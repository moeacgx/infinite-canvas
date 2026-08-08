"use client";

import { useQuery } from "@tanstack/react-query";
import { App, Button, Empty, Input, Modal, Pagination, Select, Spin } from "antd";
import { AudioLines, BookOpen, ChevronRight, Eye, FileText, PanelLeftClose, Plus, Search, Upload } from "lucide-react";
import { motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodeDefinition, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { fetchPrompts, type Prompt, type PromptCategoryOption } from "@/services/api/prompts";
import { uploadAssetMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeResource } from "@/types/canvas-plugin";

import type { CanvasNodeData, InsertAssetPayload } from "../types";
import { CANVAS_ASSET_DRAG_TYPE, startCanvasAssetDrag } from "../utils/canvas-asset-transfer";

export { CANVAS_ASSET_DRAG_TYPE } from "../utils/canvas-asset-transfer";
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 240;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 440;

const PANEL_MOTION_SECONDS = 0.3;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const ASSET_PAGE_SIZE = 12;
const PROMPT_CACHE_TIME = 24 * 60 * 60 * 1000;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    open: boolean;
    width: number;
    onClose: () => void;
    onWidthChange: (width: number) => void;
    onFocusNode: (nodeId: string) => void;
    onAssetDragStart?: (payload: InsertAssetPayload) => void;
    onAssetDragEnd?: () => void;
    onInsertAsset?: (payload: InsertAssetPayload) => void;
};

const ASSET_TYPE_OPTIONS = [
    { label: "全部", value: "" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, open, width, onClose, onWidthChange, onFocusNode, onAssetDragStart, onAssetDragEnd, onInsertAsset }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
    const [resizing, setResizing] = useState(false);
    const resizeCleanupRef = useRef<((updateState?: boolean) => void) | null>(null);
    const normalizedWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, Number(width) || CANVAS_SIDE_PANEL_MIN_WIDTH));

    useEffect(() => {
        if (open) {
            setMounted(true);
            setClosing(false);
            return;
        }
        setClosing(true);
        const timer = window.setTimeout(() => {
            setMounted(false);
            setClosing(false);
        }, PANEL_MOTION_SECONDS * 1000);
        return () => window.clearTimeout(timer);
    }, [open]);

    useEffect(
        () => () => {
            resizeCleanupRef.current?.(false);
        },
        [],
    );

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        resizeCleanupRef.current?.();
        const startX = event.clientX;
        const startWidth = normalizedWidth;
        const onMove = (moveEvent: PointerEvent) => {
            onWidthChange(Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX)));
        };
        const cleanup = (updateState = true) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            resizeCleanupRef.current = null;
            if (updateState) setResizing(false);
        };
        const onUp = () => cleanup();
        setResizing(true);
        resizeCleanupRef.current = cleanup;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    };

    if (!mounted) return null;

    return (
        <>
            <motion.button
                type="button"
                className="absolute inset-0 z-[130] cursor-default border-0 bg-black/35 p-0 backdrop-blur-[1px] md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: open ? 1 : 0 }}
                transition={{ duration: PANEL_MOTION_SECONDS }}
                style={{ pointerEvents: open ? "auto" : "none" }}
                onClick={onClose}
                aria-label="关闭画布元素面板"
                data-canvas-side-panel-backdrop
            />
            <motion.div
                className="absolute inset-y-0 left-0 z-[140] flex h-full shrink-0 md:relative md:z-[60]"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: open ? normalizedWidth + 1 : 0, opacity: open ? 1 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined, maxWidth: "86vw" }}
            >
                <aside
                    className="relative flex h-full shrink-0 flex-col overflow-hidden border-r shadow-xl md:shadow-none"
                    style={{ width: normalizedWidth, maxWidth: "86vw", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    aria-label="画布资源"
                    data-canvas-no-zoom
                >
                    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex min-w-0 items-center gap-4">
                            <PanelTabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                            <PanelTabButton label="资产" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                            <PanelTabButton label="提示词库" active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                        </div>
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} aria-label="收起左侧面板" title="收起左侧面板">
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden pt-3">
                        {tab === "canvas" ? (
                            <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} theme={theme} />
                        ) : tab === "assets" ? (
                            <CanvasAssetsTab theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />
                        ) : (
                            <CanvasPromptsTab theme={theme} onInsert={onInsertAsset} />
                        )}
                    </div>
                    <button type="button" className="absolute inset-y-0 right-0 z-40 hidden w-4 translate-x-1/2 cursor-col-resize md:block" onPointerDown={startResize} aria-label="调整左侧面板宽度" title="调整左侧面板宽度" />
                </aside>
            </motion.div>
        </>
    );
}

function PanelTabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative h-14 whitespace-nowrap text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <motion.span layoutId="canvasSidePanelTabIndicator" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const registryVersion = useNodeRegistryVersion((state) => state.version);
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const typeOptions = useMemo(() => {
        void registryVersion;
        const types = new Set([...listNodeDefinitions().map((definition) => definition.type), ...nodes.map((node) => node.type)]);
        return [{ label: "全部", value: "all" }, ...Array.from(types).map((type) => ({ label: getNodeDefinition(type)?.title || type, value: type }))];
    }, [nodes, registryVersion]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => {
            if (typeFilter !== "all" && node.type !== typeFilter) return false;
            const definition = getNodeDefinition(node.type);
            return !query || [node.title, definition?.title, node.type, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query);
        });
    }, [keyword, nodes, registryVersion, typeFilter]);

    useEffect(() => {
        const selectedId = Array.from(selectedNodeIds)[0];
        if (selectedId) rowRefs.current[selectedId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedNodeIds]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5">
                <span className="text-xs font-medium opacity-60">画布元素</span>
                <span className="text-xs opacity-35">{nodes.length}</span>
                <Select size="small" variant="borderless" className="ml-auto min-w-20" popupMatchSelectWidth={false} value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索节点" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="space-y-1.5">
                        {filtered.map((node) => {
                            const definition = getNodeDefinition(node.type);
                            const resource = nodeResource(node);
                            const preview = resource?.kind === "image" ? resource.url : undefined;
                            const active = selectedNodeIds.has(node.id);
                            return (
                                <button
                                    key={node.id}
                                    ref={(element) => {
                                        rowRefs.current[node.id] = element;
                                    }}
                                    type="button"
                                    onClick={() => onFocusNode(node.id)}
                                    className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
                                    style={active ? { background: theme.toolbar.activeBg } : undefined}
                                >
                                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-black/5 dark:bg-white/5">
                                        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : nodeIcon(definition?.icon)}
                                    </span>
                                    <span className="min-w-0 flex-1 space-y-0.5">
                                        <span className="block truncate text-sm font-medium leading-snug">{node.title || definition?.title || "未命名节点"}</span>
                                        <span className="block truncate text-xs leading-snug opacity-50">{resource?.kind === "text" ? resource.text || node.metadata?.content || "" : definition?.title || node.type}</span>
                                    </span>
                                    {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{nodes.length ? "无匹配节点" : "画布暂无节点"}</div>
                )}
            </div>
        </div>
    );
}

function nodeIcon(icon?: ReactNode) {
    return icon || <FileText className="size-5 opacity-60" />;
}

function nodeResource(node: CanvasNodeData): CanvasNodeResource | null {
    try {
        return getNodeDefinition(node.type)?.resource?.(node) || null;
    } catch {
        return null;
    }
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ theme, onAssetDragStart, onAssetDragEnd }: { theme: CanvasTheme; onAssetDragStart?: (payload: InsertAssetPayload) => void; onAssetDragEnd?: () => void }) {
    const [source, setSource] = useState<"mine" | "library">("mine");
    const [formOpen, setFormOpen] = useState(false);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-4 px-3 pb-2">
                <AssetSourceTab label="我的素材" active={source === "mine"} theme={theme} onClick={() => setSource("mine")} />
                <AssetSourceTab label="素材库" active={source === "library"} theme={theme} onClick={() => setSource("library")} />
            </div>
            {source === "mine" ? (
                <MyAssetsTab theme={theme} onAdd={() => setFormOpen(true)} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />
            ) : (
                <LibraryAssetsTab theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />
            )}
            <QuickAssetFormModal open={formOpen} onClose={() => setFormOpen(false)} />
        </div>
    );
});

function AssetSourceTab({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="relative pb-1 text-xs font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {label}
            {active ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} /> : null}
        </button>
    );
}

