import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasAssistantReference, type CanvasAssistantSession, type InsertAssetPayload, type PendingAgentAsset } from "../types";
import type { CanvasAgentAction } from "./canvas-agent-tools";

const ATTACHMENT_MATERIALIZING_ACTIONS = new Set<CanvasAgentAction["name"]>([
    "set_agent_state",
    "create_primary_script_node",
    "create_text_node",
    "update_text_node",
    "update_node",
    "delete_node",
    "create_connection",
    "create_group",
    "arrange_nodes",
    "generate_image",
    "edit_image",
    "generate_video",
    "generate_audio",
]);

export type CanvasAgentAttachmentBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export function createPendingAgentAsset(payload: InsertAssetPayload, nodeId = nanoid()): PendingAgentAsset {
    const common = {
        id: nodeId,
        title: payload.title,
        origin: "attachment" as const,
        storageKey: "storageKey" in payload ? payload.storageKey : undefined,
        mimeType: "mimeType" in payload ? payload.mimeType : undefined,
        width: "width" in payload ? payload.width : undefined,
        height: "height" in payload ? payload.height : undefined,
        bytes: "bytes" in payload ? payload.bytes : undefined,
        durationMs: "durationMs" in payload ? payload.durationMs : undefined,
    };
    let reference: CanvasAssistantReference;
    if (payload.kind === "text") reference = { ...common, type: CanvasNodeType.Text, text: payload.content };
    else if (payload.kind === "image") reference = { ...common, type: CanvasNodeType.Image, dataUrl: payload.dataUrl };
    else if (payload.kind === "video") reference = { ...common, type: CanvasNodeType.Video, url: payload.url };
    else reference = { ...common, type: CanvasNodeType.Audio, url: payload.url };
    return { nodeId, payload, reference };
}

export function pendingAgentAssetFromReference(reference: CanvasAssistantReference): PendingAgentAsset | null {
    if (reference.origin !== "attachment") return null;
    const common = {
        title: reference.title,
        storageKey: reference.storageKey,
        mimeType: reference.mimeType,
        bytes: reference.bytes,
    };
    let payload: InsertAssetPayload;
    if (reference.type === CanvasNodeType.Text) {
        if (typeof reference.text !== "string") return null;
        payload = { kind: "text", title: reference.title, content: reference.text };
    } else if (reference.type === CanvasNodeType.Video) {
        if (!reference.url) return null;
        payload = { ...common, kind: "video", url: reference.url, width: reference.width, height: reference.height };
    } else if (reference.type === CanvasNodeType.Audio) {
        if (!reference.url) return null;
        payload = { ...common, kind: "audio", url: reference.url, durationMs: reference.durationMs };
    } else {
        if (!reference.dataUrl) return null;
        payload = { ...common, kind: "image", dataUrl: reference.dataUrl, width: reference.width, height: reference.height };
    }
    return { nodeId: reference.id, payload, reference };
}

export function pendingAgentAssetsFromReferences(references: CanvasAssistantReference[]): PendingAgentAsset[] {
    const assets = new Map<string, PendingAgentAsset>();
    references.forEach((reference) => {
        const asset = pendingAgentAssetFromReference(reference);
        if (asset) assets.set(asset.nodeId, asset);
    });
    return [...assets.values()];
}

export function canvasAgentSessionAssets(session: CanvasAssistantSession, references: CanvasAssistantReference[] = []): PendingAgentAsset[] {
    const assets = new Map<string, PendingAgentAsset>();
    pendingAgentAssetsFromReferences(session.messages.flatMap((message) => message.references || [])).forEach((asset) => assets.set(asset.nodeId, asset));
    (session.draftAssets || []).forEach((asset) => assets.set(asset.nodeId, asset));
    pendingAgentAssetsFromReferences(references).forEach((asset) => assets.set(asset.nodeId, asset));
    return [...assets.values()];
}

export async function materializePendingAgentAssetsOnce(assets: PendingAgentAsset[], inFlight: Map<string, Promise<void>>, materialize: (asset: PendingAgentAsset) => Promise<void>) {
    await Promise.all(
        assets.map((asset) => {
            const existing = inFlight.get(asset.nodeId);
            if (existing) return existing;
            let tracked: Promise<void>;
            tracked = Promise.resolve()
                .then(() => materialize(asset))
                .finally(() => {
                    if (inFlight.get(asset.nodeId) === tracked) inFlight.delete(asset.nodeId);
                });
            inFlight.set(asset.nodeId, tracked);
            return tracked;
        }),
    );
}

export function mergeCanvasAssistantReferences(...groups: CanvasAssistantReference[][]): CanvasAssistantReference[] {
    const order: string[] = [];
    const references = new Map<string, CanvasAssistantReference>();
    groups.flat().forEach((reference) => {
        if (!references.has(reference.id)) order.push(reference.id);
        references.set(reference.id, reference);
    });
    return order.flatMap((id) => {
        const reference = references.get(id);
        return reference ? [reference] : [];
    });
}

export function canvasAgentActionAttachmentIds(action: CanvasAgentAction, assets: PendingAgentAsset[]): string[] {
    const knownIds = new Set(assets.map((asset) => asset.nodeId));
    const referencedIds = new Set<string>();
    const visit = (key: string, value: unknown) => {
        if (!/nodeIds?$/i.test(key)) return;
        const values = Array.isArray(value) ? value : [value];
        values.forEach((item) => {
            if (typeof item === "string" && knownIds.has(item)) referencedIds.add(item);
        });
    };
    const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        Object.entries(value).forEach(([key, nested]) => {
            visit(key, nested);
            if (nested && typeof nested === "object") walk(nested);
        });
    };
    walk(action.arguments);
    return [...referencedIds];
}

export function canvasAgentActionNeedsAttachmentMaterialization(action: CanvasAgentAction) {
    return ATTACHMENT_MATERIALIZING_ACTIONS.has(action.name);
}

export function findCanvasAgentAttachmentPosition(center: { x: number; y: number }, size: { width: number; height: number }, startSlot: number, occupied: CanvasAgentAttachmentBounds[]) {
    const gap = 72;
    const collides = (candidate: { x: number; y: number }) => {
        const left = candidate.x - size.width / 2;
        const right = candidate.x + size.width / 2;
        const top = candidate.y - size.height / 2;
        const bottom = candidate.y + size.height / 2;
        return occupied.some((item) => left < item.x + item.width + gap && right + gap > item.x && top < item.y + item.height + gap && bottom + gap > item.y);
    };
    for (let slot = startSlot; slot < startSlot + Math.max(24, occupied.length * 2 + 6); slot += 1) {
        const candidate = {
            x: center.x + ((slot % 3) - 1) * (size.width + gap),
            y: center.y + Math.floor(slot / 3) * (size.height + gap),
        };
        if (!collides(candidate)) return candidate;
    }
    return { x: center.x, y: center.y + (occupied.length + 1) * (size.height + gap) };
}
