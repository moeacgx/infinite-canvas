import { requestCanvasAgentTurn } from "@/services/api/canvas-agent";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentContent, CanvasAgentProtocolMessage, CanvasAgentState, CanvasAgentToolCall, CanvasAssistantMessageStatus, CanvasAssistantReference } from "../types";
import type { CanvasAgentContext } from "./canvas-agent-context";
import { buildCanvasAgentSkillPrompt } from "./canvas-agent-skills";
import { CANVAS_AGENT_TOOLS, canvasAgentActionLabel, isCanvasAgentMediaAction, normalizeCanvasAgentAction, parseCanvasAgentJson, userLikelyRequestedCanvasAction, type CanvasAgentAction, type CanvasAgentToolResult } from "./canvas-agent-tools";

const MAX_AGENT_STEPS = 12;
const MAX_AGENT_ACTIONS_PER_STEP = 12;
const MAX_PROTOCOL_MESSAGES = 120;
const MAX_PROTOCOL_TEXT_CHARACTERS = 64_000;
const MAX_PROTOCOL_MESSAGE_CHARACTERS = 32_000;
const MAX_TOOL_RESULT_CHARACTERS = 24_000;
const MAX_WRITE_ACTIONS_PER_TURN = 24;
const MAX_MEDIA_ACTIONS_PER_TURN = 6;
const MAX_IMAGE_OUTPUTS_PER_TURN = 12;
const WRITE_ACTION_NAMES = new Set<CanvasAgentAction["name"]>([
    "create_primary_script_node",
    "create_text_node",
    "update_text_node",
    "update_node",
    "delete_node",
    "create_connection",
    "delete_connection",
    "create_group",
    "arrange_nodes",
    "generate_image",
    "edit_image",
    "generate_video",
    "generate_audio",
]);

function trimProtocolMessages(messages: CanvasAgentProtocolMessage[]) {
    const candidates = messages.slice(-MAX_PROTOCOL_MESSAGES).map(truncateProtocolMessage);
    const trimmed: CanvasAgentProtocolMessage[] = [];
    let used = 0;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const message = candidates[index];
        const size = protocolMessageTextLength(message);
        if (trimmed.length && used + size > MAX_PROTOCOL_TEXT_CHARACTERS) break;
        trimmed.unshift(message);
        used += size;
    }
    while (trimmed[0]?.role === "tool") trimmed.shift();
    return trimmed;
}

export type CanvasAgentExecutionBudget = {
    writeActions: number;
    mediaActions: number;
    imageOutputs: number;
};

export function createCanvasAgentExecutionBudget(): CanvasAgentExecutionBudget {
    return { writeActions: 0, mediaActions: 0, imageOutputs: 0 };
}

type NormalizedNativeToolCall = {
    toolCall: CanvasAgentToolCall;
    action?: CanvasAgentAction;
    rejection?: CanvasAgentToolResult;
};

export function normalizeCanvasAgentToolCalls(toolCalls: CanvasAgentToolCall[]): NormalizedNativeToolCall[] {
    return toolCalls.map((toolCall) => {
        try {
            return { toolCall, action: normalizeCanvasAgentAction(toolCall.name, toolCall.arguments, toolCall.id) };
        } catch (error) {
            return {
                toolCall,
                rejection: {
                    ok: false,
                    code: "invalid_tool_call",
                    message: error instanceof Error ? error.message : "模型返回的工具参数无效",
                },
            };
        }
    });
}

export function reserveCanvasAgentAction(budget: CanvasAgentExecutionBudget, action: CanvasAgentAction): CanvasAgentToolResult | null {
    const writeCost = WRITE_ACTION_NAMES.has(action.name) ? 1 : 0;
    const mediaCost = isCanvasAgentMediaAction(action) ? 1 : 0;
    const imageCost = action.name === "generate_image" || action.name === "edit_image" ? Math.max(1, Math.floor(Number(action.arguments.count) || 1)) : 0;
    if (budget.writeActions + writeCost > MAX_WRITE_ACTIONS_PER_TURN) {
        return budgetExceeded("本轮画布写操作已达到 24 次上限，请先总结已完成结果并等待用户确认后再继续", budget);
    }
    if (budget.mediaActions + mediaCost > MAX_MEDIA_ACTIONS_PER_TURN) {
        return budgetExceeded("本轮媒体生成已达到 6 个任务上限，请先总结已提交任务并等待用户确认后再继续", budget);
    }
    if (budget.imageOutputs + imageCost > MAX_IMAGE_OUTPUTS_PER_TURN) {
        return budgetExceeded("本轮图片输出已达到 12 张上限，请先总结已生成结果并等待用户确认后再继续", budget);
    }
    budget.writeActions += writeCost;
    budget.mediaActions += mediaCost;
    budget.imageOutputs += imageCost;
    return null;
}

