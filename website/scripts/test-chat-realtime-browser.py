#!/usr/bin/env python3
"""用两个独立的本地 Chromium 客户端验收群聊实时推送。"""

import argparse
import json
import os
import shutil
import sqlite3
import time
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright


TIMEOUT = 20_000


def wait_for(page, predicate, description):
    deadline = time.monotonic() + TIMEOUT / 1000
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        page.wait_for_timeout(50)
    raise AssertionError(description)


class Client:
    def __init__(self, browser, args, username, key):
        self.origin = args.origin
        self.group = args.group
        self.messages = f"/api/chat/groups/{self.group}/messages"
        self.read_path = f"/api/chat/groups/{self.group}/read"
        self.requests = []
        self.frames = []
        self.read_updates = []
        self.sockets = []
        self.connections = 0
        self.connected = None
        self.block_poll = False
        self.repeat_body = None
        self.replayed = False
        self.last_send = 0

        self.context = browser.new_context(
            service_workers="block", viewport={"width": 1360, "height": 900}
        )
        self.context.add_init_script("""
            localStorage.setItem('guideDone', '1');
            window.addEventListener('chat-realtime-shadow', event => { window.testShadow = event.detail; });
        """)
        self.context.route("**/*", self.route_http)
        self.context.route_web_socket("**/*", self.route_socket)
        self.page = self.context.new_page()
        self.page.set_default_timeout(TIMEOUT)
        self.page.on("request", self.track_request)
        self.page.on("response", self.track_read)
        self.page.on("websocket", lambda socket: self.sockets.append(socket)
                     if urlsplit(socket.url).path == "/api/chat/ws" else None)

        dest = f"/chat/{self.group}"
        response = self.context.request.post(
            f"{self.origin}/auth/dev",
            form={"key": key, "username": username, "next": dest, "tl": 2},
            max_redirects=0,
        )
        assert response.status == 302, f"测试用户登录失败，HTTP {response.status}"
        me = self.context.request.get(f"{self.origin}/api/me").json()["user"]
        assert me and me["username"] == username, "测试账号与当前会话不匹配"
        self.user_id = me["id"]
        self.input = self.page.get_by_role("textbox", name="消息", exact=True)
        self.page.goto(f"{self.origin}{dest}", wait_until="networkidle")
        expect(self.input).to_be_visible(timeout=TIMEOUT)

    def route_http(self, route):
        target = urlsplit(route.request.url)
        if f"{target.scheme}://{target.netloc}" != self.origin:
            route.abort()
        elif (self.block_poll and target.path == self.messages
                and route.request.method == "GET" and "after" in parse_qs(target.query)):
            route.fulfill(status=503, json={"error": "本地验收当前阻止轮询"})
        else:
            route.continue_()

    def track_request(self, request):
        target = urlsplit(request.url)
        self.requests.append((request.method, target.path, parse_qs(target.query)))

    def track_read(self, response):
        if (response.ok and response.request.method == "POST"
                and urlsplit(response.url).path == self.read_path):
            self.read_updates.append(response.request.post_data_json["id"])

    def route_socket(self, route):
        target = urlsplit(route.url)
        if target.path != "/api/chat/ws" or f"http://{target.netloc}" != self.origin:
            route.close(code=1013, reason="本地验收当前阻止连接")
            return
        server = route.connect_to_server()
        self.connected = server
        self.connections += 1
        connection = self.connections

        def forward(raw):
            frame = json.loads(raw)
            self.frames.append((connection, frame))
            route.send(raw)
            if (self.repeat_body is not None and not self.replayed
                    and frame.get("type") == "batch"
                    and any(m.get("body") == self.repeat_body for m in frame["items"])):
                route.send(raw)
                self.replayed = True

        server.on_message(forward)

    def allow_socket(self, allow):
        self.page.evaluate("""allow => {
            window.savedTestWebSocket ??= window.WebSocket;
            window.WebSocket = allow ? window.savedTestWebSocket : class extends window.savedTestWebSocket {
                constructor() { throw new Error('本地验收当前阻止重连'); }
            };
        }""", allow)

    def wait_frame(self, kind, *, after_connection=0, mid=None):
        def find():
            return next((frame for connection, frame in self.frames if
                         connection > after_connection and frame.get("group") == self.group
                         and frame.get("type") == kind
                         and (mid is None or any(m.get("id") == mid for m in frame.get("items", [])))), None)

        return wait_for(self.page, find, f"未观察到 WS {kind} 帧，消息编号 {mid}")

    def wait_socket_ready(self):
        return wait_for(self.page, lambda: self.connections and len(self.sockets) == self.connections
                        and not self.sockets[-1].is_closed() and any(
                            connection == self.connections and frame.get("type") == "ready"
                            and frame.get("group") == self.group for connection, frame in self.frames
                        ) and self.connections, "当前浏览器的实际 WS 连接未就绪")

    def message_gets(self, start, *, incremental=False):
        return [query for method, path, query in self.requests[start:]
                if method == "GET" and (path == self.messages or path.startswith(self.messages + "/"))
                and (not incremental or "after" in query)]

    def send(self, body):
        delay = self.last_send + 1.05 - time.monotonic()
        if delay > 0:
            self.page.wait_for_timeout(delay * 1000)
        with self.page.expect_response(
            lambda r: urlsplit(r.url).path == self.messages and r.request.method == "POST"
        ) as sent:
            self.input.fill(body)
            self.page.get_by_role("button", name="发送", exact=True).click()
        response = sent.value
        assert response.ok, f"消息 POST 失败，HTTP {response.status}"
        self.last_send = time.monotonic()
        message = response.json()["message"]
        assert message["body"] == body, "POST 响应正文不匹配"
        return message["id"]

    def row(self, mid):
        return self.page.locator(f'.cm-list .cm-row[data-row="{mid}"]')

    def go_latest(self):
        latest = self.page.locator(".cm-latest")
        down = self.page.locator(".cm-down")
        if latest.is_visible():
            latest.click()
            expect(latest).to_be_hidden(timeout=TIMEOUT)
        elif down.is_visible():
            down.click()
        self.page.wait_for_function("""() => {
            const list = document.querySelector('.cm-scroll');
            return list.querySelector('.cm-row') && list.scrollHeight - list.scrollTop - list.clientHeight < 3;
        }""")

    def see(self, mid, body):
        expect(self.row(mid)).to_have_count(1, timeout=TIMEOUT)
        expect(self.row(mid).locator(".cm-text")).to_have_text(body, timeout=TIMEOUT)

    def read_cursor(self):
        response = self.context.request.get(f"{self.origin}{self.messages}")
        assert response.ok, f"读取群聊游标失败，HTTP {response.status}"
        return response.json()["last_read"]


