export type RetryableChannelFailure = {
    channelMode: string;
    method?: string;
    code?: string;
    message?: string;
    hasResponse?: boolean;
    aborted?: boolean;
    headers?: Record<string, string>;
};

export function isRetryableChannelNetworkFailure(failure: RetryableChannelFailure) {
    if (failure.channelMode !== "local" || failure.hasResponse || failure.aborted) return false;
    const code = (failure.code || "").toUpperCase();
    const message = (failure.message || "").toLowerCase();
    if (code === "ERR_CANCELED" || code === "ECONNABORTED" || message.includes("abort") || message.includes("cancel")) return false;
    const isNetworkFailure = code === "ERR_NETWORK" || message.includes("network error") || message.includes("failed to fetch") || message.includes("load failed");
    if (!isNetworkFailure) return false;
    const method = (failure.method || "GET").toUpperCase();
    // 浏览器不会说明错误发生在预检还是实际响应阶段。写请求可能已经被
    // 上游处理，自动经服务端重放会造成重复生成或双重扣费。
    return method === "GET" || method === "HEAD";
}

export function channelAgentHeaders(target: string, method: string, providerHeaders: Record<string, string>, agentToken: string) {
    return {
        "x-canvas-agent-token": agentToken,
        "x-channel-target": target,
        "x-channel-method": method.toUpperCase(),
        "x-channel-headers": encodeURIComponent(JSON.stringify(providerHeaders)),
    };
}