export type CanvasAgentRuntimeEvent = {
    status: CanvasAssistantMessageStatus;
    label: string;
};

export type RunCanvasAgentInput = {
    config: AiConfig;
    initialState: CanvasAgentState;
    protocolMessages: CanvasAgentProtocolMessage[];
    userText: string;
    references: CanvasAssistantReference[];
    getContext: (state: CanvasAgentState) => CanvasAgentContext;
    executeAction: (action: CanvasAgentAction) => Promise<CanvasAgentToolResult>;
    onEvent?: (event: CanvasAgentRuntimeEvent) => void;
    onCheckpoint?: (checkpoint: { state: CanvasAgentState; protocolMessages: CanvasAgentProtocolMessage[] }) => void;
    signal?: AbortSignal;
};

export type RunCanvasAgentResult = {
    reply: string;
    state: CanvasAgentState;
    protocolMessages: CanvasAgentProtocolMessage[];
};

export function createCanvasAgentState(): CanvasAgentState {
    return {
        phase: "intake",
        approvedNodeIds: [],
        referenceNodeIds: [],
        pendingTaskIds: [],
        completedTaskIds: [],
    };
}

export async function runCanvasAgent(input: RunCanvasAgentInput): Promise<RunCanvasAgentResult> {
    let state = input.initialState;
    let allowTools = true;
    let hasExecutedActions = false;
    const executionBudget = createCanvasAgentExecutionBudget();
    let protocolMessages: CanvasAgentProtocolMessage[] = trimProtocolMessages([...input.protocolMessages, { role: "user" as const, content: buildUserContent(input.userText, input.references) }]);

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
        throwIfAborted(input.signal);
        input.onEvent?.({ status: "thinking", label: step ? "正在根据画布结果继续" : "正在理解画布和创作目标" });
        const context = input.getContext(state);
        const turn = await requestCanvasAgentTurn({
            config: input.config,
            systemPrompt: buildCanvasAgentSkillPrompt(state.phase, input.userText, context),
            messages: protocolMessages,
            tools: CANVAS_AGENT_TOOLS,
            allowTools,
            signal: input.signal,
        });
        if (turn.usedJsonFallback) allowTools = false;

        const parsedJson = parseCanvasAgentJson(turn.content);
        const normalizedNativeCalls = normalizeCanvasAgentToolCalls(turn.toolCalls.slice(0, MAX_AGENT_ACTIONS_PER_STEP));
        const arrangeRequested = /整理|排列|排序|对齐|布局|排版|重新摆放/.test(input.userText) && !/(不要|别|无需|不用).{0,8}(整理|排列|排序|对齐|布局|排版|重新摆放)/.test(input.userText);
        const routedNativeCalls = normalizedNativeCalls.map((entry): NormalizedNativeToolCall => {
            if (entry.action?.name !== "arrange_nodes" || arrangeRequested) return entry;
            return {
                toolCall: entry.toolCall,
                rejection: { ok: false, code: "tool_not_requested", message: "用户本轮没有要求整理画布，已忽略 arrange_nodes" },
            };
        });
        const nativeActions = routedNativeCalls.flatMap((entry) => (entry.action ? [entry.action] : []));
        const hasNativeToolCalls = routedNativeCalls.length > 0;
        const actions = (hasNativeToolCalls ? nativeActions : parsedJson.actions).filter((action) => action.name !== "arrange_nodes" || arrangeRequested);
        const rejectedNativeCalls = routedNativeCalls.filter((entry) => entry.rejection);

        if (!actions.length && !rejectedNativeCalls.length) {
            const reply = (parsedJson.parsed ? parsedJson.reply : turn.content).trim();
            if (!hasExecutedActions && userLikelyRequestedCanvasAction(input.userText) && !looksLikeClarifyingQuestion(reply)) {
                const unsupported = "当前文本模型没有返回可执行的画布工具指令。可以继续讨论文本内容，但无法可靠地自动创建节点或执行生成；请在全局配置中更换支持 Tool Calling 或稳定 JSON 输出的文本模型。";
                protocolMessages = trimProtocolMessages([...protocolMessages, { role: "assistant" as const, content: unsupported }]);
                return { reply: unsupported, state, protocolMessages: persistCanvasAgentProtocolMessages(protocolMessages) };
            }
            const finalReply = reply || "我已经读取当前画布。请告诉我下一步要继续完善哪一部分。";
            protocolMessages = trimProtocolMessages([...protocolMessages, { role: "assistant" as const, content: finalReply }]);
            return { reply: finalReply, state, protocolMessages: persistCanvasAgentProtocolMessages(protocolMessages) };
        }

        input.onEvent?.({ status: "running", label: actions.length ? (actions.length === 1 ? canvasAgentActionLabel(actions[0]) : "正在执行 " + actions.length + " 个画布操作") : "正在校验模型工具指令" });
        const assistantToolMessage: CanvasAgentProtocolMessage = hasNativeToolCalls
            ? {
                  role: "assistant",
                  content: turn.content || undefined,
                  toolCalls: routedNativeCalls.map(({ toolCall, action }) => {
                      return {
                          id: toolCall.id,
                          name: action?.name || toolCall.name,
                          arguments: action?.arguments || toolCall.arguments,
                          ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
                      };
                  }),
              }
            : { role: "assistant", content: turn.content };

        const results = actions.length ? await executeActions(actions, state, executionBudget, input.executeAction, input.signal, input.onEvent) : { items: [], state };
        throwIfAborted(input.signal);
        hasExecutedActions = hasExecutedActions || actions.length > 0;
        state = results.state;

        if (hasNativeToolCalls && allowTools) {
            const resultById = new Map(results.items.map(({ action, result }) => [action.id, result]));
            protocolMessages = trimProtocolMessages([
                ...protocolMessages,
                assistantToolMessage,
                ...routedNativeCalls.map(({ toolCall, action, rejection }) => ({
                    role: "tool" as const,
                    toolCallId: toolCall.id,
                    name: action?.name || toolCall.name,
                    content: JSON.stringify(compactToolResult(rejection || (action ? resultById.get(action.id) : undefined) || { ok: false, code: "tool_result_missing", message: "工具没有返回结果" })),
                })),
            ]);
        } else {
            protocolMessages = trimProtocolMessages([
                ...protocolMessages,
                assistantToolMessage,
                {
                    role: "user" as const,
                    content: "工具执行结果（只可依据这些真实结果继续）：\n" + serializeFallbackToolResults(results.items),
                },
            ]);
        }
        input.onCheckpoint?.({ state, protocolMessages: persistCanvasAgentProtocolMessages(protocolMessages) });
    }

    const reply = "本轮已达到安全操作步数上限，当前已完成的节点和任务都已保存。你可以让我继续下一步。";
    protocolMessages = trimProtocolMessages([...protocolMessages, { role: "assistant" as const, content: reply }]);
    return { reply, state, protocolMessages: persistCanvasAgentProtocolMessages(protocolMessages) };
}

