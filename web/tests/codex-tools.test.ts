import assert from "node:assert/strict";
import test from "node:test";
import { buildCanvasAgentUserContent, createCanvasAgentExecutionBudget, createCanvasAgentState, executeActions } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import { normalizeCanvasAgentAction } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";
import { normalizeCanvasSessions } from "../src/app/(user)/canvas/stores/use-canvas-store.ts";
import { archiveCodexThread, createExternalCodexExecutor } from "../src/app/(user)/canvas/agent/codex-connection-runtime.ts";

test("Codex 连续工具调用复用本地重复写入保护", async () => {
    const budget = createCanvasAgentExecutionBudget();
    const writes = new Set<string>();
    const state = createCanvasAgentState();
    const action = normalizeCanvasAgentAction("create_text_node", { content: "测试内容", title: "测试" }, "first");
    let calls = 0;
    const execute = async () => { calls += 1; return { ok: true }; };
    const first = await executeActions([action], state, budget, writes, execute);
    const repeated = await executeActions([{ ...action, id: "second" }], first.state, budget, writes, execute);
    assert.equal(first.items[0].result.ok, true);
    assert.equal(repeated.items[0].result.code, "duplicate_action");
    assert.equal(calls, 1);
});

test("Codex 工具取消后不会执行或提交状态", async () => {
    const controller = new AbortController();
    const action = normalizeCanvasAgentAction("get_canvas_summary", {}, "read");
    let calls = 0;
    const execute = async () => { calls += 1; controller.abort(); return { ok: true }; };
    await assert.rejects(executeActions([action], createCanvasAgentState(), createCanvasAgentExecutionBudget(), new Set(), execute, controller.signal), { name: "AbortError" });
    await assert.rejects(executeActions([action], createCanvasAgentState(), createCanvasAgentExecutionBudget(), new Set(), execute, controller.signal), { name: "AbortError" });
    assert.equal(calls, 1);
});

test("Codex 输入保留未落点附件协议及图片", () => {
    const content = buildCanvasAgentUserContent("使用附件", [
        { id: "draft-text", type: "text", origin: "attachment", title: "文案", text: "附件正文" },
        { id: "draft-image", type: "image", origin: "attachment", title: "参考", dataUrl: "data:image/png;base64,AA==" },
    ]);
    assert.ok(Array.isArray(content));
    assert.match(JSON.stringify(content), /附件正文/);
    assert.match(JSON.stringify(content), /首次使用时将素材落为真实节点/);
    assert.equal(content[1].type, "image_url");
});

test("导入另一张画布时清除 Codex 线程，正常恢复保留线程与模式", () => {
    const sessions = [{ id: "session", provider: "codex" as const, codexThreadId: "thread", codexServiceId: "service", title: "对话", messages: [], agentState: createCanvasAgentState(), protocolMessages: [], createdAt: "", updatedAt: "" }];
    assert.equal(normalizeCanvasSessions(sessions)[0].codexThreadId, "thread");
    const imported = normalizeCanvasSessions(sessions, false)[0];
    assert.equal(imported.provider, "codex");
    assert.equal(imported.codexThreadId, undefined);
    assert.equal(imported.codexServiceId, undefined);
});

test("外部执行路径在调用画布前拒绝 15 张图片，并累计同连接的图片预算", async () => {
    let calls = 0;
    const execute = createExternalCodexExecutor(async () => { calls += 1; return { ok: true }; });
    const signal = new AbortController().signal;
    const image = (count: number, prompt: string) => normalizeCanvasAgentAction("generate_image", { count, prompt, sourceNodeIds: [] }, prompt);
    const excessive = await execute(image(15, "超过单次预算"), signal);
    assert.equal(excessive.code, "turn_budget_exceeded");
    assert.match(String(excessive.message), /本次网页连接/);
    assert.equal(calls, 0);
    assert.equal((await execute(image(7, "第一批"), signal)).ok, true);
    assert.equal((await execute(image(5, "第二批"), signal)).ok, true);
    assert.equal((await execute(image(1, "第三批"), signal)).code, "turn_budget_exceeded");
    assert.equal(calls, 2);
});

