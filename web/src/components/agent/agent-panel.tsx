"use client";

import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Switch, Tooltip } from "antd";
import { Bot, PanelRightClose } from "lucide-react";
import { motion } from "motion/react";

import { CanvasLocalAgentPanel } from "@/app/(user)/canvas/components/canvas-local-agent-panel";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/app/(user)/canvas/utils/canvas-agent-ops";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = 0.5;
const EMPTY_SNAPSHOT: CanvasAgentSnapshot = {
    projectId: "",
    title: "未打开画布",
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useCanvasAgentStore((state) => state.width);
    const panelOpen = useCanvasAgentStore((state) => state.panelOpen);
    const canvasContext = useCanvasAgentStore((state) => state.canvasContext);
    const token = useCanvasAgentStore((state) => state.token);
    const confirmTools = useCanvasAgentStore((state) => state.confirmTools);
    const setAgentState = useCanvasAgentStore((state) => state.setAgentState);
    const closePanel = useCanvasAgentStore((state) => state.closePanel);
    const [resizing, setResizing] = useState(false);

    const applyOps = useCallback((ops?: CanvasAgentOp[]) => {
        const current = useCanvasAgentStore.getState().canvasContext;
        if (!current) throw new Error("当前没有打开画布，请先进入一个画布项目");
        return current.applyOps(ops);
    }, []);
    const undoOps = useCallback(() => {
        const current = useCanvasAgentStore.getState().canvasContext;
        if (!current) return null;
        return current.undoOps();
    }, []);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={false}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen ? undefined : "none" }}
            aria-hidden={!panelOpen}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                initial={false}
                animate={{ x: panelOpen ? 0 : 28 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整 Agent 面板宽度" />
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-4" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-lg">
                            <Bot className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="text-base font-semibold leading-5">Agent</div>
                            <div className="truncate text-xs" style={{ color: theme.node.muted }}>{canvasContext ? canvasContext.snapshot.title : "全站助手"}</div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}>
                            <Switch size="small" checked={confirmTools} onChange={(value) => setAgentState({ confirmTools: value })} />
                            工具确认
                        </label>
                        <Tooltip title="收起 Agent">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </div>
                </header>
                <CanvasLocalAgentPanel
                    snapshot={canvasContext?.snapshot || EMPTY_SNAPSHOT}
                    canUndoOps={Boolean(canvasContext?.canUndoOps)}
                    embedded
                    autoConnect={Boolean(token.trim())}
                    onApplyOps={applyOps}
                    onUndoOps={undoOps}
                />
            </motion.aside>
        </motion.div>
    );
}
