import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const layout = read("app/(user)/layout.tsx");
const topNav = read("components/layout/app-top-nav.tsx");
const channelRequest = read("services/api/channel-request.ts");
const configStore = read("stores/use-config-store.ts");
const canvasPage = read("app/(user)/canvas/[id]/canvas-client-page.tsx");

 test("仅保留画布内创作 Agent", () => {
    assert.doesNotMatch(layout, /AgentPanel|canvas-agent-panel/);
    assert.doesNotMatch(topNav, /use-agent-store|本地网络代理|togglePanel/);
    assert.match(canvasPage, /<CanvasAssistantPanel/);
    assert.doesNotMatch(canvasPage, /use-agent-store|setAgentCanvasContext|openLocalAgent/);
});

test("本地渠道不再暴露本机 Agent 或网络代理配置", () => {
    assert.doesNotMatch(channelRequest, /channel-proxy|CanvasAgentStore|useCanvasAgentStore|requestMode|agentToken/);
    assert.doesNotMatch(configStore, /ChannelRequestMode|requestMode|本机 Agent/);
    assert.equal(existsSync(new URL("components/agent/agent-panel.tsx", root)), false);
    assert.equal(existsSync(new URL("app/(user)/canvas/components/canvas-local-agent-panel.tsx", root)), false);
    assert.equal(existsSync(new URL("../../canvas-agent", root)), false);
    assert.equal(existsSync(new URL("../../plugins/infinite-canvas", root)), false);
});
