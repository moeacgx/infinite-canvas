"use strict";

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const MAX_DELTA_BYTES = 5 * 1024 * 1024;
const pending = new Map();
const send = postMessage.bind(globalThis);
let activeRunId = "";
let deltaBytes = 0;

// CSP 是真正的网络边界；这里再移除常见入口，减少误用。
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "importScripts", "indexedDB", "caches", "cookieStore", "Worker", "SharedWorker", "BroadcastChannel", "RTCPeerConnection"]) {
    try {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
    } catch {}
}

function valueSize(value) {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return new Blob([serialized === undefined ? "" : serialized]).size;
}

function serializeBody(value) {
    if (!(value instanceof FormData)) {
        if (valueSize(value) > MAX_REQUEST_BYTES) throw new Error("模型调用脚本请求体超过 32MB 限制");
        return { kind: "raw", value };
    }
    let size = 0;
    const entries = Array.from(value.entries()).map(([key, item]) => {
        size += new Blob([key]).size + (typeof item === "string" ? new Blob([item]).size : item.size);
        return [key, typeof item === "string" ? item : { blob: item, name: item.name }];
    });
    if (size > MAX_REQUEST_BYTES) throw new Error("模型调用脚本请求体超过 32MB 限制");
    return { kind: "form", entries };
}

function rpc(config) {
    if (!config || typeof config !== "object") throw new Error("request 参数无效");
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now() + "-" + Math.random();
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ runId: activeRunId, type: "request", request: { ...config, id, data: serializeBody(config.data) } });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.min(30000, Math.max(0, Number(ms) || 0))));
}

function dataUrlToBlob(value) {
    const match = String(value).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!match) throw new Error("参考图不是有效 dataURL");
    const bytes = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    if (bytes.length > MAX_REQUEST_BYTES) throw new Error("参考图超过 32MB 限制");
    const data = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) data[index] = bytes.charCodeAt(index);
    return new Blob([data], { type: match[1] || "application/octet-stream" });
}

onmessage = async (event) => {
    const message = event.data || {};
    if (message.type === "response" && message.runId === activeRunId) {
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        message.error ? item.reject(new Error(message.error)) : item.resolve(message.data);
        return;
    }
    if (message.type !== "run" || activeRunId) return;
    activeRunId = message.runId;
    const values = message.args || {};
    const apiUrl = (path) => {
        const url = new URL(values.baseUrl);
        const basePath = url.pathname.replace(/\/+$/, "");
        const requestedPath = `/${String(path || "").replace(/^\/+/, "")}`;
        if (/\/(?:api\/v3|api\/plan\/v3)$/i.test(basePath)) {
            url.pathname = `${basePath}${requestedPath.replace(/^\/v1(?:beta)?(?=\/|$)/i, "")}`;
        } else if (/\/(?:v1|v1beta)$/i.test(basePath) && /^\/v1(?:beta)?(?=\/|$)/i.test(requestedPath)) {
            url.pathname = `${basePath.replace(/\/(?:v1|v1beta)$/i, "")}${requestedPath}`;
        } else {
            url.pathname = `${basePath}${requestedPath}`;
        }
        url.search = "";
        url.hash = "";
        return url.toString();
    };
    const request = (config) => rpc(config || {});
    const http = {
        url: apiUrl,
        get: (url, options = {}) => request({ ...options, method: "GET", url, headers: { Authorization: "Bearer " + values.apiKey, ...(options.headers || {}) } }),
        post: (url, data, options = {}) => request({ ...options, method: "POST", url, data, headers: { Authorization: "Bearer " + values.apiKey, ...(options.headers || {}) } }),
    };
    const poll = async (read, extract, options = {}) => {
        const deadline = Date.now() + Math.min(600000, Math.max(1000, Number(options.timeoutMs) || 300000));
        const interval = Math.min(30000, Math.max(250, Number(options.intervalMs) || 2500));
        for (;;) {
            const result = extract(await read());
            if (result !== null && result !== undefined && result !== false) return result;
            if (Date.now() >= deadline) throw new Error("脚本轮询超时");
            await sleep(interval);
        }
    };
    const onDelta = (text) => {
        const value = String(text || "");
        deltaBytes += new Blob([value]).size;
        if (deltaBytes > MAX_DELTA_BYTES) throw new Error("模型调用脚本流式文本超过 5MB 限制");
        send({ runId: activeRunId, type: "delta", text: value });
    };
    try {
        const runnerSource = '"use strict"; return (async () => {\n' + message.script + "\n})();";
        const runner = new Function("prompt", "images", "messages", "params", "model", "baseUrl", "apiKey", "systemPrompt", "http", "request", "poll", "sleep", "dataUrlToBlob", "apiUrl", "onDelta", runnerSource);
        const result = await runner(values.prompt, values.images, values.messages, values.params, values.model, values.baseUrl, values.apiKey, values.systemPrompt, http, request, poll, sleep, dataUrlToBlob, apiUrl, onDelta);
        if (valueSize(result) > MAX_RESPONSE_BYTES) throw new Error("模型调用脚本数据超过 128MB 限制");
        send({ runId: activeRunId, type: "result", result });
    } catch (error) {
        send({ runId: activeRunId, type: "error", message: error instanceof Error ? error.message : String(error) });
    }
};
