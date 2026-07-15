import type { AxiosRequestConfig } from "axios";
import { nanoid } from "nanoid";

import { channelAxiosRequest } from "@/services/api/channel-request";
import { buildApiUrl, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

const MAX_SCRIPT_LENGTH = 100_000;
const MAX_PLUGIN_REQUESTS = 200;
const MAX_PLUGIN_CONCURRENT_REQUESTS = 6;
const MAX_PLUGIN_WRITE_REQUESTS = 8;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const MAX_DELTA_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const VIDEO_TIMEOUT_MS = 600_000;
export const MODEL_PLUGIN_API_KEY_PLACEHOLDER = "__INFINITE_CANVAS_CHANNEL_API_KEY__";
const MODEL_PLUGIN_WORKER_URL = "/model-script-worker.js";
const BLOCKED_HEADERS = new Set(["connection", "content-length", "cookie", "forwarded", "host", "keep-alive", "origin", "proxy-authenticate", "proxy-authorization", "referer", "set-cookie", "te", "trailer", "transfer-encoding", "upgrade", "via"]);
const FORBIDDEN_SCRIPT_GLOBALS = /\b(?:BroadcastChannel|caches|cookieStore|eval|EventSource|fetch|Function|globalThis|import|importScripts|indexedDB|localStorage|location|navigator|onmessage|postMessage|RTCPeerConnection|self|sessionStorage|SharedWorker|WebSocket|WebTransport|window|Worker|XMLHttpRequest)\b|\bconstructor\b|["']con["']\s*\+\s*["']structor["']/;

type RequestOptions = { signal?: AbortSignal };
type WorkerRequest = {
    id: string;
    method?: string;
    url: string;
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    data?: SerializedBody;
    responseType?: "json" | "blob" | "text" | "arraybuffer";
};
type SerializedBody = { kind: "raw"; value: unknown } | { kind: "form"; entries: Array<[string, string | { blob: Blob; name?: string }]> };
type WorkerMessage =
    | { runId: string; type: "request"; request: WorkerRequest }
    | { runId: string; type: "delta"; text: string }
    | { runId: string; type: "result"; result: unknown }
    | { runId: string; type: "error"; message: string };

export type RunPluginArgs = {
    capability: ModelCapability;
    script: string;
    config: AiConfig;
    prompt?: string;
    images?: string[];
    messages?: unknown[];
    params?: Record<string, unknown>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
    timeoutMs?: number;
};

export type PluginVariable = { name: string; type: string; desc: string; capabilities?: ModelCapability[] };
export type PluginTemplate = { label: string; script: string };

export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {
    if (args.config.channelMode !== "local") throw new Error("自定义调用脚本仅允许用于本地渠道");
    const script = validateModelPluginScript(args.script);
    if (typeof Worker === "undefined") throw new Error("当前浏览器不支持安全脚本 Worker");

    const runId = nanoid();
    const worker = new Worker(MODEL_PLUGIN_WORKER_URL, { name: "infinite-canvas-model-script" });
    const requestController = new AbortController();
    const timeoutMs = Math.min(VIDEO_TIMEOUT_MS, Math.max(1000, args.timeoutMs || (args.capability === "video" ? VIDEO_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)));
    let requestCount = 0;
    let writeRequestCount = 0;
    let activeRequests = 0;
    let deltaBytes = 0;
    const requestQueue: WorkerRequest[] = [];

    return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            args.signal?.removeEventListener("abort", onAbort);
            requestController.abort();
            requestQueue.length = 0;
            worker.terminate();
            callback();
        };
        const fail = (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        const onAbort = () => fail(new DOMException("请求已取消", "AbortError"));
        const timer = setTimeout(() => fail(new Error("模型调用脚本执行超时")), timeoutMs);
        args.signal?.addEventListener("abort", onAbort, { once: true });
        if (args.signal?.aborted) return onAbort();

        worker.addEventListener("error", (event) => fail(new Error(event.message || "模型调用脚本 Worker 执行失败")));
        const pumpRequests = () => {
            while (!settled && activeRequests < MAX_PLUGIN_CONCURRENT_REQUESTS && requestQueue.length) {
                const request = requestQueue.shift();
                if (!request) break;
                activeRequests += 1;
                void runPluginRequest(args.config, request, { signal: requestController.signal })
                    .then((data) => {
                        if (!settled) worker.postMessage({ runId, type: "response", id: request.id, data });
                    })
                    .catch((error) => {
                        if (!settled) worker.postMessage({ runId, type: "response", id: request.id, error: error instanceof Error ? error.message : String(error) });
                    })
                    .finally(() => {
                        activeRequests -= 1;
                        pumpRequests();
                    });
            }
        };
        worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
            const message = event.data;
            if (!message || message.runId !== runId || settled) return;
            if (message.type === "delta") {
                const text = args.capability === "text" ? sanitizeModelPluginText(String(message.text || "")) : String(message.text || "");
                deltaBytes += new Blob([text]).size;
                if (deltaBytes > MAX_DELTA_BYTES) return fail(new Error("模型调用脚本流式文本超过 5MB 限制"));
                try {
                    args.onDelta?.(text);
                } catch (error) {
                    fail(error);
                }
                return;
            }
            if (message.type === "error") return fail(new Error(`模型调用脚本执行失败：${message.message}`));
            if (message.type === "result") {
                try {
                    assertPluginPayloadSize(message.result);
                    finish(() => resolve(message.result as T));
                } catch (error) {
                    fail(error);
                }
                return;
            }
            if (message.type === "request") {
                requestCount += 1;
                if (requestCount > MAX_PLUGIN_REQUESTS) return fail(new Error(`模型调用脚本请求次数超过 ${MAX_PLUGIN_REQUESTS} 次限制`));
                if (!new Set(["GET", "HEAD"]).has(String(message.request.method || "GET").toUpperCase())) {
                    writeRequestCount += 1;
                    if (writeRequestCount > MAX_PLUGIN_WRITE_REQUESTS) return fail(new Error(`模型调用脚本写请求次数超过 ${MAX_PLUGIN_WRITE_REQUESTS} 次限制`));
                }
                requestQueue.push(message.request);
                pumpRequests();
            }
        });

        try {
            worker.postMessage({
                runId,
                type: "run",
                script,
                args: {
                    prompt: args.prompt || "",
                    images: args.images || [],
                    messages: args.messages || [],
                    params: args.params || {},
                    model: args.config.model,
                    baseUrl: args.config.baseUrl,
                    apiKey: MODEL_PLUGIN_API_KEY_PLACEHOLDER,
                    systemPrompt: args.config.systemPrompt || "",
                },
            });
        } catch (error) {
            fail(error);
        }
    });
}

