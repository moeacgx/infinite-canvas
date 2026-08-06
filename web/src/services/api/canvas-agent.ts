import { aiApiUrl, aiRequestConfig, isRequestCanceled, refreshRemoteUser, readAxiosError } from "@/services/api/ai-utils";
import { channelAxiosRequest } from "@/services/api/channel-request";
import { streamGeminiChat, type GeminiChatMessage, type GeminiFunctionTool } from "@/services/api/gemini";
import { runModelPlugin } from "@/services/api/model-plugin";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentProtocolMessage, CanvasAgentToolCall } from "@/app/(user)/canvas/types";
import { createCanvasAgentFallbackActionIdFactory, type CanvasAgentToolDefinition } from "@/app/(user)/canvas/agent/canvas-agent-tools";

export type CanvasAgentModelTurn = {
    content: string;
    toolCalls: CanvasAgentToolCall[];
    usedJsonFallback: boolean;
};

type RequestCanvasAgentTurnInput = {
    config: AiConfig;
    systemPrompt: string;
    messages: CanvasAgentProtocolMessage[];
    tools: CanvasAgentToolDefinition[];
    allowTools: boolean;
    signal?: AbortSignal;
};

type ChatCompletionPayload = {
    code?: number;
    msg?: string;
    error?: { message?: string };
    choices?: Array<{
        message?: {
            content?: string | null;
            tool_calls?: Array<{
                id?: string;
                function?: { name?: string; arguments?: string | Record<string, unknown> };
            }>;
        };
    }>;
    data?: {
        choices?: Array<{
            message?: {
                content?: string | null;
                tool_calls?: Array<{
                    id?: string;
                    function?: { name?: string; arguments?: string | Record<string, unknown> };
                }>;
            };
        }>;
    };
};

class CanvasAgentRequestError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "CanvasAgentRequestError";
        this.status = status;
    }
}

export async function requestCanvasAgentTurn(input: RequestCanvasAgentTurnInput): Promise<CanvasAgentModelTurn> {
    const channelModel = input.config.textModel || input.config.model;
    // 调用脚本必须在模型值丢失渠道编码前解析，否则同名模型会错误地落到默认渠道。
    const script = resolveModelScript(input.config, channelModel, "text");
    const requestConfig = resolveModelRequestConfig(input.config, channelModel);
    const configuredSystemPrompt = requestConfig.systemPrompt.trim();
    const systemPrompt = configuredSystemPrompt ? configuredSystemPrompt + "\n\n" + input.systemPrompt : input.systemPrompt;
    let messages = input.allowTools ? input.messages : toJsonFallbackMessages(input.messages);
    let tools = input.allowTools ? input.tools : [];
    let usedJsonFallback = !input.allowTools;
    let requestError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const message = await requestCompletion(requestConfig, script, systemPrompt, messages, tools, input.signal);
            return { ...message, usedJsonFallback };
        } catch (error) {
            requestError = error;
            if (hasImageContent(messages) && isImageCompatibilityError(error)) {
                messages = stripImageContent(messages);
                continue;
            }
            if (tools.length && isToolCompatibilityError(error)) {
                tools = [];
                messages = toJsonFallbackMessages(messages);
                usedJsonFallback = true;
                continue;
            }
            throw error;
        }
    }
    throw requestError;
}

async function requestCompletion(config: AiConfig, script: string, systemPrompt: string, messages: CanvasAgentProtocolMessage[], tools: CanvasAgentToolDefinition[], signal?: AbortSignal) {
    const isNativeGeminiRequest = !script && config.apiFormat === "gemini";
    const requestMessages = [{ role: "system" as const, content: systemPrompt }, ...messages.map((message) => toRequestMessage(message, isNativeGeminiRequest))];
    if (script) {
        try {
            const result = await runModelPlugin<unknown>({
                capability: "text",
                script,
                config,
                messages: requestMessages,
                params: { tools },
                signal,
            });
            return normalizePluginResult(result);
        } catch (error) {
            if (isRequestCanceled(error, signal)) throw new DOMException("请求已取消", "AbortError");
            throw new CanvasAgentRequestError(readAxiosError(error, "文本模型请求失败"), 0);
        }
    }
    if (config.apiFormat === "gemini") {
        try {
            // requestMessages 已包含合并后的系统提示词，清空配置值避免 Gemini 再注入一次。
            const result = await streamGeminiChat({ ...config, systemPrompt: "" }, requestMessages as GeminiChatMessage[], tools as GeminiFunctionTool[], undefined, { signal });
            const fallbackActionId = createCanvasAgentFallbackActionIdFactory();
            return {
                content: result.content,
                toolCalls: result.toolCalls.map((toolCall) => {
                    const args = parseToolArguments(toolCall.arguments);
                    return {
                        id: toolCall.id || fallbackActionId(toolCall.name, args),
                        name: toolCall.name,
                        arguments: args,
                        ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
                    };
                }),
            };
        } catch (error) {
            if (isRequestCanceled(error, signal)) throw new DOMException("请求已取消", "AbortError");
            throw new CanvasAgentRequestError(readAxiosError(error, "文本模型请求失败"), 0);
        }
    }
    const body: Record<string, unknown> = {
        model: config.model,
        messages: requestMessages,
        stream: false,
    };
    if (tools.length) {
        body.tools = tools;
        body.tool_choice = "auto";
    }

    let response;
    try {
        response = await channelAxiosRequest<ChatCompletionPayload>(config, {
            method: "POST",
            url: aiApiUrl(config, "/chat/completions"),
            data: body,
            ...aiRequestConfig(config, "application/json", undefined, "text"),
            signal,
        });
    } catch (error) {
        if (isRequestCanceled(error, signal)) throw new DOMException("请求已取消", "AbortError");
        const status = typeof error === "object" && error && "response" in error ? Number((error as { response?: { status?: number } }).response?.status || 0) : 0;
        throw new CanvasAgentRequestError(readAxiosError(error, "文本模型请求失败"), status);
    }
    const payload = response.data;
    if (typeof payload.code === "number" && payload.code !== 0) throw new CanvasAgentRequestError(readError(payload, response.status), response.status);
    const message = payload.choices?.[0]?.message || payload.data?.choices?.[0]?.message;
    if (!message) throw new CanvasAgentRequestError(readError(payload, response.status) || "文本模型没有返回内容", response.status);

    refreshRemoteUser(config);
    const fallbackActionId = createCanvasAgentFallbackActionIdFactory();
    return {
        content: typeof message.content === "string" ? message.content : "",
        toolCalls: (message.tool_calls || []).flatMap((toolCall) => {
            const name = toolCall.function?.name?.trim();
            if (!name) return [];
            const args = parseToolArguments(toolCall.function?.arguments);
            return [{ id: toolCall.id || fallbackActionId(name, args), name, arguments: args }];
        }),
    };
}

