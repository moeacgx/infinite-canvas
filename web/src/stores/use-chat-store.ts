"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { AgentMessage } from "@/services/agent/agent-engine";
import type { SkillResult } from "@/services/agent/skill-executor";

export type ChatSession = {
    id: string;
    title: string;
    messages: AgentMessage[];
    enabledSkills: string[];
    createdAt: string;
};

type ChatStore = {
    sessions: ChatSession[];
    activeSessionId: string | null;
    createSession: () => string;
    deleteSession: (id: string) => void;
    setActiveSession: (id: string | null) => void;
    activeSession: () => ChatSession | undefined;
    addMessage: (sessionId: string, msg: AgentMessage) => void;
    updateMessage: (sessionId: string, messageId: string, updates: Partial<AgentMessage>) => void;
    setEnabledSkills: (sessionId: string, skills: string[]) => void;
    setSessionTitle: (sessionId: string, title: string) => void;
    clearMessages: (sessionId: string) => void;
};

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            sessions: [],
            activeSessionId: null,
            createSession: () => {
                const id = nanoid();
                const session: ChatSession = {
                    id,
                    title: "新对话",
                    messages: [],
                    enabledSkills: ["generate_image", "generate_video", "generate_audio"],
                    createdAt: new Date().toISOString(),
                };
                set((state) => ({
                    sessions: [session, ...state.sessions],
                    activeSessionId: id,
                }));
                return id;
            },
            deleteSession: (id) =>
                set((state) => ({
                    sessions: state.sessions.filter((s) => s.id !== id),
                    activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
                })),
            setActiveSession: (id) => set({ activeSessionId: id }),
            activeSession: () => {
                const state = get();
                return state.sessions.find((s) => s.id === state.activeSessionId);
            },
            addMessage: (sessionId, msg) =>
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s
                    ),
                })),
            updateMessage: (sessionId, messageId, updates) =>
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId
                            ? {
                                  ...s,
                                  messages: s.messages.map((m) =>
                                      m.id === messageId ? { ...m, ...updates } : m
                                  ),
                              }
                            : s
                    ),
                })),
            setEnabledSkills: (sessionId, skills) =>
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId ? { ...s, enabledSkills: skills } : s
                    ),
                })),
            setSessionTitle: (sessionId, title) =>
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId ? { ...s, title } : s
                    ),
                })),
            clearMessages: (sessionId) =>
                set((state) => ({
                    sessions: state.sessions.map((s) =>
                        s.id === sessionId ? { ...s, messages: [] } : s
                    ),
                })),
        }),
        {
            name: "infinite-canvas:chat_store",
            partialize: (state) => ({
                ...state,
                // Strip skillResults (base64 images) before persisting to avoid localStorage overflow
                sessions: state.sessions.map((s) => ({
                    ...s,
                    messages: s.messages.map((m) => {
                        if (m.skillResults?.length) {
                            const { skillResults, ...rest } = m;
                            return rest;
                        }
                        return m;
                    }),
                })),
            }),
        }
    )
);
