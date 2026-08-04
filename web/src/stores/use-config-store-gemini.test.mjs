import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("./use-config-store.ts", import.meta.url), "utf8");
const modalSource = readFileSync(new URL("../components/layout/app-config-modal.tsx", import.meta.url), "utf8");
const pickerSource = readFileSync(new URL("../components/model-picker.tsx", import.meta.url), "utf8");
const geminiSource = readFileSync(new URL("../services/api/gemini.ts", import.meta.url), "utf8");
const imageSource = readFileSync(new URL("../services/api/image.ts", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../services/api/audio.ts", import.meta.url), "utf8");
const videoSource = readFileSync(new URL("../services/api/video.ts", import.meta.url), "utf8");

test("本地直连支持多渠道并用渠道前缀区分同名模型", () => {
    assert.match(storeSource, /export type ApiCallFormat = "openai" \| "gemini"/);
    assert.match(storeSource, /channels: ModelChannel\[\]/);
    assert.match(storeSource, /const CHANNEL_MODEL_SEPARATOR = "::"/);
    assert.match(storeSource, /export function resolveModelRequestConfig/);
    assert.match(storeSource, /modelOptionLabel[\s\S]*channel\.name/);
});

test("切换本地直连和 New API 时分别保存模型选择", () => {
    assert.match(storeSource, /localModelState: ModelSelectionState/);
    assert.match(storeSource, /newApiModelState: ModelSelectionState/);
    assert.match(storeSource, /setChannelMode:[\s\S]*withLocalChannels/);
    assert.match(storeSource, /mode === "newapi"[\s\S]*newApiModelState/);
    assert.match(storeSource, /config\.channelMode !== "local"[\s\S]*apiFormat: "openai"/);
});

test("配置弹窗可管理 OpenAI 与 Gemini 本地渠道", () => {
    assert.match(modalSource, /const apiFormatOptions/);
    assert.match(modalSource, /fetchChannelModels/);
    assert.match(modalSource, /新增渠道/);
    assert.match(modalSource, /同名模型也能按渠道区分/);
    assert.match(pickerSource, /modelOptionLabel\(config, model\)/);
});

test("Gemini 调用支持模型列表、SSE、图片与工具调用签名", () => {
    assert.match(geminiSource, /"x-goog-api-key"/);
    assert.match(geminiSource, /streamGenerateContent/);
    assert.match(geminiSource, /responseModalities: \["TEXT", "IMAGE"\]/);
    assert.match(geminiSource, /responseFormat: \{ image \}/);
    assert.match(geminiSource, /thoughtSignature/);
    assert.match(geminiSource, /promptFeedback\?\.blockReason/);
});

test("所有生成入口都会先解析本地模型所属渠道", () => {
    for (const source of [imageSource, audioSource, videoSource]) {
        assert.match(source, /resolveModelRequestConfig/);
    }
});
