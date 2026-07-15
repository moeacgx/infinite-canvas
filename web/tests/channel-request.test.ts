import assert from "node:assert/strict";
import test from "node:test";

import axios, { AxiosError, type AxiosAdapter, type AxiosRequestConfig } from "axios";

import { channelAxiosRequest, channelFetch } from "../src/services/api/channel-request.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

test("Axios 本地 GET 网络失败后改走同源渠道代理", async () => {
    useUserStore.setState({ token: "app-token" });
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
    assert.equal(calls[1].url, "/channel-proxy");
    assert.equal(calls[1].method, "post");
    assert.equal(calls[1].headers?.get("Authorization"), "Bearer app-token");
    assert.equal(calls[1].headers?.get("x-channel-target"), "https://api.example.com/v1/models");
    const upstream = JSON.parse(decodeURIComponent(String(calls[1].headers?.get("x-channel-headers"))));
    assert.equal(upstream.Authorization, "Bearer provider");
});

test("New API 网络失败不会进入本地渠道代理", async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
        calls += 1;
        throw new AxiosError("Network Error", "ERR_NETWORK", config);
    };
    await assert.rejects(() => channelAxiosRequest({ channelMode: "newapi" }, { method: "GET", url: "https://newapi.example/v1/models", adapter }), /Network Error/);
    assert.equal(calls, 1);
});

test("模型读取触发兼容回退后，同源生成请求直接走代理且不会先发送两次", async () => {
    useUserStore.setState({ token: "app-token" });
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
    assert.equal(calls[0].url, "/channel-proxy");
    assert.equal(calls[0].headers?.get("x-channel-method"), "POST");
});

test("自动模式没有本站登录态时仍允许浏览器直接请求", async () => {
    useUserStore.setState({ token: "" });
    const calls: AxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    await channelAxiosRequest({ channelMode: "local", requestMode: "auto" }, { method: "GET", url: "https://learned-proxy.example/v1/models", adapter });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://learned-proxy.example/v1/models");
});

test("显式后端兼容模式首次写请求就走代理", async () => {
    useUserStore.setState({ token: "app-token" });
    const calls: AxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };
    await channelAxiosRequest({ channelMode: "local", requestMode: "proxy" }, { method: "POST", url: "https://forced-proxy.example/v1/chat/completions", data: {}, adapter });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/channel-proxy");
});

test("后端兼容请求被主动取消时保留 Axios 取消语义", async () => {
    useUserStore.setState({ token: "app-token" });
    const controller = new AbortController();
    controller.abort();
    const adapter: AxiosAdapter = async (config) => {
        throw new axios.CanceledError("已取消", config);
    };
    await assert.rejects(
        () => channelAxiosRequest({ channelMode: "local", requestMode: "proxy" }, { method: "GET", url: "https://cancel-proxy.example/v1/models", signal: controller.signal, adapter }),
        (error: unknown) => axios.isCancel(error),
    );
});

test("Gemini fetch 网络失败后保留上游密钥并改走代理", async () => {
    useUserStore.setState({ token: "app-token" });
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
        calls.push({ input, init });
        if (calls.length === 1) throw new TypeError("Failed to fetch");
        return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
        const response = await channelFetch({ channelMode: "local" }, "https://gemini.example/v1/models", { headers: { "x-goog-api-key": "provider-key" } });
        assert.equal(await response.text(), "ok");
        assert.equal(calls.length, 2);
        assert.equal(calls[1].input, "/channel-proxy");
        const headers = new Headers(calls[1].init?.headers);
        assert.equal(headers.get("authorization"), "Bearer app-token");
        assert.equal(headers.get("x-channel-target"), "https://gemini.example/v1/models");
        assert.deepEqual(JSON.parse(decodeURIComponent(headers.get("x-channel-headers") || "")), { "x-goog-api-key": "provider-key" });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