function MyAssetsTab({ theme, onAdd, onAssetDragStart, onAssetDragEnd }: { theme: CanvasTheme; onAdd: () => void; onAssetDragStart?: (payload: InsertAssetPayload) => void; onAssetDragEnd?: () => void }) {
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("");
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (!type || asset.kind === type) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, type]);

    return (
        <>
            <div className="flex items-center gap-4 px-3 pb-2">
                {ASSET_TYPE_OPTIONS.map((option) => (
                    <AssetSourceTab key={option.value || "all"} label={option.label} active={type === option.value} theme={theme} onClick={() => setType(option.value)} />
                ))}
            </div>
            <div className="flex items-center gap-2 px-3 pb-2">
                <Input size="small" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <button type="button" onClick={onAdd} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }}>
                    <Plus className="size-3.5" />
                    添加
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="grid grid-cols-2 gap-2 px-1 pt-1">
                        {filtered.map((asset) => (
                            <AssetDragCard key={asset.id} asset={asset} theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" className="pt-16" />
                )}
            </div>
        </>
    );
}

function LibraryAssetsTab({ theme, onAssetDragStart, onAssetDragEnd }: { theme: CanvasTheme; onAssetDragStart?: (payload: InsertAssetPayload) => void; onAssetDragEnd?: () => void }) {
    const [keyword, setKeyword] = useState("");
    const [type, setType] = useState("");
    const [page, setPage] = useState(1);
    const query = useQuery({
        queryKey: ["canvas-side-library-assets", keyword, type, page],
        queryFn: () => fetchAssetLibrary({ keyword, type, page, pageSize: ASSET_PAGE_SIZE }),
        retry: false,
    });
    const items = query.data?.items || [];

    useEffect(() => setPage(1), [keyword, type]);

    return (
        <>
            <div className="flex items-center gap-2 px-3 pb-2">
                <Input size="small" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索素材" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Select size="small" variant="borderless" className="w-20" value={type} onChange={setType} options={ASSET_TYPE_OPTIONS} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {query.isLoading ? (
                    <div className="flex justify-center pt-16">
                        <Spin size="small" />
                    </div>
                ) : query.isError ? (
                    <button type="button" onClick={() => void query.refetch()} className="block w-full pt-16 text-center text-sm text-red-500">
                        加载失败，点击重试
                    </button>
                ) : items.length ? (
                    <div className="grid grid-cols-2 gap-2 px-1 pt-1">
                        {items.map((asset) => (
                            <LibraryAssetDragCard key={asset.id} asset={asset} theme={theme} onAssetDragStart={onAssetDragStart} onAssetDragEnd={onAssetDragEnd} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无素材" className="pt-16" />
                )}
                {query.data?.total && query.data.total > ASSET_PAGE_SIZE ? (
                    <Pagination className="mt-3 flex justify-center" size="small" current={page} pageSize={ASSET_PAGE_SIZE} total={query.data.total} showSizeChanger={false} onChange={setPage} />
                ) : null}
            </div>
        </>
    );
}

function AssetDragCard({ asset, theme, onAssetDragStart, onAssetDragEnd }: { asset: Asset; theme: CanvasTheme; onAssetDragStart?: (payload: InsertAssetPayload) => void; onAssetDragEnd?: () => void }) {
    return (
        <DraggableAssetCard
            theme={theme}
            title={asset.title}
            payload={assetPayload(asset)}
            kind={asset.kind}
            imageUrl={asset.kind === "text" ? asset.coverUrl : asset.kind === "image" ? asset.coverUrl || asset.data.dataUrl : asset.coverUrl}
            mediaUrl={asset.kind === "video" || asset.kind === "audio" ? asset.data.url : ""}
            text={asset.kind === "text" ? asset.data.content : ""}
            onAssetDragStart={onAssetDragStart}
            onAssetDragEnd={onAssetDragEnd}
        />
    );
}

function LibraryAssetDragCard({ asset, theme, onAssetDragStart, onAssetDragEnd }: { asset: AssetLibraryItem; theme: CanvasTheme; onAssetDragStart?: (payload: InsertAssetPayload) => void; onAssetDragEnd?: () => void }) {
    return (
        <DraggableAssetCard
            theme={theme}
            title={asset.title}
            payload={libraryPayload(asset)}
            kind={asset.type as AssetKind}
            imageUrl={asset.coverUrl || (asset.type === "image" ? asset.url : "")}
            mediaUrl={asset.type === "video" || String(asset.type) === "audio" ? asset.url : ""}
            text={asset.content || asset.description}
            onAssetDragStart={onAssetDragStart}
            onAssetDragEnd={onAssetDragEnd}
        />
    );
}

function DraggableAssetCard({
    theme,
    title,
    payload,
    kind,
    imageUrl,
    mediaUrl,
    text,
    onAssetDragStart,
    onAssetDragEnd,
}: {
    theme: CanvasTheme;
    title: string;
    payload: InsertAssetPayload;
    kind: AssetKind;
    imageUrl: string;
    mediaUrl: string;
    text: string;
    onAssetDragStart?: (payload: InsertAssetPayload) => void;
    onAssetDragEnd?: () => void;
}) {
    return (
        <div
            draggable
            title={title}
            onDragStart={(event) => {
                startCanvasAssetDrag(event.dataTransfer, payload, onAssetDragStart);
            }}
            onDragEnd={() => onAssetDragEnd?.()}
            className="group relative aspect-square cursor-grab overflow-hidden rounded-lg border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing"
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
        >
            {kind === "text" ? (
                imageUrl ? (
                    <div className="flex size-full flex-col">
                        <img src={imageUrl} alt={title} draggable={false} className="h-1/2 w-full object-cover" />
                        <div className="h-1/2 overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{text}</div>
                    </div>
                ) : (
                    <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{text}</div>
                )
            ) : kind === "video" && mediaUrl ? (
                <video src={mediaUrl + "#t=0.1"} muted playsInline preload="metadata" draggable={false} className="size-full bg-black object-cover transition duration-300 group-hover:scale-[1.04]" />
            ) : kind === "audio" ? (
                <span className="flex size-full flex-col items-center justify-center gap-2 px-3 text-center">
                    <AudioLines className="size-9 opacity-55" />
                    <span className="line-clamp-2 text-[11px] font-medium opacity-70">{title}</span>
                </span>
            ) : imageUrl ? (
                <img src={imageUrl} alt={title} draggable={false} className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />
            ) : (
                <span className="grid size-full place-items-center">
                    <FileText className="size-8 opacity-45" />
                </span>
            )}
        </div>
    );
}

function assetPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id, source: "asset" };
    if (asset.kind === "image")
        return {
            kind: "image",
            dataUrl: asset.data.dataUrl || asset.coverUrl,
            storageKey: asset.data.storageKey,
            title: asset.title,
            assetId: asset.id,
            width: asset.data.width,
            height: asset.data.height,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            source: "asset",
        };
    if (asset.kind === "video") {
        return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, source: "asset" };
    }
    return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, assetId: asset.id, bytes: asset.data.bytes, mimeType: asset.data.mimeType, durationMs: asset.data.durationMs, source: "asset" };
}

