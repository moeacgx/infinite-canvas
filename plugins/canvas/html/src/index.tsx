// HTML 节点:沙箱 iframe 渲染 HTML,{{input}} 会替换为上游文本节点内容。
// 交互由宿主统一的「交互 ⇄ 移动」开关控制；编辑/预览与脚本权限放在悬浮工具条。
import { definePlugin, useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

// 源码编辑器行高/字号,行号槽与文本域必须完全一致才能对齐
const EDITOR_FONT = 12;
const EDITOR_LINE = 20;

function createSandboxDocument(markup: string, allowScripts: boolean): string {
    if (typeof DOMParser === "undefined") return "";
    const document = new DOMParser().parseFromString(markup, "text/html");

    // 子 frame、插件对象、刷新和 base URL 会扩大 srcDoc 的权限边界，统一移除。
    document.querySelectorAll("base, embed, iframe, meta[http-equiv], object").forEach((element) => element.remove());
    if (!allowScripts) {
        document.querySelectorAll("script").forEach((element) => element.remove());
        document.querySelectorAll("*").forEach((element) => {
            for (const attribute of Array.from(element.attributes)) {
                if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
            }
        });
    } else {
        // 即使用户明确启用脚本，也不加载第三方脚本，防止脚本来源在事后被替换。
        document.querySelectorAll("script[src]").forEach((element) => element.remove());
    }

    const policy = [
        "default-src 'none'",
        "base-uri 'none'",
        "connect-src 'none'",
        "font-src data:",
        "form-action 'none'",
        "frame-src 'none'",
        "img-src data: blob:",
        "media-src data: blob:",
        "object-src 'none'",
        allowScripts ? "script-src 'unsafe-inline'" : "script-src 'none'",
        "style-src 'unsafe-inline'",
    ].join("; ");
    const csp = document.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = policy;
    document.head.prepend(csp);
    return `<!doctype html>${document.documentElement.outerHTML}`;
}

function HtmlEditor({ ctx, value }: { ctx: CanvasNodeContentProps["ctx"]; value: string }) {
    const gutterRef = useRef<HTMLDivElement>(null);
    // 行数:按换行统计,至少 1 行;value 变化时重算
    const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
    const [scrollTop, setScrollTop] = useState(0);

    const codeStyle = { fontFamily: "monospace", fontSize: EDITOR_FONT, lineHeight: `${EDITOR_LINE}px`, boxSizing: "border-box" } as const;

    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", overflow: "hidden", borderRadius: 16, background: ctx.theme.node.fill }} onMouseDown={(e) => e.stopPropagation()}>
            {/* 行号槽:跟随文本域滚动,不可单独滚动 */}
            <div
                ref={gutterRef}
                aria-hidden
                style={{
                    ...codeStyle,
                    flex: "0 0 auto",
                    padding: "16px 8px 16px 12px",
                    textAlign: "right",
                    color: ctx.theme.node.placeholder,
                    background: `${ctx.theme.toolbar.panel}66`,
                    borderRight: `1px solid ${ctx.theme.node.stroke}`,
                    overflow: "hidden",
                    userSelect: "none",
                    whiteSpace: "pre",
                }}
            >
                {/* 用负 margin 让整列跟随 scrollTop 平移,和 textarea 同步 */}
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
            </div>
            <textarea
                autoFocus
                value={value}
                placeholder="<div>Hello, {{input}}</div>"
                spellCheck={false}
                wrap="off"
                onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{ ...codeStyle, flex: "1 1 auto", minWidth: 0, height: "100%", resize: "none", background: "transparent", padding: "16px 16px 16px 12px", outline: "none", border: "none", color: ctx.theme.node.text, whiteSpace: "pre", overflow: "auto" }}
            />
        </div>
    );
}

function HtmlContent({ ctx }: CanvasNodeContentProps) {
    const value = ctx.node.metadata?.content || "";
    const editing = Boolean(ctx.node.metadata?.editing);
    const allowScripts = Boolean(ctx.node.metadata?.allowScripts);
    const upstreamText = useMemo(
        () =>
            ctx
                .getUpstream()
                .map((node) => node.metadata?.content)
                .filter(Boolean)
                .join("\n"),
        [ctx],
    );
    const html = value.replace(/\{\{\s*input\s*\}\}/g, upstreamText);
    const sandboxDocument = useMemo(() => createSandboxDocument(html, allowScripts), [allowScripts, html]);

    if (editing) {
        return <HtmlEditor ctx={ctx} value={value} />;
    }

    if (!value) {
        return (
            <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: ctx.theme.node.placeholder }}>
                <span style={{ fontSize: 26 }}>{"</>"}</span>
                <span style={{ fontSize: 13 }}>选中节点,点上方工具条的 ✎ 编辑 HTML</span>
            </div>
        );
    }

    // 预览态:iframe 的鼠标交互由宿主「交互 ⇄ 移动」开关统一控制(见 interactionToggle),
    // 这里无需再手动做 pointer-events 穿透。data-canvas-no-zoom 保证交互时滚动作用于页面而非缩放画布。
    return (
        <div data-canvas-no-zoom style={{ position: "relative", height: "100%", width: "100%" }}>
            <iframe
                title="html-preview"
                sandbox={allowScripts ? "allow-scripts allow-forms" : "allow-forms"}
                srcDoc={sandboxDocument}
                style={{ height: "100%", width: "100%", border: 0, borderRadius: 16, background: "#fff", display: "block" }}
            />
        </div>
    );
}

export default definePlugin({
    id: "html",
    name: "HTML 节点",
    version: "1.2.1",
    description: "沙箱 iframe 渲染 HTML,支持 {{input}} 注入上游文本",
    nodes: [
        {
            type: "html:render",
            title: "HTML",
            icon: "🌐",
            description: "沙箱渲染 HTML",
            defaultSize: { width: 420, height: 320 },
            defaultMetadata: { content: "" },
            minimapColor: "#ec4899",
            hidePanel: true, // 纯展示型节点:点击/新建不弹出下方生图面板
            // 宿主统一提供「交互 ⇄ 移动」开关;编辑态强制可交互(编辑器始终可操作)并隐藏该开关
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            Content: HtmlContent,
            // 仅保留「编辑/预览」开关;交互/移动 由宿主自动注入
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                const allowScripts = Boolean(ctx.node.metadata?.allowScripts);
                const hasContent = Boolean(ctx.node.metadata?.content);
                const items = [
                    {
                        id: "html-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 HTML 源码",
                        label: editing ? "预览" : "编辑",
                        icon: editing ? "👁" : "✎",
                        active: editing,
                        onClick: () => ctx.updateMetadata({ editing: !editing }),
                    },
                ];
                // 预览且有内容时允许显式开启内联脚本；节点交互由宿主统一开关处理。
                if (!editing && hasContent) {
                    items.push({
                        id: "html-toggle-scripts",
                        title: allowScripts ? "关闭节点脚本" : "启用节点内联脚本（高风险）",
                        label: "脚本",
                        icon: "⚠",
                        active: allowScripts,
                        onClick: () => {
                            if (!allowScripts && !window.confirm("节点脚本可能读取当前 HTML 与上游输入。仅对你信任的内容启用，是否继续？")) return;
                            ctx.updateMetadata({ allowScripts: !allowScripts });
                        },
                    });
                }
                return items;
            },
        },
    ],
});
