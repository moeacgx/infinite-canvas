export type NavigationItem = {
    id: string;
    label: string;
    href: string;
    enabled: boolean;
    newTab: boolean;
};

export const defaultNavigationItems: NavigationItem[] = [
    { id: "canvas", label: "我的画布", href: "/canvas", enabled: true, newTab: false },
    { id: "image", label: "生图工作台", href: "/image", enabled: true, newTab: false },
    { id: "video", label: "视频创作台", href: "/video", enabled: true, newTab: false },
    { id: "workflows", label: "创意工作流", href: "/workflows", enabled: true, newTab: false },
    { id: "prompts", label: "提示词库", href: "/prompts", enabled: true, newTab: false },
    { id: "assets", label: "我的素材", href: "/assets", enabled: true, newTab: false },
];

export function parseNavigationItems(value: unknown): NavigationItem[] {
    if (value == null) return defaultNavigationItems;
    if (
        !Array.isArray(value) ||
        value.some((item) => !item || typeof item !== "object" || typeof item.id !== "string" || typeof item.label !== "string" || typeof item.href !== "string" || typeof item.enabled !== "boolean" || typeof item.newTab !== "boolean")
    ) {
        throw new Error("菜单配置必须是数组，每项需包含字符串 id、label、href 和布尔值 enabled、newTab");
    }
    return value;
}

export function isSafeNavigationHref(href: string): boolean {
    if (!href || new TextEncoder().encode(href).length > 2048 || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(href)) return false;
    const internal = href.startsWith("/") && !href.startsWith("//");
    if (!internal && !/^https?:\/\//i.test(href)) return false;
    try {
        const url = new URL(href, "https://navigation.invalid");
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && (!internal || url.origin === "https://navigation.invalid");
    } catch {
        return false;
    }
}

export function getVisibleNavigationItems(items?: NavigationItem[] | null): NavigationItem[] {
    // 未配置时使用默认项；主动清空菜单时保留空数组。
    return (items ?? defaultNavigationItems).filter((item) => item.enabled && isSafeNavigationHref(item.href));
}

export function isNavigationItemActive(href: string, pathname: string): boolean {
    if (!href.startsWith("/") || !isSafeNavigationHref(href)) return false;
    const path = new URL(href, "https://navigation.invalid").pathname.replace(/\/$/, "") || "/";
    return pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
}