def wait_read(client, mid):
    wait_for(client.page, lambda: any(read >= mid for read in client.read_updates),
             f"群聊页面未成功提交消息 {mid} 的已读请求")
    assert client.read_cursor() >= mid, f"服务端已读游标未推进到消息 {mid}"


@contextmanager
def chat_controls(path, group):
    # 操作隔离夹具，退出验收时恢复这条配置记录。
    with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=rw", uri=True)) as db:
        prior = db.execute("SELECT disabled, shadow FROM chat_realtime_controls WHERE group_id=?", (group,)).fetchone()

        def change(*, disabled=False, shadow=False):
            with db:
                db.execute("""INSERT INTO chat_realtime_controls (group_id, disabled, shadow) VALUES (?, ?, ?)
                           ON CONFLICT (group_id) DO UPDATE SET disabled=excluded.disabled, shadow=excluded.shadow""",
                           (group, int(disabled), int(shadow)))

        try:
            yield change
        finally:
            with db:
                if prior is None:
                    db.execute("DELETE FROM chat_realtime_controls WHERE group_id=?", (group,))
                else:
                    db.execute("UPDATE chat_realtime_controls SET disabled=?, shadow=? WHERE group_id=?", (*prior, group))


def check_live(sender, receiver, tag):
    for client in (sender, receiver):
        client.go_latest()
        client.wait_frame("ready")
    before_send = [len(client.requests) for client in (sender, receiver)]
    body = f"浏览器实时验收 {tag}"
    receiver.repeat_body = body
    first = sender.send(body)
    sent_batch = sender.wait_frame("batch", mid=first)
    received_batch = receiver.wait_frame("batch", mid=first)
    own = next(m for m in sent_batch["items"] if m["id"] == first)
    peer = next(m for m in received_batch["items"] if m["id"] == first)
    assert own["mine"] and own.get("command_id"), "发件人未收到自己的请求编号"
    assert not peer["mine"] and "command_id" not in peer, "收件人看到了发件人的私有消息字段"
    receiver.see(first, body)
    assert receiver.replayed, "未注入重复的 WS 批次"
    second = sender.send(body)
    assert first != second, "用户有意发送相同正文时被错误合并"
    receiver.wait_frame("batch", mid=second)
    for client in (sender, receiver):
        client.see(first, body)
        client.see(second, body)
    # 观测时间长于原有 3 秒轮询，避免把下一轮轮询尚未发生误判为已停止。
    receiver.page.wait_for_timeout(4200)
    for client, start in zip((sender, receiver), before_send):
        assert client.message_gets(start) == [], "实时连接期间出现了群消息 GET"
    wait_read(receiver, second)
    print(f"通过实时 POST、重复帧去重、同文双发和已读验收，消息 {first}、{second}，两个页面新增群消息 GET 均为 0")


