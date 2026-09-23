export type RetryableChannelFailure = {
    channelMode: string;
    method?: string;
    code?: string;
    message?: string;
    hasResponse?: boolean;
    status?: number;
    aborted?: boolean;
};

// 长任务轮询需要覆盖短暂的浏览器、Cloudflare 和网关断流。
export const NEW_API_READ_RETRY_DELAYS_MS = [2000, 4000, 8000, 10000, 10000] as const;

export function isRetryableNewApiReadFailure(failure: RetryableChannelFailure) {
    if (failure.channelMode !== "newapi" || failure.aborted) return false;
    const method = (failure.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") return false;
    if (failure.hasResponse) return failure.status === 502 || failure.status === 503 || failure.status === 504;
    const code = (failure.code || "").toUpperCase();
    const message = (failure.message || "").toLowerCase();
    if (code === "ERR_CANCELED" || message.includes("abort") || message.includes("cancel")) return false;
    return code === "ERR_NETWORK" || code === "ECONNABORTED" || code === "ETIMEDOUT" || message.includes("network error") || message.includes("failed to fetch") || message.includes("load failed");
}
