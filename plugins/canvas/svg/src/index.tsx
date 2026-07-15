// SVG 节点:编辑与渲染 SVG,无自身内容时可取上游文本节点里的 SVG 源码。
import { definePlugin, sanitizeSvg, useEffect, useMemo, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

const DEFAULT_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#6366f1"/></svg>';

function SvgContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    const stored = ctx.node.metadata?.content;
    const upstream = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((text) => text?.trim().startsWith("<svg"));
    const value = stored ?? "";
    const svg = value.trim() || upstream || DEFAULT_SVG;
    const safeSvg = useMemo(() => sanitizeSvg(svg), [svg]);

    useEffect(() => {
        if (stored === undefined && upstream) ctx.updateMetadata({ content: upstream });
    }, [ctx, stored, upstream]);

    const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" } as const;

    return (
        <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <button type="button" style={toggle} onClick={() => setEditing((v) => !v)} title={editing ? "预览" : "编辑源码"}>
                {editing ? "👁" : "✎"}
            </button>
            {editing ? (
                <textarea autoFocus value={value} placeholder={DEFAULT_SVG} onChange={(e) => ctx.updateMetadata({ content: e.target.value })} onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 12, outline: "none", border: "none", color: ctx.theme.node.text }} />
            ) : (
                <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} dangerouslySetInnerHTML={{ __html: safeSvg }} />
            )}
        </div>
    );
}

export default definePlugin({
    id: "svg",
    name: "SVG 节点",
    version: "1.0.1",
    description: "编辑与渲染 SVG,可接收上游文本节点的 SVG 源码",
    nodes: [
        {
            type: "svg:vector",
            title: "SVG",
            icon: "🔷",
            description: "渲染 SVG 矢量图",
            defaultSize: { width: 320, height: 320 },
            defaultMetadata: {},
            minimapColor: "#14b8a6",
            Content: SvgContent,
        },
    ],
});
