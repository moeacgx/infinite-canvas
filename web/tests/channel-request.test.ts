import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import axios, { AxiosError, type AxiosAdapter, type AxiosRequestConfig } from "axios";

import { channelAxiosRequest, channelFetch, rememberLocalAgentCapabilities } from "../src/services/api/channel-request.ts";
import { useCanvasAgentStore } from "../src/app/(user)/canvas/stores/use-canvas-agent-store.ts";

const AGENT_URL = "http://127.0.0.1:17371";
const AGENT_TOKEN = "0123456789abcdef0123456789abcdef";

function connectLocalAgent() {
    useCanvasAgentStore.setState({ url: AGENT_URL, token: AGENT_TOKEN });
    rememberLocalAgentCapabilities(AGENT_URL, ["channel-proxy"]);
}

test("Web 客户端与本机 Agent 的真实 HTTP 协议保持一致", async () => {
    const received: { headers?: typeof import("node:http").IncomingHttpHeaders; body?: string } = {};
    let capabilityChecks = 0;
    const server = createServer(async (request, response) => {
        if (request.url === "/config") {
            capabilityChecks += 1;
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: true, version: "0.3.0", capabilities: ["channel-proxy"] }));
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        received.headers = request.headers;
        received.body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json", "x-channel-proxy": "local-agent" });
        response.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const agentUrl = `http://127.0.0.1:${address.port}`;
        useCanvasAgentStore.setState({ url: agentUrl, token: AGENT_TOKEN });
        const target = "https://provider.example/v1/chat/completions?api-version=2026-01-01";
        const result = await channelAxiosRequest<{ ok: boolean }>(
            { channelMode: "local", requestMode: "agent" },
            {
                method: "POST",
                url: target,
                headers: { Authorization: "Bearer provider-key", "Content-Type": "application/json" },
                data: { prompt: "协议验证" },
            },
        );
        assert.equal(result.data.ok, true);
        assert.equal(capabilityChecks, 1);
        assert.equal(received.headers?.["x-canvas-agent-token"], AGENT_TOKEN);
        assert.equal(received.headers?.["x-channel-target"], target);
        assert.equal(received.headers?.["x-channel-method"], "POST");
        const providerHeaders = JSON.parse(decodeURIComponent(String(received.headers?.["x-channel-headers"] || "")));
        assert.equal(providerHeaders.Authorization, "Bearer provider-key");
        assert.deepEqual(JSON.parse(received.body || "{}"), { prompt: "协议验证" });
    } finally {
        server.close();
        await once(server, "close");
        connectLocalAgent();
    }
});

test("旧版 Agent 在收到渠道 API Key 前会被能力探测拒绝", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
        paths.push(request.url || "");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, version: "0.2.0" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        useCanvasAgentStore.setState({ url: `http://127.0.0.1:${address.port}`, token: AGENT_TOKEN });
        await assert.rejects(() => channelAxiosRequest({ channelMode: "local", requestMode: "agent" }, { method: "GET", url: "https://provider.example/v1/models", headers: { Authorization: "Bearer provider-key" } }), /版本过旧/);
        assert.deepEqual(paths, ["/config"]);
    } finally {
        server.close();
        await once(server, "close");
        connectLocalAgent();
    }
});

test("Axios 本地 GET 网络失败后改走本机 Canvas Agent", async () => {
    connectLocalAgent();
    const calls: AxiosRequestConfig[] = [];
    let failedDirect = false;
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        if (!failedDirect) {
            failedDirect = true;
            throw new AxiosError("Network Error", "ERR_NETWORK", config);
        }
        return { data: { data: [{ id: "model" }] }, status: 200, statusText: "OK", headers: {}, config };
    };
    const response = await channelAxiosRequest<{ data: Array<{ id: string }> }>({ channelMode: "local" }, { method: "GET", url: "https://api.example.com/v1/models", headers: { Authorization: "Bearer provider" }, adapter });
    assert.equal(response.data.data[0].id, "model");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, `${AGENT_URL}/channel-proxy`);
    assert.equal(calls[1].method, "post");
    assert.equal(calls[1].headers?.get("x-canvas-agent-token"), AGENT_TOKEN);
    assert.equal(calls[1].headers?.get("x-channel-target"), "https://api.example.com/v1/models");
    const upstream = JSON.parse(decodeURIComponent(String(calls[1].headers?.get("x-channel-headers"))));
    assert.equal(upstream.Authorization, "Bearer provider");
});

