import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mock, test } from "node:test";

test("本地服务隔离模型工作目录，并真正停止当前代任务", { timeout: 15000 }, async (context) => {
    const temporaryHome = mkdtempSync(join(tmpdir(), "canvas-agent-test-"));
    const probe = createServer();
    await new Promise((done) => probe.listen(0, "127.0.0.1", done));
    const port = probe.address().port;
    await new Promise((done) => probe.close(done));
    const token = "test-token-".repeat(4);
    const oldPort = process.env.CANVAS_AGENT_PORT;
    const oldToken = process.env.CANVAS_AGENT_TOKEN;
    process.env.CANVAS_AGENT_PORT = String(port);
    process.env.CANVAS_AGENT_TOKEN = token;
    const calls = [];
    let current;
    class FakeCodex {
        stopped = false;
        ready = Promise.resolve();
        constructor(emit) { this.emit = emit; current = this; }
        request(method, params) { calls.push({ method, params }); return Promise.resolve({ ok: true }); }
        close() {
            if (this.stopped) return;
            this.stopped = true;
            this.emit("rpc", { method: "bridge/disconnected", params: { message: "已停止" } });
        }
    }
    mock.module("node:os", { namedExports: { homedir: () => temporaryHome } });
    mock.module(new URL("../codex.mjs", import.meta.url).href, { namedExports: { CodexClient: FakeCodex } });
    context.mock.method(console, "log", () => {});
    const previousHandlers = new Set(process.listeners("SIGTERM"));
    const eventsController = new AbortController();
    context.after(() => {
        eventsController.abort();
        for (const handler of process.listeners("SIGTERM")) if (!previousHandlers.has(handler)) {
            handler();
            process.removeListener("SIGTERM", handler);
            process.removeListener("SIGINT", handler);
        }
        if (oldPort === undefined) delete process.env.CANVAS_AGENT_PORT; else process.env.CANVAS_AGENT_PORT = oldPort;
        if (oldToken === undefined) delete process.env.CANVAS_AGENT_TOKEN; else process.env.CANVAS_AGENT_TOKEN = oldToken;
        mock.restoreAll();
        // 只清理本次创建的系统临时目录，不读取或改动实际用户配置。
        assert.ok(resolve(temporaryHome).startsWith(resolve(tmpdir()) + sep));
        assert.notEqual(temporaryHome, homedir());
        rmSync(temporaryHome, { recursive: true, force: true });
    });
    await import("../index.mjs");
    const endpoint = `http://127.0.0.1:${port}`;
    const headers = { "content-type": "application/json", "x-canvas-agent-token": token };
    const post = (path, body) => fetch(endpoint + path, { method: "POST", headers, body: JSON.stringify({ clientId: "test", ...body }) });
    const config = await fetch(endpoint + "/config").then((response) => response.json());
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    assert.deepEqual(config, { url: endpoint, hasToken: true, distribution: "moeacgx/infinite-canvas", version });
    assert.equal((await fetch(endpoint + "/tools")).status, 401);
    const events = await fetch(endpoint + "/events?clientId=test&token=" + token, { signal: eventsController.signal });
    assert.equal(events.status, 200);
    assert.equal((await post("/connect", { canvasId: "canvas-test", tools: [{ name: "get_canvas_summary", description: "读取画布", inputSchema: { type: "object" } }] })).status, 200);
    // 真实发送超过 20mb 的 JSON，覆盖鉴权、解析错误与服务恢复链路。
    const oversizedBody = JSON.stringify({ clientId: "test", padding: "x".repeat(20 * 1024 * 1024) });
    await context.test("超限 JSON 在解析前校验 Token", async () => {
        for (const credential of [undefined, "invalid-token"]) {
            const response = await fetch(endpoint + "/rpc", {
                method: "POST",
                headers: { "content-type": "application/json", ...(credential ? { "x-canvas-agent-token": credential } : {}) },
                body: oversizedBody,
            });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { error: "Token 不正确" });
        }
    });
    await context.test("超限 JSON 返回 413 中文提示，服务仍可用", async () => {
        const response = await fetch(endpoint + "/rpc", { method: "POST", headers, body: oversizedBody });
        assert.equal(response.status, 413);
        assert.deepEqual(await response.json(), { error: "请求内容超过 20MB 限制，请减少图片或压缩后重试" });
        assert.equal(calls.length, 0);
        assert.equal((await post("/connect", { canvasId: "canvas-test", tools: [{ name: "get_canvas_summary", description: "读取画布", inputSchema: { type: "object" } }] })).status, 200);
    });
    await context.test("其他 JSON 解析错误仍返回 400 和原始错误", async () => {
        const response = await fetch(endpoint + "/rpc", { method: "POST", headers, body: "{" });
        assert.equal(response.status, 400);
        let message;
        try { JSON.parse("{"); } catch (error) { message = error.message; }
        assert.deepEqual(await response.json(), { error: message });
    });
    assert.equal((await post("/rpc", { method: "thread/start", generation: 0 })).status, 200);
    const thread = calls.find((call) => call.method === "thread/start");
    assert.equal(thread.params.cwd, join(temporaryHome, ".infinite-canvas-moe", "workspace"));
    const programDirectory = dirname(fileURLToPath(new URL("../index.mjs", import.meta.url)));
    assert.notEqual(thread.params.cwd, programDirectory);
    assert.equal(thread.params.config.mcp_servers["infinite-canvas"].args[0], join(programDirectory, "index.mjs"));
    const stopped = await post("/rpc", { method: "bridge/stop", generation: 0 });
    assert.equal(stopped.status, 200);
    assert.equal(current.stopped, true);
    assert.equal(stopped.headers.get("x-canvas-agent-generation"), "1");
    assert.equal((await post("/rpc", { method: "turn/start", generation: 0 })).status, 400);
    const staleTool = await post("/tools/call", { name: "get_canvas_summary", source: "codex", generation: 0, arguments: {} });
    assert.equal(staleTool.status, 400);
    assert.match((await staleTool.json()).error, /Codex 请求已停止/);
    assert.equal((await post("/rpc", { method: "thread/start", generation: 1 })).status, 200);
    const restarted = current;
    assert.equal((await post("/rpc", { method: "bridge/stop", generation: 2 })).status, 200);
    assert.equal(restarted.stopped, true);
});