export function validateModelPluginScript(value: string) {
    const script = value.trim();
    if (!script) throw new Error("模型调用脚本为空");
    if (script.length > MAX_SCRIPT_LENGTH) throw new Error("模型调用脚本超过 100000 字符限制");
    if (FORBIDDEN_SCRIPT_GLOBALS.test(script)) throw new Error("脚本包含被禁用的浏览器全局对象或动态代码入口，请使用 request/http/dataUrlToBlob 辅助函数");
    return script;
}

async function runPluginRequest(config: AiConfig, request: WorkerRequest, options?: RequestOptions) {
    const method = String(request.method || "GET").toUpperCase();
    if (!new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).has(method)) throw new Error("脚本请求方法不允许");
    const url = resolveModelPluginUrl(config.baseUrl, request.url);
    const headers = injectModelPluginCredential(sanitizeModelPluginHeaders(request.headers), config.apiKey);
    const data = deserializePluginBody(request.data);
    assertPluginRequestBodySize(data);
    const response = await channelAxiosRequest(config, {
        method,
        url,
        headers,
        params: sanitizePluginParams(request.params),
        data,
        responseType: request.responseType || "json",
        signal: options?.signal,
        maxBodyLength: MAX_REQUEST_BYTES,
        maxContentLength: MAX_RESPONSE_BYTES,
    } as AxiosRequestConfig);
    assertPluginPayloadSize(response.data);
    return response.data;
}

