import assert from "node:assert/strict";
import test from "node:test";

import axios, { AxiosError, type AxiosAdapter, type AxiosRequestConfig } from "axios";

import { channelAxiosRequest, channelFetch } from "../src/services/api/channel-request.ts";

test("本地渠道请求始终直连提供商，不经过本机代理", async () => {
    const calls: AxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
        calls.push(config);
        return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    };

    const result = await channelAxiosRequest<{ ok: boolean }>(
        { channelMode: "local" },
        { method: "POST", url: "https://provider.example/v1/chat/completions", data: { prompt: "直连" }, adapter },
    );

    assert.equal(result.data.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://provider.example/v1/chat/completions");
});

test("本地写请求网络失败只尝试一次", async () => {
    let calls = 0;
    const adapter: AxiosAdapter = async (config) => {
        calls += 1;
        throw new AxiosError("Network Error", "ERR_NETWORK", config);
    };

    await assert.rejects(
        () => channelAxiosRequest({ channelMode: "local" }, { method: "POST", url: "https://provider.example/v1/images/generations", data: { prompt: "一次" }, adapter }),
        /Network Error/,
    );
    assert.equal(calls, 1);
});

test("New API GET 瞬时网络失败会在浏览器内重试", async () => {
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

test("channelFetch 使用浏览器原生请求，不改写目标地址", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
        calls.push({ input, init });
        return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
        const response = await channelFetch({ channelMode: "local" }, "https://provider.example/v1/models", { method: "GET" });
        assert.equal(await response.text(), "ok");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].input, "https://provider.example/v1/models");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
