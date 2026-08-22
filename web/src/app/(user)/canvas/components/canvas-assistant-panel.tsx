"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, History, Minus, Plus, RotateCcw, Sparkles, Trash2, Video, X } from "lucide-react";
import { App, Button, Modal, Tooltip } from "antd";
import { motion } from "motion/react";
import { nanoid } from "nanoid";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ImageGenerationPending } from "@/components/image-generation-pending";
import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { deleteStoredMedia, uploadMediaFile } from "@/services/file-storage";
import { deleteStoredImages, imageToDataUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { decodeChannelModel, resolveCapabilityModel, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { createCanvasAgentState, runCanvasAgent } from "../agent/canvas-agent-runtime";
import { canvasAgentActionAttachmentIds, canvasAgentActionNeedsAttachmentMaterialization, canvasAgentSessionAssets, createPendingAgentAsset, mergeCanvasAssistantReferences } from "../agent/canvas-agent-attachments";
import type { CanvasAgentContext } from "../agent/canvas-agent-context";
import type { CanvasAgentAction, CanvasAgentToolResult } from "../agent/canvas-agent-tools";
import {
    CanvasNodeType,
    type CanvasAgentConfig,
    type CanvasAgentProtocolMessage,
    type CanvasAgentState,
    type CanvasAssistantMessage,
    type CanvasAssistantReference,
    type CanvasAssistantSession,
    type CanvasNodeData,
    type InsertAssetPayload,
    type PendingAgentAsset,
} from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-node-type";
import { AssetPickerModal } from "./asset-picker-modal";
import { AssistantReferenceChip, CanvasAssistantComposer } from "./canvas-assistant-composer";
const PANEL_MOTION_SECONDS = 0.25;

const FLOATING_AGENT_MIN_WIDTH = 320;
const FLOATING_AGENT_MIN_HEIGHT = 420;

export type CanvasAssistantBounds = { x: number; y: number; width: number; height: number };

function clampFloatingBounds(bounds: CanvasAssistantBounds): CanvasAssistantBounds {
    const viewportWidth = typeof window === "undefined" ? Math.max(bounds.width + 24, 1024) : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? Math.max(bounds.height + 24, 720) : window.innerHeight;
    const minWidth = Math.min(FLOATING_AGENT_MIN_WIDTH, Math.max(280, viewportWidth - 24));
    const minHeight = Math.min(FLOATING_AGENT_MIN_HEIGHT, Math.max(320, viewportHeight - 24));
    const width = Math.min(Math.max(bounds.width, minWidth), Math.max(minWidth, viewportWidth - 24));
    const height = Math.min(Math.max(bounds.height, minHeight), Math.max(minHeight, viewportHeight - 24));
    return {
        width,
        height,
        x: Math.max(12, Math.min(viewportWidth - width - 12, bounds.x)),
        y: Math.max(12, Math.min(viewportHeight - height - 12, bounds.y)),
    };
}

function initialFloatingBounds(width: number, height: number, position?: { x: number; y: number }): CanvasAssistantBounds {
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
    const safe = clampFloatingBounds({ x: position?.x ?? viewportWidth - width - 24, y: position?.y ?? viewportHeight - height - 24, width, height });
    return safe;
}

type FloatingInteraction = { kind: "drag" | "resize"; startX: number; startY: number; startBounds: CanvasAssistantBounds };

type CanvasAssistantPanelProps = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    sessions: CanvasAssistantSession[];
    activeSessionId: string | null;
    agentConfig: CanvasAgentConfig;
    open: boolean;
    width: number;
    height: number;
    position?: { x: number; y: number };
    onBoundsChange: (bounds: CanvasAssistantBounds) => void;
    onSelectNodeIds: (ids: Set<string>) => void;
    onSessionsChange: (sessions: CanvasAssistantSession[], activeSessionId: string | null) => void;
    onAgentConfigChange: (patch: Partial<CanvasAgentConfig>) => void;
    getAgentContext: (state: CanvasAgentState) => CanvasAgentContext;
    getCurrentNode: (nodeId: string) => CanvasNodeData | undefined;
    onExecuteAction: (action: CanvasAgentAction, messageReferenceNodeIds: string[], signal?: AbortSignal) => Promise<CanvasAgentToolResult>;
    onMaterializeReferences: (assets: PendingAgentAsset[], signal?: AbortSignal) => Promise<void>;
    onClose: () => void;
    initialRequest?: { prompt: string; references: CanvasAssistantReference[]; textModel?: string; textChannelId?: string } | null;
    onInitialRequestConsumed?: () => void;
};

type PendingDeleteConfirmation = {
    title: string;
    resolve: (confirmed: boolean) => void;
};

export function CanvasAssistantPanel({
    nodes,
    selectedNodeIds,
    sessions,
    activeSessionId,
    agentConfig,
    open,
    width,
    height,
    position,
    onBoundsChange,
    onSelectNodeIds,
    onSessionsChange,
    onAgentConfigChange,
    getAgentContext,
    getCurrentNode,
    onExecuteAction,
    onMaterializeReferences,
    onClose,
    initialRequest,
    onInitialRequestConsumed,
}: CanvasAssistantPanelProps) {
    const { message: toast } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const abortRef = useRef<AbortController | null>(null);
    const runningRef = useRef(false);
    const consumedInitialRequestRef = useRef<typeof initialRequest>(null);
    const pendingDeleteRef = useRef<PendingDeleteConfirmation | null>(null);
    const messageListRef = useRef<HTMLDivElement>(null);
    const attachmentCleanupTimerRef = useRef<number | null>(null);
    const attachmentCleanupRequestedRef = useRef(false);
    const mountedRef = useRef(true);
    const [view, setView] = useState<"chat" | "history">("chat");
    const [prompt, setPrompt] = useState("");
    const [isRunning, setIsRunning] = useState(false);
    const [checkedChatIds, setCheckedChatIds] = useState<string[]>([]);
    const [deleteChatIds, setDeleteChatIds] = useState<string[]>([]);
    const [removedReferenceIds, setRemovedReferenceIds] = useState<Set<string>>(new Set());
    const [pendingDelete, setPendingDelete] = useState<PendingDeleteConfirmation | null>(null);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [uploadingAssetCount, setUploadingAssetCount] = useState(0);
    const uploadingAssetCountRef = useRef(0);
    const [bounds, setBounds] = useState(() => initialFloatingBounds(width, height, position));
    const [interacting, setInteracting] = useState(false);
    const boundsRef = useRef(bounds);
    const interactionCleanupRef = useRef<(() => void) | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [initialSession] = useState(createSession);
    const safeSessions = sessions.length ? sessions : [initialSession];
    const resolvedActiveSessionId = activeSessionId && safeSessions.some((session) => session.id === activeSessionId) ? activeSessionId : safeSessions[0]?.id || null;
    const sessionsRef = useRef<CanvasAssistantSession[]>(safeSessions);
    const activeSessionIdRef = useRef<string | null>(resolvedActiveSessionId);

    useEffect(() => {
        boundsRef.current = bounds;
    }, [bounds]);

    useEffect(() => {
        setBounds(initialFloatingBounds(width, height, position));
    }, [height, position?.x, position?.y, width]);

    useEffect(() => () => interactionCleanupRef.current?.(), []);

    useEffect(() => {
        sessionsRef.current = safeSessions;
        activeSessionIdRef.current = resolvedActiveSessionId;
    }, [resolvedActiveSessionId, sessions]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
            pendingDeleteRef.current?.resolve(false);
            pendingDeleteRef.current = null;
        };
    }, []);

    const activeSession = safeSessions.find((session) => session.id === resolvedActiveSessionId) || safeSessions[0] || null;
    const historySessions = safeSessions.filter((session) => session.messages.length > 0);
    const messages = activeSession?.messages || [];
    const activeTextModel = resolveCapabilityModel(effectiveConfig, "text", activeSession?.textModel || effectiveConfig.textModel || effectiveConfig.model);
    const activeTextChannelId = activeSession?.textChannelId || decodeChannelModel(activeTextModel)?.channelId || effectiveConfig.textChannelId;
    const hasMessages = messages.length > 0;
    const selectedNodeKey = useMemo(() => Array.from(selectedNodeIds).sort().join(","), [selectedNodeIds]);

    useEffect(() => {
        if (view !== "chat") return;
        const frame = window.requestAnimationFrame(() => {
            const element = messageListRef.current;
            if (element) element.scrollTop = element.scrollHeight;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [messages, view]);
    const allSelectedReferences = useMemo(() => buildAssistantReferences(nodes, selectedNodeIds), [nodes, selectedNodeIds]);
    const selectedReferences = useMemo(() => allSelectedReferences.filter((item) => !removedReferenceIds.has(item.id)), [allSelectedReferences, removedReferenceIds]);
    const draftAssets = activeSession?.draftAssets || [];
    const draftReferences = useMemo(() => draftAssets.map((asset) => asset.reference), [draftAssets]);
    const composerReferences = useMemo(() => mergeCanvasAssistantReferences(selectedReferences, draftReferences), [draftReferences, selectedReferences]);
    const iconButtonStyle = { color: theme.node.muted };
    const settleDeleteConfirmation = (confirmed: boolean) => {
        const pending = pendingDeleteRef.current;
        if (!pending) return;
        pendingDeleteRef.current = null;
        setPendingDelete(null);
        pending.resolve(confirmed);
    };

    useEffect(() => {
        setRemovedReferenceIds(new Set());
    }, [resolvedActiveSessionId, selectedNodeKey]);

    const commitSessions = (nextSessions: CanvasAssistantSession[], nextActiveSessionId = activeSessionIdRef.current) => {
        sessionsRef.current = nextSessions;
        activeSessionIdRef.current = nextActiveSessionId;
        onSessionsChange(nextSessions, nextActiveSessionId);
    };

    const updateSession = (sessionId: string, updater: (session: CanvasAssistantSession) => CanvasAssistantSession) => {
        commitSessions(sessionsRef.current.map((session) => (session.id === sessionId ? updater(session) : session)));
    };
    const selectTextModel = (model: string, channelId: string | undefined) => {
        if (isRunning) return;
        const textModel = resolveCapabilityModel(effectiveConfig, "text", model);
        const textChannelId = channelId || decodeChannelModel(textModel)?.channelId || "";
        if (textModel === activeTextModel && textChannelId === activeTextChannelId) return;
        const sessionId = activeSessionIdRef.current || resolvedActiveSessionId;
        if (!sessionId) return;
        updateSession(sessionId, (current) => ({ ...current, textModel, textChannelId, updatedAt: new Date().toISOString() }));
    };

    const updateDraftAssets = (sessionId: string, updater: (assets: PendingAgentAsset[]) => PendingAgentAsset[]) => {
        updateSession(sessionId, (session) => ({ ...session, draftAssets: updater(session.draftAssets || []), updatedAt: new Date().toISOString() }));
    };

    const addDraftAsset = (payload: InsertAssetPayload, targetSessionId?: string) => {
        const sessionId = targetSessionId || activeSessionIdRef.current || resolvedActiveSessionId;
        if (!sessionId || !sessionsRef.current.some((session) => session.id === sessionId)) return false;
        updateDraftAssets(sessionId, (assets) => [...assets, createPendingAgentAsset(payload)]);
        return true;
    };

    const scheduleAttachmentCleanup = () => {
        attachmentCleanupRequestedRef.current = true;
        if (attachmentCleanupTimerRef.current) return;
        const run = () => {
            attachmentCleanupTimerRef.current = null;
            if (!attachmentCleanupRequestedRef.current) return;
            if (uploadingAssetCountRef.current > 0) {
                attachmentCleanupTimerRef.current = window.setTimeout(run, 500);
                return;
            }
            attachmentCleanupRequestedRef.current = false;
            cleanupImages({ sessions: sessionsRef.current });
        };
        attachmentCleanupTimerRef.current = window.setTimeout(run, 500);
    };

    const changeUploadingAssetCount = (delta: 1 | -1) => {
        if (delta > 0 && attachmentCleanupTimerRef.current) {
            clearTimeout(attachmentCleanupTimerRef.current);
            attachmentCleanupTimerRef.current = null;
        }
        uploadingAssetCountRef.current = Math.max(0, uploadingAssetCountRef.current + delta);
        if (delta < 0 && uploadingAssetCountRef.current === 0 && attachmentCleanupRequestedRef.current) scheduleAttachmentCleanup();
        if (mountedRef.current) {
            setUploadingAssetCount(uploadingAssetCountRef.current);
        }
    };

    const removeDraftAsset = (assetId: string) => {
        const sessionId = activeSessionIdRef.current || resolvedActiveSessionId;
        if (!sessionId) return;
        updateDraftAssets(sessionId, (assets) => assets.filter((asset) => asset.nodeId !== assetId));
        scheduleAttachmentCleanup();
    };

    const handleAssistantFile = async (file: File) => {
        const targetSessionId = activeSessionIdRef.current || resolvedActiveSessionId;
        if (!targetSessionId) return;
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
        if (!isImage && !isVideo && !isAudio) {
            toast.warning("请选择图片、视频或音频文件");
            return;
        }
        changeUploadingAssetCount(1);
        try {
            let payload: InsertAssetPayload;
            if (isImage) {
                const image = await uploadImage(file);
                payload = { kind: "image", dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType, title: file.name };
            } else {
                const media = await uploadMediaFile(file, isVideo ? "video" : "audio");
                payload = isVideo
                    ? { kind: "video", url: media.url, storageKey: media.storageKey, width: media.width, height: media.height, bytes: media.bytes, mimeType: media.mimeType, title: file.name }
                    : { kind: "audio", url: media.url, storageKey: media.storageKey, durationMs: media.durationMs, bytes: media.bytes, mimeType: media.mimeType, title: file.name };
            }
            if (!mountedRef.current || !addDraftAsset(payload, targetSessionId)) {
                if (payload.storageKey) {
                    if (payload.kind === "image") await deleteStoredImages([payload.storageKey]).catch(() => undefined);
                    else if (payload.kind === "video" || payload.kind === "audio") await deleteStoredMedia([payload.storageKey]).catch(() => undefined);
                }
                if (mountedRef.current) toast.info("原会话已删除，素材未添加");
                return;
            }
            toast.success("素材已添加到 Agent 输入框");
        } catch (error) {
            if (mountedRef.current) toast.error(error instanceof Error ? error.message : "素材上传失败");
        } finally {
            changeUploadingAssetCount(-1);
        }
    };

    const appendMessage = (sessionId: string, message: CanvasAssistantMessage) => {
        updateSession(sessionId, (session) => ({
            ...session,
            title: session.messages.length ? session.title : message.text.slice(0, 18) || "新对话",
            messages: [...session.messages, message],
            updatedAt: new Date().toISOString(),
        }));
    };

    const updateMessage = (sessionId: string, messageId: string, patch: Partial<CanvasAssistantMessage>) => {
        updateSession(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
            updatedAt: new Date().toISOString(),
        }));
    };

    const startChatSession = () => {
        if (activeSession && activeSession.messages.length === 0) {
            commitSessions(sessionsRef.current, activeSession.id);
            return;
        }
        const session = createSession();
        commitSessions([session, ...sessionsRef.current], session.id);
    };

    const removeSessions = (ids: string[]) => {
        const next = safeSessions.filter((session) => !ids.includes(session.id));
        if (!next.length) {
            const session = createSession();
            commitSessions([session], session.id);
        } else {
            const currentActiveSessionId = activeSessionIdRef.current;
            commitSessions(next, currentActiveSessionId && ids.includes(currentActiveSessionId) ? next[0].id : currentActiveSessionId);
        }
        scheduleAttachmentCleanup();
        setCheckedChatIds((previous) => previous.filter((id) => !ids.includes(id)));
    };

    const clearSessions = () => {
        const session = createSession();
        commitSessions([session], session.id);
        setCheckedChatIds([]);
        scheduleAttachmentCleanup();
    };

    const sendMessage = async (text: string, savedReferences?: CanvasAssistantReference[], baseProtocolMessages?: CanvasAgentProtocolMessage[], onAccepted?: () => void) => {
        if (runningRef.current) return;
        const references = savedReferences || composerReferences;
        if (!text.trim() && !references.length) return;
        runningRef.current = true;
        const session = sessionsRef.current.find((item) => item.id === (activeSessionIdRef.current || resolvedActiveSessionId)) || activeSession || createSession();
        if (!activeSession) {
            commitSessions([session], session.id);
        }

        const sessionSnapshot = sessionsRef.current.find((item) => item.id === session.id) || session;
        const knownAttachmentAssets = canvasAgentSessionAssets(sessionSnapshot, references);
        const attachmentAssets = new Map(knownAttachmentAssets.map((asset) => [asset.nodeId, asset]));
        const messageReferenceNodeIds = references.map((reference) => reference.id);
        const userMessage: CanvasAssistantMessage = { id: nanoid(), role: "user", text, references, status: "success" };
        const assistantId = nanoid();
        appendMessage(session.id, userMessage);
        appendMessage(session.id, { id: assistantId, role: "assistant", text: "", status: "thinking", activity: "正在理解画布和创作目标" });
        if (!savedReferences) {
            setPrompt("");
            updateDraftAssets(session.id, () => []);
        }
        onAccepted?.();

        const textModel = resolveCapabilityModel(effectiveConfig, "text", session.textModel || effectiveConfig.textModel || effectiveConfig.model);
        const textChannelId = session.textChannelId || decodeChannelModel(textModel)?.channelId || effectiveConfig.textChannelId;
        const requestConfig = {
            ...effectiveConfig,
            model: textModel,
            textModel,
            textChannelId,
            activeChannelId: textChannelId || effectiveConfig.activeChannelId,
        };
        if (!isAiConfigReady(requestConfig, requestConfig.model)) {
            openConfigDialog(true);
            updateMessage(session.id, assistantId, {
                text: "创作 Agent 文本模型尚未配置完成。请从上方选择文本模型，或先在全局配置中完成模型和渠道配置后再继续。",
                status: "error",
                activity: undefined,
            });
            runningRef.current = false;
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setIsRunning(true);
        try {
            const modelReferences = await Promise.all(
                references.map(async (reference) => {
                    if (!reference.dataUrl) return reference;
                    try {
                        return { ...reference, dataUrl: await imageToDataUrl(reference, controller.signal) };
                    } catch {
                        return reference;
                    }
                }),
            );
            const result = await runCanvasAgent({
                config: requestConfig,
                initialState: session.agentState,
                protocolMessages: baseProtocolMessages || session.protocolMessages,
                userText: text,
                references: modelReferences,
                getContext: getAgentContext,
                executeAction: async (action) => {
                    if (action.name === "delete_node") {
                        const nodeId = typeof action.arguments.nodeId === "string" ? action.arguments.nodeId : "";
                        const node = getCurrentNode(nodeId) || nodes.find((item) => item.id === nodeId);
                        const attachment = attachmentAssets.get(nodeId);
                        const confirmed = await new Promise<boolean>((resolve) => {
                            const pending = { title: node?.title || attachment?.reference.title || "未命名节点", resolve };
                            pendingDeleteRef.current = pending;
                            setPendingDelete(pending);
                        });
                        if (!confirmed) return { ok: false, code: "delete_cancelled", message: "用户取消删除，原节点已保留" };
                    }
                    const attachmentIds = canvasAgentActionNeedsAttachmentMaterialization(action) ? canvasAgentActionAttachmentIds(action, knownAttachmentAssets) : [];
                    if (attachmentIds.length) await onMaterializeReferences(attachmentIds.map((id) => attachmentAssets.get(id)!).filter(Boolean), controller.signal);
                    return onExecuteAction(action, messageReferenceNodeIds, controller.signal);
                },
                signal: controller.signal,
                onEvent: (event) => updateMessage(session.id, assistantId, { status: event.status, activity: event.label }),
                onCheckpoint: (checkpoint) =>
                    updateSession(session.id, (current) => ({
                        ...current,
                        agentState: checkpoint.state,
                        protocolMessages: checkpoint.protocolMessages,
                        updatedAt: new Date().toISOString(),
                    })),
            });
            updateSession(session.id, (current) => ({
                ...current,
                agentState: result.state,
                protocolMessages: result.protocolMessages,
                messages: current.messages.map((message) => (message.id === assistantId ? { ...message, text: result.reply, status: "success", activity: undefined } : message)),
                updatedAt: new Date().toISOString(),
            }));
        } catch (error) {
            const stopped = error instanceof Error && error.name === "AbortError";
            updateMessage(session.id, assistantId, {
                text: stopped ? "已停止继续执行。已经生成完成的节点会保留，未完成的请求已停止。" : error instanceof Error ? error.message : "Agent 执行失败",
                status: stopped ? "waiting" : "error",
                activity: undefined,
            });
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
                runningRef.current = false;
                setIsRunning(false);
            }
        }
    };

    useEffect(() => {
        if (!initialRequest || consumedInitialRequestRef.current === initialRequest || (!initialRequest.prompt.trim() && !initialRequest.references.length)) return;
        if (runningRef.current) return;
        const targetSessionId = activeSessionIdRef.current || sessionsRef.current[0]?.id;
        if (targetSessionId && initialRequest.textModel) {
            updateSession(targetSessionId, (current) => ({
                ...current,
                textModel: initialRequest.textModel,
                textChannelId: initialRequest.textChannelId || decodeChannelModel(initialRequest.textModel)?.channelId || "",
                updatedAt: new Date().toISOString(),
            }));
        }
        void sendMessage(initialRequest.prompt, initialRequest.references, undefined, () => {
            consumedInitialRequestRef.current = initialRequest;
            onInitialRequestConsumed?.();
        });
    }, [initialRequest, onInitialRequestConsumed]);

    const submit = async () => {
        const text = prompt.trim();
        if ((!text && !composerReferences.length) || isRunning) return;
        await sendMessage(text);
    };

    const retryMessage = (message: CanvasAssistantMessage) => {
        if (isRunning || runningRef.current) return;
        const index = messages.findIndex((item) => item.id === message.id);
        const user = messages.slice(0, index).findLast((item) => item.role === "user");
        if (!user) return;
        const protocolMessages = activeSession?.protocolMessages || [];
        void sendMessage(user.text, user.references, protocolMessages.slice(0, findProtocolTurnStart(protocolMessages, user.text)));
    };

    const updateBounds = (next: CanvasAssistantBounds) => {
        const clamped = clampFloatingBounds(next);
        boundsRef.current = clamped;
        setBounds(clamped);
    };

    const beginInteraction = (event: ReactPointerEvent<HTMLElement>, kind: FloatingInteraction["kind"]) => {
        if (!open) return;
        event.preventDefault();
        event.stopPropagation();
        interactionCleanupRef.current?.();
        const startBounds = boundsRef.current;
        const startX = event.clientX;
        const startY = event.clientY;
        const move = (moveEvent: PointerEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;
            updateBounds(kind === "drag" ? { ...startBounds, x: startBounds.x + deltaX, y: startBounds.y + deltaY } : { ...startBounds, width: startBounds.width + deltaX, height: startBounds.height + deltaY });
        };
        const stop = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", stop);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            interactionCleanupRef.current = null;
            setInteracting(false);
            onBoundsChange(boundsRef.current);
        };
        interactionCleanupRef.current = stop;
        setInteracting(true);
        document.body.style.userSelect = "none";
        document.body.style.cursor = kind === "drag" ? "grabbing" : "se-resize";
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop);
    };

    const close = () => {
        settleDeleteConfirmation(false);
        setAssetPickerOpen(false);
        onClose();
    };

    useEffect(() => {
        const clampOnResize = () => {
            const next = clampFloatingBounds(boundsRef.current);
            boundsRef.current = next;
            setBounds(next);
            onBoundsChange(next);
        };
        window.addEventListener("resize", clampOnResize);
        return () => window.removeEventListener("resize", clampOnResize);
    }, [onBoundsChange]);

    return (
        <motion.div
            className="fixed z-[140] max-w-[calc(100vw-24px)]"
            initial={false}
            animate={{ opacity: open ? 1 : 0, scale: open ? 1 : 0.96, y: open ? 0 : 16 }}
            transition={{ duration: interacting ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden={!open}
            style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, pointerEvents: open ? "auto" : "none", visibility: open ? "visible" : "hidden" }}
        >
            <motion.aside
                className="relative flex h-full w-full flex-col overflow-hidden rounded-[26px] border shadow-[0_24px_90px_rgba(28,25,23,.24)] backdrop-blur-2xl"
                initial={false}
                animate={{ x: 0 }}
                style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text, backdropFilter: "blur(24px) saturate(145%)" }}
            >
                <div
                    className="flex shrink-0 cursor-grab items-center justify-between border-b px-4 py-3 active:cursor-grabbing"
                    style={{ borderColor: theme.node.stroke }}
                    onPointerDown={(event) => {
                        if ((event.target as HTMLElement).closest("button")) return;
                        beginInteraction(event, "drag");
                    }}
                >
                    <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <Bot className="size-4 shrink-0" />
                        <span className="shrink-0">{view === "history" ? "历史记录" : "创作 Agent"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        {view === "history" ? (
                            <>
                                <Tooltip title="删除选中">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!h-8 !w-8 !min-w-8"
                                        style={iconButtonStyle}
                                        icon={<Trash2 className="size-4" />}
                                        disabled={isRunning || !checkedChatIds.length}
                                        onClick={() => setDeleteChatIds(checkedChatIds)}
                                    />
                                </Tooltip>
                                <Tooltip title="删除全部">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!h-8 !w-8 !min-w-8"
                                        style={iconButtonStyle}
                                        icon={<X className="size-4" />}
                                        disabled={isRunning || !historySessions.length}
                                        onClick={() => setDeleteChatIds(historySessions.map((session) => session.id))}
                                    />
                                </Tooltip>
                            </>
                        ) : null}
                        <Tooltip title={view === "history" ? "返回对话" : "历史记录"}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={iconButtonStyle}
                                icon={<History className="size-4" />}
                                disabled={isRunning}
                                onClick={() => setView(view === "history" ? "chat" : "history")}
                                aria-label={view === "history" ? "返回对话" : "历史记录"}
                            />
                        </Tooltip>
                        <Tooltip title="新对话">
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={iconButtonStyle}
                                icon={<Plus className="size-4" />}
                                disabled={isRunning || !hasMessages}
                                onClick={() => {
                                    startChatSession();
                                    setView("chat");
                                }}
                                aria-label="新对话"
                            />
                        </Tooltip>
                        <Tooltip title="最小化 Agent">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<Minus className="size-4" />} onClick={close} aria-label="最小化 Agent" />
                        </Tooltip>
                        <Tooltip title="关闭 Agent">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={iconButtonStyle} icon={<X className="size-4" />} onClick={close} aria-label="关闭 Agent" />
                        </Tooltip>
                    </div>
                </div>

                <div ref={messageListRef} className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                    {view === "history" ? (
                        <AssistantHistory
                            sessions={historySessions}
                            activeSession={activeSession}
                            disabled={isRunning}
                            checkedIds={checkedChatIds.filter((id) => historySessions.some((session) => session.id === id))}
                            onToggleChecked={(id, checked) => setCheckedChatIds((previous) => (checked ? [...new Set([...previous, id])] : previous.filter((item) => item !== id)))}
                            onOpen={(id) => {
                                commitSessions(sessionsRef.current, id);
                                setView("chat");
                            }}
                            onDelete={(id) => setDeleteChatIds([id])}
                        />
                    ) : messages.length ? (
                        <AssistantMessages messages={messages} isRunning={isRunning} onRetry={retryMessage} />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                            <div className="grid size-12 place-items-center rounded-2xl" style={{ background: theme.node.fill }}>
                                <Sparkles className="size-5" />
                            </div>
                            <div className="mt-4 text-base font-medium">从一个想法开始</div>
                            <div className="mt-2 max-w-[260px] text-sm leading-6 opacity-55">描述故事、宣传片或现有素材，Agent 会与你沟通并直接操作当前画布</div>
                        </div>
                    )}
                </div>

                {view === "chat" ? (
                    <>
                        {pendingDelete ? (
                            <div className="mx-2 mb-2 overflow-hidden rounded-xl border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                <div className="min-w-0 px-3 py-2.5">
                                    <div className="truncate text-sm font-medium">删除「{pendingDelete.title}」？</div>
                                    <div className="mt-0.5 text-xs opacity-55">相关连线和任务记录将按现有逻辑清理</div>
                                </div>
                                <div className="grid grid-cols-2 border-t" style={{ borderColor: theme.node.stroke }}>
                                    <button type="button" className="h-9 cursor-pointer border-0 bg-transparent text-sm" style={{ color: theme.node.text }} onClick={() => settleDeleteConfirmation(false)}>
                                        取消
                                    </button>
                                    <button type="button" className="h-9 cursor-pointer border-0 border-l bg-transparent text-sm font-medium" style={{ borderColor: theme.node.stroke, color: "#ef4444" }} onClick={() => settleDeleteConfirmation(true)}>
                                        确认删除
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        <CanvasAssistantComposer
                            textModel={activeTextModel}
                            textChannelId={activeTextChannelId}
                            onTextModelChange={selectTextModel}
                            prompt={prompt}
                            isRunning={isRunning}
                            submitDisabled={uploadingAssetCount > 0}
                            references={composerReferences}
                            agentConfig={agentConfig}
                            onAgentConfigChange={onAgentConfigChange}
                            onPromptChange={setPrompt}
                            onSubmit={submit}
                            onStop={() => {
                                settleDeleteConfirmation(false);
                                abortRef.current?.abort();
                            }}
                            onOpenUpload={() => uploadInputRef.current?.click()}
                            onOpenAssets={() => setAssetPickerOpen(true)}
                            onRemoveReference={(id) => {
                                if (draftAssets.some((asset) => asset.nodeId === id)) {
                                    removeDraftAsset(id);
                                    return;
                                }
                                setRemovedReferenceIds((previous) => new Set(previous).add(id));
                                if (selectedNodeIds.has(id)) onSelectNodeIds(new Set(Array.from(selectedNodeIds).filter((nodeId) => nodeId !== id)));
                            }}
                            onPasteImage={(file) => void handleAssistantFile(file)}
                        />
                    </>
                ) : null}

                <Modal
                    title="删除对话记录？"
                    open={deleteChatIds.length > 0}
                    centered
                    onCancel={() => setDeleteChatIds([])}
                    footer={
                        <>
                            <Button onClick={() => setDeleteChatIds([])}>取消</Button>
                            <Button
                                danger
                                type="primary"
                                disabled={isRunning}
                                onClick={() => {
                                    deleteChatIds.length === historySessions.length ? clearSessions() : removeSessions(deleteChatIds);
                                    setDeleteChatIds([]);
                                }}
                            >
                                删除
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">将删除 {deleteChatIds.length} 条对话记录，此操作不可撤销</p>
                </Modal>
                <AssetPickerModal
                    open={assetPickerOpen}
                    defaultTab="my-assets"
                    onUploadBusyChange={changeUploadingAssetCount}
                    onInsert={(payload) => {
                        addDraftAsset(payload);
                        setAssetPickerOpen(false);
                    }}
                    onClose={() => setAssetPickerOpen(false)}
                />
                <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac"
                    className="hidden"
                    disabled={uploadingAssetCount > 0}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void handleAssistantFile(file);
                    }}
                />
                <button
                    type="button"
                    className="absolute bottom-1 right-1 z-20 hidden size-4 cursor-se-resize rounded-sm opacity-35 transition hover:opacity-80 md:block"
                    onPointerDown={(event) => beginInteraction(event, "resize")}
                    aria-label="调整 Agent 窗口大小"
                />
            </motion.aside>
        </motion.div>
    );
}
export function CanvasAssistantLauncher({ onOpen }: { onOpen: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <motion.button
            type="button"
            data-canvas-agent-launcher
            className="fixed bottom-20 right-4 z-[130] inline-flex items-center gap-2 rounded-full border px-2.5 py-2 shadow-[0_16px_42px_rgba(28,25,23,.22)] backdrop-blur-xl transition sm:bottom-6 sm:right-6"
            style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onOpen();
            }}
            aria-label="打开创作 Agent"
            title="打开创作 Agent"
        >
            <span className="relative grid size-9 place-items-center rounded-full" style={{ background: theme.toolbar.activeBg, color: theme.node.activeStroke }}>
                <Bot className="size-4" />
                <span className="absolute right-0.5 top-0.5 size-2 rounded-full border" style={{ background: "#10b981", borderColor: theme.toolbar.panel }} />
            </span>
            <span className="hidden pr-1 text-[11px] font-semibold uppercase tracking-[0.18em] sm:inline">Agent</span>
        </motion.button>
    );
}