def check_reconnect(sender, receiver, tag):
    previous = receiver.connections
    requests_at_close = len(receiver.requests)
    receiver.allow_socket(False)
    receiver.connected.close(code=4001, reason="本地验收模拟链路短断")
    try:
        body = f"浏览器短断验收 {tag}"
        offline = sender.send(body)
        receiver.see(offline, body)
        assert receiver.message_gets(requests_at_close, incremental=True), "断线后未通过 HTTP 补收"
    finally:
        receiver.allow_socket(True)
    receiver.wait_frame("ready", after_connection=previous)

    after_ready = len(receiver.requests)
    body = f"浏览器重连验收 {tag}"
    mid = sender.send(body)
    receiver.wait_frame("batch", mid=mid, after_connection=previous)
    receiver.see(mid, body)
    assert receiver.message_gets(after_ready) == [], "重新就绪后仍在轮询消息"
    wait_read(receiver, mid)

    previous = receiver.connections
    receiver.allow_socket(False)
    receiver.block_poll = True
    receiver.connected.close(code=4001, reason="本地验收模拟漏收消息")
    try:
        body = f"浏览器实时补收验收 {tag}"
        missed = sender.send(body)
        receiver.allow_socket(True)
        receiver.wait_frame("batch", mid=missed, after_connection=previous)
        receiver.wait_frame("ready", after_connection=previous)
        receiver.see(missed, body)
    finally:
        receiver.allow_socket(True)
        receiver.block_poll = False
    wait_read(receiver, missed)
    print(f"通过断线 HTTP 补收、重新建立实时连接和 WS 补收验收，消息 {offline}、{mid}、{missed}")


def check_old_window(sender, receiver, tag):
    page = receiver.page
    oldest = int(page.locator(".cm-list .cm-row").first.get_attribute("data-row"))
    cursor = receiver.read_cursor()
    page.add_init_script(f"""localStorage.setItem('chatReading:v1', JSON.stringify({{
      [{json.dumps(f'{receiver.user_id}:{receiver.group}')}]: {{
        id: {oldest}, offset: 0, height: 40, width: 0, tail: {cursor}, bottom: false, at: Date.now()
      }}
    }}));""")
    previous = receiver.connections
    page.reload(wait_until="networkidle")
    latest = page.get_by_role("button", name="回到最新消息", exact=False)
    expect(latest).to_be_visible(timeout=TIMEOUT)
    anchor = receiver.row(oldest)
    expect(anchor).to_have_count(1, timeout=TIMEOUT)
    receiver.wait_frame("ready", after_connection=previous)
    old_top = anchor.evaluate("row => row.getBoundingClientRect().top")

    body = f"浏览器旧窗口验收 {tag}"
    mid = sender.send(body)
    receiver.wait_frame("batch", mid=mid, after_connection=previous)
    expect(latest).to_be_visible(timeout=TIMEOUT)
    expect(receiver.row(mid)).to_have_count(0)
    assert abs(anchor.evaluate("row => row.getBoundingClientRect().top") - old_top) <= 3, "旧阅读位置发生跳动"
    assert receiver.read_cursor() == cursor, "旧窗口意外推进了服务端已读游标"

    latest.click()
    receiver.see(mid, body)
    wait_read(receiver, mid)
    print(f"通过旧窗口验收，旧阅读窗口保持定位且游标为 {cursor}，回到最新后呈现并标记消息 {mid}")


