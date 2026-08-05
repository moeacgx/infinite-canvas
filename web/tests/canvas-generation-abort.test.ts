import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter } from "axios";

import { createLinkedAbortController } from "../src/app/(user)/canvas/utils/canvas-generation-abort.ts";
import { createVideoGenerationTask } from "../src/services/api/video.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

test("Agent 停止信号会传递给画布媒体生成请求", () => {
    const parent = new AbortController();
    const linked = createLinkedAbortController(parent.signal);

    parent.abort("用户停止");

    assert.equal(linked.controller.signal.aborted, true);
    assert.equal(linked.controller.signal.reason, "用户停止");
});

test("媒体生成完成后解除停止信号监听", () => {
    const parent = new AbortController();
    const linked = createLinkedAbortController(parent.signal);

    linked.dispose();
    parent.abort();

    assert.equal(linked.controller.signal.aborted, false);
});

test("Seedance 参考素材上传继承生成取消信号并保留 AbortError", { timeout: 2_000 }, async (context) => {
    const originalAdapter = axios.defaults.adapter;
    const originalToken = useUserStore.getState().token;
    const controller = new AbortController();
    let resolveUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
        resolveUploadStarted = resolve;
    });
    let uploadCanceled = false;

    context.after(() => {
        axios.defaults.adapter = originalAdapter;
        useUserStore.setState({ token: originalToken });
    });
    useUserStore.setState({ token: "test-token" });
    axios.defaults.adapter = (async (config) => {
        resolveUploadStarted();
        assert.equal(config.url, "/api/v1/media/references");
        assert.equal(config.signal, controller.signal);
        return await new Promise((_resolve, reject) => {
            const cancel = () => {
                uploadCanceled = true;
                reject(new axios.CanceledError("canceled", config));
            };
            if (config.signal?.aborted) cancel();
            else config.signal?.addEventListener("abort", cancel, { once: true });
        });
    }) as AxiosAdapter;

    const model = "doubao-seedance-2.0";
    const config = {
        ...defaultConfig,
        channelMode: "remote" as const,
        model,
        videoModel: model,
        models: [model],
        videoModels: [model],
    };
    const request = createVideoGenerationTask(config, "生成视频", [{ id: "reference", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" }], [], [], { signal: controller.signal });

    await uploadStarted;
    controller.abort();

    await assert.rejects(request, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(uploadCanceled, true);
});
