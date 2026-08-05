import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasAgentState, type CanvasConnection, type CanvasNodeData, type CanvasNodeTypeId } from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-node-type";

export type CanvasAgentContextNode = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    text?: string;
    mediaUrl?: string;
    hasMedia?: boolean;
    status?: string;
    prompt?: string;
    model?: string;
    size?: string;
    seconds?: string;
    generateAudio?: string;
    taskId?: string;
    error?: string;
    groupId?: string;
};

export type CanvasAgentContext = {
    project: {
        id: string;
        title: string;
        nodeCount: number;
        connectionCount: number;
    };
    agentState: CanvasAgentState;
    selectedNodeIds: string[];
    nodes: CanvasAgentContextNode[];
    connections: CanvasConnection[];
    generation: {
        channelMode: AiConfig["channelMode"];
        textModel: string;
        imageModel: string;
        videoModel: string;
        audioModel: string;
        imageChannelId: string;
        videoChannelId: string;
        imageApiMode: string;
        imageQuality: string;
        imageSize: string;
        videoQuality: string;
        videoSize: string;
        imageCount: string;
        imageBackground: string;
        videoSeconds: string;
        videoGenerateAudio: string;
        videoMode: string;
        videoWatermark: string;
        audioVoice: string;
        audioFormat: string;
    };
    tasks: Array<{
        nodeId: string;
        type: CanvasNodeTypeId;
        status: string;
        taskId: string;
        progress?: number;
        error?: string;
    }>;
};

type BuildCanvasAgentContextInput = {
    projectId: string;
    projectTitle: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Iterable<string>;
    config: AiConfig & { videoSize: string };
    agentState: CanvasAgentState;
};

const MAX_CONTEXT_NODES = 120;
const MAX_TEXT_LENGTH = 4000;
const MAX_CONTEXT_NODE_CHARACTERS = 48_000;
const MAX_CONTEXT_CONNECTION_CHARACTERS = 8_000;

export function buildCanvasAgentContext(input: BuildCanvasAgentContextInput): CanvasAgentContext {
    const selectedNodeIds = Array.from(input.selectedNodeIds);
    const prioritizedIds = new Set<string>([...selectedNodeIds, ...input.agentState.approvedNodeIds, ...input.agentState.referenceNodeIds]);
    input.connections.forEach((connection) => {
        if (prioritizedIds.has(connection.fromNodeId) || prioritizedIds.has(connection.toNodeId)) {
            prioritizedIds.add(connection.fromNodeId);
            prioritizedIds.add(connection.toNodeId);
        }
    });
    input.nodes.forEach((node) => {
        if (node.metadata?.status === "loading" || node.metadata?.status === "error") prioritizedIds.add(node.id);
    });

    const candidateNodes = [...input.nodes.filter((node) => prioritizedIds.has(node.id)), ...input.nodes.filter((node) => !prioritizedIds.has(node.id))].slice(0, MAX_CONTEXT_NODES);
    const orderedNodes = takeWithinCharacterBudget(candidateNodes.map(summarizeNode), MAX_CONTEXT_NODE_CHARACTERS);
    const includedIds = new Set(orderedNodes.map((node) => node.id));
    const includedSourceNodes = candidateNodes.filter((node) => includedIds.has(node.id));
    const videoModel = input.config.videoModel || input.config.model;
    const connections = takeWithinCharacterBudget(
        input.connections.filter((connection) => includedIds.has(connection.fromNodeId) && includedIds.has(connection.toNodeId)),
        MAX_CONTEXT_CONNECTION_CHARACTERS,
    );

    return {
        project: {
            id: input.projectId,
            title: input.projectTitle,
            nodeCount: input.nodes.length,
            connectionCount: input.connections.length,
        },
        agentState: input.agentState,
        selectedNodeIds,
        nodes: orderedNodes,
        connections,
        generation: {
            channelMode: input.config.channelMode,
            textModel: input.config.textModel || input.config.model,
            imageModel: input.config.imageModel || input.config.model,
            videoModel,
            audioModel: input.config.audioModel,
            imageChannelId: input.config.imageChannelId,
            videoChannelId: input.config.videoChannelId,
            imageApiMode: input.config.apiMode,
            imageQuality: input.config.quality,
            imageSize: input.config.size,
            videoQuality: input.config.vquality,
            videoSize: input.config.videoSize,
            imageCount: input.config.canvasImageCount || input.config.count,
            imageBackground: input.config.background,
            videoSeconds: input.config.videoSeconds,
            videoGenerateAudio: input.config.videoGenerateAudio,
            videoMode: input.config.videoMode,
            videoWatermark: input.config.videoWatermark,
            audioVoice: input.config.audioVoice,
            audioFormat: input.config.audioFormat,
        },
        tasks: includedSourceNodes.flatMap((node) => {
            const taskId = mediaTaskId(node);
            if (!taskId) return [];
            return [
                {
                    nodeId: node.id,
                    type: node.type,
                    status: node.metadata?.status || "idle",
                    taskId,
                    progress: node.metadata?.progress,
                    error: node.metadata?.errorDetails,
                },
            ];
        }),
    };
}

function takeWithinCharacterBudget<T>(items: T[], budget: number) {
    const selected: T[] = [];
    let used = 0;
    for (const item of items) {
        const size = JSON.stringify(item).length + 1;
        if (used + size > budget) continue;
        selected.push(item);
        used += size;
    }
    return selected;
}

export function serializeCanvasAgentContext(context: CanvasAgentContext) {
    return JSON.stringify(context);
}

function summarizeNode(node: CanvasNodeData): CanvasAgentContextNode {
    const content = node.metadata?.content || "";
    const isText = node.type === CanvasNodeType.Text;
    const mediaUrl = !isText && content && !content.startsWith("data:") ? content : undefined;
    return {
        id: node.id,
        type: node.type,
        title: node.title,
        text: isText && content ? content.slice(0, MAX_TEXT_LENGTH) : undefined,
        mediaUrl,
        hasMedia: !isText ? Boolean(content) : undefined,
        status: node.metadata?.status,
        prompt: node.metadata?.prompt?.slice(0, MAX_TEXT_LENGTH),
        model: node.metadata?.model,
        size: node.metadata?.size,
        seconds: node.metadata?.seconds,
        generateAudio: node.metadata?.generateAudio,
        taskId: mediaTaskId(node) || undefined,
        error: node.metadata?.errorDetails,
        groupId: node.metadata?.groupId,
    };
}

function mediaTaskId(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Video) return node.metadata?.videoTaskId || "";
    if (node.type === CanvasNodeType.Audio) return node.metadata?.audioTaskId || "";
    if (isCanvasImageNodeType(node.type)) return node.metadata?.imageTaskId || "";
    return "";
}