def check_disabled(sender, receiver, args, tag):
    with chat_controls(args.db, args.group) as change:
        change(disabled=True)
        receiver.wait_frame("disabled")
        after_disabled = len(receiver.requests)
        body = f"浏览器回退轮询验收 {tag}"
        mid = sender.send(body)
        receiver.see(mid, body)
        assert receiver.message_gets(after_disabled, incremental=True), "关闭实时后未恢复 HTTP 消息轮询"
        assert all(not any(m.get("id") == mid for m in frame.get("items", []))
                   for _, frame in receiver.frames), "关闭后仍通过 WS 接收群消息"
    print(f"通过服务端关闭实时后的轮询验收，消息 {mid}")


def check_shadow(sender, receiver, args, tag):
    clients = (sender, receiver)
    with chat_controls(args.db, args.group) as change:
        connections = [client.connections for client in clients]
        change(shadow=True)
        for client, previous in zip(clients, connections):
            client.wait_frame("ready", after_connection=previous)
            client.go_latest()

        page = receiver.page
        receiver.block_poll = True
        try:
            body = f"浏览器影子比对验收 {tag}"
            shadow = sender.send(body)
            receiver.wait_frame("batch", mid=shadow, after_connection=connections[1])
            page.wait_for_function("window.testShadow?.batches > 0")
            expect(receiver.row(shadow)).to_have_count(0)
        finally:
            receiver.block_poll = False
        receiver.see(shadow, body)
        stats = page.wait_for_function("window.testShadow?.compared > 0 && window.testShadow").json_value()
        assert stats["mismatch"] == 0, "影子阶段同快照比对发生差异"
        assert set(stats) == {"batches", "compared", "mismatch"}, "影子诊断输出了计数以外的信息"
        wait_read(receiver, shadow)

        connections = [client.connections for client in clients]
        change()
        for client, previous in zip(clients, connections):
            client.wait_frame("ready", after_connection=previous)
        before_send = [len(client.requests) for client in clients]
        body = f"浏览器切换实时验收 {tag}"
        live = sender.send(body)
        receiver.wait_frame("batch", mid=live, after_connection=connections[1])
        receiver.see(live, body)
        page.wait_for_timeout(4200)
        for client, start in zip(clients, before_send):
            assert client.message_gets(start) == [], "影子切为实时后仍请求群消息 GET"
    print(f"通过影子到实时切换验收，影子比对 {stats['compared']} 条、差异 {stats['mismatch']} 条，消息 {shadow}、{live}")