async function executeActions(
    actions: CanvasAgentAction[],
    initialState: CanvasAgentState,
    budget: CanvasAgentExecutionBudget,
    executeAction: (action: CanvasAgentAction) => Promise<CanvasAgentToolResult>,
    signal?: AbortSignal,
    onEvent?: (event: CanvasAgentRuntimeEvent) => void,
) {
    let state = initialState;
    const executeOne = async (action: CanvasAgentAction) => {
        throwIfAborted(signal);
        const budgetError = reserveCanvasAgentAction(budget, action);
        if (budgetError) return { action, result: budgetError };
        onEvent?.({ status: "running", label: canvasAgentActionLabel(action) });
        try {
            const result = await executeAction(action);
            throwIfAborted(signal);
            if (action.name === "set_agent_state" && result.ok) state = applyAgentState(state, action.arguments);
            else state = applyTaskResult(state, result);
            return { action, result };
        } catch (error) {
            throwIfAborted(signal);
            return {
                action,
                result: {
                    ok: false,
                    code: "tool_execution_failed",
                    message: error instanceof Error ? error.message : "工具执行失败",
                } satisfies CanvasAgentToolResult,
            };
        }
    };

    const items = actions.every(isCanvasAgentMediaAction)
        ? await Promise.all(actions.map(executeOne))
        : await actions.reduce<Promise<Array<{ action: CanvasAgentAction; result: CanvasAgentToolResult }>>>(async (pending, action) => [...(await pending), await executeOne(action)], Promise.resolve([]));
    return { items, state };
}

