import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { isRequestCanceled, readApiErrorMessage, readAxiosError } from "@/services/api/ai-utils";
import { createVideoGenerationTask } from "@/services/api/video";
import { imageToDataUrl } from "@/services/image-storage";
import { defaultConfig } from "@/stores/use-config-store";

test("识别 AbortSignal 主动取消", () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(isRequestCanceled(new Error("网络失败"), controller.signal), true);
});

test("识别 Axios 与 DOM 取消错误", () => {
    assert.equal(isRequestCanceled(new axios.CanceledError("已取消")), true);
    assert.equal(isRequestCanceled(new DOMException("已取消", "AbortError")), true);
});

test("普通下载错误不会被误判为取消", () => {
    assert.equal(isRequestCanceled(new Error("下载失败")), false);
});

test("图片引用读取沿用调用方的取消信号", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    globalThis.fetch = ((_input, init) => {
        receivedSignal = init?.signal;
        markStarted();
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("已取消", "AbortError")), { once: true }));
    }) as typeof fetch;

    const pending = imageToDataUrl({ url: "https://media.example/reference.png" }, controller.signal);
    await started;
    controller.abort();

    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(receivedSignal, controller.signal);
});

test("Seedance 本地参考素材预处理沿用调用方的取消信号", async (context) => {
    const originalFetch = globalThis.fetch;
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    globalThis.fetch = ((_input, init) => {
        receivedSignal = init?.signal;
        markStarted();
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("已取消", "AbortError")), { once: true }));
    }) as typeof fetch;

    const model = "doubao-seedance-2.0";
    const pending = createVideoGenerationTask(
        { ...defaultConfig, channelMode: "remote", model, videoModel: model },
        "生成一段参考视频",
        [],
        [{ id: "video-1", name: "reference.mp4", type: "video/mp4", url: "blob:reference-video", durationMs: 3000 }],
        [],
        { signal: controller.signal },
    );
    await started;
    controller.abort();

    await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(receivedSignal, controller.signal);
});

test("读取 New API 任务接口的顶层错误消息", () => {
    assert.equal(readApiErrorMessage({ code: "invalid_api_platform", message: "invalid api platform: 48" }), "invalid api platform: 48");
    assert.equal(readApiErrorMessage({ error: { message: "渠道余额不足" } }), "渠道余额不足");
    assert.equal(readApiErrorMessage('{"msg":"分组不可用"}'), "分组不可用");
});

test("Axios 任务错误优先展示服务端真实消息", () => {
    const error = new axios.AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
        data: { code: "invalid_api_platform", message: "invalid api platform: 48" },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
    });
    assert.equal(readAxiosError(error, "视频任务创建失败"), "invalid api platform: 48");
});
