"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Input, Select } from "antd";
import { FileText, PanelLeftClose, Search } from "lucide-react";
import { motion } from "motion/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "../types";

const PANEL_MOTION_SECONDS = 0.3;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 240;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 440;

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
};

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    open: boolean;
    width: number;
    onClose: () => void;
    onWidthChange: (width: number) => void;
    onFocusNode: (nodeId: string) => void;
};

export function CanvasSidePanel({ nodes, selectedNodeIds, open, width, onClose, onWidthChange, onFocusNode }: Props) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const registryVersion = useNodeRegistryVersion((state) => state.version);
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const [mounted, setMounted] = useState(open);
    const [closing, setClosing] = useState(false);
    const [resizing, setResizing] = useState(false);
    const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const resizeCleanupRef = useRef<((updateState?: boolean) => void) | null>(null);
    const normalizedWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, Number(width) || CANVAS_SIDE_PANEL_MIN_WIDTH));

    const typeOptions = useMemo(() => {
        void registryVersion;
        const types = new Set([...listNodeDefinitions().map((definition) => definition.type), ...nodes.map((node) => node.type)]);
        return [
            { label: "全部", value: "all" },
            ...Array.from(types).map((type) => ({ label: getNodeDefinition(type)?.title || type, value: type })),
        ];
    }, [nodes, registryVersion]);

    const filteredNodes = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => {
            if (typeFilter !== "all" && node.type !== typeFilter) return false;
            const definition = getNodeDefinition(node.type);
            const haystack = [node.title, definition?.title, node.type, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase();
            return !query || haystack.includes(query);
        });
    }, [keyword, nodes, registryVersion, typeFilter]);

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

    useEffect(() => {
        const selectedId = Array.from(selectedNodeIds)[0];
        if (selectedId) rowRefs.current[selectedId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedNodeIds]);

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
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ overflow: "clip", pointerEvents: closing ? "none" : undefined, maxWidth: "86vw" }}
            >
                <aside
                    className="relative flex h-full shrink-0 flex-col overflow-hidden border-r shadow-xl md:shadow-none"
                    style={{ width: normalizedWidth, maxWidth: "86vw", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    aria-label="画布元素"
                    data-canvas-no-zoom
                >
                    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3" style={{ borderColor: theme.toolbar.border }}>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">画布元素</div>
                            <div className="text-xs opacity-45">{nodes.length} 个节点</div>
                        </div>
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} aria-label="收起左侧面板" title="收起左侧面板">
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                        <Input size="small" allowClear prefix={<Search className="size-3.5 opacity-50" />} placeholder="搜索节点" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                        <Select size="small" className="w-28 shrink-0" popupMatchSelectWidth={false} value={typeFilter} onChange={setTypeFilter} options={typeOptions} />
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                        {filteredNodes.length ? (
                            <div className="space-y-1">
                                {filteredNodes.map((node) => {
                                    const definition = getNodeDefinition(node.type);
                                    const active = selectedNodeIds.has(node.id);
                                    const preview = nodePreview(node);
                                    return (
                                        <button
                                            key={node.id}
                                            ref={(element) => {
                                                rowRefs.current[node.id] = element;
                                            }}
                                            type="button"
                                            onClick={() => onFocusNode(node.id)}
                                            className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")}
                                            style={active ? { background: theme.toolbar.activeBg } : undefined}
                                        >
                                            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-black/5 dark:bg-white/5">
                                                {preview ? <img src={preview} alt="" className="size-full object-cover" /> : nodeIcon(definition?.icon)}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">{node.title || definition?.title || "未命名节点"}</span>
                                                <span className="block truncate text-xs opacity-45">{definition?.title || node.type}</span>
                                            </span>
                                            {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="pt-16 text-center text-sm opacity-40">{nodes.length ? "没有匹配的节点" : "画布暂无节点"}</div>
                        )}
                    </div>

                    <button type="button" className="absolute inset-y-0 right-0 z-40 hidden w-4 translate-x-1/2 cursor-col-resize md:block" onPointerDown={startResize} aria-label="调整左侧面板宽度" title="调整左侧面板宽度" />
                </aside>
            </motion.div>
        </>
    );
}

function nodeIcon(icon?: ReactNode) {
    return icon || <FileText className="size-5 opacity-60" />;
}

function nodePreview(node: CanvasNodeData) {
    try {
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        return resource?.kind === "image" ? resource.url : undefined;
    } catch {
        return undefined;
    }
}
