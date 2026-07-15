export type RetryableChannelFailure = {
    channelMode: string;
    method?: string;
    code?: string;
    message?: string;
    hasResponse?: boolean;
    aborted?: boolean;
    headers?: Record<string, string>;
};

const PREFLIGHT_HEADERS = new Set(["authorization", "x-api-key", "api-key", "x-goog-api-key", "anthropic-version"]);

export function isRetryableChannelNetworkFailure(failure: RetryableChannelFailure) {
    if (failure.channelMode !== "local" || failure.hasResponse || failure.aborted) return false;
    const code = (failure.code || "").toUpperCase();
    const message = (failure.message || "").toLowerCase();
    if (code === "ERR_CANCELED" || code === "ECONNABORTED" || message.includes("abort") || message.includes("cancel")) return false;
    const isNetworkFailure = code === "ERR_NETWORK" || message.includes("network error") || message.includes("failed to fetch") || message.includes("load failed");
    if (!isNetworkFailure) return false;
    const method = (failure.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return true;
    const headers = Object.fromEntries(Object.entries(failure.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const contentType = headers["content-type"]?.toLowerCase() || "";
    return Object.keys(headers).some((key) => PREFLIGHT_HEADERS.has(key)) || (contentType !== "" && !contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data") && !contentType.startsWith("text/plain"));
}

export function channelProxyHeaders(target: string, method: string, providerHeaders: Record<string, string>, appToken: string) {
    return {
        Authorization: `Bearer ${appToken}`,
        "x-channel-target": target,
        "x-channel-method": method.toUpperCase(),
        "x-channel-headers": encodeURIComponent(JSON.stringify(providerHeaders)),
    };
}
