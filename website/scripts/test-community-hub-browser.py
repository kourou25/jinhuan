#!/usr/bin/env python3
"""使用本机 Chromium 验收社区共建的公开入口、装扮预览和反馈流程。"""

import argparse
import json
import re
import shutil
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright


TIMEOUT = 12_000
SKIN = "shiratori-starlight"
TITLE = "浏览器验收星光票根反馈"
BODY = "站内作品详情仅供反馈"
PUBLIC_BODY = "这段公开说明可同步"
GITHUB_REPO = "https://github.com/kourou25/jinhuan"
SKIN_UPDATES = "**/api/community-skins/updates"


def target_params(url):
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


def tab(page, name, selected=None):
    link = page.get_by_role("navigation", name="社区共建").get_by_role("link", name=name, exact=True)
    if selected:
        expect(link).to_have_attribute("aria-current", "page", timeout=TIMEOUT)
    return link


def assert_no_visible_null(section):
    visible_null = section.evaluate("""root => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            if (text.textContent.trim() !== 'null' || getComputedStyle(text.parentElement).visibility !== 'visible') continue;
            const range = document.createRange();
            range.selectNode(text);
            if ([...range.getClientRects()].some(rect => rect.width && rect.height)) return true;
        }
        return false;
    }""")
    assert not visible_null, "站点更新出现了可见的裸文本 null"


def expect_site_updates(page, args, only_fix=False):
    site = page.get_by_role("region", name="站点更新", exact=True)
    if not args.release_data:
        expect(site.get_by_role("heading", name=args.fix_title, exact=True)).to_be_visible(timeout=TIMEOUT)
        expect(site.get_by_role("heading", name=args.feature_title, exact=True)).to_have_count(0 if only_fix else 1)
        return site
    release = args.release_data[1 if only_fix else 0]
    title = page.get_by_role("heading", name=release["title"], exact=True)
    card = site.get_by_role("article").filter(has=title)
    expect(card).to_be_visible(timeout=TIMEOUT)
    expect(card.locator("time")).to_have_attribute("datetime", release["date"])
    groups = [(name, items) for name, items in release["groups"] if not only_fix or name == "修复"]
    expect(card.locator("section").get_by_role("heading")).to_have_text([name for name, _ in groups])
    for name, items in groups:
        group = card.locator("section").filter(has=page.get_by_role("heading", name=name, exact=True))
        expect(group.get_by_role("listitem")).to_have_text(items)
    return site


def updates(page, args):
    updates_path = "/road?tab=updates" if args.release_data else "/road"
    page.goto(args.origin + updates_path, wait_until="networkidle")
    tab(page, "更新记录", selected=True)
    site = expect_site_updates(page, args)
    assert_no_visible_null(site)
    if args.release_data:
        expect(page.get_by_role("link", name="在 GitHub 提需求", exact=True)).to_have_attribute(
            "href", GITHUB_REPO + "/issues/new/choose")
    if args.backend == "sync":
        changes = page.get_by_role("complementary", name="装扮变更", exact=True)
        expect(page.get_by_role("heading", name="已上线", exact=True)).to_be_visible()
        expect(page.get_by_role("heading", name="待主站同步", exact=True)).to_be_visible()
        expect(changes.get_by_role("link", name=args.other_skin_title, exact=True)).to_be_visible()
        expect(page.get_by_text("等待同步的夹具票根", exact=True)).to_be_visible()
    else:
        expect(page.get_by_role("heading", name="待主站同步", exact=True)).to_have_count(0)

    if args.release_data and args.backend == "sync":
        page.route(SKIN_UPDATES, lambda route: route.fulfill(status=503, json={"error": "夹具暂时不可用"}), times=1)
        with page.expect_response(SKIN_UPDATES) as failed:
            page.goto(args.origin + "/road?tab=updates&kind=fix", wait_until="networkidle")
        assert failed.value.status == 503, "未触发独立的装扮变更请求失败"
        expect_site_updates(page, args, only_fix=True)
        expect(changes.get_by_role("status")).to_contain_text("装扮变更暂时无法读取。")
        with page.expect_response(SKIN_UPDATES) as retried:
            changes.get_by_role("button", name="重新读取", exact=True).click()
        assert retried.value.ok, "重试后未读到真实装扮变更"
        expect(changes.get_by_role("link", name=args.other_skin_title, exact=True)).to_be_visible()
        expect_site_updates(page, args, only_fix=True)
    elif args.release_data:
        page.goto(args.origin + "/road?tab=updates&kind=fix", wait_until="networkidle")
        expect_site_updates(page, args, only_fix=True)
    else:
        page.goto(args.origin + "/community-updates.html?kind=fix", wait_until="networkidle")
        page.wait_for_url("**/road?tab=updates&kind=fix")
        expect_site_updates(page, args, only_fix=True)
        expect(page.get_by_role("link", name=re.compile("^修复")).filter(has_text="修复")).to_have_attribute("aria-current", "true")

    tab(page, "鞭打反馈").click()
    tab(page, "鞭打反馈", selected=True)
    expect(page.get_by_role("link", name="登录查看", exact=True)).to_be_visible(timeout=TIMEOUT)
    expect(page.locator(".rd-card")).to_have_count(0)
    print("通过游客更新记录、修复分类及反馈登录门槛验收。")