const ASSISTANT_MARKDOWN_COMPONENTS: Components = {
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4" />,
};

function AssistantMarkdown({ children }: { children: string }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={cn(
                "min-w-0 whitespace-normal break-words",
                "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
                "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h1:first-child]:mt-0",
                "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2:first-child]:mt-0",
                "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:font-semibold [&_h3:first-child]:mt-0",
                "[&_h4]:my-2 [&_h4]:font-semibold",
                "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
                "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--agent-markdown-border)] [&_blockquote]:pl-3 [&_blockquote]:opacity-80",
                "[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-[color:var(--agent-markdown-border)]",
                "[&_code]:rounded [&_code]:bg-[var(--agent-markdown-surface)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
                "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[var(--agent-markdown-surface)] [&_pre]:p-3",
                "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border-b [&_th]:border-[color:var(--agent-markdown-border)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--agent-markdown-border)] [&_td]:px-2 [&_td]:py-1.5",
            )}
            style={
                {
                    "--agent-markdown-surface": theme.toolbar.itemHover,
                    "--agent-markdown-border": theme.node.stroke,
                } as CSSProperties
            }
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={ASSISTANT_MARKDOWN_COMPONENTS} skipHtml>
                {children}
            </ReactMarkdown>
        </div>
    );
}

function AssistantMessages({ messages, isRunning, onRetry }: { messages: CanvasAssistantMessage[]; isRunning: boolean; onRetry: (message: CanvasAssistantMessage) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const latestAssistantId = messages.findLast((message) => message.role === "assistant")?.id;

    return (
        <>
            {messages.map((message) => {
                const running = message.status === "thinking" || message.status === "running";
                return (
                    <div key={message.id} className={cn("flex flex-col gap-2", message.role === "user" ? "items-end" : "items-start")}>
                        {message.text ? (
                            <div
                                className="max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6"
                                style={
                                    message.role === "user"
                                        ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText }
                                        : message.status === "error"
                                          ? { background: theme.node.fill, color: theme.node.text }
                                          : { background: theme.node.fill, color: theme.node.text }
                                }
                            >
                                {message.role === "assistant" ? (
                                    <div className="mb-1 flex items-center gap-1.5 text-xs opacity-60">
                                        <Bot className="size-3.5" />
                                        Agent
                                    </div>
                                ) : null}
                                {message.role === "assistant" ? <AssistantMarkdown>{message.text}</AssistantMarkdown> : message.text}
                            </div>
                        ) : null}
                        {message.references?.length ? <MessageReferences message={message} /> : null}
                        {running ? <ImageGenerationPending compact label={message.activity || "正在执行"} className="w-[250px] rounded-2xl border" /> : null}
                        {message.id === latestAssistantId && !running && message.text ? (
                            <Button shape="circle" size="small" style={{ borderColor: theme.node.stroke }} icon={<RotateCcw className="size-3.5" />} disabled={isRunning} onClick={() => onRetry(message)} title="重试" />
                        ) : null}
                    </div>
                );
            })}
        </>
    );
}

