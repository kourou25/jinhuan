#!/usr/bin/env python3
"""使用本机 Chromium 验收社区共建的公开入口、装扮预览和反馈流程。"""

import argparse
import json
import re
import shutil
from datetime import datetime
from math import ceil
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

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


def directory_geometry(catalog):
    return catalog.evaluate("""list => {
        const cards = [...list.querySelectorAll('a[href*="skin="]')];
        const boxes = cards.map(card => card.getBoundingClientRect());
        const pager = document.querySelector('nav[aria-label="作品分页"]');
        const controls = [...pager.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        const footer = document.querySelector('.mobile-nav')?.getBoundingClientRect();
        const bottom = footer?.height ? Math.min(innerHeight, footer.top) : innerHeight;
        const cols = new Set(boxes.map(box => Math.round(box.left))).size;
        const rows = new Set(boxes.map(box => Math.round(box.top))).size;
        const rowStep = Math.max(...boxes.map(box => box.height)) +
            (parseFloat(getComputedStyle(list).rowGap) || 0);
        const content = [...boxes, ...controls, pager.getBoundingClientRect()];
        const lastBottom = Math.max(...content.map(box => box.bottom));
        const visible = content.every(box => box.width > 0 && box.height > 0 &&
            box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.top >= -0.5 && box.bottom <= bottom + 0.5);
        return {visible, rows, cols, rowStep, bottom, lastBottom, scroll: scrollY,
            ids: cards.map(card => new URL(card.href).searchParams.get('skin'))};
    }""")


