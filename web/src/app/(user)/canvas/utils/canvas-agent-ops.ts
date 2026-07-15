import { nanoid } from "nanoid";

import { getNodeSpec } from "../constants";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from "../types";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeType; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeType }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

const MAX_AGENT_OPS = 100;
const MAX_COORDINATE = 1_000_000;
const MIN_NODE_SIZE = 48;
const MAX_NODE_SIZE = 8192;
const METADATA_KEYS = new Set<keyof CanvasNodeMetadata>([
    "content", "composerContent", "prompt", "status", "errorDetails", "fontSize", "generationMode", "generationType", "model", "modelOverride", "size", "quality", "count", "seconds", "vquality", "generateAudio", "watermark", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions", "references", "naturalWidth", "naturalHeight", "freeResize", "isBatchRoot", "batchRootId", "batchChildIds", "batchUsesReferenceImages", "primaryImageId", "imageBatchExpanded", "storageKey", "mimeType", "bytes", "durationMs", "groupId",
]);

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    (Array.isArray(ops) ? ops.slice(0, MAX_AGENT_OPS) : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = Object.values(CanvasNodeType).includes(op.nodeType as CanvasNodeType) ? op.nodeType! : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const requestedId = safeId(op.id);
            const id = requestedId && !nodes.some((item) => item.id === requestedId) ? requestedId : `${nodeType}-${nanoid()}`;
            const node: CanvasNodeData = {
                id,
                type: nodeType,
                title: safeText(op.title, 128) || spec.title,
                position: safePosition(op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 }, { x: index * 36, y: index * 36 }),
                width: safeNumber(op.width, spec.width, MIN_NODE_SIZE, MAX_NODE_SIZE),
                height: safeNumber(op.height, spec.height, MIN_NODE_SIZE, MAX_NODE_SIZE),
                metadata: { ...spec.metadata, ...safeMetadata(op.metadata) },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            const id = safeId(op.id);
            if (!id) return;
            nodes = nodes.map((node) => {
                if (node.id !== id) return node;
                const patch = op.patch || {};
                return {
                    ...node,
                    title: safeText(patch.title, 128) || node.title,
                    position: patch.position ? safePosition(patch.position, node.position) : node.position,
                    width: safeNumber(patch.width, node.width, MIN_NODE_SIZE, MAX_NODE_SIZE),
                    height: safeNumber(patch.height, node.height, MIN_NODE_SIZE, MAX_NODE_SIZE),
                    metadata: { ...node.metadata, ...safeMetadata(patch.metadata), ...safeMetadata(op.metadata) },
                };
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set((op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : [])).map(safeId).filter((id): id is string => Boolean(id)));
            nodes = nodes
                .filter((node) => !ids.has(node.id))
                .map((node) => (node.metadata?.groupId && ids.has(node.metadata.groupId) ? { ...node, metadata: { ...node.metadata, groupId: undefined } } : node));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set((op.ids || (op.id ? [op.id] : [])).map(safeId).filter((id): id is string => Boolean(id)));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            const fromNodeId = safeId(op.fromNodeId);
            const toNodeId = safeId(op.toNodeId);
            if (!fromNodeId || !toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            const from = nodes.find((node) => node.id === fromNodeId);
            const to = nodes.find((node) => node.id === toNodeId);
            const canConnect = from && to && from.id !== to.id && from.type !== CanvasNodeType.Group && to.type !== CanvasNodeType.Group && !(from.type === CanvasNodeType.Config && to.type === CanvasNodeType.Config);
            if (!exists && canConnect) connections = [...connections, { id: uniqueConnectionId(op.id, connections), fromNodeId, toNodeId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = safeViewport(op.viewport, viewport);
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).map(safeId).filter((id): id is string => Boolean(id) && nodes.some((node) => node.id === id));
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    nodes = nodes.map((node) => {
        const groupId = node.metadata?.groupId;
        if (!groupId || (groupId !== node.id && nodeById.get(groupId)?.type === CanvasNodeType.Group)) return node;
        return { ...node, metadata: { ...node.metadata, groupId: undefined } };
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function safeId(value: unknown) {
    return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value) ? value : undefined;
}

function safeText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function safePosition(value: unknown, fallback: CanvasNodeData["position"]) {
    if (!value || typeof value !== "object") return fallback;
    const position = value as Partial<CanvasNodeData["position"]>;
    return {
        x: safeNumber(position.x, fallback.x, -MAX_COORDINATE, MAX_COORDINATE),
        y: safeNumber(position.y, fallback.y, -MAX_COORDINATE, MAX_COORDINATE),
    };
}

function safeViewport(value: unknown, fallback: ViewportTransform) {
    if (!value || typeof value !== "object") return fallback;
    const viewport = value as Partial<ViewportTransform>;
    return {
        x: safeNumber(viewport.x, fallback.x, -MAX_COORDINATE, MAX_COORDINATE),
        y: safeNumber(viewport.y, fallback.y, -MAX_COORDINATE, MAX_COORDINATE),
        k: safeNumber(viewport.k, fallback.k, 0.05, 8),
    };
}

function safeMetadata(value: unknown): CanvasNodeMetadata {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, item]) => {
        if (!METADATA_KEYS.has(key as keyof CanvasNodeMetadata)) return;
        if (typeof item === "string") result[key] = item.slice(0, key === "content" ? 16 * 1024 * 1024 : 100_000);
        else if (typeof item === "boolean") result[key] = item;
        else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
        else if (Array.isArray(item)) result[key] = item.filter((entry): entry is string => typeof entry === "string").slice(0, 128).map((entry) => entry.slice(0, 1_000_000));
    });
    return result as CanvasNodeMetadata;
}

function uniqueConnectionId(requestedId: unknown, connections: CanvasConnection[]) {
    const id = safeId(requestedId);
    return id && !connections.some((connection) => connection.id === id) ? id : nanoid();
}

function opLabel(type: string) {
    if (type === "add_node") return "新增节点";
    if (type === "update_node") return "更新节点";
    if (type === "delete_node") return "删除节点";
    if (type === "delete_connections") return "删除连线";
    if (type === "connect_nodes") return "连接";
    if (type === "set_viewport") return "调整视图";
    if (type === "select_nodes") return "选择节点";
    if (type === "run_generation") return "触发生成";
    return type;
}
