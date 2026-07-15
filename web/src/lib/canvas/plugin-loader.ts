import { isBuiltinNodeType, registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";

const MAX_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_NODES = 50;
const MAX_PLUGIN_CSS_LENGTH = 512 * 1024;
const cleanups = new Map<string, () => void>();

export const unsafeCanvasPluginsEnabled = process.env.NEXT_PUBLIC_ENABLE_UNSAFE_CANVAS_PLUGINS === "true";

async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    if (new Blob([source]).size > MAX_PLUGIN_SOURCE_BYTES) throw new Error("插件源码超过 2MB 限制");
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const module = (await import(/* webpackIgnore: true */ url)) as { default?: unknown; plugin?: unknown };
        const exported = module.default ?? module.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error("插件未导出有效对象");
    if (!value.id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.id)) throw new Error("插件 id 格式不正确");
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 128) throw new Error("插件名称格式不正确");
    if (value.description && (typeof value.description !== "string" || value.description.length > 1000)) throw new Error("插件描述过长");
    if (value.css && (typeof value.css !== "string" || value.css.length > MAX_PLUGIN_CSS_LENGTH)) throw new Error("插件样式超过限制");
    if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > MAX_PLUGIN_NODES) throw new Error(`插件节点数量必须为 1-${MAX_PLUGIN_NODES}`);
    const types = new Set<string>();
    value.nodes.forEach((node) => {
        if (!node || typeof node !== "object" || typeof node.type !== "string" || node.type.length > 160 || !new RegExp(`^${escapeRegExp(value.id!)}:[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$`).test(node.type)) throw new Error(`插件节点类型必须以 ${value.id}: 开头并使用安全字符`);
        if (isBuiltinNodeType(node.type)) throw new Error(`插件不能覆盖内置节点：${node.type}`);
        if (types.has(node.type)) throw new Error(`插件包含重复节点类型：${node.type}`);
        if (!node.title || typeof node.title !== "string" || node.title.length > 128 || !node.defaultSize || !validPluginNodeSize(node.defaultSize.width) || !validPluginNodeSize(node.defaultSize.height)) throw new Error(`插件节点定义不完整或尺寸超限：${node.type}`);
        types.add(node.type);
    });
}

export function activatePlugin(plugin: CanvasPlugin) {
    deactivatePlugin(plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    try {
        registerNodeDefinitions(plugin.nodes, plugin.id);
        if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
        const cleanup = plugin.setup?.(runtime);
        if (typeof cleanup === "function") disposers.push(cleanup);
        if (disposers.length) cleanups.set(plugin.id, () => [...disposers].reverse().forEach((dispose) => dispose()));
    } catch (error) {
        [...disposers].reverse().forEach((dispose) => dispose());
        unregisterPluginNodes(plugin.id);
        throw error;
    }
}

export function deactivatePlugin(pluginId: string) {
    cleanups.get(pluginId)?.();
    cleanups.delete(pluginId);
    unregisterPluginNodes(pluginId);
}

function normalizePluginUrl(rawUrl: string, options?: { unsafeRemote?: boolean; development?: boolean }) {
    const url = new URL(rawUrl, window.location.href);
    if (url.username || url.password || url.hash) throw new Error("插件地址不能包含凭据或片段");
    const sameOriginOfficial = url.origin === window.location.origin && url.pathname.startsWith("/plugins/");
    if (sameOriginOfficial) return url.toString();
    const isLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
    if (options?.development && process.env.NODE_ENV === "development" && isLoopback && (url.protocol === "http:" || url.protocol === "https:")) return url.toString();
    if (!options?.unsafeRemote || !unsafeCanvasPluginsEnabled) throw new Error("默认仅允许加载本站 /plugins/ 下的官方插件");
    if (url.protocol !== "https:") throw new Error("第三方远程插件必须使用 HTTPS");
    return url.toString();
}

async function fetchPluginSource(rawUrl: string, options?: { unsafeRemote?: boolean; development?: boolean }) {
    const url = normalizePluginUrl(rawUrl, options);
    const response = await fetch(url, { headers: { accept: "text/javascript, application/javascript, text/plain;q=0.8" } });
    if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`);
    const declaredSize = Number(response.headers.get("content-length")) || 0;
    if (declaredSize > MAX_PLUGIN_SOURCE_BYTES) throw new Error("插件源码超过 2MB 限制");
    const source = await response.text();
    if (new Blob([source]).size > MAX_PLUGIN_SOURCE_BYTES) throw new Error("插件源码超过 2MB 限制");
    return { source, url };
}

function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

export async function installPluginFromUrl(rawUrl: string, options?: { official?: boolean; unsafeRemote?: boolean }) {
    const { source, url } = await fetchPluginSource(rawUrl, { unsafeRemote: options?.unsafeRemote });
    const plugin = await evaluatePluginSource(source);
    activatePlugin(plugin);
    usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled: true, official: options?.official });
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    return installPluginFromUrl(record.url, { official: record.official, unsafeRemote: !record.official && !record.local });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (enabled && !record.official && !record.local && !unsafeCanvasPluginsEnabled) throw new Error("第三方插件功能未启用");
    usePluginStore.getState().setEnabled(record.id, enabled);
    if (!enabled) return deactivatePlugin(record.id);
    const source = record.local ? (await fetchPluginSource(withCacheBust(record.url))).source : record.source;
    activatePlugin(await evaluatePluginSource(source));
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

let loaded = false;

export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    await usePluginStore.persist.rehydrate();
    await discoverLocalPlugins();
    const store = usePluginStore.getState();
    if (!unsafeCanvasPluginsEnabled) {
        store.plugins.filter((record) => record.enabled && !record.official && !record.local).forEach((record) => store.setEnabled(record.id, false));
    }
    await Promise.all(
        usePluginStore
            .getState()
            .plugins.filter((record) => record.enabled)
            .map(async (record) => {
                try {
                    const source = record.local ? (await fetchPluginSource(withCacheBust(record.url))).source : record.source;
                    activatePlugin(await evaluatePluginSource(source));
                } catch (error) {
                    console.error(`[plugin] 加载失败：${record.id}`, error);
                }
            }),
    );
    await loadDevelopmentPlugins();
}

async function discoverLocalPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json", { cache: "no-store" });
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return;
    }
    if (!Array.isArray(urls)) return;
    await Promise.all(
        urls.filter((url): url is string => typeof url === "string").map(async (rawUrl) => {
            try {
                const { source, url } = await fetchPluginSource(withCacheBust(rawUrl));
                const plugin = await evaluatePluginSource(source);
                const store = usePluginStore.getState();
                if (!store.plugins.some((item) => item.id === plugin.id)) store.upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, enabled: false, local: true });
            } catch (error) {
                console.error(`[plugin] 本地插件发现失败：${rawUrl}`, error);
            }
        }),
    );
}

async function loadDevelopmentPlugins() {
    if (process.env.NODE_ENV !== "development") return;
    const raw = process.env.NEXT_PUBLIC_DEV_PLUGINS;
    if (!raw) return;
    await Promise.all(
        raw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map(async (url) => {
                try {
                    const source = (await fetchPluginSource(withCacheBust(url), { development: true })).source;
                    const plugin = await evaluatePluginSource(source);
                    activatePlugin(plugin);
                } catch (error) {
                    console.error(`[plugin] 开发插件加载失败：${url}`, error);
                }
            }),
    );
}

function validPluginNodeSize(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 48 && value <= 8192;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
