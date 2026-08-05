import assert from "node:assert/strict";
import test from "node:test";

import { assertVideoSecondsSupported, getVideoMaxSeconds, supportsVideoAudioGeneration } from "../src/lib/video-model-capabilities.ts";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store.ts";

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "newapi",
        baseUrl: "https://newapi.example.com",
        newApiGroup: "video",
        models: ["text-model", "grok-imagine-video", "grok-imagine-video-1.5", "other-video"],
        textModels: ["text-model"],
        videoModels: ["grok-imagine-video", "grok-imagine-video-1.5", "other-video"],
        model: "text-model",
        videoModel: "grok-imagine-video",
        videoSeconds: "20",
        ...overrides,
    };
}

test("New API Grok video models have a 15-second limit", () => {
    assert.equal(getVideoMaxSeconds(makeConfig({ videoModel: "grok-imagine-video" })), 15);
    assert.equal(getVideoMaxSeconds(makeConfig({ videoModel: "grok-imagine-video-1.5" })), 15);
});

test("other models and channels keep the 20-second limit", () => {
    assert.equal(getVideoMaxSeconds(makeConfig({ videoModel: "other-video" })), 20);
    assert.equal(getVideoMaxSeconds(makeConfig({ channelMode: "local", videoModel: "grok-imagine-video" })), 20);
    assert.equal(getVideoMaxSeconds(makeConfig({ channelMode: "remote", videoModel: "grok-imagine-video" })), 20);
});

test("videoModel wins over a separate text model", () => {
    const config = makeConfig({ model: "text-model", videoModel: "grok-imagine-video-1.5" });
    assert.equal(getVideoMaxSeconds(config), 15);
});

test("overlong Grok requests fail before dispatch", () => {
    assert.throws(() => assertVideoSecondsSupported(makeConfig({ videoSeconds: "16" })), /15/);
    assert.doesNotThrow(() => assertVideoSecondsSupported(makeConfig({ videoSeconds: "15" })));
    assert.doesNotThrow(() => assertVideoSecondsSupported(makeConfig({ videoModel: "other-video", videoSeconds: "20" })));
});

test("音频生成只对明确支持的模型开放", () => {
    assert.equal(defaultConfig.videoGenerateAudio, "false");
    assert.equal(supportsVideoAudioGeneration("grok-imagine-video-1.5"), false);
    assert.equal(supportsVideoAudioGeneration("custom-video-model"), false);
    assert.equal(supportsVideoAudioGeneration("kling-v2.6"), true);
    assert.equal(supportsVideoAudioGeneration("bytedance/seedance_2"), true);
    assert.equal(supportsVideoAudioGeneration("kling-v3-motion-control"), false);
});
