import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter } from "axios";

import { requestGeneration } from "../src/services/api/image.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";

test("New API 多张图片结果下载会被同一生成信号同时取消", { timeout: 2_000 }, async (context) => {
    const originalAdapter = axios.defaults.adapter;
    const controller = new AbortController();
    let resolveDownloadStarted!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
        resolveDownloadStarted = resolve;
    });
    let downloadStartedCount = 0;
    let downloadCanceledCount = 0;

    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });
    axios.defaults.adapter = (async (config) => {
        const url = String(config.url || "");
        if (config.method === "post" && url.endsWith("/images/tasks")) {
            return { data: { task_id: "task-image" }, status: 200, statusText: "OK", headers: {}, config };
        }
        if (url.endsWith("/images/tasks/task-image")) {
            return {
                data: {
                    task_id: "task-image",
                    status: "succeeded",
                    result: { data: [{ url: "/canvas/v1/images/tasks/task-image/content/0" }, { url: "/canvas/v1/images/tasks/task-image/content/1" }] },
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        if (/\/canvas\/v1\/images\/tasks\/task-image\/content\/[01]$/.test(url)) {
            downloadStartedCount += 1;
            if (downloadStartedCount === 2) resolveDownloadStarted();
            assert.equal(config.signal, controller.signal);
            return await new Promise((_resolve, reject) => {
                const cancel = () => {
                    downloadCanceledCount += 1;
                    reject(new axios.CanceledError("请求已取消", config));
                };
                if (config.signal?.aborted) cancel();
                else config.signal?.addEventListener("abort", cancel, { once: true });
            });
        }
        throw new Error(`未预期的图片请求：${url}`);
    }) as AxiosAdapter;

    const config = {
        ...defaultConfig,
        channelMode: "newapi" as const,
        baseUrl: "https://newapi.example/v1",
        newApiGroup: "default",
        newApiImageGroup: "default",
        model: "gpt-image-2",
        imageModel: "gpt-image-2",
        count: "2",
        models: ["gpt-image-2"],
        imageModels: ["gpt-image-2"],
    };
    const request = requestGeneration(config, "生成图片", { signal: controller.signal });

    await downloadStarted;
    controller.abort();

    await assert.rejects(request, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
    assert.equal(downloadCanceledCount, 2);
});
