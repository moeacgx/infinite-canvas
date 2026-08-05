import { nanoid } from "nanoid";

import { imageToDataUrl } from "@/services/image-storage";
import { networkFailureMessage } from "@/services/api/network-error";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { channelAxiosRequest, channelFetch } from "@/services/api/channel-request";

export type GeminiMessageContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type GeminiChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: GeminiMessageContent | null;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
        thoughtSignature?: string;
    }>;
};

export type GeminiFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    };
};

export type GeminiToolCall = {
    id: string;
    name: string;
    arguments: string;
    thoughtSignature?: string;
};

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: GeminiToolCall[] };
type RequestOptions = { signal?: AbortSignal };

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GEMINI_IMAGE_SIZE_BY_QUALITY: Record<string, string> = { low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K", "1k": "1K", "2k": "2K", "4k": "4K" };

export function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

export function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    const model = config.model.trim().replace(/^models\//, "");
    return `${baseUrl}/models/${encodeURIComponent(model)}:${action}`;
}

export function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

export async function fetchGeminiModels(config: Pick<AiConfig, "baseUrl" | "apiKey"> & Partial<Pick<AiConfig, "requestMode">>) {
    const requestConfig = { ...config, model: "" };
    const response = await channelAxiosRequest<GeminiPayload>({ channelMode: "local", requestMode: config.requestMode }, { method: "GET", url: geminiApiUrl(requestConfig), headers: geminiHeaders(requestConfig) });
    validateGeminiPayload(response.data);
    return (response.data.models || [])
        .map((model) => model.name?.replace(/^models\//, ""))
        .filter((model): model is string => Boolean(model))
        .sort((a, b) => a.localeCompare(b));
}

export async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) parts.push(toGeminiImagePart(await imageToDataUrl(image, options?.signal)));
    const response = await channelAxiosRequest<GeminiPayload>(config, {
        method: "POST",
        url: geminiApiUrl(config, "generateContent"),
        data: {
            ...toGeminiBody(config, [{ role: "user", content: prompt }]),
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                ...resolveGeminiImageConfig(config),
            },
            contents: [{ role: "user", parts }],
        },
        headers: geminiHeaders(config),
        signal: options?.signal,
    });
    return parseGeminiImages(response.data);
}

export async function streamGeminiChat(config: AiConfig, messages: GeminiChatMessage[], tools: GeminiFunctionTool[] | undefined, onDelta?: (text: string) => void, options?: RequestOptions): Promise<{ content: string; toolCalls: GeminiToolCall[] }> {
    const requestUrl = `${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`;
    let response: Response;
    try {
        response = await channelFetch(config, requestUrl, {
            method: "POST",
            headers: geminiHeaders(config),
            body: JSON.stringify({ ...toGeminiBody(config, messages), ...toGeminiToolOptions(tools || []) }),
            signal: options?.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (error instanceof Error && !(error instanceof TypeError)) throw error;
        throw new Error(
            networkFailureMessage({
                fallback: "Gemini 请求失败",
                requestUrl,
                pageProtocol: typeof window === "undefined" ? undefined : window.location.protocol,
            }),
        );
    }
    if (!response.ok) throw new Error(await readGeminiError(response, "请求失败"));
    if (!response.body) return parseGeminiResponse((await response.json()) as GeminiPayload);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    return { content: state.text, toolCalls: state.toolCalls };
}

function toGeminiBody(config: AiConfig, messages: GeminiChatMessage[]) {
    const systemText = [config.systemPrompt.trim(), ...messages.filter((message) => message.role === "system").map((message) => geminiTextContent(message.content))].filter(Boolean).join("\n\n");
    return {
        contents: toGeminiContents(messages.filter((message) => message.role !== "system")),
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    };
}

function toGeminiContents(messages: GeminiChatMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    const contents: GeminiContent[] = [];
    for (const message of messages) {
        if (message.role === "tool") {
            const id = message.tool_call_id || "";
            const name = callNameById.get(id) || "tool_result";
            contents.push({ role: "user", parts: [{ functionResponse: { id, name, response: { result: jsonValue(geminiTextContent(message.content)) } } }] });
            continue;
        }
        if (message.role === "assistant" && message.tool_calls?.length) {
            const parts: GeminiPart[] = [];
            if (message.content) parts.push(...toGeminiParts(message.content));
            for (const call of message.tool_calls) {
                callNameById.set(call.id, call.function.name);
                parts.push({
                    functionCall: { id: call.id, name: call.function.name, args: jsonObject(call.function.arguments) },
                    ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
                });
            }
            contents.push({ role: "model", parts });
            continue;
        }
        contents.push({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) });
    }
    return contents;
}

function toGeminiParts(content: GeminiMessageContent | null): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: GeminiMessageContent | null) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function toGeminiToolOptions(tools: GeminiFunctionTool[]) {
    if (!tools.length) return {};
    return {
        tools: [
            {
                functionDeclarations: tools.map((tool) => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters,
                })),
            },
        ],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        consumeGeminiStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
        state.buffer = state.buffer.slice((match.index || 0) + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiResponse(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts.flatMap((part): GeminiToolCall[] => {
        const call = part.functionCall;
        if (!call?.name) return [];
        const thoughtSignature = part.thoughtSignature || part.thought_signature;
        return [
            {
                id: call.id || nanoid(),
                name: call.name,
                arguments: JSON.stringify(call.args || {}),
                ...(thoughtSignature ? { thoughtSignature } : {}),
            },
        ];
    });
    return { content, toolCalls };
}

function parseGeminiImages(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = config.size.trim();
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = supportsGeminiImageSize(config.model) ? resolveGeminiImageSize(config.quality, dimensions) : undefined;
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { responseFormat: { image } } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseImageRatio(item);
        const bestRatio = parseImageRatio(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(quality: string, dimensions: { width: number; height: number } | null) {
    const normalizedQuality = quality.trim().toLowerCase();
    if (GEMINI_IMAGE_SIZE_BY_QUALITY[normalizedQuality]) return GEMINI_IMAGE_SIZE_BY_QUALITY[normalizedQuality];
    if (!dimensions) return undefined;
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function supportsGeminiImageSize(model: string) {
    const value = model.toLowerCase();
    return value.includes("gemini-3") || value.includes("3.1") || value.includes("3-pro");
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width, height };
}

function jsonObject(value: string) {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readGeminiError(response: Response, fallback: string) {
    const text = await response.text();
    if (text) {
        try {
            const payload = JSON.parse(text) as GeminiPayload;
            if (payload.error?.message) return payload.error.message;
        } catch {
            if (text.length < 300) return text;
        }
    }
    if (response.status === 401 || response.status === 403) return "鉴权失败，请检查 Gemini API Key 或模型权限";
    if (response.status === 429) return "请求被限流或额度不足，请稍后重试";
    return `${fallback}：${response.status}`;
}