def skin_history(page, args):
    page.get_by_role("link", name="查看作品更新", exact=True).click()
    page.wait_for_url(f"**/road?tab=updates&skin={SKIN}")
    tab(page, "更新记录", selected=True)
    changes = page.get_by_role("complementary", name="装扮变更", exact=True)
    published = changes.get_by_role("link", name="星光票根", exact=True)
    expect(changes.get_by_role("heading", name="已上线", exact=True)).to_be_visible(timeout=TIMEOUT)
    expect(published).to_have_attribute("href", f"/road?tab=skins&skin={SKIN}")
    expect(changes.get_by_text(args.other_skin_title, exact=True)).to_have_count(0)
    expect(changes.get_by_text("等待同步的夹具票根", exact=True)).to_have_count(0)
    expect_site_updates(page, args)

    changes.get_by_role("link", name="查看全部装扮变更", exact=True).click()
    page.wait_for_url("**/road?tab=updates")
    expect(changes.get_by_role("link", name=args.other_skin_title, exact=True)).to_be_visible(timeout=TIMEOUT)
    expect(changes.get_by_text("等待同步的夹具票根", exact=True)).to_be_visible()
    published.click()
    page.wait_for_url(f"**/road?tab=skins&skin={SKIN}")
    tab(page, "装扮工坊", selected=True)
    expect(page.get_by_role("heading", name="星光票根", exact=True)).to_be_visible(timeout=TIMEOUT)
    print("通过作品专属更新、其他作品排除、站点更新保留、清除筛选与返回作品验收。")


def legacy_skin_history(page, args):
    page.goto(f"{args.origin}/road?tab=updates&skin={SKIN}", wait_until="networkidle")
    tab(page, "更新记录", selected=True)
    back = page.get_by_role("link", name="返回作品", exact=True)
    expect(page.locator("p").filter(has=back)).to_contain_text("当前站点暂未提供作品更新记录。", timeout=TIMEOUT)
    expect_site_updates(page, args)
    expect(back).to_have_attribute("href", f"/road?tab=skins&skin={SKIN}")
    back.click()
    page.wait_for_url(f"**/road?tab=skins&skin={SKIN}")
    tab(page, "装扮工坊", selected=True)
    expect(page.get_by_role("heading", name="星光票根", exact=True)).to_be_visible(timeout=TIMEOUT)
    print("通过旧服务的作品更新深链降级、保留站点更新和返回对应作品验收。")