function libraryPayload(asset: AssetLibraryItem): InsertAssetPayload {
    const assetType = String(asset.type);
    if (assetType === "text") return { kind: "text", content: asset.content, title: asset.title, assetId: asset.id, source: "library" };
    if (assetType === "image") return { kind: "image", dataUrl: asset.url || asset.coverUrl, title: asset.title, assetId: asset.id, source: "library" };
    if (assetType === "video") return { kind: "video", url: asset.url, title: asset.title, assetId: asset.id, source: "library" };
    if (assetType === "audio") return { kind: "audio", url: asset.url, title: asset.title, assetId: asset.id, source: "library" };
    return { kind: "image", dataUrl: asset.url || asset.coverUrl, title: asset.title, assetId: asset.id, source: "library" };
}

const CanvasPromptsTab = memo(function CanvasPromptsTab({ theme, onInsert }: { theme: CanvasTheme; onInsert?: (payload: InsertAssetPayload) => void }) {
    const copyText = useCopyText();
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({ system: true });
    const [detail, setDetail] = useState<Prompt | null>(null);
    const categoryQuery = useQuery({
        queryKey: ["canvas-side-prompt-categories"],
        queryFn: () => fetchPrompts({ page: 1, pageSize: 1 }),
        retry: false,
    });
    const categories = useMemo(() => normalizePromptCategories(categoryQuery.data?.categories || []), [categoryQuery.data?.categories]);

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索提示词" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {categoryQuery.isLoading ? (
                    <div className="flex justify-center pt-16">
                        <Spin size="small" />
                    </div>
                ) : categoryQuery.isError ? (
                    <button type="button" onClick={() => void categoryQuery.refetch()} className="block w-full pt-16 text-center text-sm text-red-500">
                        加载失败，点击重试
                    </button>
                ) : (
                    <div className="space-y-2">
                        {categories.map((category) => {
                            const opened = Boolean(expanded[category.category]) || Boolean(keyword.trim());
                            return (
                                <PromptGroup
                                    key={category.category}
                                    category={category}
                                    keyword={keyword}
                                    open={opened}
                                    theme={theme}
                                    onToggle={() => setExpanded((current) => ({ ...current, [category.category]: !current[category.category] }))}
                                    onView={setDetail}
                                    onInsert={onInsert}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => copyText(prompt, "已复制提示词")} />
        </div>
    );
});

function normalizePromptCategories(categories: PromptCategoryOption[]) {
    const result = new Map<string, PromptCategoryOption>();
    result.set("system", { category: "system", name: "系统提示词" });
    categories.forEach((item) => {
        if (item.category) result.set(item.category, item);
    });
    return Array.from(result.values());
}

async function fetchPromptCategory(category: string) {
    const first = await fetchPrompts({ category, page: 1, pageSize: 500 });
    if (first.total <= first.items.length) return first.items;
    const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / 500) - 1 }, (_, index) => fetchPrompts({ category, page: index + 2, pageSize: 500 })));
    return [...first.items, ...pages.flatMap((page) => page.items)];
}