def check_popout(sender, receiver, tag):
    page = receiver.page
    expected = f"{receiver.origin}/chat/{receiver.group}"
    assert page.evaluate("typeof window.documentPictureInPicture?.requestWindow === 'function'"), "本机 Chromium 缺少文档画中画能力"
    page.get_by_role("link", name="图廊", exact=True).click()
    page.get_by_role("button", name="打开群聊", exact=True).click()
    pick = page.get_by_role("combobox", name="切换群", exact=True)
    if pick.is_visible():
        pick.select_option(str(receiver.group))
    page.get_by_role("button", name="置顶浮窗", exact=False).click()
    page.wait_for_function("documentPictureInPicture.window?.document.querySelector('.cm-list .cm-row')")
    connection = receiver.wait_socket_ready()
    try:
        group_name = page.evaluate("documentPictureInPicture.window.document.querySelector('.pip-name').textContent")
        page.locator('nav[aria-label="主导航"] a[href="/chat"]').click()
        if page.url != expected:
            page.locator(".chat-groups .chat-gr").filter(has=page.get_by_text(group_name, exact=True)).click()
        page.wait_for_url(expected)
        expect(receiver.input).to_be_visible(timeout=TIMEOUT)
        receiver.go_latest()
        assert receiver.wait_socket_ready() == connection, "打开主窗后建立了额外的 WS 连接"
        assert sum(not s.is_closed() for s in receiver.sockets) == 1, "两窗没有共用一个实际 WS 连接"

        body = f"浏览器双窗口验收 {tag}"
        mid = sender.send(body)
        receiver.wait_frame("batch", mid=mid, after_connection=connection - 1)
        receiver.see(mid, body)
        page.wait_for_function("""({mid, body}) => {
            const doc = documentPictureInPicture.window?.document;
            return doc?.querySelector(`.cm-list .cm-row[data-row="${mid}"] .cm-text`)?.textContent === body;
        }""", arg={"mid": mid, "body": body})
    finally:
        page.evaluate("documentPictureInPicture.window?.close()")
        page.wait_for_function("!documentPictureInPicture.window")

    before_send = len(receiver.requests)
    body = f"浏览器关闭浮窗验收 {tag}"
    after = sender.send(body)
    receiver.wait_frame("batch", mid=after, after_connection=connection - 1)
    receiver.see(after, body)
    assert receiver.connections == connection and not receiver.sockets[-1].is_closed(), "关闭浮窗影响了主窗 WS 连接"
    assert receiver.message_gets(before_send) == [], "关闭浮窗后主窗恢复了群消息 GET"
    print(f"通过原生文档画中画验收，两窗共用一个实际 WS 连接，关闭浮窗后原连接继续推送，消息 {mid}、{after}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="http://localhost:18794", help="本机验收服务地址")
    parser.add_argument("--group", type=int, default=7, help="启用实时且预先填充历史的测试群 ID")
    parser.add_argument("--sender", default="vps_browser_a", help="已加入测试群的发件账号")
    parser.add_argument("--receiver", default="vps_browser_b", help="已加入测试群的收件账号")
    parser.add_argument("--key-file", type=Path, help="包含 DEV_LOGIN_KEY 的本机 .env 文件")
    parser.add_argument("--db", required=True, type=Path, help="可临时切换群实时开关的隔离 SQLite 数据库")
    parser.add_argument("--chromium", default=shutil.which("chromium"), help="本机 Chromium 可执行文件路径")
    args = parser.parse_args()
    args.origin = args.origin.rstrip("/")
    origin = urlsplit(args.origin)
    if (origin.scheme != "http" or origin.hostname not in {"localhost", "127.0.0.1", "::1"}
            or origin.username or origin.path or origin.query or origin.fragment):
        parser.error("仅允许测试本机 HTTP 服务地址")
    if args.sender == args.receiver:
        parser.error("发件与收件账号必须不同")
    key = os.environ.get("CHAT_TEST_KEY")
    if not key and args.key_file:
        for line in args.key_file.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "DEV_LOGIN_KEY":
                key = value.strip().strip("'\"")
                break
    if not key:
        parser.error("请通过 --key-file 或 CHAT_TEST_KEY 提供本地测试口令")

    tag = uuid4().hex[:10]
    with sync_playwright() as p:
        sender_browser = p.chromium.launch(headless=True, executable_path=args.chromium)
        receiver_browser = p.chromium.launch(headless=True, executable_path=args.chromium)
        try:
            sender = Client(sender_browser, args, args.sender, key)
            receiver = Client(receiver_browser, args, args.receiver, key)
            check_live(sender, receiver, tag)
            check_reconnect(sender, receiver, tag)
            check_old_window(sender, receiver, tag)
            check_shadow(sender, receiver, args, tag)
            check_popout(sender, receiver, tag)
            check_disabled(sender, receiver, args, tag)
        finally:
            receiver_browser.close()
            sender_browser.close()


if __name__ == "__main__":
    main()
