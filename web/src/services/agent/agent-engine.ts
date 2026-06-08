import axios from "axios";
import { nanoid } from "nanoid";

import type { AiConfig } from "@/stores/use-config-store";
import type { Skill } from "@/services/api/skills";
import { aiApiUrl, aiRequestConfig, refreshRemoteUser, readAxiosError } from "@/services/api/ai-utils";
import { parseAgentStreamChunk } from "./agent-stream";
import { buildToolDefinitions } from "./skill-definitions";
import { executeSkill, type SkillResult } from "./skill-executor";

export type AgentMessage = {
    id: string;
    role: "user" | "assistant" | "tool" | "system";
    content: string | null;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    toolCallId?: string;
    skillResults?: SkillResult[];
    isStreaming?: boolean;
};

export type AgentCallbacks = {
    onMessageCreate: (msg: AgentMessage) => void;
    onMessageUpdate: (id: string, updates: Partial<AgentMessage>) => void;
    onSkillExecuting: (messageId: string, skillName: string) => void;
    onSkillDone: (messageId: string) => void;
};

const MAX_TOOL_ROUNDS = 5;
const AGENT_SYSTEM_PROMPT = `你是一个多功能 AI 助手，可以通过 Skills（技能）完成用户的创意需求。
当用户需要生成图片、视频或音频时，请调用对应的技能。
对于图片生成，请将用户的需求翻译为详细的英文提示词以获得最佳效果。
如果用户没有明确需求，可以正常对话。`;

/**
 * Run the agent loop: send chat completion with tools, handle tool calls, recurse.
 */
export async function runAgent(
    config: AiConfig,
    messages: AgentMessage[],
    enabledSkills: Skill[],
    callbacks: AgentCallbacks,
    signal?: AbortSignal,
): Promise<void> {
    const tools = enabledSkills.length > 0 ? buildToolDefinitions(enabledSkills) : undefined;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // Build OpenAI messages
        const apiMessages = buildApiMessages(config, messages);

        // Create assistant message placeholder
        const assistantId = nanoid();
        const assistantMsg: AgentMessage = {
            id: assistantId,
            role: "assistant",
            content: "",
            isStreaming: true,
        };
        callbacks.onMessageCreate(assistantMsg);

        // Stream chat completion
        const result = await streamChatCompletion(
            config,
            apiMessages,
            tools,
            (text) => callbacks.onMessageUpdate(assistantId, { content: text }),
            signal,
        );

        // Update final message
        callbacks.onMessageUpdate(assistantId, {
            content: result.content,
            toolCalls: result.toolCalls,
            isStreaming: false,
        });

        // Add to messages for next round
        messages = [
            ...messages,
            {
                ...assistantMsg,
                content: result.content,
                toolCalls: result.toolCalls,
                isStreaming: false,
            },
        ];

        // If no tool calls, we're done
        if (!result.toolCalls?.length) {
            refreshRemoteUser(config);
            return;
        }

        // Execute each tool call
        for (const tc of result.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
                args = JSON.parse(tc.arguments);
            } catch {
                /* use empty */
            }

            // Notify UI: skill is executing
            callbacks.onSkillExecuting(assistantId, tc.name);

            // Execute the skill
            const skillResult = await executeSkill(config, tc.name, args);

            // Build tool result message WITH the skill result embedded
            const toolResultContent =
                skillResult.type === "error"
                    ? `错误: ${skillResult.error}`
                    : skillResult.type === "image"
                      ? `已成功生成 ${skillResult.images?.length || 0} 张图片。`
                      : skillResult.type === "video"
                        ? "视频已成功生成。"
                        : skillResult.type === "audio"
                          ? "音频已成功生成。"
                          : "技能执行完成。";

            // Tool message carries the actual results (images/video/audio)
            const toolMsg: AgentMessage = {
                id: nanoid(),
                role: "tool",
                content: toolResultContent,
                toolCallId: tc.id,
                skillResults: [skillResult],
            };
            callbacks.onMessageCreate(toolMsg);
            messages = [...messages, toolMsg];

            // Notify UI: skill done
            callbacks.onSkillDone(assistantId);
        }

        // Continue to next round (model will see tool results)
    }
}

