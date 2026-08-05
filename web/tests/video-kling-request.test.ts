import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import axios, { type AxiosAdapter } from "axios";

import { createVideoGenerationTask, pollVideoGenerationTask, waitForVideoGenerationTask, type VideoReferenceInput } from "../src/services/api/video.ts";
import { defaultConfig, encodeChannelModel, type AiConfig, type ModelChannel } from "../src/stores/use-config-store.ts";

function localVideoConfig(channel: ModelChannel, model: string, patch: Partial<AiConfig> = {}): AiConfig {
    const selected = encodeChannelModel(channel.id, model);
    return {
        ...defaultConfig,
        channelMode: "local",
        channels: [channel],
        models: [selected],
        videoModels: [selected],
        model: selected,
        videoModel: selected,
        activeChannelId: channel.id,
        videoChannelId: channel.id,
        ...patch,
    };
}

function channel(id: string, name: string, model: string): ModelChannel {
    return {
        id,
        name,
        baseUrl: `https://${id}.example/v1`,
        apiKey: "test-key",
        apiFormat: "openai",
        requestMode: "direct",
        models: [model],
    };
}

async function captureVideoRequest(context: TestContext, config: AiConfig, input: VideoReferenceInput) {
    const originalAdapter = axios.defaults.adapter;
    let body: FormData | undefined;
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });
    axios.defaults.adapter = (async (request) => {
        body = request.data as FormData;
        return { data: { id: "task_test" }, status: 200, statusText: "OK", headers: {}, config: request };
    }) as AxiosAdapter;

    await createVideoGenerationTask(config, "生成一段视频", input);
    assert.ok(body instanceof FormData);
    return body;
}

test("APIMart Kling v3 请求保留完整工作台参数", async (context) => {
    const model = "kling-v3";
    const config = localVideoConfig(channel("apimart", "APIMart 视频", model), model, {
        videoMode: "4k",
        videoSeconds: "15",
        videoSize: "720x1280",
        size: "720x1280",
        videoNegativePrompt: "不要字幕",
        videoMultiShot: "true",
        videoShotType: "customize",
        videoMultiPrompt: [
            { prompt: "镜头一", duration: "5" },
            { prompt: "镜头二", duration: "10" },
        ],
        videoElementList: [
            {
                name: "主角",
                description: "保持人物一致",
                references: [{ id: "element-1", kind: "image", name: "actor.png", type: "image/png", url: "https://media.example/actor.png" }],
            },
        ],
        videoGenerateAudio: "true",
    });

    const body = await captureVideoRequest(context, config, {});

    assert.equal(body.get("model"), model);
    assert.equal(body.get("mode"), "4k");
    assert.equal(body.get("duration"), "15");
    assert.equal(body.get("aspect_ratio"), "9:16");
    assert.equal(body.get("negative_prompt"), "不要字幕");
    assert.equal(body.get("multi_shot"), "true");
    assert.equal(body.get("shot_type"), "customize");
    assert.deepEqual(JSON.parse(String(body.get("multi_prompt"))), [
        { index: 1, prompt: "镜头一", duration: 5 },
        { index: 2, prompt: "镜头二", duration: 10 },
    ]);
    assert.deepEqual(JSON.parse(String(body.get("element_list"))), [{ name: "主角", description: "保持人物一致", element_input_urls: ["https://media.example/actor.png"] }]);
    assert.equal(body.get("video_generate_audio"), "true");
    assert.equal(body.has("seconds"), false);
    assert.equal(body.has("preset"), false);
});

test("KIE Kling v3 使用 KIE 多镜头和元素结构", async (context) => {
    const model = "kling-3-0-video";
    const config = localVideoConfig(channel("kie", "KIE 中转", model), model, {
        videoMode: "pro",
        videoSeconds: "8",
        size: "1:1",
        videoNegativePrompt: "不会发送",
        videoMultiShot: "true",
        videoMultiPrompt: [{ prompt: "环绕镜头", duration: "8" }],
        videoElementList: [
            {
                name: "产品",
                description: "固定外观",
                references: [{ id: "element-2", kind: "video", name: "product.mp4", type: "video/mp4", url: "https://media.example/product.mp4" }],
            },
        ],
    });

    const body = await captureVideoRequest(context, config, {});

    assert.equal(body.get("duration"), "8");
    assert.equal(body.get("multi_shot"), "true");
    assert.deepEqual(JSON.parse(String(body.get("multi_prompt"))), [{ prompt: "环绕镜头", duration: 8 }]);
    assert.deepEqual(JSON.parse(String(body.get("element_list"))), [{ name: "产品", description: "固定外观", references: [{ kind: "video", url: "https://media.example/product.mp4" }] }]);
    assert.equal(body.has("negative_prompt"), false);
    assert.equal(body.has("shot_type"), false);
});

