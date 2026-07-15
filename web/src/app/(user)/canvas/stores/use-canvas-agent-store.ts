import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "../utils/canvas-agent-ops";

function readStoredAgentToken() {
    if (typeof window === "undefined") return "";
    const token = sessionStorage.getItem("canvas-agent-token") || localStorage.getItem("canvas-agent-token") || "";
    if (token) sessionStorage.setItem("canvas-agent-token", token);
    localStorage.removeItem("canvas-agent-token");
    return token;
}

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string; run?: boolean } & Record<string, unknown> };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";
export type AgentCanvasContext = {
    snapshot: CanvasAgentSnapshot;
    canUndoOps: boolean;
    applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps: () => CanvasAgentSnapshot | null;
};

type CanvasAgentStore = {
    width: number;
    panelOpen: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    connected: boolean;
    enabled: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    activity: string;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    setAgentState: (patch: Partial<Omit<CanvasAgentStore, "setAgentState" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext" | "addMessage" | "addEventLog" | "clearEventLogs">>) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const useCanvasAgentStore = create<CanvasAgentStore>((set) => ({
    width: typeof window === "undefined" ? 440 : Number(localStorage.getItem("canvas-agent-panel-width")) || 440,
    panelOpen: false,
    canvasContext: null,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: readStoredAgentToken(),
    connected: false,
    enabled: false,
    prompt: "",
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: true,
    activity: "就绪",
    connectError: "",
    pendingTool: null,
    setAgentState: (patch) => set(patch),
    openPanel: () => set({ panelOpen: true }),
    closePanel: () => set({ panelOpen: false }),
    togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
