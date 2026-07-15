import assert from "node:assert/strict";
import test from "node:test";

import type { AxiosAdapter, AxiosRequestConfig } from "axios";

test("刷新页面后自动模式仍记得需要本机 Agent 的渠道来源", async () => {
    const values = new Map<string, string>([
        ["canvas-agent-token", "0123456789abcdef0123456789abcdef"],
        ["canvas-agent-url", "http://127.0.0.1:17371"],
        ["infinite-canvas:agent-channel-origins", JSON.stringify(["https://persist-agent.example"])],
    ]);
    const storage = {
        getItem: (key: string) => values.get(key) || null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    };
    const globals = globalThis as typeof globalThis & { window: typeof globalThis; sessionStorage: typeof storage; localStorage: typeof storage };
    globals.window = globalThis;
    globals.sessionStorage = storage;
    globals.localStorage = storage;

    try {
        const { channelAxiosRequest, rememberLocalAgentCapabilities } = await import("../src/services/api/channel-request.ts");
        rememberLocalAgentCapabilities("http://127.0.0.1:17371", ["channel-proxy"]);
        const calls: AxiosRequestConfig[] = [];
        const adapter: AxiosAdapter = async (config) => {
            calls.push(config);
            return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
        };
        await channelAxiosRequest({ channelMode: "local", requestMode: "auto" }, { method: "POST", url: "https://persist-agent.example/v1/images/generations", data: { prompt: "test" }, adapter });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, "http://127.0.0.1:17371/channel-proxy");
    } finally {
        delete (globalThis as Partial<typeof globals>).window;
        delete (globalThis as Partial<typeof globals>).sessionStorage;
        delete (globalThis as Partial<typeof globals>).localStorage;
    }
});
