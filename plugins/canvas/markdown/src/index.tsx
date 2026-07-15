// Markdown 节点:编辑与渲染 Markdown。marked 从 CDN 按需加载,不打进插件体积。
// styles.css 由 esbuild 以 text 方式打进 bundle,通过 plugin.css 自动注入。
import { definePlugin, sanitizeHtml, useEffect, useMemo, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

import css from "./styles.css";

type Marked = { parse: (src: string) => string };

let marked: Marked | undefined; // 加载完成后的 marked 实例,模块级缓存,后续同步渲染
let markedPromise: Promise<Marked> | undefined;
function loadMarked(): Promise<Marked> {
    if (marked) return Promise.resolve(marked);
    if (!markedPromise) markedPromise = import("https://esm.sh/marked@14").then((mod: { marked: Marked }) => (marked = mod.marked));
    return markedPromise;
}

function MarkdownContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    // marked 就绪状态:已缓存则首帧即为 true,避免重渲染/重挂载时闪成空白
    const [markedReady, setMarkedReady] = useState(Boolean(marked));
    const value = ctx.node.metadata?.content || "";

    useEffect(() => {
        if (marked) return;
        let alive = true;
        loadMarked().then(() => alive && setMarkedReady(true));
        return () => {
            alive = false;
        };
    }, []);

    // marked 就绪后同步计算 HTML(按 value 记忆),不再用异步 setState 填充,消除闪烁
    const html = useMemo(() => sanitizeHtml(marked ? marked.parse(value || "*双击右上角按钮编辑 Markdown*") : ""), [value, markedReady]);

    const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" } as const;

    return (
        <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <button type="button" style={toggle} onClick={() => setEditing((v) => !v)} title={editing ? "预览" : "编辑"}>
                {editing ? "👁" : "✎"}
            </button>
            {editing ? (
                <textarea autoFocus value={value} placeholder="# 输入 Markdown" onChange={(e) => ctx.updateMetadata({ content: e.target.value })} onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", resize: "none", background: "transparent", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text }} />
            ) : (
                <div className="cnv-md" onWheel={(e) => e.stopPropagation()} style={{ color: ctx.theme.node.text }} dangerouslySetInnerHTML={{ __html: html }} />
            )}
        </div>
    );
}

export default definePlugin({
    id: "markdown",
    name: "Markdown 节点",
    version: "1.0.1",
    description: "在画布中编辑与渲染 Markdown",
    css,
    nodes: [
        {
            type: "markdown:doc",
            title: "Markdown",
            icon: "📝",
            description: "编辑与渲染 Markdown",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { content: "" },
            minimapColor: "#6366f1",
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: MarkdownContent,
        },
    ],
});
