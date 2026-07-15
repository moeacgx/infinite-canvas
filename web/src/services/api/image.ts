import { buildApiUrl, isNewApiConfig, resolveCapabilityModel, resolveModelRequestConfig, resolveModelScript, resolveNewApiGroup, type AiConfig, type FetchedModelLists, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl, setImageBlob } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";
import { aiApiUrl, aiHeaders, aiRequestConfig, withSystemMessage, withSystemPrompt, refreshRemoteUser, readAxiosError } from "@/services/api/ai-utils";
import { fetchGeminiModels, requestGeminiImages, streamGeminiChat } from "@/services/api/gemini";
import { channelAxiosRequest } from "@/services/api/channel-request";
import { normalizePluginImages, resolveModelPluginResultUrl, runModelPlugin, sanitizeModelPluginText } from "@/services/api/model-plugin";

export type ChatCompletionMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ImageTaskResponse = {
    task_id?: string;
    status?: "queued" | "processing" | "succeeded" | "failed";
    progress?: string;
    result?: ImageApiResponse;
    error?: string | { message?: string };
};
type RequestOptions = { signal?: AbortSignal };

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
const NEW_API_IMAGE_TASK_POLL_INTERVAL_MS = 2500;
const NEW_API_IMAGE_TASK_MAX_ATTEMPTS = 240;

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

async function resolveImageDataUrl(item: Record<string, unknown>, config?: AiConfig, signal?: AbortSignal) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        if (config && isNewApiConfig(config) && item.url.startsWith("/canvas/v1/images/tasks/")) {
            return downloadNewApiImageContent(config, item.url);
        }
        if (config?.channelMode === "local" && /^https?:/i.test(item.url)) return downloadLocalImageContent(config, item.url, signal);
        return item.url;
    }
    return null;
}

async function parseImagePayload(payload: ImageApiResponse, config?: AiConfig, signal?: AbortSignal) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const dataUrls = await Promise.all((payload.data || []).map((item) => resolveImageDataUrl(item, config, signal)));
    const images = dataUrls.filter((value): value is string => Boolean(value)).map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

async function downloadLocalImageContent(config: AiConfig, url: string, signal?: AbortSignal) {
    const sameOrigin = (() => {
        try {
            return new URL(url).origin === new URL(config.baseUrl).origin;
        } catch {
            return false;
        }
    })();
    const response = await channelAxiosRequest<Blob>(config, {
        method: "GET",
        url,
        headers: sameOrigin && config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
        responseType: "blob",
        signal,
    });
    return setImageBlob(`image:${nanoid()}`, response.data);
}

async function downloadNewApiImageContent(config: AiConfig, path: string) {
    const response = await channelAxiosRequest<Blob>(config, {
        method: "GET",
        url: newApiCanvasUrl(config.baseUrl, path),
        ...aiRequestConfig(config, undefined, undefined, "image"),
        responseType: "blob",
    });
    const storageKey = `image:${nanoid()}`;
    return setImageBlob(storageKey, response.data);
}

function newApiCanvasUrl(baseUrl: string, path: string) {
    try {
        const url = new URL(path, baseUrl.trim());
        return url.toString();
    } catch {
        return buildApiUrl(baseUrl, path.replace(/^\/canvas\/v1/, ""));
    }
}