test("外部执行路径更换请求 ID 仍去重，只有新连接执行器重置预算和去重", async () => {
    let calls = 0;
    const tool = async () => { calls += 1; return { ok: true }; };
    const execute = createExternalCodexExecutor(tool);
    const signal = new AbortController().signal;
    const action = normalizeCanvasAgentAction("generate_image", { prompt: "相同图片", count: 12, sourceNodeIds: [] }, "first");
    assert.equal((await execute(action, signal)).ok, true);
    assert.equal((await execute({ ...action, id: "another-request" }, signal)).code, "duplicate_action");
    assert.equal((await execute(normalizeCanvasAgentAction("generate_image", { prompt: "不同图片", count: 1, sourceNodeIds: [] }), signal)).code, "turn_budget_exceeded");
    const reconnected = createExternalCodexExecutor(tool);
    assert.equal((await reconnected(action, signal)).ok, true);
    assert.equal(calls, 2);
});

test("外部执行路径累计媒体和写入预算，读取不受写入上限影响", async () => {
    const signal = new AbortController().signal;
    let mediaCalls = 0;
    const media = createExternalCodexExecutor(async () => { mediaCalls += 1; return { ok: true }; });
    for (let i = 0; i < 6; i++) assert.equal((await media(normalizeCanvasAgentAction("generate_video", { prompt: `视频${i}`, sourceNodeIds: [] }), signal)).ok, true);
    assert.equal((await media(normalizeCanvasAgentAction("generate_video", { prompt: "第七个", sourceNodeIds: [] }), signal)).code, "turn_budget_exceeded");
    assert.equal(mediaCalls, 6);
    let writeCalls = 0;
    const write = createExternalCodexExecutor(async () => { writeCalls += 1; return { ok: true }; });
    for (let i = 0; i < 24; i++) assert.equal((await write(normalizeCanvasAgentAction("create_text_node", { title: `节点${i}`, content: `${i}` }), signal)).ok, true);
    assert.equal((await write(normalizeCanvasAgentAction("create_text_node", { title: "超额节点", content: "超额" }), signal)).code, "turn_budget_exceeded");
    assert.equal(writeCalls, 24);
    assert.equal((await write(normalizeCanvasAgentAction("get_canvas_summary", {}), signal)).ok, true);
});

test("外部工具取消信号原样传递，已取消请求不会触发画布", async () => {
    const controller = new AbortController();
    let calls = 0;
    const execute = createExternalCodexExecutor(async (_action, signal) => {
        assert.equal(signal, controller.signal);
        calls += 1;
        controller.abort();
        return { ok: true };
    });
    const action = normalizeCanvasAgentAction("get_canvas_summary", {});
    await assert.rejects(execute(action, controller.signal), { name: "AbortError" });
    await assert.rejects(execute(action, controller.signal), { name: "AbortError" });
    assert.equal(calls, 1);
});

test("归档真实路径在离线或不同服务时跳过请求，在线失败返回明确结果", async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const client = {
        connected: () => true, serviceId: "current-service",
        rpc: async <T>(method: string, params?: Record<string, unknown>): Promise<T> => { requests.push({ method, params }); return {} as T; },
    };
    assert.deepEqual(await archiveCodexThread(null, "thread", "current-service"), { status: "skipped" });
    assert.deepEqual(await archiveCodexThread({ ...client, connected: () => false }, "thread", "current-service"), { status: "skipped" });
    assert.deepEqual(await archiveCodexThread(client, "thread", "other-service"), { status: "skipped" });
    assert.deepEqual(await archiveCodexThread(client, "thread"), { status: "skipped" });
    assert.equal(requests.length, 0);
    assert.deepEqual(await archiveCodexThread(client, "thread", "current-service"), { status: "archived" });
    assert.deepEqual(requests, [{ method: "thread/archive", params: { threadId: "thread" } }]);
    assert.deepEqual(await archiveCodexThread({ ...client, rpc: async () => { throw new Error("远端不可用"); } }, "thread", "current-service"), { status: "failed", message: "远端不可用" });
});
