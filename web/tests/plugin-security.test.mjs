import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loader = readFileSync(new URL("../src/lib/canvas/plugin-loader.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../src/lib/canvas/plugin-registry.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-plugin-manager-modal.tsx", import.meta.url), "utf8");

test("默认只允许镜像内同源官方插件", () => {
    assert.match(loader, /url\.origin === window\.location\.origin && url\.pathname\.startsWith\("\/plugins\/"\)/);
    assert.match(registry, /官方插件注册表必须来自本站 \/plugins\//);
    assert.doesNotMatch(registry, /basketikun|jsdelivr|UPSTREAM_PLUGIN/);
});

test("第三方插件必须显式开启危险开关并再次确认", () => {
    assert.match(loader, /NEXT_PUBLIC_ENABLE_UNSAFE_CANVAS_PLUGINS/);
    assert.match(loader, /!options\?\.unsafeRemote \|\| !unsafeCanvasPluginsEnabled/);
    assert.match(manager, /unsafeCanvasPluginsEnabled/);
    assert.match(manager, /确认执行第三方插件/);
    assert.match(manager, /信任并安装/);
});

test("插件节点和源码具备资源边界且激活失败会回滚", () => {
    assert.match(loader, /MAX_PLUGIN_SOURCE_BYTES/);
    assert.match(loader, /MAX_PLUGIN_CSS_LENGTH/);
    assert.match(loader, /value >= 48 && value <= 8192/);
    assert.match(loader, /unregisterPluginNodes\(plugin\.id\)/);
});
