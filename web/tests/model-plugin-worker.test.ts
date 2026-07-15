import assert from "node:assert/strict";
import axios, { CanceledError, type AxiosAdapter } from "axios";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Worker as NodeWorker } from "node:worker_threads";

import { runModelPlugin } from "@/services/api/model-plugin";
import { defaultConfig } from "@/stores/use-config-store";

const workerSource = readFileSync(new URL("../public/model-script-worker.js", import.meta.url), "utf8");

function createWorker() {
    return new NodeWorker(
        `const { parentPort } = require("node:worker_threads");
globalThis.postMessage = (value) => parentPort.postMessage(value);
parentPort.on("message", (value) => globalThis.onmessage?.({ data: value }));
${workerSource}`,
        { eval: true },
    );
}

test("隔离 Worker 通过 RPC 执行模型脚本", async () => {
    const worker = createWorker();
    const runId = "run-rpc";
    const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker 测试超时")), 2000);
        worker.on("message", (message) => {
            if (message.type === "request") {
                worker.postMessage({ runId, type: "response", id: message.request.id, data: { ok: true } });
                return;
            }
            if (message.type === "result") {
                clearTimeout(timer);
                resolve(message.result);
            }
            if (message.type === "error") {
                clearTimeout(timer);
                reject(new Error(message.message));
            }
        });
        worker.postMessage({ runId, type: "run", script: "return await request({ method: 'GET', url: baseUrl + '/v1/models' });", args: { prompt: "", images: [], messages: [], params: {}, model: "m", baseUrl: "https://api.example.com", apiKey: "key", systemPrompt: "" } });
    });
    await worker.terminate();
    assert.deepEqual(result, { ok: true });
});

test("apiUrl 兼容根地址、v1 和 api/v3 Base URL", async () => {
    const cases = [
        ["https://api.example.com", "https://api.example.com/v1/chat/completions"],
        ["https://api.example.com/v1", "https://api.example.com/v1/chat/completions"],
        ["https://api.example.com/api/v3", "https://api.example.com/api/v3/chat/completions"],
    ];
    for (const [baseUrl, expected] of cases) {
        const worker = createWorker();
        const result = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("apiUrl 测试超时")), 2000);
            worker.on("message", (message) => {
                if (message.type === "result") {
                    clearTimeout(timer);
                    resolve(message.result);
                } else if (message.type === "error") {
                    clearTimeout(timer);
                    reject(new Error(message.message));
                }
            });
            worker.postMessage({ runId: `url-${baseUrl}`, type: "run", script: "return apiUrl('/v1/chat/completions');", args: { prompt: "", images: [], messages: [], params: {}, model: "m", baseUrl, apiKey: "placeholder", systemPrompt: "" } });
        });
        await worker.terminate();
        assert.equal(result, expected);
    }
});

test("隔离 Worker 能序列化表单和 Blob，并把 RPC 错误返回脚本", async () => {
    const worker = createWorker();
    const runId = "run-form";
    const error = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker 表单测试超时")), 2000);
        worker.on("message", (message) => {
            if (message.type === "request") {
                try {
                    assert.equal(message.request.data.kind, "form");
                    assert.equal(message.request.data.entries[0][0], "prompt");
                    assert.equal(message.request.data.entries[0][1], "hello");
                    assert.equal(message.request.data.entries[1][0], "file");
                    assert.equal(message.request.data.entries[1][1].blob instanceof Blob, true);
                    worker.postMessage({ runId, type: "response", id: message.request.id, error: "上游拒绝请求" });
                } catch (assertionError) {
                    clearTimeout(timer);
                    reject(assertionError);
                }
                return;
            }
            if (message.type === "error") {
                clearTimeout(timer);
                resolve(message.message);
            }
        });
        worker.postMessage({
            runId,
            type: "run",
            script: `const form = new FormData();
form.append("prompt", "hello");
form.append("file", dataUrlToBlob("data:text/plain;base64,SGk="), "hello.txt");
return await request({ method: "POST", url: baseUrl + "/v1/files", data: form });`,
            args: { prompt: "", images: [], messages: [], params: {}, model: "m", baseUrl: "https://api.example.com", apiKey: "key", systemPrompt: "" },
        });
    });
    await worker.terminate();
    assert.match(error, /上游拒绝请求/);
});

