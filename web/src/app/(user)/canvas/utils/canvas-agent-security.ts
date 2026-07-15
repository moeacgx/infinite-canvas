const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function normalizeLocalAgentEndpoint(rawEndpoint: string) {
    let url: URL;
    try {
        url = new URL(rawEndpoint.trim());
    } catch {
        throw new Error("本地 Agent 地址格式不正确");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("本地 Agent 仅支持 HTTP 或 HTTPS");
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("本地 Agent 地址必须指向本机环回地址");
    if (url.username || url.password || url.search || url.hash) throw new Error("本地 Agent 地址不能包含凭据、查询参数或片段");
    if (url.pathname !== "/" && url.pathname !== "") throw new Error("本地 Agent 地址不能包含额外路径");
    return url.origin;
}

export function normalizeLocalAgentToken(rawToken: string) {
    const token = rawToken.trim();
    if (!/^[a-zA-Z0-9_-]{16,512}$/.test(token)) throw new Error("本地 Agent token 格式不正确");
    return token;
}

export function removeAgentCredentialsFromUrl(rawUrl: string) {
    const url = new URL(rawUrl);
    url.searchParams.delete("agentUrl");
    url.searchParams.delete("agentToken");
    return `${url.pathname}${url.search}${url.hash}`;
}
