import type { UploadedImage } from "@/services/image-storage";

import type { CanvasAssistantImage, InsertAssetPayload } from "../types";

export const CANVAS_ASSET_DRAG_TYPE = "application/x-infinite-canvas-asset";
export const CANVAS_ASSET_DRAG_MARKER = "asset";

type CanvasAssetDataTransfer = {
    effectAllowed: string;
    setData: (format: string, data: string) => void;
};

type CanvasImageResolver = (storageKey: string, fallback: string) => Promise<string>;
type CanvasImageUploader = (input: string) => Promise<UploadedImage>;

export type CanvasAssetDropResolution = {
    matched: boolean;
    payload: InsertAssetPayload | null;
    error?: string;
};

export function startCanvasAssetDrag(dataTransfer: CanvasAssetDataTransfer, payload: InsertAssetPayload, onStart?: (payload: InsertAssetPayload) => void) {
    dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, CANVAS_ASSET_DRAG_MARKER);
    dataTransfer.effectAllowed = "copy";
    onStart?.(payload);
}

export function createCanvasAssetInsertGuard(expectedEpoch: number, readCurrentEpoch: () => number) {
    return () => {
        if (expectedEpoch !== readCurrentEpoch()) throw new DOMException("画布已切换，已停止素材插入", "AbortError");
    };
}

export function isCanvasAssetInsertCanceled(error: unknown) {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export function normalizeCanvasAssetDragPayload(payload: unknown): InsertAssetPayload | null {
    if (!payload || typeof payload !== "object") return null;
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.title !== "string") return null;
    if (candidate.kind === "text" && hasText(candidate.content)) return candidate as InsertAssetPayload;
    if (candidate.kind === "image" && typeof candidate.dataUrl === "string" && (candidate.dataUrl.trim() || hasText(candidate.storageKey))) return candidate as InsertAssetPayload;
    if ((candidate.kind === "video" || candidate.kind === "audio") && hasText(candidate.url)) return candidate as InsertAssetPayload;
    return null;
}

export function resolveCanvasAssetDropPayload(serialized: string, inMemoryPayload: unknown): CanvasAssetDropResolution {
    if (!serialized) return { matched: false, payload: null };
    if (serialized !== CANVAS_ASSET_DRAG_MARKER) return { matched: true, payload: null, error: "素材拖拽数据无效" };
    const payload = normalizeCanvasAssetDragPayload(inMemoryPayload);
    if (payload) return { matched: true, payload };
    return { matched: true, payload: null, error: invalidAssetMessage(inMemoryPayload) };
}

export async function resolveCanvasImageForInsert(image: CanvasAssistantImage, resolveStoredImage: CanvasImageResolver, uploadRemoteImage: CanvasImageUploader): Promise<UploadedImage> {
    const dataUrl = image.storageKey ? await resolveStoredImage(image.storageKey, image.dataUrl) : image.dataUrl;
    if (!dataUrl.trim()) throw new Error("图片素材没有可用地址");
    if (!image.storageKey) return uploadRemoteImage(dataUrl);
    return {
        url: dataUrl,
        storageKey: image.storageKey,
        width: image.width || 1,
        height: image.height || 1,
        bytes: image.bytes || 0,
        mimeType: image.mimeType || "image/png",
    };
}

function hasText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function invalidAssetMessage(payload: unknown) {
    if (payload && typeof payload === "object") {
        const kind = (payload as Record<string, unknown>).kind;
        if (kind === "image") return "图片素材没有可用地址";
        if (kind === "text") return "文本素材内容为空";
        if (kind === "video") return "视频素材没有可用地址";
        if (kind === "audio") return "音频素材没有可用地址";
    }
    return "素材内容无效，无法插入";
}
