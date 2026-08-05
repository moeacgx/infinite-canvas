import { CANVAS_AGENT_ACTION_NAMES, type CanvasAgentActionName } from "./canvas-agent-tools";
import type { CanvasAgentProtocolMessage, CanvasAgentToolCall } from "../types";

const MAX_RESTORED_MESSAGES = 120;
const MAX_MESSAGE_TEXT_CHARACTERS = 32_000;
const MAX_TOOL_ARGUMENT_CHARACTERS = 16_000;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_THOUGHT_SIGNATURE_CHARACTERS = 8_192;
const ACTION_NAMES = new Set<string>(CANVAS_AGENT_ACTION_NAMES);

export function sanitizeCanvasAgentProtocolMessages(value: unknown): CanvasAgentProtocolMessage[] {
    if (!Array.isArray(value)) return [];

    const messages: CanvasAgentProtocolMessage[] = [];
    let pendingCalls = new Map<string, CanvasAgentActionName>();
    for (const rawMessage of value.slice(-MAX_RESTORED_MESSAGES)) {
        if (!isRecord(rawMessage)) continue;

        if (rawMessage.role === "user") {
            pendingCalls = new Map();
            const content = sanitizeUserContent(rawMessage.content);
            if (content) messages.push({ role: "user", content });
            continue;
        }

        // 系统提示词只能由当前运行器构建，恢复数据不得注入 system 角色。
        if (rawMessage.role === "system") {
            pendingCalls = new Map();
            continue;
        }

        if (rawMessage.role === "assistant") {
            const content = boundedString(rawMessage.content, MAX_MESSAGE_TEXT_CHARACTERS);
            const toolCalls = sanitizeToolCalls(rawMessage.toolCalls);
            pendingCalls = new Map(toolCalls.map((call) => [call.id, call.name as CanvasAgentActionName]));
            if (content || toolCalls.length) messages.push({ role: "assistant", ...(content ? { content } : {}), ...(toolCalls.length ? { toolCalls } : {}) });
            continue;
        }

        if (rawMessage.role === "tool") {
            const toolCallId = boundedString(rawMessage.toolCallId, MAX_IDENTIFIER_CHARACTERS);
            const name = boundedString(rawMessage.name, MAX_IDENTIFIER_CHARACTERS);
            const content = boundedString(rawMessage.content, MAX_MESSAGE_TEXT_CHARACTERS);
            if (!toolCallId || !name || !content || pendingCalls.get(toolCallId) !== name) continue;
            messages.push({ role: "tool", toolCallId, name, content });
            pendingCalls.delete(toolCallId);
            continue;
        }

        pendingCalls = new Map();
    }

    while (messages[0]?.role === "tool") messages.shift();
    return messages;
}

function sanitizeUserContent(value: unknown) {
    if (typeof value === "string") return value.slice(0, MAX_MESSAGE_TEXT_CHARACTERS);
    if (!Array.isArray(value)) return "";
    return value
        .flatMap((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
        .join("\n")
        .slice(0, MAX_MESSAGE_TEXT_CHARACTERS);
}

function sanitizeToolCalls(value: unknown): CanvasAgentToolCall[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).flatMap((rawCall) => {
        if (!isRecord(rawCall)) return [];
        const id = boundedString(rawCall.id, MAX_IDENTIFIER_CHARACTERS);
        const name = boundedString(rawCall.name, MAX_IDENTIFIER_CHARACTERS);
        if (!id || !ACTION_NAMES.has(name)) return [];
        const args = sanitizeArguments(rawCall.arguments);
        const thoughtSignature = boundedString(rawCall.thoughtSignature, MAX_THOUGHT_SIGNATURE_CHARACTERS);
        return [{ id, name, arguments: args, ...(thoughtSignature ? { thoughtSignature } : {}) }];
    });
}

function sanitizeArguments(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) return {};
    try {
        const serialized = JSON.stringify(value);
        if (serialized.length > MAX_TOOL_ARGUMENT_CHARACTERS) return {};
        const parsed = JSON.parse(serialized);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function boundedString(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
