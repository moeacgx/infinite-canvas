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
const UPSTREAM_PLUGIN_REGISTRY_URL = "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";

export async function fetchOfficialPlugins(registryUrl = process.env.NEXT_PUBLIC_PLUGIN_REGISTRY_URL || DEFAULT_PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {
    const requestedUrl = new URL(registryUrl, window.location.origin).toString();
    let response = await fetch(requestedUrl, { headers: { accept: "application/json" } });
    let resolvedRegistryUrl = requestedUrl;
    if (!response.ok && registryUrl === DEFAULT_PLUGIN_REGISTRY_URL) {
        resolvedRegistryUrl = UPSTREAM_PLUGIN_REGISTRY_URL;
        response = await fetch(resolvedRegistryUrl, { headers: { accept: "application/json" } });
    }
    if (!response.ok) throw new Error(`获取官方插件列表失败 (HTTP ${response.status})`);
    const data = (await response.json()) as RawManifest;
    return (Array.isArray(data.plugins) ? data.plugins : [])
        .filter((item): item is RawEntry & { id: string } => Boolean(item?.id && (item.entry || item.url)))
        .map((item) => ({ id: item.id, name: item.name || item.id, version: item.version || "0.0.0", description: item.description, icon: item.icon, url: item.url || new URL(item.entry as string, resolvedRegistryUrl).toString() }));
}
