import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, useConfigStore } from "../src/stores/use-config-store.ts";

test("New API 与本地渠道来回切换时分别保留连接地址", () => {
    const newApiConfig = {
        ...defaultConfig,
        channelMode: "newapi" as const,
        baseUrl: "https://newapi.example.com",
        newApiGroup: "vip",
        models: ["new-model"],
        textModels: ["new-model"],
        model: "new-model",
        textModel: "new-model",
        channels: [{ id: "local", name: "本地", baseUrl: "https://local.example.com", apiKey: "local-key", apiFormat: "openai" as const, models: ["local-model"] }],
    };
    useConfigStore.setState({
        config: newApiConfig,
        newApiConnectionState: { baseUrl: "https://newapi.example.com", newApiGroup: "vip", newApiTextGroup: "", newApiImageGroup: "", newApiVideoGroup: "", newApiAudioGroup: "" },
    });
    useConfigStore.getState().setChannelMode("local");
    assert.equal(useConfigStore.getState().config.baseUrl, "https://local.example.com");
    useConfigStore.getState().setChannelMode("newapi");
    assert.equal(useConfigStore.getState().config.baseUrl, "https://newapi.example.com");
    assert.equal(useConfigStore.getState().config.newApiGroup, "vip");
});
