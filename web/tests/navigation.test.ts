import assert from "node:assert/strict";
import test from "node:test";

import { defaultNavigationItems, getVisibleNavigationItems, isNavigationItemActive, isSafeNavigationHref, parseNavigationItems } from "../src/lib/navigation.ts";

test("未配置使用默认菜单，主动清空不会恢复默认", () => {
    assert.deepEqual(getVisibleNavigationItems(), defaultNavigationItems);
    assert.deepEqual(getVisibleNavigationItems(null), defaultNavigationItems);
    assert.deepEqual(getVisibleNavigationItems([]), []);
});

test("菜单保持配置顺序、名称和打开方式，过滤隐藏项及危险链接", () => {
    const custom = { id: "docs", label: "文档站", href: "https://example.com/docs", enabled: true, newTab: true };
    const renamed = { ...defaultNavigationItems[0], label: "项目" };
    assert.deepEqual(getVisibleNavigationItems([custom, { ...renamed, enabled: false }, renamed, { ...custom, href: "javascript:alert(1)" }]), [custom, renamed]);
});

test("仅接受站内路径与 HTTP(S) 链接", () => {
    for (const href of ["/", "/canvas/123", "/prompts?q=test#list", "https://example.com/docs", "http://localhost:3000"]) {
        assert.equal(isSafeNavigationHref(href), true, href);
    }
    for (const href of ["", "//evil.example", "/\\evil.example", "javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com", "https:example.com", "https://", "/foo\nbar", "/foo bar", "/".repeat(2049)]) {
        assert.equal(isSafeNavigationHref(href), false, href);
    }
});

test("活动菜单按路径边界匹配，外链不高亮", () => {
    assert.equal(isNavigationItemActive("/canvas", "/canvas/123"), true);
    assert.equal(isNavigationItemActive("/canvas?tab=all", "/canvas"), true);
    assert.equal(isNavigationItemActive("/canvas", "/canvas-extra"), false);
    assert.equal(isNavigationItemActive("/", "/canvas"), false);
    assert.equal(isNavigationItemActive("https://example.com/canvas", "/canvas"), false);
});

test("JSON 菜单结构错误时拒绝切换，合法值和空数组保持原样", () => {
    for (const value of [{}, [null], ["menu"], [{ id: "x", label: "菜单", href: "/", enabled: "true", newTab: false }]]) {
        assert.throws(() => parseNavigationItems(value), /菜单配置必须是数组/);
    }
    assert.deepEqual(parseNavigationItems(null), defaultNavigationItems);
    assert.deepEqual(parseNavigationItems([]), []);
    assert.deepEqual(parseNavigationItems(defaultNavigationItems), defaultNavigationItems);
});

test("URL 长度按 UTF-8 字节计算且拒绝 C1 控制字符", () => {
    assert.equal(isSafeNavigationHref("/" + "中".repeat(683)), false);
    assert.equal(isSafeNavigationHref("/foo\u0080bar"), false);
});