def skin_preview(page, args):
    tab(page, "装扮工坊").click()
    tab(page, "装扮工坊", selected=True)
    expect(page.get_by_role("heading", name="装扮工坊", exact=True)).to_be_visible(timeout=TIMEOUT)
    expect(page.get_by_role("heading", name="星光票根", exact=True)).to_be_visible()
    frame = page.frame_locator("iframe.ch-preview")
    bubble = frame.locator(f".ch-stage-bubble.cskin-bubble-{SKIN}")
    expect(bubble).to_have_text("晚安，明天见！", timeout=TIMEOUT)
    page.locator('[data-preview-theme="light"]').click()
    expect(frame.locator("html")).to_have_attribute("data-theme", "light")
    expect(bubble).to_have_css("color", "rgb(38, 52, 82)", timeout=TIMEOUT)
    short_height = bubble.bounding_box()["height"]
    page.locator('[data-preview-theme="dark"]').click()
    expect(frame.locator("html")).to_have_attribute("data-theme", "dark")
    expect(bubble).to_have_css("color", "rgb(240, 242, 252)")
    page.locator('[data-preview-length="long"]').click()
    expect(page.locator("iframe.ch-preview")).to_have_attribute("data-preview-length", "long")
    expect(bubble).to_contain_text("今晚的流星来得比平时晚一些")
    assert bubble.bounding_box()["height"] > short_height, "长消息未展示真实换行和气泡高度变化"
    page.locator('[data-preview-length="short"]').click()
    expect(bubble).to_have_text("晚安，明天见！")

    original = bubble.element_handle()
    page.locator("[data-preview-replay]").click()
    assert not original.evaluate("element => element.isConnected"), "重播应重新开始样式动画"
    animation = bubble.evaluate("element => element.getAnimations().map(a => a.animationName)")
    assert any(name.endswith("ticket-edge-light") for name in animation), f"没有实际播放星光动效，动画 {animation}"

    if args.backend == "sync":
        skin_history(page, args)
    else:
        expect(page.get_by_role("link", name="查看作品更新", exact=True)).to_have_count(0)
        legacy_skin_history(page, args)
    page.get_by_role("button", name="反馈这套装扮", exact=True).click()
    login = page.get_by_role("link", name="登录后反馈", exact=True)
    expect(login).to_be_visible(timeout=TIMEOUT)
    return_to = target_params(login.get_attribute("href"))["next"]
    assert urlsplit(return_to).path == "/road"
    params = target_params(return_to)
    source = params.pop("source", None)
    if args.backend == "sync":
        assert source == args.skin_source
    else:
        assert source in (None, args.skin_source)
    assert params == {"tab": "feedback", "compose": "1", "skin": SKIN}
    print("通过星光票根真实发布 CSS、日夜主题、短长消息、重播和作品反馈共享参数验收。")
    return return_to


def expect_post(path):
    return lambda response: response.request.method == "POST" and urlsplit(response.url).path == path


def open_feedback(page, args, return_to):
    key = next(line.split("=", 1)[1] for line in args.env_file.read_text().splitlines() if line.startswith("DEV_LOGIN_KEY="))
    login = page.context.request.post(args.origin + "/auth/dev", form={
        "key": key, "username": "community_e2e_author", "next": return_to, "tl": 2,
    }, max_redirects=0)
    assert login.status == 302, f"测试账号登录失败，HTTP {login.status}"
    page.goto(args.origin + return_to, wait_until="networkidle")
    tab(page, "鞭打反馈", selected=True)
    form = page.locator("form.road-fbody")
    expect(form.get_by_role("link", name=re.compile("^关联作品.*星光票根$"))).to_be_visible(timeout=TIMEOUT)
    form.get_by_label("标题", exact=True).fill(TITLE)
    return form


def legacy_feedback(page, args, return_to):
    form = open_feedback(page, args, return_to)
    details = form.get_by_label("详情", exact=True)
    expect(details).to_be_editable()
    expected_context = f"关于这件社区作品\n{args.origin}/road?tab=skins&skin={SKIN}"
    initial = details.input_value()
    assert initial.startswith(expected_context), f"旧服务表单未附上可编辑的作品上下文 {initial!r}"
    edited = initial.replace("关于这件社区作品", "已编辑的作品上下文").rstrip() + "\n\n" + BODY
    details.fill(edited)
    expect(form.get_by_role("checkbox", name="同步到 GitHub", exact=True, include_hidden=True)).to_have_count(0)
    expect(form.get_by_label("公开标题", exact=True)).to_have_count(0)
    expect(form.get_by_label("公开正文", exact=True)).to_have_count(0)

    with page.expect_response(expect_post("/api/road")) as stored:
        form.get_by_role("button", name="提交", exact=True).click()
    response = stored.value
    assert response.ok, f"旧服务普通反馈保存失败，HTTP {response.status}"
    payload = response.request.post_data_json
    assert payload["title"] == TITLE and payload["body"] == edited
    assert set(payload) == {"kind", "title", "body", "media"}, f"旧服务普通反馈请求出现扩展字段 {payload.keys()}"
    item = response.json()["id"]

    page.goto(f"{args.origin}/road?item={item}", wait_until="networkidle")
    assert target_params(page.url) == {"item": str(item)}
    card = page.locator(f"article#road-{item}")
    expect(page.locator("article.rd-card")).to_have_count(1, timeout=TIMEOUT)
    expect(card.get_by_role("heading", name=TITLE, exact=True)).to_be_visible()
    expect(card.locator(".rd-body")).to_contain_text("已编辑的作品上下文")
    expect(card.locator(".rd-body")).to_contain_text(BODY)
    expect(card.get_by_role("link", name=re.compile(r"GitHub Issue #"))).to_have_count(0)
    expect(card.get_by_role("button", name=re.compile("GitHub|Issue"), include_hidden=True)).to_have_count(0)

    page.goto(f"{args.origin}/road?tab=feedback&issue={args.issue}", wait_until="networkidle")
    expect(page.get_by_text("暂时无法查看关联反馈", exact=True)).to_be_visible(timeout=TIMEOUT)
    expect(page.locator("article.rd-card")).to_have_count(0)
    print("通过旧服务的作品一键反馈、可编辑上下文、普通保存、旧单条链接及关联反馈降级验收。")


