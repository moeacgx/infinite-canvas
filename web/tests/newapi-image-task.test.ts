import assert from "node:assert/strict";
import test from "node:test";
import axios, { type AxiosAdapter, type AxiosRequestConfig } from "axios";
import localforage from "localforage";

import { defaultConfig } from "../src/stores/use-config-store.ts";

const memoryStores = new Map<string, Map<string, unknown>>();
const memoryDriver = {
    _driver: "memory-newapi-image-driver",
    _support: true,
    _initStorage(options: { name?: string; storeName?: string }) {
        const key = `${options.name || "localforage"}/${options.storeName || "keyvaluepairs"}`;
        if (!memoryStores.has(key)) memoryStores.set(key, new Map());
        this._memoryStore = memoryStores.get(key)!;
        return Promise.resolve();
    },
    _memoryStore: new Map<string, unknown>(),
    clear(callback?: (error: null) => void) {
        this._memoryStore.clear();
        callback?.(null);
        return Promise.resolve();
    },
    getItem(key: string, callback?: (error: null, value: unknown) => void) {
        const value = this._memoryStore.has(key) ? this._memoryStore.get(key) : null;
        callback?.(null, value);
        return Promise.resolve(value);
    },
    setItem(key: string, value: unknown, callback?: (error: null, value: unknown) => void) {
        this._memoryStore.set(key, value);
        callback?.(null, value);
        return Promise.resolve(value);
    },
    removeItem(key: string, callback?: (error: null) => void) {
        this._memoryStore.delete(key);
        callback?.(null);
        return Promise.resolve();
    },
    iterate(iterator: (value: unknown, key: string, index: number) => unknown, callback?: (error: null, result?: unknown) => void) {
        let index = 1;
        for (const [key, value] of this._memoryStore.entries()) {
            const result = iterator(value, key, index++);
            if (result !== undefined) {
                callback?.(null, result);
                return Promise.resolve(result);
            }
        }
        callback?.(null);
        return Promise.resolve();
    },
    key(index: number, callback?: (error: null, value: string | null) => void) {
        const value = Array.from(this._memoryStore.keys())[index] ?? null;
        callback?.(null, value);
        return Promise.resolve(value);
    },
    keys(callback?: (error: null, value: string[]) => void) {
        const value = Array.from(this._memoryStore.keys());
        callback?.(null, value);
        return Promise.resolve(value);
    },
    length(callback?: (error: null, value: number) => void) {
        const value = this._memoryStore.size;
        callback?.(null, value);
        return Promise.resolve(value);
    },
};

await localforage.defineDriver(memoryDriver);
const createLocalForageInstance = localforage.createInstance.bind(localforage);
localforage.createInstance = ((options: { name?: string; storeName?: string } = {}) => createLocalForageInstance({ ...options, driver: memoryDriver._driver })) as typeof localforage.createInstance;

if (typeof URL.createObjectURL !== "function") {
    URL.createObjectURL = () => "blob:newapi-image";
    URL.revokeObjectURL = () => undefined;
}

const { requestGeneration } = await import("../src/services/api/image.ts");

const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

function newApiConfig() {
    return {
        ...defaultConfig,
        channelMode: "newapi" as const,
        baseUrl: "https://newapi.example/v1",
        newApiGroup: "auto",
        newApiImageGroup: "auto",
        model: "gpt-image-2.5-flare",
        imageModel: "gpt-image-2.5-flare",
        count: "1",
        models: ["gpt-image-2.5-flare"],
        imageModels: ["gpt-image-2.5-flare"],
    };
}

function axiosOk(config: AxiosRequestConfig, data: unknown) {
    return { data, status: 200, statusText: "OK", headers: {}, config };
}

test("New API 信封 + SUCCESS 任务会解析出图片，而不是把已成功任务判失败", { timeout: 2_000 }, async (context) => {
    const originalAdapter = axios.defaults.adapter;
    const downloadedUrls: string[] = [];
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });

    axios.defaults.adapter = (async (config) => {
        const url = String(config.url || "");
        if (config.method === "post" && url.endsWith("/images/tasks")) {
            return axiosOk(config, {
                code: "success",
                message: "",
                data: { task_id: "task_flare", status: "IN_PROGRESS", progress: "0%" },
            });
        }
        if (url.endsWith("/images/tasks/task_flare")) {
            assert.equal(config.withCredentials, true);
            return axiosOk(config, {
                code: "success",
                message: "",
                data: {
                    task_id: "task_flare",
                    status: "SUCCESS",
                    progress: "100%",
                    data: {
                        data: [{ url: "https://files.example/flare.png", b64_json: "" }],
                    },
                },
            });
        }
        if (url === "https://files.example/flare.png") {
            downloadedUrls.push(url);
            assert.notEqual(config.withCredentials, true);
            assert.equal(config.responseType, "blob");
            return axiosOk(config, pngBlob);
        }
        throw new Error(`未预期的图片请求：${url}`);
    }) as AxiosAdapter;

    const images = await requestGeneration(newApiConfig(), "Dark, eerie Chinese mythological");

    assert.equal(images.length, 1);
    assert.equal(downloadedUrls.length, 1);
    assert.match(images[0].dataUrl, /^(blob:|data:)/);
});

test("New API 绝对 Canvas 内容地址会带登录态下载", { timeout: 2_000 }, async (context) => {
    const originalAdapter = axios.defaults.adapter;
    const downloadedUrls: string[] = [];
    context.after(() => {
        axios.defaults.adapter = originalAdapter;
    });

    axios.defaults.adapter = (async (config) => {
        const url = String(config.url || "");
        if (config.method === "post" && url.endsWith("/images/tasks")) {
            return axiosOk(config, { task_id: "task-image" });
        }
        if (url.endsWith("/images/tasks/task-image")) {
            return axiosOk(config, {
                task_id: "task-image",
                status: "succeeded",
                result: { data: [{ url: "https://newapi.example/canvas/v1/images/tasks/task-image/content/0" }] },
            });
        }
        if (url === "https://newapi.example/canvas/v1/images/tasks/task-image/content/0") {
            downloadedUrls.push(url);
            assert.equal(config.withCredentials, true);
            return axiosOk(config, pngBlob);
        }
        throw new Error(`未预期的图片请求：${url}`);
    }) as AxiosAdapter;

    const images = await requestGeneration(newApiConfig(), "生成图片");

    assert.equal(images.length, 1);
    assert.equal(downloadedUrls.length, 1);
    assert.match(images[0].dataUrl, /^(blob:|data:)/);
});
