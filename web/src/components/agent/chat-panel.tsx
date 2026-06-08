"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Input, Spin } from "antd";
import { Plus, Send, Square, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { useConfigStore } from "@/stores/use-config-store";
import { useChatStore } from "@/stores/use-chat-store";
import { fetchSkills, type Skill } from "@/services/api/skills";
import { runAgent, type AgentMessage } from "@/services/agent/agent-engine";
import type { SkillResult } from "@/services/agent/skill-executor";
import { ChatMessage } from "./chat-message";
import { SkillSelector } from "./skill-selector";

export function ChatPanel() {
    const { message: antMessage } = App.useApp();
    const config = useConfigStore((s) => s.config);
    const {
        sessions,
        activeSessionId,
        createSession,
        deleteSession,
        setActiveSession,
        addMessage,
        updateMessage,
        setEnabledSkills,
        setSessionTitle,
        clearMessages,
    } = useChatStore();

    const [input, setInput] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [executingSkill, setExecutingSkill] = useState<{
        messageId: string;
        name: string;
    } | null>(null);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [isLoadingSkills, setIsLoadingSkills] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const session = sessions.find((s) => s.id === activeSessionId);

    // Fetch available skills on mount and config change
    useEffect(() => {
        let cancelled = false;
        setIsLoadingSkills(true);
        fetchSkills(config)
            .then((response) => {
                if (!cancelled) setSkills(response.skills);
            })
            .catch(() => {
                /* ignore */
            })
            .finally(() => {
                if (!cancelled) setIsLoadingSkills(false);
            });
        return () => {
            cancelled = true;
        };
    }, [config]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [session?.messages]);

    // Create first session if none
    useEffect(() => {
        if (!sessions.length) createSession();
    }, [sessions.length, createSession]);

    const handleSend = useCallback(async () => {
        if (!input.trim() || isRunning) return;
        const sessionId = activeSessionId || createSession();
        const currentSession = useChatStore
            .getState()
            .sessions.find((s) => s.id === sessionId);
        if (!currentSession) return;

        const userMsg: AgentMessage = {
            id: nanoid(),
            role: "user",
            content: input.trim(),
        };
        addMessage(sessionId, userMsg);
        setInput("");
        setIsRunning(true);

        const enabledSkillDefs = skills.filter((s) =>
            currentSession.enabledSkills.includes(s.name)
        );
        const currentMessages = [...(currentSession.messages || []), userMsg];

        // Auto-title from first user message
        if (currentMessages.filter((m) => m.role === "user").length === 1) {
            setSessionTitle(
                sessionId,
                input.trim().slice(0, 30) +
                    (input.trim().length > 30 ? "..." : "")
            );
        }

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            await runAgent(
                config,
                currentMessages,
                enabledSkillDefs,
                {
                    onMessageCreate: (msg) => addMessage(sessionId, msg),
                    onMessageUpdate: (id, updates) =>
                        updateMessage(sessionId, id, updates),
                    onSkillStart: (messageId, name) =>
                        setExecutingSkill({ messageId, name }),
                    onSkillComplete: (messageId, _name, result) => {
                        setExecutingSkill(null);
                        // Attach skill result to the assistant message that triggered it
                        const latestSession = useChatStore
                            .getState()
                            .sessions.find((s) => s.id === sessionId);
                        const assistantMsg = latestSession?.messages.find(
                            (m) => m.id === messageId
                        );
                        if (assistantMsg) {
                            updateMessage(sessionId, messageId, {
                                skillResults: [
                                    ...(assistantMsg.skillResults || []),
                                    result,
                                ],
                            });
                        }
                    },
                },
                controller.signal
            );
        } catch (error) {
            if (!controller.signal.aborted) {
                antMessage.error(
                    error instanceof Error ? error.message : "请求失败"
                );
            }
        } finally {
            setIsRunning(false);
            setExecutingSkill(null);
            abortRef.current = null;
        }
    }, [
        input,
        isRunning,
        activeSessionId,
        config,
        skills,
        createSession,
        addMessage,
        updateMessage,
        setSessionTitle,
        antMessage,
    ]);

    const handleStop = () => {
        abortRef.current?.abort();
    };

    const handleNewSession = () => {
        createSession();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header: session tabs + skills */}
            <div className="border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-700 dark:bg-stone-900">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        {sessions.slice(0, 8).map((s) => (
                            <Button
                                key={s.id}
                                size="small"
                                type={
                                    s.id === activeSessionId
                                        ? "primary"
                                        : "text"
                                }
                                onClick={() => setActiveSession(s.id)}
                            >
                                {s.title.slice(0, 12)}
                            </Button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            size="small"
                            type="text"
                            icon={<Plus className="size-4" />}
                            onClick={handleNewSession}
                        />
                        {session ? (
                            <Button
                                size="small"
                                type="text"
                                danger
                                icon={<Trash2 className="size-4" />}
                                onClick={() => clearMessages(session.id)}
                            />
                        ) : null}
                    </div>
                </div>
                {!isLoadingSkills && skills.length > 0 && session ? (
                    <div className="mt-2">
                        <SkillSelector
                            skills={skills}
                            enabled={session.enabledSkills}
                            onChange={(s) => setEnabledSkills(session.id, s)}
                        />
                    </div>
                ) : null}
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
                <div className="mx-auto max-w-3xl space-y-4">
                    {!session?.messages.length ? (
                        <div className="flex h-40 items-center justify-center text-sm text-stone-400">
                            开始对话吧！启用 Skills 后，AI
                            可以帮你生成图片和视频。
                        </div>
                    ) : null}
                    {session?.messages.map((msg) => (
                        <ChatMessage
                            key={msg.id}
                            message={msg}
                            isExecutingSkill={
                                executingSkill?.messageId === msg.id
                            }
                            executingSkillName={executingSkill?.name}
                        />
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="border-t border-stone-200 bg-white px-4 py-3 dark:border-stone-700 dark:bg-stone-900">
                <div className="mx-auto flex max-w-3xl gap-2">
                    <Input.TextArea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        disabled={isRunning}
                        className="flex-1"
                    />
                    {isRunning ? (
                        <Button
                            icon={<Square className="size-4" />}
                            onClick={handleStop}
                            danger
                        >
                            停止
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            icon={<Send className="size-4" />}
                            onClick={() => void handleSend()}
                            disabled={!input.trim()}
                        >
                            发送
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
