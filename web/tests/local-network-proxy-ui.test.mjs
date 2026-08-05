import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("../src/components/agent/agent-panel.tsx", import.meta.url), "utf8");
const localAgentSource = await readFile(new URL("../src/app/(user)/canvas/components/canvas-local-agent-panel.tsx", import.meta.url), "utf8");

test("全站本地 Agent 精简为自定义 API 网络代理", () => {
    assert.match(panelSource, /本地网络代理/);
    assert.match(panelSource, /自定义 API 跨域回退/);
    assert.match(panelSource, /networkOnly/);
    assert.match(localAgentSource, /networkOnly[\s\S]{0,300}本地网络代理不执行对话或画布工具/);
    assert.match(localAgentSource, /用于用户自定义 API 在浏览器直连受限时的安全本机转发/);
});

test("网络代理模式只显示连接和日志页签", () => {
    assert.match(localAgentSource, /networkOnly[\s\S]{0,300}value: "setup"[\s\S]{0,300}value: "log"/);
    assert.match(localAgentSource, /visibleActiveTab/);
});
