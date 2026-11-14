import assert from "node:assert/strict";
import test from "node:test";
import { createCodexAgentClient, normalizeCodexEndpoint, type CodexRpcEvent } from "../src/services/api/codex-agent.ts";

class FakeEventSource extends EventTarget {
    static OPEN = 1;
    static latest: FakeEventSource;
    readyState = 0;
    onopen?: () => void;
    onerror?: () => void;
    url: string;
    constructor(url: string) { super(); this.url = url; FakeEventSource.latest = this; }
    open() { this.readyState = 1; this.onopen?.(); }
    emit(name: string, data: unknown) { this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) })); }
    close() { this.readyState = 2; }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("请求按 UTF-8 总字节数拦截，413 非 JSON 响应仍显示明确提示", async (t) => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
        requests += 1;
        return new Response("<html>Payload Too Large</html>", { status: 413 });
    });
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    t.after(() => { globalThis.EventSource = original; });
    const client = createCodexAgentClient({ endpoint: "http://localhost:3210", token: "test" }, "canvas", [], {
        rpc: () => {}, tool: () => {}, cancelTool: () => {}, ready: async () => {}, error: () => {},
    });
    t.after(() => client.close());
    await assert.rejects(client.rpc("turn/start", { input: "图".repeat(7 * 1024 * 1024) }), /请求内容过大/);
    assert.equal(requests, 0);
    await assert.rejects(client.rpc("turn/start", { input: "普通文本" }), /请求内容过大/);
    assert.equal(requests, 1);
});

test("Codex 连接只接受本机 HTTP 根地址", () => {
    assert.equal(normalizeCodexEndpoint("http://localhost:3210/"), "http://localhost:3210");
    for (const endpoint of ["https://127.0.0.1:3210", "http://example.com", "http://127.0.0.1:3210/other", "http://user:pass@localhost:3210", "http://localhost:3210?token=x", "http://localhost:3210#x"]) {
        assert.throws(() => normalizeCodexEndpoint(endpoint));
    }
});

test("连接携带当前画布、工具和身份，停止后过滤旧输出并保留外部工具", async (t) => {
    const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
        const path = new URL(String(url)).pathname;
        requests.push({ path, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        return Response.json(path === "/connect" ? { serviceId: "service-a" } : {});
    });
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    t.after(() => { globalThis.EventSource = original; });
    const rpc: CodexRpcEvent[] = [];
    const tools: string[] = [];
    const canceled: string[] = [];
    let ready = false;
    const client = createCodexAgentClient({ endpoint: "http://127.0.0.1:3210", token: "test-token" }, "current-canvas", [{ name: "get_canvas_summary" }], {
        rpc: (event) => rpc.push(event), tool: (event) => tools.push(event.requestId), cancelTool: (id) => canceled.push(id),
        ready: async () => { ready = true; }, error: (error) => { throw error; },
    });
    t.after(() => client.close());
    const events = FakeEventSource.latest;
    events.open();
    await tick();
    assert.equal(ready, true);
    assert.equal(client.serviceId, "service-a");
    assert.equal(requests[0].body.canvasId, "current-canvas");
    assert.deepEqual(requests[0].body.tools, [{ name: "get_canvas_summary" }]);
    assert.equal(requests[0].headers.get("x-canvas-agent-token"), "test-token");
    assert.equal(new URL(events.url).searchParams.get("clientId"), requests[0].body.clientId);
    events.emit("rpc", { generation: 0, method: "item/agentMessage/delta", params: { delta: "输出" } });
    await client.stop();
    events.emit("rpc", { generation: 0, method: "item/agentMessage/delta", params: { delta: "过期输出" } });
    events.emit("tool", { generation: 0, source: "codex", requestId: "old" });
    events.emit("tool", { generation: 0, source: "external", requestId: "external" });
    events.emit("tool", { generation: 1, source: "codex", requestId: "new" });
    events.emit("tool-cancel", { requestId: "new" });
    assert.equal(rpc.length, 1);
    assert.deepEqual(tools, ["external", "new"]);
    assert.deepEqual(canceled, ["new"]);
    assert.equal(requests.at(-1)?.body.method, "bridge/stop");
    assert.equal(requests.at(-1)?.body.generation, 1);
    client.close();
    assert.equal(client.signal.aborted, true);
    assert.equal(client.connected(), false);
});

test("服务代次改变时中止旧 RPC，权限回复保留请求代次", async (t) => {
    let reply: Record<string, unknown> | undefined;
    t.mock.method(globalThis, "fetch", async (url, init) => {
        if (String(url).endsWith("/reply")) {
            reply = JSON.parse(String(init?.body));
            return Response.json({});
        }
        return Response.json({ error: "服务已重启" }, { status: 409, headers: { "x-canvas-agent-generation": "2" } });
    });
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    t.after(() => { globalThis.EventSource = original; });
    const events: CodexRpcEvent[] = [];
    const client = createCodexAgentClient({ endpoint: "http://localhost:3210", token: "test" }, "canvas", [], {
        rpc: (event) => events.push(event), tool: () => {}, cancelTool: () => {}, ready: async () => {}, error: () => {},
    });
    t.after(() => client.close());
    await assert.rejects(client.rpc("turn/start"), { name: "AbortError" });
    assert.equal(events[0].method, "bridge/disconnected");
    await client.reply({ id: 7, generation: 1, method: "item/fileChange/requestApproval", params: {} }, { decision: "decline" });
    assert.equal(reply?.generation, 1);
    assert.deepEqual(reply?.result, { decision: "decline" });
});

test("关闭连接会取消正在等待的 HTTP 请求", async (t) => {
    t.mock.method(globalThis, "fetch", (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    t.after(() => { globalThis.EventSource = original; });
    const client = createCodexAgentClient({ endpoint: "http://localhost:3210", token: "test" }, "canvas", [], {
        rpc: () => {}, tool: () => {}, cancelTool: () => {}, ready: async () => {}, error: () => {},
    });
    const result = client.rpc("turn/start");
    client.close();
    await assert.rejects(result, { name: "AbortError" });
});