function AssistantHistory({
    sessions,
    activeSession,
    disabled,
    checkedIds,
    onToggleChecked,
    onOpen,
    onDelete,
}: {
    sessions: CanvasAssistantSession[];
    activeSession: CanvasAssistantSession | null;
    disabled: boolean;
    checkedIds: string[];
    onToggleChecked: (id: string, checked: boolean) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className="space-y-1">
            {sessions.map((session) => (
                <div key={session.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition" style={session.id === activeSession?.id ? { background: theme.node.fill } : undefined}>
                    <input type="checkbox" className="size-4" style={{ accentColor: theme.node.text }} checked={checkedIds.includes(session.id)} disabled={disabled} onChange={(event) => onToggleChecked(session.id, event.target.checked)} />
                    <button type="button" className="min-w-0 flex-1 text-left text-sm" disabled={disabled} onClick={() => onOpen(session.id)}>
                        <span className="block truncate">{session.title}</span>
                        <span className="text-xs opacity-50">{session.messages.length} 条消息</span>
                    </button>
                    <Button type="text" shape="circle" size="small" className="opacity-0 transition group-hover:opacity-100" icon={<Trash2 className="size-3.5" />} disabled={disabled} onClick={() => onDelete(session.id)} title="删除" />
                </div>
            ))}
        </div>
    );
}

function MessageReferences({ message }: { message: CanvasAssistantMessage }) {
    return (
        <div className={cn("flex max-w-[88%] flex-wrap gap-2", message.role === "user" ? "justify-end" : "justify-start")}>
            {message.references?.map((item) => (
                <AssistantReferenceChip key={item.id} item={item} />
            ))}
        </div>
    );
}

function nodeToReference(node: CanvasNodeData): CanvasAssistantReference | null {
    if (isCanvasImageNodeType(node.type) && node.metadata?.content) {
        return {
            id: node.id,
            type: node.type,
            title: node.title,
            origin: "canvas",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
            mimeType: node.metadata.mimeType,
            width: node.metadata.naturalWidth || node.width,
            height: node.metadata.naturalHeight || node.height,
            bytes: node.metadata.bytes,
        };
    }
    if (node.type === CanvasNodeType.Text && node.metadata?.content) {
        return { id: node.id, type: node.type, title: node.title, origin: "canvas", text: node.metadata.content };
    }
    if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.content) {
        return {
            id: node.id,
            type: node.type,
            title: node.title,
            origin: "canvas",
            url: node.metadata.content,
            storageKey: node.metadata.storageKey,
            mimeType: node.metadata.mimeType,
            width: node.metadata.naturalWidth || node.width,
            height: node.metadata.naturalHeight || node.height,
            bytes: node.metadata.bytes,
            durationMs: node.metadata.durationMs,
        };
    }
    return null;
}

function buildAssistantReferences(nodes: CanvasNodeData[], selectedNodeIds: Set<string>) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return Array.from(selectedNodeIds)
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .map(nodeToReference)
        .filter((item): item is CanvasAssistantReference => Boolean(item));
}

function findProtocolTurnStart(messages: CanvasAgentProtocolMessage[], userText: string) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user") continue;
        const content =
            typeof message.content === "string"
                ? message.content
                : message.content
                      .filter((item) => item.type === "text")
                      .map((item) => item.text)
                      .join("\n");
        if (content === userText || content.startsWith(userText + "\n\n本次明确引用的真实节点：") || content.startsWith(userText + "\n\n本次明确附加的素材：")) return index;
    }
    return messages.length;
}

function createSession(textModel = "", textChannelId = ""): CanvasAssistantSession {
    const now = new Date().toISOString();
    return {
        id: nanoid(),
        title: "新对话",
        messages: [],
        ...(textModel ? { textModel } : {}),
        ...(textChannelId ? { textChannelId } : {}),
        draftAssets: [],
        agentState: createCanvasAgentState(),
        protocolMessages: [],
        createdAt: now,
        updatedAt: now,
    };
}
