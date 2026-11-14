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

test("连接入口要求先保持仓库服务运行，再提供插件及手动连接", () => {
    const view = read("components/canvas-codex-connect-view.tsx");
    const startup = view.indexOf("第一步：启动本仓库 Agent（必需）");
    const connection = view.indexOf("第二步：通过插件或手动连接");
    assert.ok(startup >= 0 && connection > startup);
    assert.match(view, /npm --prefix canvas-agent install\\nnpm --prefix canvas-agent start/);
    assert.match(view, /连接期间保持终端运行/);
    assert.match(view, /上游插件可能自动启动旧 npm 服务/);
    assert.match(view, /本仓库服务启动后，可手动填写/);
    assert.doesNotMatch(view, /按使用场景选择一种连接方式|建议先按方式二/);
});
