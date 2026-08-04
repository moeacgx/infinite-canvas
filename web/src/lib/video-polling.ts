import axios from "axios";

export const VIDEO_POLL_TRANSIENT_FAILURE_LIMIT = 5;

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isTransientVideoPollError(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted || axios.isCancel(error)) return false;
    if (axios.isAxiosError(error)) {
        if (!error.response) return true;
        return TRANSIENT_HTTP_STATUSES.has(error.response.status);
    }
    if (!(error instanceof Error)) return false;
    return /network error|failed to fetch|network request failed|load failed|timed?\s*out|econnreset|econnrefused|socket|无法连接本机 canvas agent/i.test(error.message);
}

export function reachedVideoPollFailureLimit(consecutiveFailures: number): boolean {
    return consecutiveFailures >= VIDEO_POLL_TRANSIENT_FAILURE_LIMIT;
}