function buildUserContent(text: string, references: CanvasAssistantReference[]): CanvasAgentContent {
    const referenceText = references.length ? "\n\n本次明确引用的真实节点：" + references.map((item) => item.id + "（" + item.title + "）").join("、") : "";
    const images = references.flatMap((item) => {
        const url = item.dataUrl;
        return url && (/^data:image\//.test(url) || /^https?:\/\//.test(url)) ? [{ type: "image_url" as const, image_url: { url } }] : [];
    });
    if (!images.length) return text + referenceText;
    return [{ type: "text", text: text + referenceText }, ...images];
}

function looksLikeClarifyingQuestion(text: string) {
    return /[?？]|请(?:告诉|选择|确认|提供)|需要.{0,12}(?:吗|呢)|希望.{0,12}(?:吗|呢)/.test(text);
}

function persistCanvasAgentProtocolMessages(messages: CanvasAgentProtocolMessage[]) {
    return messages.map((message): CanvasAgentProtocolMessage => {
        if ((message.role === "user" || message.role === "system") && Array.isArray(message.content)) {
            const text = message.content
                .filter((item) => item.type === "text")
                .map((item) => item.text)
                .join("\n")
                .trim();
            return { role: message.role, content: text || "本轮包含图片引用；媒体内容未写入会话记录。" };
        }
        return message;
    });
}

function budgetExceeded(message: string, budget: CanvasAgentExecutionBudget): CanvasAgentToolResult {
    return {
        ok: false,
        code: "turn_budget_exceeded",
        message,
        usage: { ...budget },
        limits: {
            writeActions: MAX_WRITE_ACTIONS_PER_TURN,
            mediaActions: MAX_MEDIA_ACTIONS_PER_TURN,
            imageOutputs: MAX_IMAGE_OUTPUTS_PER_TURN,
        },
    };
}

function truncateProtocolMessage(message: CanvasAgentProtocolMessage): CanvasAgentProtocolMessage {
    if (message.role === "user" || message.role === "system") {
        if (typeof message.content === "string") return { role: message.role, content: message.content.slice(0, MAX_PROTOCOL_MESSAGE_CHARACTERS) };
        let remaining = MAX_PROTOCOL_MESSAGE_CHARACTERS;
        return {
            role: message.role,
            content: message.content.map((item) => {
                if (item.type === "image_url") return item;
                const text = item.text.slice(0, remaining);
                remaining -= text.length;
                return { ...item, text };
            }),
        };
    }
    if (message.role === "assistant") {
        return {
            role: "assistant",
            ...(message.content ? { content: message.content.slice(0, MAX_PROTOCOL_MESSAGE_CHARACTERS) } : {}),
            ...(message.toolCalls?.length
                ? {
                      toolCalls: message.toolCalls.map((call) => ({
                          ...call,
                          arguments: compactToolArguments(call.arguments),
                      })),
                  }
                : {}),
        };
    }
    if (message.role === "tool") return { ...message, content: message.content.slice(0, MAX_TOOL_RESULT_CHARACTERS) };
    return message;
}

function protocolMessageTextLength(message: CanvasAgentProtocolMessage) {
    if (message.role === "user" || message.role === "system") {
        return typeof message.content === "string" ? message.content.length : message.content.reduce((total, item) => total + (item.type === "text" ? item.text.length : 0), 0);
    }
    if (message.role === "assistant") {
        return (message.content?.length || 0) + (message.toolCalls || []).reduce((total, call) => total + call.id.length + call.name.length + safeJsonLength(call.arguments), 0);
    }
    if (message.role === "tool") return message.content.length + message.toolCallId.length + message.name.length;
    return 0;
}

function compactToolArguments(value: Record<string, unknown>) {
    try {
        const serialized = JSON.stringify(value);
        return serialized.length <= MAX_PROTOCOL_MESSAGE_CHARACTERS ? value : { truncated: true };
    } catch {
        return { truncated: true };
    }
}

function compactToolResult(result: CanvasAgentToolResult): CanvasAgentToolResult {
    try {
        if (JSON.stringify(result).length <= MAX_TOOL_RESULT_CHARACTERS) return result;
    } catch {
        // 继续返回结构化摘要。
    }
    return summarizeToolResult(result, true);
}

function serializeFallbackToolResults(items: Array<{ action: CanvasAgentAction; result: CanvasAgentToolResult }>) {
    const compact = items.map(({ action, result }) => ({ tool: action.name, id: action.id, result: compactToolResult(result) }));
    const serialized = JSON.stringify(compact);
    if (serialized.length <= MAX_TOOL_RESULT_CHARACTERS) return serialized;
    return JSON.stringify({
        truncated: true,
        message: "工具结果过长，已保留状态摘要；需要详情时按节点 ID 重新读取",
        items: items.map(({ action, result }) => ({ tool: action.name, id: action.id, result: summarizeToolResult(result, false) })),
    });
}

function summarizeToolResult(result: CanvasAgentToolResult, truncated: boolean): CanvasAgentToolResult {
    const summary: CanvasAgentToolResult = {
        ok: result.ok,
        ...(typeof result.code === "string" ? { code: result.code } : {}),
        ...(typeof result.message === "string" ? { message: result.message.slice(0, 2_000) } : {}),
        ...(truncated ? { truncated: true } : {}),
    };
    for (const key of ["nodeId", "taskId", "status", "progress", "createdNodeIds", "connectionIds", "deletedNodeIds"]) {
        const value = result[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string"))) summary[key] = value;
    }
    return summary;
}

function safeJsonLength(value: unknown) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return MAX_PROTOCOL_MESSAGE_CHARACTERS;
    }
}