test("同步死循环只阻塞 Worker，可被主线程终止", async () => {
    const worker = createWorker();
    worker.postMessage({ runId: "run-loop", type: "run", script: "for (;;) {}", args: { prompt: "", images: [], messages: [], params: {}, model: "m", baseUrl: "https://api.example.com", apiKey: "key", systemPrompt: "" } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const code = await worker.terminate();
    assert.equal(typeof code, "number");
});

test("非本地渠道不会执行自定义模型脚本", async () => {
    await assert.rejects(
        runModelPlugin({ capability: "text", script: "return 'no'", config: { ...defaultConfig, channelMode: "newapi", model: "m" } }),
        /仅允许用于本地渠道/,
    );
});

test("主线程取消会终止脚本 Worker 并返回 AbortError", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    let instance: HangingWorker | undefined;
    class HangingWorker extends EventTarget {
        terminated = false;
        constructor() {
            super();
            instance = this;
        }
        postMessage() {}
        terminate() {
            this.terminated = true;
        }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: HangingWorker });
    try {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            runModelPlugin({ capability: "text", script: "return 'no'", config: { ...defaultConfig, channelMode: "local", baseUrl: "https://api.example.com", apiKey: "key", model: "m" }, signal: controller.signal }),
            (error: unknown) => error instanceof DOMException && error.name === "AbortError",
        );
        assert.equal(instance?.terminated, true);
    } finally {
        if (originalDescriptor) Object.defineProperty(globalThis, "Worker", originalDescriptor);
        else Reflect.deleteProperty(globalThis, "Worker");
    }
});

test("脚本返回后会取消仍在执行的父线程渠道请求", async () => {
    const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    const originalAdapter = axios.defaults.adapter;
    let requestAborted = false;
    let workerTerminated = false;
    class RequestThenResultWorker extends EventTarget {
        postMessage(message: { type?: string; runId?: string }) {
            if (message.type !== "run") return;
            queueMicrotask(() => {
                this.dispatchEvent(new MessageEvent("message", { data: { runId: message.runId, type: "request", request: { id: "pending", method: "GET", url: "https://api.example.com/v1/models" } } }));
                setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { runId: message.runId, type: "result", result: "done" } })), 0);
            });
        }
        terminate() {
            workerTerminated = true;
        }
    }
    axios.defaults.adapter = ((config) =>
        new Promise((_resolve, reject) => {
            const cancel = () => {
                requestAborted = true;
                reject(new CanceledError("已取消", config));
            };
            if (config.signal?.aborted) cancel();
            else config.signal?.addEventListener("abort", cancel, { once: true });
        })) as AxiosAdapter;
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: RequestThenResultWorker });
    try {
        const result = await runModelPlugin({ capability: "text", script: "return 'done'", config: { ...defaultConfig, channelMode: "local", baseUrl: "https://api.example.com", apiKey: "key", model: "m" } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(result, "done");
        assert.equal(requestAborted, true);
        assert.equal(workerTerminated, true);
    } finally {
        axios.defaults.adapter = originalAdapter;
        if (originalWorkerDescriptor) Object.defineProperty(globalThis, "Worker", originalWorkerDescriptor);
        else Reflect.deleteProperty(globalThis, "Worker");
    }
});

test("单次脚本超过 200 个请求时会终止 Worker", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
    class FloodWorker extends EventTarget {
        terminated = false;
        postMessage(message: { type?: string; runId?: string }) {
            if (this.terminated || message.type !== "run") return;
            queueMicrotask(() => {
                for (let index = 0; index < 201 && !this.terminated; index += 1) {
                    this.dispatchEvent(new MessageEvent("message", { data: { runId: message.runId, type: "request", request: { id: String(index), method: "GET", url: "/blocked" } } }));
                }
            });
        }
        terminate() {
            this.terminated = true;
        }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FloodWorker });
    try {
        await assert.rejects(
            runModelPlugin({ capability: "text", script: "return 'no'", config: { ...defaultConfig, channelMode: "local", baseUrl: "https://api.example.com", apiKey: "key", model: "m" } }),
            /请求次数超过 200 次限制/,
        );
    } finally {
        if (originalDescriptor) Object.defineProperty(globalThis, "Worker", originalDescriptor);
        else Reflect.deleteProperty(globalThis, "Worker");
    }
});