function normalizePluginResult(value: unknown) {
    if (typeof value === "string") return { content: value, toolCalls: [] };
    if (!value || typeof value !== "object") return { content: "", toolCalls: [] };
    const payload = value as { content?: unknown; toolCalls?: unknown; tool_calls?: unknown };
    const calls = Array.isArray(payload.toolCalls) ? payload.toolCalls : Array.isArray(payload.tool_calls) ? payload.tool_calls : [];
    const fallbackActionId = createCanvasAgentFallbackActionIdFactory();
    return {
        content: typeof payload.content === "string" ? payload.content : "",
        toolCalls: calls.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const call = item as { id?: unknown; name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
            const name = String(call.name || call.function?.name || "").trim();
            if (!name) return [];
            const args = parseToolArguments(call.arguments ?? call.function?.arguments);
            return [{ id: String(call.id || fallbackActionId(name, args)), name, arguments: args }];
        }),
    };
}

function toRequestMessage(message: CanvasAgentProtocolMessage, includeThoughtSignature: boolean) {
    if (message.role === "assistant") {
        return {
            role: "assistant",
            content: message.content || null,
            ...(message.toolCalls?.length
                ? {
                      tool_calls: message.toolCalls.map((toolCall) => ({
                          id: toolCall.id,
                          type: "function",
                          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
                          ...(includeThoughtSignature && toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
                      })),
                  }
                : {}),
        };
    }
    if (message.role === "tool") {
        return {
            role: "tool",
            content: message.content,
            tool_call_id: message.toolCallId,
            name: message.name,
        };
    }
    return { role: message.role, content: message.content };
}

function parseToolArguments(value: unknown) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== "string") return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function readError(payload: ChatCompletionPayload, status: number) {
    return payload.error?.message || payload.msg || (status ? "文本模型请求失败：" + status : "文本模型请求失败");
}

function hasImageContent(messages: CanvasAgentProtocolMessage[]) {
    return messages.some((message) => (message.role === "user" || message.role === "system") && Array.isArray(message.content) && message.content.some((item) => item.type === "image_url"));
}

function stripImageContent(messages: CanvasAgentProtocolMessage[]) {
    return messages.map((message): CanvasAgentProtocolMessage => {
        if ((message.role === "user" || message.role === "system") && Array.isArray(message.content)) {
            return { role: message.role, content: message.content.filter((item) => item.type === "text") };
        }
        return message;
    });
}

function toJsonFallbackMessages(messages: CanvasAgentProtocolMessage[]) {
    return messages.map((message): CanvasAgentProtocolMessage => {
        if (message.role === "assistant" && message.toolCalls?.length) {
            const toolCallSummary = message.toolCalls.map((toolCall) => `工具调用：${toolCall.name}\n调用 ID：${toolCall.id}\n参数：${stringifyToolArguments(toolCall.arguments)}`).join("\n\n");
            return { role: "assistant", content: [message.content?.trim(), toolCallSummary].filter(Boolean).join("\n\n") };
        }
        if (message.role === "tool") {
            return {
                role: "user",
                content: `工具执行结果：${message.name}\n调用 ID：${message.toolCallId}\n结果：${message.content}`,
            };
        }
        return message;
    });
}

function stringifyToolArguments(value: Record<string, unknown>) {
    try {
        return JSON.stringify(value);
    } catch {
        return "[参数无法序列化]";
    }
}

function isImageCompatibilityError(error: unknown) {
    return error instanceof CanvasAgentRequestError && /image_url|image input|vision|multimodal|content.*array|unsupported.*image|不支持.*图片|图像输入/i.test(error.message);
}

function isToolCompatibilityError(error: unknown) {
    if (!(error instanceof CanvasAgentRequestError)) return false;
    return error.status === 400 || error.status === 422 || /tools?|tool_choice|function.?call|unknown field|unsupported|not support|不支持|未知字段/i.test(error.message);
}
