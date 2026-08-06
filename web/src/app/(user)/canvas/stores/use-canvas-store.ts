import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { sanitizeCanvasAgentProtocolMessages } from "../agent/canvas-agent-protocol";
import { createCanvasAgentState } from "../agent/canvas-agent-runtime";
import type { CanvasAgentConfig, CanvasAgentPhase, CanvasAgentState, CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasPendingAgentRequest, ViewportTransform } from "../types";

export type CanvasSidePanelState = {
    open: boolean;
    width: number;
};

export const DEFAULT_CANVAS_SIDE_PANEL: CanvasSidePanelState = { open: true, width: 280 };
export const DEFAULT_CANVAS_AGENT_PANEL: CanvasSidePanelState = { open: false, width: 390 };

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    agentConfig: CanvasAgentConfig | null;
    autoTitlePending: boolean;
    pendingAgentRequest?: CanvasPendingAgentRequest;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    sidePanel: CanvasSidePanelState;
    agentPanel: CanvasSidePanelState;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string, options?: { agentConfig?: CanvasAgentConfig; pendingAgentRequest?: CanvasPendingAgentRequest }) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (
        id: string,
        patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "agentConfig" | "autoTitlePending" | "pendingAgentRequest" | "backgroundMode" | "showImageInfo" | "viewport" | "sidePanel" | "agentPanel">>,
    ) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布", options) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    agentConfig: options?.agentConfig || null,
                    autoTitlePending: true,
                    pendingAgentRequest: options?.pendingAgentRequest,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    sidePanel: { ...DEFAULT_CANVAS_SIDE_PANEL },
                    agentPanel: options?.pendingAgentRequest ? { ...DEFAULT_CANVAS_AGENT_PANEL, open: true } : { ...DEFAULT_CANVAS_AGENT_PANEL },
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = normalizeProject(
                    {
                        id: nanoid(),
                        title: source.title || "导入画布",
                        createdAt: source.createdAt || now,
                        updatedAt: now,
                        nodes: source.nodes || [],
                        connections: source.connections || [],
                        chatSessions: source.chatSessions || [],
                        activeChatId: source.activeChatId || null,
                        agentConfig: source.agentConfig || null,
                        autoTitlePending: false,
                        backgroundMode: source.backgroundMode || "lines",
                        showImageInfo: source.showImageInfo || false,
                        viewport: source.viewport || initialViewport,
                        sidePanel: source.sidePanel || { ...DEFAULT_CANVAS_SIDE_PANEL },
                        agentPanel: source.agentPanel || { ...DEFAULT_CANVAS_AGENT_PANEL },
                    },
                    false,
                );
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, autoTitlePending: false, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects: projects.map((project) => normalizeProject(project)) }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<CanvasStore>;
                return { ...currentState, ...persisted, projects: (persisted.projects || []).map((project) => normalizeProject(project)) };
            },
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

function normalizeProject(project: Partial<CanvasProject> & Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt">, preserveProtocolMessages = true): CanvasProject {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        nodes: project.nodes || [],
        connections: project.connections || [],
        chatSessions: normalizeCanvasSessions(project.chatSessions || [], preserveProtocolMessages),
        activeChatId: project.activeChatId || null,
        agentConfig: project.agentConfig || null,
        autoTitlePending: project.autoTitlePending === true,
        pendingAgentRequest: project.pendingAgentRequest,
        backgroundMode: project.backgroundMode || "lines",
        showImageInfo: project.showImageInfo === true,
        viewport: project.viewport || initialViewport,
        sidePanel: project.sidePanel || { ...DEFAULT_CANVAS_SIDE_PANEL },
        agentPanel: project.agentPanel || { ...DEFAULT_CANVAS_AGENT_PANEL },
    };
}

export function normalizeCanvasSessions(sessions: CanvasAssistantSession[], preserveProtocolMessages = true) {
    return sessions.map((session) => ({
        ...session,
        draftAssets: normalizeDraftAssets(session.draftAssets),
        messages: (session.messages || []).map((message) =>
            message.role === "assistant" && (message.status === "thinking" || message.status === "running")
                ? {
                      ...message,
                      text: message.text || "上次任务因页面关闭而中断。已完成的画布结果会保留，可以从这里重试继续。",
                      status: "waiting" as const,
                      activity: undefined,
                  }
                : message,
        ),
        agentState: normalizeCanvasAgentState(session.agentState),
        protocolMessages: preserveProtocolMessages ? sanitizeCanvasAgentProtocolMessages(session.protocolMessages) : [],
    }));
}

function normalizeDraftAssets(value: CanvasAssistantSession["draftAssets"]) {
    if (!Array.isArray(value)) return [];
    return value.filter((asset) => asset && typeof asset.nodeId === "string" && asset.nodeId.length > 0 && asset.reference?.id === asset.nodeId && asset.reference.origin === "attachment" && typeof asset.payload?.kind === "string");
}

function normalizeCanvasAgentState(value: CanvasAgentState | undefined): CanvasAgentState {
    const fallback = createCanvasAgentState();
    if (!value || typeof value !== "object") return fallback;
    const phases: CanvasAgentPhase[] = ["intake", "concept", "script", "breakdown", "references", "storyboard", "video", "audio", "review", "complete"];
    const strings = (input: unknown) => (Array.isArray(input) ? input.filter((item): item is string => typeof item === "string").slice(0, 200) : []);
    return {
        phase: phases.includes(value.phase) ? value.phase : fallback.phase,
        ...(typeof value.brief === "string" ? { brief: value.brief.slice(0, 32_000) } : {}),
        ...(typeof value.targetDurationSeconds === "number" && Number.isFinite(value.targetDurationSeconds) ? { targetDurationSeconds: value.targetDurationSeconds } : {}),
        ...(typeof value.approvedPlan === "string" ? { approvedPlan: value.approvedPlan.slice(0, 32_000) } : {}),
        approvedNodeIds: strings(value.approvedNodeIds),
        referenceNodeIds: strings(value.referenceNodeIds),
        pendingTaskIds: strings(value.pendingTaskIds),
        completedTaskIds: strings(value.completedTaskIds),
    };
}
