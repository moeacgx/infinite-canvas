import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter } from "axios";

import { requestGeminiImages } from "../src/services/api/gemini.ts";
import { PLUGIN_TEMPLATES } from "../src/services/api/model-plugin.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";

const thoughtParts = [
    { thought: true, inlineData: { mimeType: "image/png", data: "VEhPVUdIVA==" } },
    { thought: true, inline_data: { mime_type: "image/png", data: "VEhPVUdIVA==" } },
    { thought: true, fileData: { fileUri: "https://example.com/thought.png" } },
];
const finalParts = [
    { inlineData: { mimeType: "image/png", data: "RklOQUw=" } },
    { thought: false, inline_data: { mime_type: "image/webp", data: "RklOQUwy" } },
];

test("Gemini 图片结果排除全部思考图片并保留最终结果", async (context) => {
    const original = axios.defaults.adapter;
    context.after(() => { axios.defaults.adapter = original; });
    axios.defaults.adapter = (async (config) => ({
        config, status: 200, statusText: "OK", headers: {},
        data: { candidates: [{ content: { parts: [...thoughtParts, ...finalParts, { fileData: { fileUri: "https://example.com/final.png" } }] } }] },
    })) as AxiosAdapter;
    const images = await requestGeminiImages({ ...defaultConfig, channelMode: "local" }, "绘图", [], 1);
    assert.deepEqual(images.map((image) => image.dataUrl), [
        "data:image/png;base64,RklOQUw=", "data:image/webp;base64,RklOQUwy", "https://example.com/final.png",
    ]);
});

test("Gemini 只返回思考图片时报告缺少最终图片", async (context) => {
    const original = axios.defaults.adapter;
    context.after(() => { axios.defaults.adapter = original; });
    axios.defaults.adapter = (async (config) => ({
        config, status: 200, statusText: "OK", headers: {},
        data: { candidates: [{ content: { parts: thoughtParts } }] },
    })) as AxiosAdapter;
    await assert.rejects(requestGeminiImages({ ...defaultConfig, channelMode: "local" }, "绘图", [], 1), /没有返回图片/);
});

test("Gemini 生图通过 imageConfig 发送比例与分辨率", async (context) => {
    const original = axios.defaults.adapter;
    context.after(() => { axios.defaults.adapter = original; });
    let body: { generationConfig?: Record<string, unknown> } = {};
    axios.defaults.adapter = (async (config) => {
        body = JSON.parse(config.data);
        return { config, status: 200, statusText: "OK", headers: {}, data: { candidates: [{ content: { parts: finalParts } }] } };
    }) as AxiosAdapter;
    await requestGeminiImages({ ...defaultConfig, channelMode: "local", model: "gemini-3-pro-image-preview", size: "16:9", quality: "high" }, "绘图", [], 1);
    assert.deepEqual(body.generationConfig?.imageConfig, { aspectRatio: "16:9", imageSize: "4K" });
    assert.equal(body.generationConfig?.responseFormat, undefined);
});

test("Gemini 新建脚本模板同样过滤思考图片", async () => {
    const template = PLUGIN_TEMPLATES.image.find((item) => item.label === "Gemini 规范")!;
    const run = new Function("request", "apiUrl", "model", "prompt", "apiKey", "images", `return (async () => { ${template.script} })()`);
    const result = await run(async () => ({ candidates: [{ content: { parts: [...thoughtParts, ...finalParts] } }] }),
        (path: string) => path, "gemini", "绘图", "test-key", []);
    assert.deepEqual(result, ["data:image/png;base64,RklOQUw=", "data:image/webp;base64,RklOQUwy"]);
});