export function resolveModelPluginUrl(baseUrl: string, path: string) {
    let base: URL;
    let target: URL;
    try {
        base = new URL(baseUrl.trim());
        target = /^https?:/i.test(path) ? new URL(path) : new URL(buildApiUrl(baseUrl, path.startsWith("/") ? path : `/${path}`));
    } catch {
        throw new Error("模型脚本请求地址无效");
    }
    if (!["http:", "https:"].includes(base.protocol) || target.protocol !== base.protocol || target.origin !== base.origin) throw new Error("模型脚本只能请求当前渠道同源地址");
    if (target.username || target.password || target.hash) throw new Error("模型脚本请求地址不能包含凭据或片段");
    return target.toString();
}

export function resolveModelPluginResultUrl(baseUrl: string, value: string) {
    let base: URL;
    let target: URL;
    try {
        base = new URL(baseUrl.trim());
        target = new URL(value, base);
    } catch {
        throw new Error("模型脚本返回地址无效");
    }
    if (!["http:", "https:"].includes(base.protocol) || target.protocol !== base.protocol || target.origin !== base.origin) throw new Error("模型脚本返回地址只能使用当前渠道同源资源");
    if (target.username || target.password || target.hash) throw new Error("模型脚本返回地址不能包含凭据或片段");
    const url = target.toString();
    if (url.includes(MODEL_PLUGIN_API_KEY_PLACEHOLDER)) throw new Error("模型脚本返回地址不能包含 API Key 占位符");
    return url;
}

export function sanitizeModelPluginHeaders(input?: Record<string, string>) {
    const headers: Record<string, string> = {};
    const entries = Object.entries(input || {});
    if (entries.length > 64) throw new Error("模型脚本请求头数量超过限制");
    let totalBytes = 0;
    for (const [rawName, rawValue] of entries) {
        const name = rawName.trim().toLowerCase();
        if (!name || BLOCKED_HEADERS.has(name) || name.startsWith("sec-") || name.startsWith("proxy-") || name.startsWith("x-forwarded-")) continue;
        const value = String(rawValue);
        if (name.length > 128 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || value.length > 8192 || /[\r\n]/.test(value)) throw new Error("模型脚本请求头格式无效或超过限制");
        totalBytes += new Blob([name, value]).size;
        if (totalBytes > 64 * 1024) throw new Error("模型脚本请求头总大小超过 64KB 限制");
        headers[name] = value;
    }
    return headers;
}

export function injectModelPluginCredential(headers: Record<string, string>, apiKey: string) {
    return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => {
            if (value === MODEL_PLUGIN_API_KEY_PLACEHOLDER) return [name, apiKey];
            if (value === `Bearer ${MODEL_PLUGIN_API_KEY_PLACEHOLDER}`) return [name, `Bearer ${apiKey}`];
            if (value.includes(MODEL_PLUGIN_API_KEY_PLACEHOLDER)) throw new Error("API Key 占位符只能作为完整请求头值或 Bearer 凭据使用");
            return [name, value];
        }),
    );
}

function sanitizePluginParams(input?: Record<string, unknown>) {
    const entries = Object.entries(input || {});
    if (entries.length > 100) throw new Error("模型脚本查询参数过多");
    return Object.fromEntries(entries.map(([key, value]) => [key.slice(0, 128), typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : String(value ?? "").slice(0, 8192)]));
}

function deserializePluginBody(body?: SerializedBody) {
    if (!body) return undefined;
    if (body.kind === "raw") return body.value;
    const form = new FormData();
    body.entries.slice(0, 100).forEach(([key, value]) => {
        if (typeof value === "string") form.append(key, value);
        else form.append(key, value.blob, value.name);
    });
    return form;
}

function assertPluginRequestBodySize(value: unknown) {
    if (value instanceof FormData) {
        let size = 0;
        value.forEach((item, key) => {
            size += new Blob([key]).size + (typeof item === "string" ? new Blob([item]).size : item.size);
        });
        if (size > MAX_REQUEST_BYTES) throw new Error("模型调用脚本请求体超过 32MB 限制");
        return;
    }
    try {
        const size = value instanceof Blob ? value.size : value instanceof ArrayBuffer ? value.byteLength : ArrayBuffer.isView(value) ? value.byteLength : new Blob([typeof value === "string" ? value : JSON.stringify(value)]).size;
        if (size > MAX_REQUEST_BYTES) throw new Error("模型调用脚本请求体超过 32MB 限制");
    } catch (error) {
        if (error instanceof Error && error.message.includes("32MB")) throw error;
        throw new Error("模型调用脚本请求体无法序列化");
    }
}