def feedback(page, args, return_to):
    form = open_feedback(page, args, return_to)
    form.get_by_label("详情", exact=True).fill(BODY)
    form.get_by_role("checkbox", name="同步到 GitHub", exact=True).check()
    form.get_by_label("公开标题", exact=True).fill(args.denied_title)
    form.get_by_label("公开正文", exact=True).fill(PUBLIC_BODY)
    form.get_by_text("预览公开内容", exact=True).click()
    expect(form.locator("details")).to_contain_text(PUBLIC_BODY)
    assert BODY not in form.locator("details").inner_text(), "公开预览包含站内详情"

    with (page.expect_response(expect_post("/api/road")) as stored,
          page.expect_response(lambda response: response.request.method == "POST" and re.fullmatch(
              r"/api/road/\d+/github", urlsplit(response.url).path)) as published):
        form.get_by_role("button", name="提交", exact=True).click()
    site = stored.value
    external = published.value
    assert site.ok and external.status == 503, f"站内保存及假 GitHub 失败未分别返回预期状态 {site.status}/{external.status}"
    item = site.json()["id"]
    assert site.request.post_data_json["skin_id"] == SKIN
    assert site.request.post_data_json["skin_source"] == args.skin_source
    assert external.request.post_data_json == {"title": args.denied_title, "body": PUBLIC_BODY}
    assert external.json()["github_sync_status"] == "failed"

    page.goto(f"{args.origin}/road?item={item}", wait_until="networkidle")
    assert target_params(page.url) == {"item": str(item)}
    card = page.locator(f"article#road-{item}")
    expect(page.locator("article.rd-card")).to_have_count(1, timeout=TIMEOUT)
    expect(card.get_by_role("heading", name=TITLE, exact=True)).to_be_visible()
    expect(card.get_by_text(BODY, exact=True)).to_be_visible()
    source = card.get_by_role("link", name=re.compile("^关联作品.*星光票根$"))
    expect(source).to_have_attribute("href", f"/road?tab=skins&skin={SKIN}")
    card.get_by_role("button", name="重试 GitHub 同步", exact=True).click()
    page.get_by_role("button", name="关联已有 Issue", exact=True).click()
    form.get_by_label("Issue 编号", exact=True).fill(str(args.issue))
    with page.expect_response(expect_post(f"/api/road/{item}/github")) as attached:
        form.get_by_role("button", name="关联 Issue", exact=True).click()
    linked = attached.value.json()
    assert attached.value.ok and linked == {"github_issue": args.issue, "github_sync_status": "linked"}
    expect(card.get_by_role("link", name=f"GitHub Issue #{args.issue}")).to_have_attribute(
        "href", f"https://github.com/kourou25/jinhuan/issues/{args.issue}")
    card.get_by_role("link", name="查看关联更新", exact=True).click()
    page.wait_for_url(f"**/road?tab=updates&issue={args.issue}")
    if args.release_data:
        site = expect_site_updates(page, args)
        issue_url = f"{GITHUB_REPO}/issues/{args.issue}"
        feedback_url = f"/road?tab=feedback&issue={args.issue}"
        issue_link = page.get_by_role("link", name="打开 GitHub Issue", exact=True)
        expect(site.locator("p").filter(has=issue_link)).to_contain_text(f"更新记录里暂时没有需求 #{args.issue}。")
        expect(issue_link).to_have_attribute("href", issue_url)
        expect(site.get_by_role("article").locator(f'a[href="{issue_url}"], a[href="{feedback_url}"]')).to_have_count(0)
    else:
        update = page.locator(f"#ch-issue-{args.issue}.ch-update-target")
        expect(update).to_contain_text(args.fix_title, timeout=TIMEOUT)
    with page.expect_response(lambda response: response.ok and response.request.method == "GET" and
                              urlsplit(response.url).path == "/api/road" and
                              target_params(response.url).get("issue") == str(args.issue)) as filtered:
        if args.release_data:
            page.goto(f"{args.origin}/road?tab=feedback&issue={args.issue}", wait_until="networkidle")
        else:
            update.get_by_role("link", name="查看关联反馈", exact=True).click()
    page.wait_for_url(f"**/road?tab=feedback&issue={args.issue}")
    titles = {entry["title"] for entry in filtered.value.json()["items"]}
    assert titles == {TITLE, "兼容历史群聊反馈"}, f"Issue 回链包含未关联或隐藏反馈 {titles}"
    expect(page.locator("article.rd-card")).to_have_count(2, timeout=TIMEOUT)
    expect(card.get_by_role("heading", name=TITLE, exact=True)).to_be_visible()
    print("通过作品反馈先保存、公开字段分离、已有 Issue 关联、更新页 GitHub 入口及反馈筛选验收。")