test("New API GET 瞬时网络失败会在浏览器内重试且不会进入本地渠道代理", async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
        calls += 1;
        if (calls < 3) throw new AxiosError("Network Error", "ERR_NETWORK", config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    const response = await channelAxiosRequest<{ ok: boolean }>({ channelMode: "newapi" }, { method: "GET", url: "https://newapi.example/v1/models", adapter });
    assert.equal(response.data.ok, true);
    assert.equal(calls, 3);
});

test("New API POST 网络失败不会自动重放", async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
        calls += 1;
        throw new AxiosError("Network Error", "ERR_NETWORK", config);
    };
    await assert.rejects(() => channelAxiosRequest({ channelMode: "newapi" }, { method: "POST", url: "https://newapi.example/v1/videos", adapter }), /Network Error/);
    assert.equal(calls, 1);
});

test("模型读取触发兼容回退后，同源生成请求直接走代理且不会先发送两次", async () => {
    connectLocalAgent();
    const calls: AxiosRequestConfig[] = [];
    let failedDirect = false;
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        if (!failedDirect) {
            failedDirect = true;
            throw new AxiosError("Network Error", "ERR_NETWORK", config);
        }
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    const baseUrl = "https://learned-proxy.example/v1";
    await channelAxiosRequest({ channelMode: "local", requestMode: "auto" }, { method: "GET", url: `${baseUrl}/models`, adapter });
    calls.length = 0;
    await channelAxiosRequest({ channelMode: "local", requestMode: "auto" }, { method: "POST", url: `${baseUrl}/images/generations`, data: { prompt: "test" }, adapter });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${AGENT_URL}/channel-proxy`);
    assert.equal(calls[0].headers?.get("x-channel-method"), "POST");
});

test("自动模式没有本机 Agent 配置时仍先允许浏览器直接请求", async () => {
    useCanvasAgentStore.setState({ token: "" });
    const calls: AxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    await channelAxiosRequest({ channelMode: "local", requestMode: "auto" }, { method: "GET", url: "https://learned-proxy.example/v1/models", adapter });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://learned-proxy.example/v1/models");
});

test("显式本机 Agent 模式首次写请求就走本机转发", async () => {
    connectLocalAgent();
    const calls: AxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    await channelAxiosRequest({ channelMode: "local", requestMode: "agent" }, { method: "POST", url: "https://forced-proxy.example/v1/chat/completions", data: {}, adapter });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${AGENT_URL}/channel-proxy`);
});

test("本机 Agent 请求被主动取消时保留 Axios 取消语义", async () => {
    connectLocalAgent();
    const controller = new AbortController();
    controller.abort();
    const adapter: AxiosAdapter = async (config) => {
        throw new axios.CanceledError("已取消", config);
    };
    await assert.rejects(
        () => channelAxiosRequest({ channelMode: "local", requestMode: "agent" }, { method: "GET", url: "https://cancel-proxy.example/v1/models", signal: controller.signal, adapter }),
        (error: unknown) => axios.isCancel(error),
    );
});

test("Gemini fetch 网络失败后保留上游密钥并改走本机 Agent", async () => {
    connectLocalAgent();
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
        calls.push({ input, init });
        if (calls.length === 1) throw new TypeError("Failed to fetch");
        return new Response("ok", { status: 200, headers: { "x-channel-proxy": "local-agent" } });
    }) as typeof fetch;
    try {
        const response = await channelFetch({ channelMode: "local" }, "https://gemini.example/v1/models", { headers: { "x-goog-api-key": "provider-key" } });
        assert.equal(await response.text(), "ok");
        assert.equal(calls.length, 2);
        assert.equal(calls[1].input, `${AGENT_URL}/channel-proxy`);
        const headers = new Headers(calls[1].init?.headers);
        assert.equal(headers.get("x-canvas-agent-token"), AGENT_TOKEN);
        assert.equal(headers.get("x-channel-target"), "https://gemini.example/v1/models");
        assert.deepEqual(JSON.parse(decodeURIComponent(headers.get("x-channel-headers") || "")), { "x-goog-api-key": "provider-key" });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