function PromptGroup({
    category,
    keyword,
    open,
    theme,
    onToggle,
    onView,
    onInsert,
}: {
    category: PromptCategoryOption;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onView: (prompt: Prompt) => void;
    onInsert?: (payload: InsertAssetPayload) => void;
}) {
    const query = useQuery({
        queryKey: ["canvas-side-prompt-category", category.category],
        queryFn: () => fetchPromptCategory(category.category),
        enabled: open,
        staleTime: PROMPT_CACHE_TIME,
        gcTime: PROMPT_CACHE_TIME,
        retry: false,
    });
    const items = useMemo(() => {
        const queryText = keyword.trim().toLowerCase();
        const cachedItems = query.data || [];
        return queryText ? cachedItems.filter((item) => [item.title, item.prompt].join(" ").toLowerCase().includes(queryText)) : cachedItems;
    }, [keyword, query.data]);

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{category.name || category.category}</span>
                {query.isSuccess && open ? <span className="opacity-50">{items.length}</span> : null}
            </button>
            {open ? (
                <div className="space-y-1.5 px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            加载失败，点击重试
                        </button>
                    ) : items.length ? (
                        items.map((item) => <PromptRow key={item.id} item={item} theme={theme} onView={() => onView(item)} onInsert={onInsert ? () => onInsert({ kind: "text", content: item.prompt, title: item.title }) : undefined} />)
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">该分类暂无提示词</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onView, onInsert }: { item: Prompt; theme: CanvasTheme; onView: () => void; onInsert?: () => void }) {
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium leading-snug">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs leading-snug opacity-50">{item.prompt}</span>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label="查看详情">
                    <Eye className="size-3.5" />
                </button>
                {onInsert ? (
                    <button
                        type="button"
                        onClick={onInsert}
                        className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                        style={{ color: theme.toolbar.activeText }}
                        aria-label="插入画布"
                    >
                        <Plus className="size-3.5" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}

type QuickAssetMedia = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    durationMs?: number;
};

function QuickAssetFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [kind, setKind] = useState<AssetKind>("text");
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [tags, setTags] = useState("");
    const [media, setMedia] = useState<QuickAssetMedia | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        setKind("text");
        setTitle("");
        setContent("");
        setTags("");
        setMedia(null);
        setBusy(false);
    }, [open]);

    const save = () => {
        const nextTitle = title.trim();
        const nextContent = content.trim();
        if (!nextTitle) return message.warning("请输入素材标题");
        if (!nextContent) return message.warning(kind === "text" ? "请输入文本内容" : "请上传文件或填写资源 URL");
        const common = {
            title: nextTitle,
            coverUrl: kind === "image" ? nextContent : "",
            tags: tags
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            source: "手动添加",
            metadata: { source: "canvas-side-panel" },
        };
        if (kind === "text") {
            addAsset({ ...common, kind: "text", data: { content: nextContent } });
        } else if (kind === "image") {
            addAsset({
                ...common,
                kind: "image",
                data: media ? { dataUrl: media.url, storageKey: media.storageKey, width: media.width, height: media.height, bytes: media.bytes, mimeType: media.mimeType } : { dataUrl: nextContent, width: 0, height: 0, bytes: 0, mimeType: "image/*" },
            });
        } else if (kind === "video") {
            addAsset({
                ...common,
                kind: "video",
                data: media ? { url: media.url, storageKey: media.storageKey, width: media.width, height: media.height, bytes: media.bytes, mimeType: media.mimeType } : { url: nextContent, width: 0, height: 0, bytes: 0, mimeType: "video/mp4" },
            });
        } else {
            addAsset({
                ...common,
                kind: "audio",
                data: media ? { url: media.url, storageKey: media.storageKey, width: 0, height: 0, bytes: media.bytes, mimeType: media.mimeType, durationMs: media.durationMs } : { url: nextContent, width: 0, height: 0, bytes: 0, mimeType: "audio/mpeg" },
            });
        }
        message.success("素材已保存");
        onClose();
    };

    const readFile = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try {
            if (kind === "image") {
                if (!file.type.startsWith("image/")) return message.warning("请选择图片文件");
                const uploaded = await uploadImage(file);
                setMedia({ url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType });
                setContent(uploaded.url);
            } else {
                const expectedPrefix = kind === "video" ? "video/" : "audio/";
                if (!file.type.startsWith(expectedPrefix)) return message.warning(kind === "video" ? "请选择视频文件" : "请选择音频文件");
                const uploaded = await uploadAssetMediaFile(file, kind === "video" ? "asset-video" : "asset-audio");
                setMedia({ url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || 0, height: uploaded.height || 0, bytes: uploaded.bytes, mimeType: uploaded.mimeType, durationMs: uploaded.durationMs });
                setContent(uploaded.url);
            }
            if (!title.trim()) setTitle(file.name);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取素材失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal title="新增素材" open={open} onCancel={busy ? undefined : onClose} onOk={save} okText="保存" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: busy }} destroyOnHidden>
            <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                    <div className="text-sm font-medium">类型</div>
                    <Select
                        className="w-full"
                        value={kind}
                        options={ASSET_TYPE_OPTIONS.slice(1)}
                        onChange={(value: AssetKind) => {
                            setKind(value);
                            setContent("");
                            setMedia(null);
                        }}
                    />
                </div>
                <div className="space-y-1.5">
                    <div className="text-sm font-medium">标题</div>
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给素材起一个容易检索的名字" />
                </div>
                <div className="space-y-1.5">
                    <div className="text-sm font-medium">{kind === "text" ? "文本内容" : kind === "image" ? "图片内容" : kind === "video" ? "视频内容" : "音频内容"}</div>
                    {kind === "text" ? (
                        <Input.TextArea rows={6} value={content} onChange={(event) => setContent(event.target.value)} placeholder="输入需要反复使用的提示词或文案" />
                    ) : (
                        <div className="space-y-2">
                            <Input
                                value={content}
                                onChange={(event) => {
                                    setContent(event.target.value);
                                    setMedia(null);
                                }}
                                placeholder={kind === "image" ? "填写图片 URL，或上传本地图片" : kind === "video" ? "填写视频 URL，或上传本地视频" : "填写音频 URL，或上传本地音频"}
                            />
                            <Button icon={<Upload className="size-4" />} loading={busy} disabled={busy} onClick={() => fileInputRef.current?.click()}>
                                上传文件
                            </Button>
                            {content ? (
                                kind === "image" ? (
                                    <img src={content} alt="" className="max-h-36 rounded-md object-contain" />
                                ) : kind === "video" ? (
                                    <video src={content} controls className="max-h-36 rounded-md bg-black" />
                                ) : (
                                    <audio src={content} controls className="w-full" />
                                )
                            ) : null}
                        </div>
                    )}
                </div>
                <div className="space-y-1.5">
                    <div className="text-sm font-medium">标签</div>
                    <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="多个标签用逗号分隔" />
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*"}
                    className="hidden"
                    onChange={(event) => {
                        void readFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </div>
        </Modal>
    );
}
