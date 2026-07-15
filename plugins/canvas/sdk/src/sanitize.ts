// 官方示例插件会渲染用户或模型生成的标记。这里提供一套保守的白名单净化器，
// 避免 script、事件属性、危险 URL 与 SVG foreignObject 进入宿主页面。

const HTML_TAGS = new Set([
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "details",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "kbd",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
]);

const HTML_DROP_WITH_CONTENT = new Set([
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "meta",
    "noscript",
    "object",
    "script",
    "select",
    "style",
    "template",
    "textarea",
]);

const HTML_GLOBAL_ATTRS = new Set(["class", "dir", "lang", "title"]);
const HTML_TAG_ATTRS: Record<string, ReadonlySet<string>> = {
    a: new Set(["href"]),
    code: new Set(["class"]),
    img: new Set(["alt", "height", "loading", "src", "title", "width"]),
    ol: new Set(["start"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
};

const SVG_TAGS = new Set([
    "circle",
    "clippath",
    "defs",
    "desc",
    "ellipse",
    "g",
    "image",
    "line",
    "lineargradient",
    "marker",
    "mask",
    "path",
    "pattern",
    "polygon",
    "polyline",
    "radialgradient",
    "rect",
    "stop",
    "svg",
    "text",
    "title",
    "tspan",
]);

const SVG_ATTRS = new Set([
    "alignment-baseline",
    "aria-label",
    "clip-path",
    "clip-rule",
    "cx",
    "cy",
    "d",
    "dominant-baseline",
    "dx",
    "dy",
    "fill",
    "fill-opacity",
    "fill-rule",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "fx",
    "fy",
    "gradienttransform",
    "gradientunits",
    "height",
    "href",
    "id",
    "marker-end",
    "marker-mid",
    "marker-start",
    "mask",
    "offset",
    "opacity",
    "orient",
    "patterncontentunits",
    "patterntransform",
    "patternunits",
    "points",
    "preserveaspectratio",
    "r",
    "refx",
    "refy",
    "role",
    "rx",
    "ry",
    "spreadmethod",
    "stop-color",
    "stop-opacity",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
    "transform",
    "viewbox",
    "width",
    "x",
    "x1",
    "x2",
    "xlink:href",
    "xmlns",
    "xmlns:xlink",
    "y",
    "y1",
    "y2",
]);

const URL_ATTRS = new Set(["href", "src", "xlink:href"]);
const PAINT_SERVER_ATTRS = new Set(["clip-path", "fill", "marker-end", "marker-mid", "marker-start", "mask", "stroke"]);

function compactScheme(value: string): string {
    return value.trim().replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
}

function isSafeHtmlUrl(value: string, attribute: string): boolean {
    const compact = compactScheme(value);
    if (!compact) return false;
    if (compact.startsWith("javascript:") || compact.startsWith("vbscript:") || compact.startsWith("file:")) return false;
    if (compact.startsWith("data:")) {
        return attribute === "src" && /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(compact);
    }
    return /^(?:https?:|mailto:|tel:|\/|\.?\.\/|#|\?)/i.test(compact) || !/^[a-z][a-z0-9+.-]*:/i.test(compact);
}

function isSafeSvgUrl(value: string): boolean {
    const compact = compactScheme(value);
    return compact.startsWith("#") || /^data:image\/(?:gif|jpe?g|png|webp);base64,/i.test(compact);
}

function sanitizeHtmlElement(element: Element): void {
    const tag = element.localName.toLowerCase();
    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const tagAttrs = HTML_TAG_ATTRS[tag];
        const allowed = HTML_GLOBAL_ATTRS.has(name) || tagAttrs?.has(name) || name === "aria-label";
        if (!allowed || name.startsWith("on") || name === "style" || (URL_ATTRS.has(name) && !isSafeHtmlUrl(attribute.value, name))) {
            element.removeAttribute(attribute.name);
        }
    }
    if (tag === "a" && element.hasAttribute("href")) {
        element.setAttribute("rel", "nofollow noopener noreferrer");
    }
    if (tag === "img") element.setAttribute("loading", "lazy");
}

function sanitizeHtmlTree(parent: ParentNode): void {
    for (const child of Array.from(parent.childNodes)) {
        // 不依赖宿主全局 Element，兼容 iframe / 跨 realm 创建的 Document。
        if (child.nodeType !== 1) continue;
        const element = child as Element;
        const tag = element.localName.toLowerCase();
        if (!HTML_TAGS.has(tag)) {
            if (HTML_DROP_WITH_CONTENT.has(tag)) {
                element.remove();
            } else {
                sanitizeHtmlTree(element);
                element.replaceWith(...Array.from(element.childNodes));
            }
            continue;
        }
        sanitizeHtmlElement(element);
        sanitizeHtmlTree(element);
    }
}

function sanitizeSvgElement(element: Element): boolean {
    const tag = element.localName.toLowerCase();
    if (!SVG_TAGS.has(tag)) {
        element.remove();
        return false;
    }
    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        const unsafePaint = PAINT_SERVER_ATTRS.has(name) && /url\s*\(/i.test(value) && !/^\s*url\(\s*#[^)]+\s*\)\s*$/i.test(value);
        if (!SVG_ATTRS.has(name) || name.startsWith("on") || name === "style" || unsafePaint || (URL_ATTRS.has(name) && !isSafeSvgUrl(value))) {
            element.removeAttribute(attribute.name);
        }
    }
    for (const child of Array.from(element.children)) sanitizeSvgElement(child);
    return true;
}

/** 净化 Markdown 等渲染器输出的 HTML，仅保留常用排版标签。 */
export function sanitizeHtml(markup: string): string {
    if (!markup || typeof DOMParser === "undefined") return "";
    const document = new DOMParser().parseFromString(markup, "text/html");
    sanitizeHtmlTree(document.body);
    return document.body.innerHTML;
}

/** 净化 SVG 源码，拒绝脚本、事件处理器、foreignObject 与外部资源引用。 */
export function sanitizeSvg(markup: string): string {
    if (!markup || typeof DOMParser === "undefined") return "";
    const document = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = document.documentElement;
    if (root.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) return "";
    return sanitizeSvgElement(root) ? root.outerHTML : "";
}