function parseStreamChunk(chunk: string, onDelta: (value: string) => void) {
    let deltaText = "";
    for (const eventBlock of chunk.split("\n\n")) {
        const data = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") continue;
        const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content || "";
        deltaText += delta;
    }
    if (deltaText) onDelta(deltaText);
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const channelModel = resolveCapabilityModel(config, "image");
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    assertImageModel(requestConfig.model);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const script = resolveModelScript(config, channelModel, "image");
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        try {
            const result = await runModelPlugin({ capability: "image", script, config: requestConfig, prompt: withSystemPrompt(requestConfig, prompt), images: [], params: { size: requestSize, quality, count: n }, signal: options?.signal });
            return await Promise.all(normalizePluginImages(result).map(async (value) => ({ id: nanoid(), dataUrl: /^data:image\//i.test(value) ? value : await downloadLocalImageContent(requestConfig, resolveModelPluginResultUrl(requestConfig.baseUrl, value), options?.signal) })));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const payload = {
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        response_format: "b64_json",
        output_format: IMAGE_OUTPUT_FORMAT,
    };
    if (isNewApiConfig(requestConfig)) {
        return requestNewApiImageTask(requestConfig, payload, undefined, options);
    }
    try {
        const response = await channelAxiosRequest<ImageApiResponse>(requestConfig, {
            method: "POST",
            url: aiApiUrl(requestConfig, "/images/generations"),
            data: payload,
            ...aiRequestConfig(requestConfig, "application/json", undefined, "image"),
            signal: options?.signal,
        });
        const images = await parseImagePayload(response.data, requestConfig, options?.signal);
        refreshRemoteUser(requestConfig);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

async function requestNewApiImageTask(config: AiConfig, payload: Record<string, unknown> | FormData, params?: Record<string, string>, options?: RequestOptions) {
    try {
        const created = (await channelAxiosRequest<ImageTaskResponse>(config, { method: "POST", url: aiApiUrl(config, "/images/tasks"), data: payload, ...aiRequestConfig(config, payload instanceof FormData ? undefined : "application/json", params, "image"), signal: options?.signal })).data;
        const taskId = created.task_id;
        if (!taskId) throw new Error("图片任务没有返回任务 ID");
        const task = await waitForNewApiImageTask(config, taskId, options);
        if (!task.result) throw new Error("图片任务成功但没有返回结果");
        const images = await parseImagePayload(task.result, config, options?.signal);
        refreshRemoteUser(config);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

async function waitForNewApiImageTask(config: AiConfig, taskId: string, options?: RequestOptions) {
    for (let attempt = 0; attempt < NEW_API_IMAGE_TASK_MAX_ATTEMPTS; attempt += 1) {
        const task = (await channelAxiosRequest<ImageTaskResponse>(config, { method: "GET", url: aiApiUrl(config, `/images/tasks/${encodeURIComponent(taskId)}`), ...aiRequestConfig(config, undefined, undefined, "image"), signal: options?.signal })).data;
        if (task.status === "succeeded") return task;
        if (task.status === "failed") throw new Error(readImageTaskError(task.error) || "图片生成失败");
        if (attempt === NEW_API_IMAGE_TASK_MAX_ATTEMPTS - 1) throw new Error("图片生成超时，请稍后重试");
        await delay(NEW_API_IMAGE_TASK_POLL_INTERVAL_MS, options?.signal);
    }
    throw new Error("图片生成超时，请稍后重试");
}

function readImageTaskError(error: ImageTaskResponse["error"]) {
    if (typeof error === "string") return error;
    return error?.message || "";
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("请求已取消", "AbortError"));
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const channelModel = resolveCapabilityModel(config, "image");
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    assertImageModel(requestConfig.model);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const script = resolveModelScript(config, channelModel, "image");
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
        const maskDataUrl = mask ? await imageToDataUrl(mask) : "";
        try {
            const result = await runModelPlugin({ capability: "image", script, config: requestConfig, prompt: withSystemPrompt(requestConfig, requestPrompt), images, params: { size: requestSize, quality, count: n, mask: maskDataUrl }, signal: options?.signal });
            return await Promise.all(normalizePluginImages(result).map(async (value) => ({ id: nanoid(), dataUrl: /^data:image\//i.test(value) ? value : await downloadLocalImageContent(requestConfig, resolveModelPluginResultUrl(requestConfig.baseUrl, value), options?.signal) })));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    formData.set("response_format", "b64_json");
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    if (isNewApiConfig(requestConfig)) {
        return requestNewApiImageTask(requestConfig, formData, { action: "edits" }, options);
    }

    try {
        const response = await channelAxiosRequest<ImageApiResponse>(requestConfig, { method: "POST", url: aiApiUrl(requestConfig, "/images/edits"), data: formData, ...aiRequestConfig(requestConfig, undefined, undefined, "image"), signal: options?.signal });
        const images = await parseImagePayload(response.data, requestConfig, options?.signal);
        refreshRemoteUser(requestConfig);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: ChatCompletionMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const channelModel = config.model || resolveCapabilityModel(config, "text");
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    assertImageModel(requestConfig.model);
    const script = resolveModelScript(config, channelModel, "text");
    if (script) {
        try {
            let streamedText = "";
            const result = await runModelPlugin<unknown>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta: (delta) => {
                    streamedText += delta;
                    onDelta(sanitizeModelPluginText(streamedText));
                },
            });
            const rawText = sanitizeModelPluginText(typeof result === "string" ? result : result && typeof result === "object" && typeof (result as { content?: unknown }).content === "string" ? String((result as { content: string }).content) : "");
            const text = rawText.trim() || "没有返回内容";
            if (!streamedText) onDelta(text);
            return text;
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    let buffer = "";
    let answer = "";
    let processedLength = 0;

    try {
        if (requestConfig.apiFormat === "gemini") {
            const result = await streamGeminiChat(requestConfig, messages, undefined, onDelta, options);
            const answer = result.content || "没有返回内容";
            if (!result.content) onDelta(answer);
            return answer;
        }
        const response = await channelAxiosRequest(requestConfig, {
            method: "POST",
            url: aiApiUrl(requestConfig, "/chat/completions"),
            data: {
                model: requestConfig.model,
                messages: withSystemMessage(requestConfig, messages),
                stream: true,
            },
            ...aiRequestConfig(requestConfig, "application/json", undefined, "text"),
            signal: options?.signal,
            responseType: "text",
            onDownloadProgress: (event) => {
                    const responseText = String(event.event?.target?.responseText || "");
                    const nextText = responseText.slice(processedLength);
                    processedLength = responseText.length;
                    buffer += nextText;
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";
                    for (const chunk of chunks) {
                        parseStreamChunk(chunk, (delta) => {
                            answer += delta;
                            onDelta(answer);
                        });
                    }
            },
        });
        if (typeof response.data === "object" && response.data && "code" in response.data && (response.data as { code?: number; msg?: string }).code !== 0) {
            throw new Error((response.data as { msg?: string }).msg || "请求失败");
        }
        if (typeof response.data === "string") {
            let apiError = "";
            try {
                const payload = JSON.parse(response.data) as { code?: number; msg?: string };
                if (typeof payload.code === "number" && payload.code !== 0) {
                    apiError = payload.msg || "请求失败";
                }
            } catch {
                // ignore plain text stream content
            }
            if (apiError) throw new Error(apiError);
        }
        if (buffer) {
            parseStreamChunk(buffer, (delta) => {
                answer += delta;
                onDelta(answer);
            });
        }
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
    refreshRemoteUser(requestConfig);
    return answer || "没有返回内容";
}

export async function fetchImageModels(config: AiConfig) {
    if (config.channelMode === "remote") return config.models;
    try {
        if (config.channelMode === "local" && config.apiFormat === "gemini") return await fetchGeminiModels(config);
        if (!isNewApiConfig(config)) return await fetchModelsForGroup(config);
        const groupModels = await fetchNewApiGroupModels(config);
        const defaultModels = groupModels.get(resolveNewApiGroup(config)) || [];
        const textModels = groupModels.get(resolveNewApiGroup(config, "text")) || [];
        const imageModels = groupModels.get(resolveNewApiGroup(config, "image")) || [];
        const videoModels = groupModels.get(resolveNewApiGroup(config, "video")) || [];
        const audioModels = groupModels.get(resolveNewApiGroup(config, "audio")) || [];
        return {
            models: uniqueSortedModels([...defaultModels, ...textModels, ...imageModels, ...videoModels, ...audioModels]),
            textModels,
            imageModels,
            videoModels,
            audioModels,
        } satisfies FetchedModelLists;
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    try {
        if (channel.apiFormat === "gemini") return await fetchGeminiModels(channel);
        const response = await channelAxiosRequest<{ data?: Array<{ id?: string }>; error?: { message?: string } }>({ channelMode: "local", requestMode: channel.requestMode }, {
            method: "GET",
            url: buildApiUrl(channel.baseUrl, "/models"),
            headers: { Authorization: `Bearer ${channel.apiKey}` },
        });
        if (response.data.error?.message) throw new Error(response.data.error.message);
        return uniqueSortedModels((response.data.data || []).map((model) => model.id).filter((id): id is string => Boolean(id)));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

async function fetchNewApiGroupModels(config: AiConfig) {
    const groups = uniqueSortedModels([resolveNewApiGroup(config), resolveNewApiGroup(config, "text"), resolveNewApiGroup(config, "image"), resolveNewApiGroup(config, "video"), resolveNewApiGroup(config, "audio")]);
    const entries = await Promise.all(groups.map(async (group) => [group, await fetchModelsForGroup({ ...config, newApiGroup: group })] as const));
    return new Map(entries);
}

async function fetchModelsForGroup(config: AiConfig) {
    const response = await channelAxiosRequest<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(config, { method: "GET", url: buildApiUrl(config.baseUrl, "/models"), ...aiRequestConfig(config) });
    return uniqueSortedModels((response.data.data || []).map((model) => model.id).filter((id): id is string => Boolean(id)));
}

function uniqueSortedModels(models: string[]) {
    return Array.from(new Set(models.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function assertImageModel(model: string) {
    if (!model.trim()) throw new Error("请先选择模型");
}
