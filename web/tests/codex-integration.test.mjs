import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../src/app/(user)/canvas/${path}`, import.meta.url), "utf8");

test("外部工具分支接入连接级执行器，归档不要求先取得在线客户端", () => {
    const hook = read("agent/use-codex-agent.ts");
    const effectStart = hook.indexOf("if (!enabled || !connection.token");
    const executorStart = hook.indexOf("const executeExternalTool = createExternalCodexExecutor(", effectStart);
    const handlerStart = hook.indexOf("const handleTool =", effectStart);
    assert.ok(effectStart >= 0 && executorStart > effectStart && handlerStart > executorStart);
    assert.match(hook.slice(handlerStart), /else result = await executeExternalTool\(action, signal\)/);
    assert.doesNotMatch(hook.slice(handlerStart), /latest\.current\.executeTool\(action, signal\)/);
    assert.match(hook, /archive:.*=> archiveCodexThread\(client\.current, threadId, serviceId\)/);
});

test("本地删除先于远端归档，跳过及失败均明确提示", () => {
    const panel = read("components/canvas-assistant-panel.tsx");
    const start = panel.indexOf("const removeSessions =");
    const end = panel.indexOf("const sendMessage =", start);
    assert.ok(start >= 0 && end > start);
    const removal = panel.slice(start, end);
    const commit = removal.indexOf("commitSessions(next, selected.id)");
    const archive = removal.indexOf("await Promise.all(");
    assert.ok(commit >= 0 && archive > commit);
    assert.match(removal, /codex\.archive\(session\.codexThreadId!, session\.codexServiceId\)/);
    assert.match(removal, /status === "failed"[\s\S]*toast\.warning/);
    assert.match(removal, /status === "skipped"[\s\S]*toast\.info/);
});

test("连接入口使用本仓库独立插件，提供旧插件迁移和可选源码启动", () => {
    const view = read("components/canvas-codex-connect-view.tsx");
    assert.match(view, /https:\/\/github\.com\/moeacgx\/infinite-canvas\.git/);
    assert.match(view, /codex plugin add canvas-agent@infinite-canvas-moe/);
    assert.match(view, /codex plugin remove canvas-agent@infinite-canvas"/);
    assert.match(view, /node canvas-agent\/bootstrap\.mjs/);
    assert.match(view, /无需另行克隆源码或手动启动服务/);
    assert.doesNotMatch(view, /tigerowo|第一步：启动本仓库 Agent（必需）/);
});
