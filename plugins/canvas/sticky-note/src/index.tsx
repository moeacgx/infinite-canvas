// 便利贴节点:可换色、可编辑、可衍生文本节点(演示 ctx.applyOps 画布指令集)。
import { definePlugin, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

const COLORS = ["#fde68a", "#fca5a5", "#a7f3d0", "#bfdbfe", "#ddd6fe"];

function StickyNoteContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    // pluginColor 是插件自定义 metadata 字段(非内置字段),读出为 unknown,按需断言
    const color = (ctx.node.metadata?.pluginColor as string | undefined) || COLORS[0];
    const content = ctx.node.metadata?.content || "";

    const cycleColor = () => {
        const next = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
        ctx.updateMetadata({ pluginColor: next });
    };

    const spawnTextNode = () => {
        const id = `sticky-${ctx.node.id}-${ctx.getNodes().length}`;
        ctx.applyOps([
            {
                type: "add_node",
                id,
                nodeType: "text",
                title: "便利贴衍生",
                x: ctx.node.position?.x ?? 0,
                y: (ctx.node.position?.y ?? 0) + 260,
                metadata: { content, status: "success" },
            },
            { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
        ]);
    };

    const btn = { width: 26, height: 26, borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(0,0,0,.08)", fontSize: 13 } as const;

    return (
        <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column", background: color, borderRadius: 16, padding: 12, boxSizing: "border-box" }}>
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginBottom: 6 }}>
                <button type="button" title="换颜色" onClick={cycleColor} style={btn}>
                    🎨
                </button>
                <button type="button" title="衍生文本节点" onClick={spawnTextNode} style={btn}>
                    ➡️
                </button>
                <button type="button" title={editing ? "完成" : "编辑"} onClick={() => setEditing((v) => !v)} style={btn}>
                    {editing ? "✓" : "✎"}
                </button>
            </div>
            {editing ? (
                <textarea autoFocus value={content} onChange={(e) => ctx.updateMetadata({ content: e.target.value })} onWheel={(e) => e.stopPropagation()} style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "#1c1917", fontSize: 15, lineHeight: 1.5 }} />
            ) : (
                <div style={{ flex: 1, whiteSpace: "pre-wrap", overflow: "auto", color: "#1c1917", fontSize: 15, lineHeight: 1.5 }}>{content || "双击 ✎ 编辑便利贴"}</div>
            )}
        </div>
    );
}

export default definePlugin({
    id: "sticky-note",
    name: "便利贴节点",
    version: "1.0.0",
    description: "可换色、可编辑、可衍生文本节点的便利贴",
    nodes: [
        {
            type: "sticky-note:note",
            title: "便利贴",
            icon: "📌",
            description: "彩色便利贴",
            defaultSize: { width: 240, height: 200 },
            defaultMetadata: { content: "", pluginColor: "#fde68a" },
            minimapColor: "#f59e0b",
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: StickyNoteContent,
        },
    ],
});