def invalid_issue_deeplinks(page, args, requests):
    for value in ("", "not-an-issue"):
        start = len(requests)
        page.goto(f"{args.origin}/road?tab=feedback&issue={value}", wait_until="networkidle")
        tab(page, "鞭打反馈", selected=True)
        expect(page.get_by_text("无效的 Issue 编号", exact=True)).to_be_visible(timeout=TIMEOUT)
        expect(page.get_by_role("link", name="查看全部反馈", exact=True)).to_have_attribute("href", "/road?tab=feedback")
        expect(page.locator("article.rd-card")).to_have_count(0)
        assert not any(urlsplit(url).path == "/api/road" for url in requests[start:]), "无效 Issue 深链不应请求反馈列表"
    print("通过空值和非法 Issue 深链验收，页面保留提示，没有请求反馈列表。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--backend", required=True, choices=("legacy", "sync"))
    parser.add_argument("--skin-source", required=True)
    parser.add_argument("--fix-title", required=True)
    parser.add_argument("--feature-title", required=True)
    parser.add_argument("--other-skin-title", required=True)
    parser.add_argument("--issue", required=True, type=int)
    parser.add_argument("--denied-title", required=True)
    parser.add_argument("--release-data", type=json.loads, default=())
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme != "http" or origin.hostname != "127.0.0.1" or origin.path or not origin.port:
        parser.error("仅接受显式端口的本机隔离服务地址")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=shutil.which("chromium"),
                                    args=["--proxy-server=http://127.0.0.1:1"])
        try:
            context = browser.new_context(viewport={"width": 1100, "height": 900}, color_scheme="light",
                                          reduced_motion="no-preference", service_workers="block")
            context.add_init_script("localStorage.setItem('guideDone', '1');")
            page = context.new_page()
            requests = []
            page.on("request", lambda request: requests.append(request.url))
            page.set_default_timeout(TIMEOUT)
            updates(page, args)
            return_to = skin_preview(page, args)
            if args.backend == "sync":
                feedback(page, args, return_to)
            else:
                legacy_feedback(page, args, return_to)
            invalid_issue_deeplinks(page, args, requests)
            if args.release_data:
                retired = {"/api/community-updates", "/community-updates.html"}
                assert not any(urlsplit(url).path in retired for url in requests), "更新页面请求了已下线的地址"
            if args.backend == "legacy":
                unsupported = [url.geturl() for url in map(urlsplit, requests) if (
                    url.path == "/api/community-skins/updates"
                    or re.fullmatch(r"/api/road/\d+/github", url.path)
                    or url.path == "/api/road" and "issue" in parse_qs(url.query, keep_blank_values=True)
                )]
                assert not unsupported, f"旧服务浏览会话发出了不可用的 API 请求 {unsupported}"
        finally:
            browser.close()


if __name__ == "__main__":
    main()