function applyAgentState(state: CanvasAgentState, patch: Record<string, unknown>): CanvasAgentState {
    return {
        ...state,
        phase: typeof patch.phase === "string" ? (patch.phase as CanvasAgentState["phase"]) : state.phase,
        brief: typeof patch.brief === "string" ? patch.brief : state.brief,
        targetDurationSeconds: typeof patch.targetDurationSeconds === "number" ? patch.targetDurationSeconds : state.targetDurationSeconds,
        approvedPlan: typeof patch.approvedPlan === "string" ? patch.approvedPlan : state.approvedPlan,
        approvedNodeIds: Array.isArray(patch.approvedNodeIds) ? (patch.approvedNodeIds as string[]) : state.approvedNodeIds,
        referenceNodeIds: Array.isArray(patch.referenceNodeIds) ? (patch.referenceNodeIds as string[]) : state.referenceNodeIds,
    };
}

function applyTaskResult(state: CanvasAgentState, result: CanvasAgentToolResult): CanvasAgentState {
    const taskId = typeof result.taskId === "string" ? result.taskId : "";
    if (!taskId) return state;
    const completed = result.status === "success" || result.status === "completed";
    const terminal = completed || result.status === "error" || result.status === "failed";
    return {
        ...state,
        pendingTaskIds: terminal ? state.pendingTaskIds.filter((id) => id !== taskId) : [...new Set([...state.pendingTaskIds, taskId])],
        completedTaskIds: completed ? [...new Set([...state.completedTaskIds, taskId])] : state.completedTaskIds,
    };
}

function throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) return;
    const error = new Error("Agent 已停止");
    error.name = "AbortError";
    throw error;
}