function buildApiMessages(config: AiConfig, messages: AgentMessage[]) {
    const systemPrompt = config.systemPrompt?.trim();
    const fullSystemPrompt = [AGENT_SYSTEM_PROMPT, systemPrompt].filter(Boolean).join("\n\n");

    const apiMessages: Array<Record<string, unknown>> = [{ role: "system", content: fullSystemPrompt }];

    for (const msg of messages) {
        if (msg.role === "system") continue;
        if (msg.role === "tool") {
            apiMessages.push({
                role: "tool",
                content: msg.content || "",
                tool_call_id: msg.toolCallId || "",
            });
        } else if (msg.role === "assistant" && msg.toolCalls?.length) {
            apiMessages.push({
                role: "assistant",
                content: msg.content || null,
                tool_calls: msg.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            });
        } else {
            apiMessages.push({
                role: msg.role,
                content: msg.content || "",
            });
        }
    }
    return apiMessages;
}

type StreamResult = {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

async function streamChatCompletion(
    config: AiConfig,
    messages: Array<Record<string, unknown>>,
    tools: ReturnType<typeof buildToolDefinitions> | undefined,
    onDelta: (fullText: string) => void,
    signal?: AbortSignal,
): Promise<StreamResult> {
    let buffer = "";
    let content = "";
    let processedLength = 0;
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

    const model = config.model || config.textModel || "gpt-4o";

    try {
        await axios.post(
            aiApiUrl(config, "/chat/completions"),
            {
                model,
                messages,
                stream: true,
                ...(tools?.length ? { tools } : {}),
            },
            {
                ...aiRequestConfig(config, "application/json", undefined, "text"),
                responseType: "text",
                signal,
                onDownloadProgress: (event) => {
                    const responseText = String(event.event?.target?.responseText || "");
                    const nextText = responseText.slice(processedLength);
                    processedLength = responseText.length;
                    buffer += nextText;
                    const chunks = buffer.split("\n\n");
                    buffer = chunks.pop() || "";
                    for (const chunk of chunks) {
                        const events = parseAgentStreamChunk(chunk);
                        for (const ev of events) {
                            if (ev.type === "content") {
                                content += ev.text;
                                onDelta(content);
                            } else if (ev.type === "tool_call_delta") {
                                const existing = toolCallAccumulator.get(ev.index);
                                if (existing) {
                                    if (ev.arguments) existing.arguments += ev.arguments;
                                } else {
                                    toolCallAccumulator.set(ev.index, {
                                        id: ev.id || `call_${nanoid()}`,
                                        name: ev.name || "",
                                        arguments: ev.arguments || "",
                                    });
                                }
                            }
                        }
                    }
                },
            },
        );

        // Process remaining buffer
        if (buffer) {
            const events = parseAgentStreamChunk(buffer);
            for (const ev of events) {
                if (ev.type === "content") {
                    content += ev.text;
                    onDelta(content);
                } else if (ev.type === "tool_call_delta") {
                    const existing = toolCallAccumulator.get(ev.index);
                    if (existing) {
                        if (ev.arguments) existing.arguments += ev.arguments;
                    } else {
                        toolCallAccumulator.set(ev.index, {
                            id: ev.id || `call_${nanoid()}`,
                            name: ev.name || "",
                            arguments: ev.arguments || "",
                        });
                    }
                }
            }
        }
    } catch (error) {
        if (signal?.aborted) throw new Error("已取消");
        throw new Error(readAxiosError(error, "对话请求失败"));
    }

    const toolCalls = toolCallAccumulator.size > 0 ? Array.from(toolCallAccumulator.values()) : undefined;

    return { content, toolCalls };
}