def skin_directory(page, args):
    entries = args.skin_order
    path = "/road?tab=skins"
    page.goto(args.origin + path, wait_until="networkidle")
    tab(page, "装扮工坊", selected=True)
    expect(page.get_by_role("heading", name="装扮工坊", exact=True)).to_be_visible()
    catalog = page.get_by_role("list", name="已发布作品", exact=True)
    pager = page.get_by_role("navigation", name="作品分页", exact=True)
    previous = pager.get_by_role("button", name="上一页", exact=True)
    next_page = pager.get_by_role("button", name="下一页", exact=True)
    expect(pager).to_be_visible(timeout=TIMEOUT)
    expect(page.get_by_role("heading", name="星光票根", exact=True)).to_have_count(0)

    def geometry(full=False):
        result = directory_geometry(catalog)
        assert result["visible"] and abs(result["scroll"]) < 1, f"一屏目录被遮挡或需滚动 {result}"
        if full:
            assert len(result["ids"]) == result["rows"] * result["cols"], f"满页应由整行组成 {result}"
            assert result["lastBottom"] + result["rowStep"] > result["bottom"] + 0.5, f"本屏仍可放入另一整行 {result}"
        return result

    def resize(width, height, full=True):
        page.set_viewport_size({"width": width, "height": height})
        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        return geometry(full=full)

    phone = resize(375, 820)
    wide = resize(1280, 820)
    short = resize(1280, 390)
    desktop = resize(1280, 920)
    assert phone["cols"] >= 2, "窄手机仍应显示多列作品目录"
    assert wide["cols"] > phone["cols"] and len(wide["ids"]) > len(phone["ids"]), "加宽没有容纳更多列及作品"
    assert desktop["rows"] > short["rows"] and len(desktop["ids"]) > len(short["ids"]), "加高没有容纳更多行及作品"
    for layout in (phone, short, wide, desktop):
        assert layout["ids"] == [entry["id"] for entry in entries[:len(layout["ids"])]], f"调整尺寸后首页作品错位 {layout}"

    size = len(desktop["ids"])
    assert 0 < size < len(entries), "夹具的作品数量必须超过单页容量"
    pages = ceil(len(entries) / size)
    seen = []
    for index in range(pages):
        start = index * size
        expect(pager).to_contain_text(f"第 {index + 1} / {pages} 页")
        current = geometry()
        expected = entries[start:start + size]
        assert current["ids"] == [entry["id"] for entry in expected], f"第 {index + 1} 页作品顺序或范围有误 {current}"
        seen.extend(current["ids"])
        for sample in (expected[0], expected[-1]):
            link = page.get_by_role("link", name=sample["name"], exact=True)
            card = catalog.get_by_role("listitem").filter(has=link)
            if "updated_at" in sample:
                date = datetime.fromtimestamp(sample["updated_at"], ZoneInfo("Asia/Shanghai"))
                expect(card.locator("time")).to_have_text(f"{date.year}年{date.month}月{date.day}日")
            else:
                expect(card.get_by_text("更新时间未知", exact=True)).to_be_visible()
        if index == 0:
            expect(previous).to_be_disabled()
        else:
            expect(previous).to_be_enabled()
        if index + 1 == pages:
            expect(next_page).to_be_disabled()
        else:
            expect(next_page).to_be_enabled()
            next_page.click()
            page.wait_for_url(f"**{path}&anchor={entries[start + size]['id']}")
    assert seen == [entry["id"] for entry in entries], "翻页后作品有重复或缺失"

    previous.click()
    prior_start = (pages - 2) * size
    page.wait_for_url(f"**{path}&anchor={entries[prior_start]['id']}")
    expect(pager).to_contain_text(f"第 {pages - 1} / {pages} 页")
    assert geometry()["ids"] == [entry["id"] for entry in entries[prior_start:prior_start + size]], "上一页作品范围有误"
    next_page.click()
    recent_start = (pages - 1) * size
    page.wait_for_url(f"**{path}&anchor={entries[recent_start]['id']}")
    expect(pager).to_contain_text(f"第 {pages} / {pages} 页")
    selected = entries[min(recent_start + 1, len(entries) - 1)]
    detail_url = f"{path}&skin={selected['id']}"
    anchored_url = f"{path}&anchor={selected['id']}"
    recent_ids = [entry["id"] for entry in entries[recent_start:]]
    catalog.get_by_role("link", name=selected["name"], exact=True).click()
    page.wait_for_url(f"**{detail_url}")
    expect(page.get_by_role("heading", name=selected["name"], exact=True)).to_be_visible()
    expect(pager).to_have_count(0)
    page.go_back()
    page.wait_for_url(f"**{anchored_url}")
    expect(pager).to_contain_text(f"第 {pages} / {pages} 页")
    assert geometry()["ids"] == recent_ids, "浏览器后退没有恢复原目录页"
    page.go_forward()
    page.wait_for_url(f"**{detail_url}")
    back = page.get_by_role("link", name="返回作品目录", exact=True)
    expect(back).to_have_attribute("href", anchored_url)
    back.click()
    page.wait_for_url(f"**{anchored_url}")
    expect(pager).to_contain_text(f"第 {pages} / {pages} 页")
    assert geometry()["ids"] == recent_ids, "返回后没有恢复原目录页"
    assert selected["id"] in resize(375, 820, full=False)["ids"], "缩窄非首页后丢失当前作品锚点"
    assert resize(1280, 920, full=False)["ids"] == recent_ids, "恢复宽高后丢失当前目录页"

    page.goto(args.origin + detail_url, wait_until="networkidle")
    expect(page.get_by_role("heading", name=selected["name"], exact=True)).to_be_visible()
    back.click()
    expect(pager).to_be_visible()
    assert selected["id"] in geometry()["ids"], "直接打开作品深链后，返回目录时找不到该作品"
    print(f"通过装扮目录日期排序、分页与返回验收，窄手机 {len(phone['ids'])} 件，桌面矮屏 {len(short['ids'])} 件，桌面 {size} 件。")


def skin_preview(page, args):
    if args.skin_order:
        page.goto(f"{args.origin}/road?tab=skins&skin={SKIN}", wait_until="networkidle")
    else:
        tab(page, "装扮工坊").click()
        expect(page.get_by_role("heading", name="装扮工坊", exact=True)).to_be_visible(timeout=TIMEOUT)
    tab(page, "装扮工坊", selected=True)
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
    parser.add_argument("--skin-order", type=json.loads, default=())
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
            if args.skin_order:
                skin_directory(page, args)
                page.set_viewport_size({"width": 1100, "height": 900})
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
