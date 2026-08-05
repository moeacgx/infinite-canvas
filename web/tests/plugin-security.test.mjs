import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loader = readFileSync(new URL("../src/lib/canvas/plugin-loader.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../src/lib/canvas/plugin-registry.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-plugin-manager-modal.tsx", import.meta.url), "utf8");
const registryBuild = readFileSync(new URL("../../plugins/canvas/registry/build.mjs", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

test("默认只允许镜像内同源官方插件", () => {
    assert.match(loader, /url\.origin === window\.location\.origin && url\.pathname\.startsWith\("\/plugins\/"\)/);
    assert.match(registry, /官方插件注册表必须来自本站 \/plugins\//);
    assert.doesNotMatch(registry, /basketikun|jsdelivr|UPSTREAM_PLUGIN/);
});

test("镜像提供空的本地插件索引且官方插件仍按清单加载", () => {
    assert.match(registryBuild, /writeFile\(join\(outDir, "index\.json"\), "\[\]\\n"\)/);
    assert.match(registryBuild, /writeFile\(join\(outDir, "official-plugins\.json"\)/);
    assert.match(dockerfile, /COPY --from=plugin-build \/app\/plugins\/canvas\/registry\/dist \.\/public\/plugins/);
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

test("插件跳转、启用失败和清理异常不会越过安全边界", () => {
    assert.match(loader, /normalizePluginUrl\(response\.url \|\| url, options\)/);
    assert.match(loader, /setEnabled\(record\.id, false\)/);
    assert.match(loader, /finally\s*\{[\s\S]*unregisterPluginNodes\(pluginId\)/);
});

test("插件升级绕过缓存但不会持久化临时缓存参数", () => {
    assert.match(loader, /bustCache:\s*true/);
    assert.match(loader, /const url = normalizePluginUrl\(rawUrl/);
    assert.match(manager, /hasUpgrade/);
});