test("通用视频模型透传首帧和尾帧且保留原有字段", async (context) => {
    const model = "custom-video-model";
    const config = localVideoConfig(channel("custom", "自定义中转", model), model, {
        videoSeconds: "6",
        size: "1280x720",
        vquality: "1080",
        videoGenerateAudio: "true",
        systemPrompts: { ...defaultConfig.systemPrompts, video: "保持镜头连续" },
    });

    const body = await captureVideoRequest(context, config, {
        firstFrame: { id: "first", name: "first.png", type: "image/png", dataUrl: "", url: "https://media.example/first.png" },
        lastFrame: { id: "last", name: "last.png", type: "image/png", dataUrl: "", url: "https://media.example/last.png" },
        videoReferences: [{ id: "video", name: "reference.mp4", type: "video/mp4", url: "https://media.example/reference.mp4" }],
        audioReferences: [{ id: "audio", name: "reference.mp3", type: "audio/mpeg", url: "https://media.example/reference.mp3" }],
    });

    assert.equal(body.get("prompt"), "保持镜头连续\n\n生成一段视频");
    assert.equal(body.get("seconds"), "6");
    assert.equal(body.get("size"), "1280x720");
    assert.equal(body.get("resolution_name"), "1080p");
    assert.equal(body.get("preset"), "normal");
    assert.equal(body.get("first_frame_url"), "https://media.example/first.png");
    assert.equal(body.get("last_frame_url"), "https://media.example/last.png");
    assert.equal(body.get("video_reference[]"), "https://media.example/reference.mp4");
    assert.equal(body.get("audio_reference[]"), "https://media.example/reference.mp3");
    assert.equal(body.has("video_generate_audio"), false);
    assert.equal(body.has("duration"), false);
});

test("Kling v2.6 标清模式自动关闭音频而不阻断请求", async (context) => {
    const model = "kling-v2.6";
    const config = localVideoConfig(channel("apimart", "APIMart 视频", model), model, {
        videoMode: "std",
        videoSeconds: "5",
        videoGenerateAudio: "true",
    });

    const body = await captureVideoRequest(context, config, {});

    assert.equal(body.get("mode"), "std");
    assert.equal(body.get("video_generate_audio"), "false");
});

test("视频轮询完成结果兼容 video_url 和 url", async (context) => {
    const model = "custom-video-model";
    const config = localVideoConfig(channel("custom", "自定义中转", model), model);
    const originalAdapter = axios.defaults.adapter;
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });

    for (const [field, value] of [
        ["video_url", "https://media.example/video-url.mp4"],
        ["url", "https://media.example/url.mp4"],
    ] as const) {
        axios.defaults.adapter = (async (request) => ({
            data: { id: `task_${field}`, status: "completed", [field]: value },
            status: 200,
            statusText: "OK",
            headers: {},
            config: request,
        })) as AxiosAdapter;
        const state = await pollVideoGenerationTask(config, { id: `task_${field}`, provider: "openai", model });
        assert.equal(state.status, "completed");
        if (state.status === "completed") assert.equal(state.result.url, value);
    }
});

test("画布刷新后只轮询已持久化任务且沿用原渠道", async (context) => {
    const model = "custom-video-model";
    const customChannel = channel("custom", "自定义中转", model);
    const config = localVideoConfig(customChannel, model);
    const channelModel = encodeChannelModel(customChannel.id, model);
    const originalAdapter = axios.defaults.adapter;
    const requests: Array<{ method?: string; url?: string }> = [];
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });
    axios.defaults.adapter = (async (request) => {
        requests.push({ method: request.method, url: request.url });
        return {
            data: { id: "task_restore", status: "completed", url: "https://media.example/restored.mp4" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: request,
        };
    }) as AxiosAdapter;

    const result = await waitForVideoGenerationTask(config, { id: "task_restore", provider: "openai", model, channelModel });

    assert.equal(result.url, "https://media.example/restored.mp4");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "get");
    assert.match(requests[0].url || "", /^https:\/\/custom\.example\/v1\/videos\/task_restore$/);
});

test("New API Grok 超过 15 秒时在请求发出前失败", async (context) => {
    const originalAdapter = axios.defaults.adapter;
    let requestCount = 0;
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });
    axios.defaults.adapter = (async (request) => {
        requestCount += 1;
        return { data: { id: "unexpected" }, status: 200, statusText: "OK", headers: {}, config: request };
    }) as AxiosAdapter;
    const config: AiConfig = {
        ...defaultConfig,
        channelMode: "newapi",
        baseUrl: "https://newapi.example.com",
        newApiGroup: "video",
        videoModel: "grok-imagine-video-1.5",
        model: "grok-imagine-video-1.5",
        models: ["grok-imagine-video-1.5"],
        videoModels: ["grok-imagine-video-1.5"],
        videoSeconds: "16",
    };

    await assert.rejects(() => createVideoGenerationTask(config, "测试时长", {}), /15/);
    assert.equal(requestCount, 0);
});