function assertPluginPayloadSize(value: unknown) {
    let size = 0;
    if (value instanceof Blob) size = value.size;
    else if (value instanceof ArrayBuffer) size = value.byteLength;
    else if (ArrayBuffer.isView(value)) size = value.byteLength;
    else {
        try {
            size = new Blob([typeof value === "string" ? value : JSON.stringify(value)]).size;
        } catch {
            throw new Error("模型调用脚本返回了无法序列化的数据");
        }
    }
    if (size > MAX_RESPONSE_BYTES) throw new Error("模型调用脚本数据超过 128MB 限制");
}

export function normalizePluginImages(result: unknown): string[] {
    const values = (Array.isArray(result) ? result : [result])
        .map((item) => {
            if (typeof item === "string") return /^(?:data:image\/|https?:\/\/|\/)/i.test(item.trim()) ? item.trim() : "";
            if (!item || typeof item !== "object") return "";
            const record = item as Record<string, unknown>;
            if (typeof record.dataUrl === "string" && /^data:image\//i.test(record.dataUrl)) return record.dataUrl;
            if (typeof record.url === "string" && /^(?:https?:\/\/|\/)/i.test(record.url.trim())) return record.url.trim();
            if (typeof record.b64_json === "string") return `data:image/png;base64,${record.b64_json}`;
            return "";
        })
        .filter(Boolean);
    if (!values.length) throw new Error("模型调用脚本没有返回图片");
    return values;
}

export function sanitizeModelPluginText(value: string) {
    return value
        .replace(/!\[/g, "[")
        .replace(/<\/?\s*(?:audio|embed|iframe|img|link|object|source|style|svg|video)\b[^>]*>/gi, "[已移除脚本媒体内容]");
}

export const PLUGIN_VARIABLES: PluginVariable[] = [
    { name: "prompt", type: "string", desc: "已拼接系统提示词的用户输入", capabilities: ["image", "video", "audio"] },
    { name: "images", type: "string[]", desc: "参考图 dataURL 数组", capabilities: ["image", "video"] },
    { name: "messages", type: "unknown[]", desc: "对话消息数组", capabilities: ["text"] },
    { name: "params", type: "object", desc: "当前生成参数" },
    { name: "model", type: "string", desc: "当前模型原始名称" },
    { name: "baseUrl", type: "string", desc: "当前渠道地址" },
    { name: "apiKey", type: "string", desc: "不含真实密钥的鉴权占位符；仅在同源请求头中由宿主替换" },
    { name: "systemPrompt", type: "string", desc: "系统提示词" },
    { name: "http", type: "object", desc: "自动带 Bearer 鉴权的 http.get/post" },
    { name: "request", type: "function", desc: "受同源限制的 request({method,url,headers,data,responseType})" },
    { name: "poll", type: "function", desc: "poll(request, extract, {intervalMs,timeoutMs})" },
    { name: "sleep", type: "function", desc: "可取消的延时" },
    { name: "dataUrlToBlob", type: "function", desc: "把 dataURL 转换为 Blob" },
    { name: "apiUrl", type: "function", desc: "按当前 Base URL 生成不会重复 v1/v1beta 的接口地址" },
    { name: "onDelta", type: "function", desc: "推送流式文本", capabilities: ["text"] },
];

export const PLUGIN_RETURNS: Record<ModelCapability, string> = {
    image: "返回图片 URL/dataURL 字符串、数组，或含 dataUrl/url/b64_json 的对象。",
    video: "脚本内完成轮询，返回视频 URL 字符串、{url} 或 {blob}。",
    audio: "返回 Blob、base64/dataURL 字符串，或含 b64_json/data/url 的对象。",
    text: "通过 onDelta(text) 推送增量，并返回最终完整文本。",
};

export const PLUGIN_TEMPLATES: Record<ModelCapability, PluginTemplate[]> = {
    image: [
        { label: "OpenAI 规范", script: `const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
if (!images.length) {
  const data = await request({ method: "POST", url: apiUrl("/v1/images/generations"), headers, data: { model, prompt, n: params.count, size: params.size, quality: params.quality, response_format: "b64_json" } });
  return (data.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);
}
const form = new FormData();
form.set("model", model); form.set("prompt", prompt); form.set("n", String(params.count || 1));
for (const dataUrl of images) form.append("image", dataUrlToBlob(dataUrl), "reference.png");
const data = await request({ method: "POST", url: apiUrl("/v1/images/edits"), headers: { Authorization: \`Bearer \${apiKey}\` }, data: form });
return (data.data || []).map((item) => item.b64_json ? \`data:image/png;base64,\${item.b64_json}\` : item.url);` },
        { label: "Gemini 规范", script: `const parts = [{ text: prompt }];
for (const dataUrl of images) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
}
const data = await request({ method: "POST", url: apiUrl(\`/v1beta/models/\${model}:generateContent\`), headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, data: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"] } } });
return (data.candidates || []).flatMap((item) => item.content?.parts || []).map((part) => part.inlineData || part.inline_data).filter(Boolean).map((image) => \`data:\${image.mimeType || image.mime_type || "image/png"};base64,\${image.data}\`);` },
    ],
    video: [
        { label: "OpenAI 规范", script: `const headers = { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` };
const task = await request({ method: "POST", url: apiUrl("/v1/videos"), headers, data: { model, prompt, seconds: params.seconds, size: params.size } });
await poll(() => request({ method: "GET", url: apiUrl(\`/v1/videos/\${task.id}\`), headers }), (state) => state.status === "completed" ? true : null, { intervalMs: 2500, timeoutMs: 300000 });
return await request({ method: "GET", url: apiUrl(\`/v1/videos/\${task.id}/content\`), headers, responseType: "blob" });` },
        { label: "Gemini 规范", script: `const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
const instance = { prompt };
const first = images[0]?.match(/^data:([^;]+);base64,(.*)$/);
if (first) instance.image = { bytesBase64Encoded: first[2], mimeType: first[1] };
const operation = await request({ method: "POST", url: apiUrl(\`/v1beta/models/\${model}:predictLongRunning\`), headers, data: { instances: [instance], parameters: { aspectRatio: params.ratio } } });
const uri = await poll(() => request({ method: "GET", url: apiUrl(\`/v1beta/\${operation.name}\`), headers }), (state) => state.done ? state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri : null, { intervalMs: 5000, timeoutMs: 300000 });
if (!uri) throw new Error("Gemini 未返回视频 URI");
return await request({ method: "GET", url: uri, headers: { "x-goog-api-key": apiKey }, responseType: "blob" });` },
    ],
    audio: [
        { label: "OpenAI 规范", script: `return await request({ method: "POST", url: apiUrl("/v1/audio/speech"), headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` }, responseType: "blob", data: { model, input: prompt, voice: params.voice, response_format: params.format, speed: Number(params.speed), instructions: params.instructions || undefined } });` },
        { label: "Gemini 规范", script: `const data = await request({ method: "POST", url: apiUrl(\`/v1beta/models/\${model}:generateContent\`), headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, data: { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } } } } } });
const audio = data.candidates?.[0]?.content?.parts?.map((part) => part.inlineData || part.inline_data).find(Boolean);
if (!audio?.data) throw new Error("Gemini 未返回音频");
return { data: audio.data, mimeType: audio.mimeType || audio.mime_type || "audio/pcm;rate=24000" };` },
    ],
    text: [
        { label: "OpenAI 规范", script: `const data = await request({ method: "POST", url: apiUrl("/v1/chat/completions"), headers: { "Content-Type": "application/json", Authorization: \`Bearer \${apiKey}\` }, data: { model, messages, stream: false, ...(params.tools?.length ? { tools: params.tools } : {}) } });
const message = data.choices?.[0]?.message || {};
const text = message.content || "";
if (text) onDelta(text);
return message.tool_calls?.length ? { content: text, toolCalls: message.tool_calls } : text;` },
        { label: "Gemini 规范", script: `const textOf = (content) => typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item?.text || "").join("") : "";
const contents = messages.filter((item) => item.role !== "system" && item.role !== "tool").map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: textOf(item.content) }] }));
const data = await request({ method: "POST", url: apiUrl(\`/v1beta/models/\${model}:generateContent\`), headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, data: { contents, ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}) } });
const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
onDelta(text); return text;` },
    ],
};
