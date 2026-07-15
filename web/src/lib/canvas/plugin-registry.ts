export type OfficialPluginEntry = {
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    url: string;
};

type RawEntry = { id?: string; name?: string; version?: string; description?: string; icon?: string; entry?: string; url?: string };
type RawManifest = { plugins?: RawEntry[] };

const DEFAULT_PLUGIN_REGISTRY_URL = "/plugins/official-plugins.json";

export async function fetchOfficialPlugins(registryUrl = process.env.NEXT_PUBLIC_PLUGIN_REGISTRY_URL || DEFAULT_PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    const requestedUrl = new URL(registryUrl, window.location.origin).toString();
    const registry = new URL(requestedUrl);
    if (registry.origin !== window.location.origin || !registry.pathname.startsWith("/plugins/")) throw new Error("官方插件注册表必须来自本站 /plugins/");
    const response = await fetch(requestedUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`获取官方插件列表失败 (HTTP ${response.status})`);
    const data = (await response.json()) as RawManifest;
    return (Array.isArray(data.plugins) ? data.plugins : [])
        .filter((item): item is RawEntry & { id: string } => Boolean(item?.id && (item.entry || item.url)))
        .map((item) => {
            const url = new URL(item.url || (item.entry as string), requestedUrl);
            if (url.origin !== window.location.origin || !url.pathname.startsWith("/plugins/")) throw new Error(`官方插件地址越界：${item.id}`);
            return { id: item.id, name: item.name || item.id, version: item.version || "0.0.0", description: item.description, icon: item.icon, url: url.toString() };
        });
}
