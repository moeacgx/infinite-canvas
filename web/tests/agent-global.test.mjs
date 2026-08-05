import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../src/app/(user)/layout.tsx", import.meta.url), "utf8");
const canvasPage = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-local-agent-panel.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/app/(user)/canvas/stores/use-canvas-agent-store.ts", import.meta.url), "utf8");
const siteTools = readFileSync(new URL("../src/lib/agent/agent-site-tools.ts", import.meta.url), "utf8");

test("Agent 面板挂载在用户全局布局并由画布注册上下文", () => {
    assert.match(layout, /<AgentPanel\s*\/>/);
    assert.doesNotMatch(canvasPage, /<CanvasLocalAgentPanel/);
    assert.match(canvasPage, /setAgentCanvasContext\(\{ snapshot: agentSnapshot/);
    assert.match(canvasPage, /setAgentCanvasContext\(null\)/);
});

test("连接 token 只保存在会话存储中", () => {
    assert.match(store, /sessionStorage\.setItem\("canvas-agent-token"/);
    assert.match(store, /localStorage\.removeItem\("canvas-agent-token"/);
    assert.doesNotMatch(panel, /localStorage\.setItem\("canvas-agent-token"/);
});

test("付费或写入型站点工具需要确认并支持停止 Codex", () => {
    assert.match(panel, /payload\.name === "canvas_apply_ops"\) return confirmCanvasTools/);
    assert.match(panel, /payload\.name === "assets_add"\) return true/);
    assert.match(panel, /workbench_image_generate/);
    assert.match(panel, /workbench_video_generate/);
    assert.match(panel, /payload\.input\?\.run !== false/);
    assert.match(panel, /\/agent\/codex\/interrupt/);
});

test("视频工作台 Agent 读写独立视频尺寸", () => {
    const videoToolSource = siteTools.slice(siteTools.indexOf("function runVideoWorkbench"), siteTools.indexOf("async function searchPrompts"));
    assert.match(siteTools, /size:\s*config\.videoSize\s*\|\|\s*"1280x720"/);
    assert.match(siteTools, /resolution:\s*normalizeAgentVideoResolution\(config\.vquality\)/);
    assert.match(siteTools, /resolutionOptions:\s*\["480", "720", "1080"\]/);
    assert.match(videoToolSource, /input\.size,[\s\S]{0,100}updateConfig\("videoSize", value\)/);
    assert.match(videoToolSource, /typeof input\.resolution === "string"[\s\S]{0,180}normalizeAgentVideoResolution\(input\.resolution\)[\s\S]{0,100}updateConfig\("vquality", resolution\)/);
    assert.doesNotMatch(videoToolSource, /updateConfig\("size", value\)/);
});
