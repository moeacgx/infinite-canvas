import assert from "node:assert/strict";
import test from "node:test";

import { requestEdit, requestGeneration } from "../src/services/api/image.ts";
import { createModelChannel, defaultConfig, encodeChannelModel, withLocalChannels } from "../src/stores/use-config-store.ts";
import { normalizePanoramaQuality, resolvePanoramaPreviewSize } from "../src/app/(user)/canvas/utils/canvas-panorama.ts";

test("全景默认质量归一化并只迁移旧默认预览尺寸", () => {
    assert.equal(normalizePanoramaQuality(undefined), "medium");
    assert.equal(normalizePanoramaQuality("auto"), "medium");
    assert.equal(normalizePanoramaQuality("HIGH"), "high");
    assert.deepEqual(resolvePanoramaPreviewSize(undefined, undefined), { width: 420, height: 210 });
    assert.deepEqual(resolvePanoramaPreviewSize(340, 170), { width: 420, height: 210 });
    assert.deepEqual(resolvePanoramaPreviewSize(680, 340), { width: 680, height: 340 });
});

test("Responses 多图请求限制并发并只注入一次系统提示词", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests -= 1;
        return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: "SU1BR0U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const channel = createModelChannel({
        id: "responses",
        name: "Responses",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        imageApiMode: "responses",
        responsesImageModel: "gpt-5.6",
        models: ["gpt-image-2", "gpt-5.6"],
    });
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            imageModel: encodeChannelModel("responses", "gpt-image-2"),
            imageModels: [encodeChannelModel("responses", "gpt-image-2")],
            systemPrompt: "SYSTEM",
            count: "6",
        },
        [channel],
    );

    const images = await requestGeneration(config, "PROMPT");

    assert.equal(images.length, 6);
    assert.equal(requestBodies.length, 6);
    assert.equal(maxActiveRequests, 3);
    for (const body of requestBodies) {
        assert.equal(body.model, "gpt-5.6");
        assert.equal(body.input, "SYSTEM\n\nPROMPT");
    }
});

test("Images URL 返回设置显式发送 response_format=url", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ data: [{ b64_json: "SU1BR0U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const channel = createModelChannel({
        id: "images",
        name: "Images",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        imageApiMode: "images",
        streamImages: true,
        responseFormatB64Json: false,
        models: ["gpt-image-2"],
    });
    const selectedModel = encodeChannelModel("images", "gpt-image-2");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            imageModel: selectedModel,
            imageModels: [selectedModel],
        },
        [channel],
    );

    await requestGeneration(config, "PROMPT");

    assert.equal(requestBody?.response_format, "url");
    assert.equal(requestBody?.stream, true);
});

test("Images 流式多图拆成单图请求并限制并发", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeRequests -= 1;
        return new Response('data: {"type":"image_generation.completed","b64_json":"SU1BR0U="}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        });
    };

    const channel = createModelChannel({
        id: "images-stream",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        streamImages: true,
        models: ["gpt-image-2"],
    });
    const selectedModel = encodeChannelModel("images-stream", "gpt-image-2");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local", imageModel: selectedModel, imageModels: [selectedModel], count: "6" }, [channel]);

    const images = await requestGeneration(config, "PROMPT");

    assert.equal(images.length, 6);
    assert.equal(requestBodies.length, 6);
    assert.equal(maxActiveRequests, 3);
    assert.ok(requestBodies.every((body) => body.n === 1));
});

test("图片比例换算保持常见比例并遵守最大边长", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: "SU1BR0U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const channel = createModelChannel({
        id: "ratio",
        name: "Ratio",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        imageApiMode: "responses",
        responsesImageModel: "gpt-5.6",
        models: ["gpt-image-2", "gpt-5.6"],
    });
    const selectedModel = encodeChannelModel("ratio", "gpt-image-2");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            imageModel: selectedModel,
            imageModels: [selectedModel],
            count: "1",
        },
        [channel],
    );

    await requestGeneration({ ...config, quality: "medium", size: "16:9" }, "PROMPT");
    await requestGeneration({ ...config, quality: "medium", size: "9:16" }, "PROMPT");
    await requestGeneration({ ...config, quality: "high", size: "3:1" }, "PROMPT");

    const sizes = requestBodies.map((body) => (body.tools as Array<Record<string, unknown>>)[0]?.size);
    assert.deepEqual(sizes, ["2816x1584", "1584x2816", "3840x1280"]);
});

test("GPT 图片 21:9 4K 精确尺寸最长边不超过 3840", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: "SU1BR0U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const channel = createModelChannel({
        id: "gpt-4k",
        name: "GPT 4K",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        imageApiMode: "responses",
        responsesImageModel: "gpt-5.6",
        models: ["gpt-image-2", "gpt-5.6"],
    });
    const selectedModel = encodeChannelModel("gpt-4k", "gpt-image-2");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local", imageModel: selectedModel, imageModels: [selectedModel], count: "1" }, [channel]);

    await requestGeneration({ ...config, quality: "high", size: "3808x1632" }, "PROMPT");
    await assert.rejects(() => requestGeneration({ ...config, quality: "high", size: "6272x2688" }, "PROMPT"), /最长边不能超过 3840px/);

    const sizes = requestBodies.map((body) => (body.tools as Array<Record<string, unknown>>)[0]?.size);
    assert.deepEqual(sizes, ["3808x1632"]);
});

test("全景 2:1 生成与编辑请求保留归一化质量并按质量换算输出尺寸", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ output: [{ type: "image_generation_call", result: "SU1BR0U=" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };

    const channel = createModelChannel({
        id: "panorama-ratio",
        name: "Panorama Ratio",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        imageApiMode: "responses",
        responsesImageModel: "gpt-5.6",
        models: ["gpt-image-2", "gpt-5.6"],
    });
    const selectedModel = encodeChannelModel("panorama-ratio", "gpt-image-2");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            imageModel: selectedModel,
            imageModels: [selectedModel],
            count: "1",
        },
        [channel],
    );

    await requestGeneration({ ...config, quality: "medium", size: "2:1" }, "PANORAMA");
    await requestGeneration({ ...config, quality: "high", size: "2:1" }, "PANORAMA");
    await requestEdit({ ...config, quality: normalizePanoramaQuality("auto"), size: "2:1" }, "PANORAMA EDIT", [{ id: "reference", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,SU1BR0U=" }]);

    const tools = requestBodies.map((body) => (body.tools as Array<Record<string, unknown>>)[0]);
    assert.deepEqual(
        tools.map((tool) => tool?.quality),
        ["medium", "high", "medium"],
    );
    assert.deepEqual(
        tools.map((tool) => tool?.size),
        ["2912x1456", "3840x1920", "2912x1456"],
    );
});
