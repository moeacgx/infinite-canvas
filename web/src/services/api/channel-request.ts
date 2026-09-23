import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

import type { AiConfig } from "@/stores/use-config-store";

import { isRetryableNewApiReadFailure, NEW_API_READ_RETRY_DELAYS_MS } from "./channel-retry";

type ChannelTransportConfig = Pick<AiConfig, "channelMode">;

export async function channelAxiosRequest<T = unknown>(config: ChannelTransportConfig, requestConfig: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return requestWithNewApiReadRetry<T>(config, requestConfig);
}

async function requestWithNewApiReadRetry<T>(config: ChannelTransportConfig, requestConfig: AxiosRequestConfig) {
    for (let retry = 0; ; retry += 1) {
        try {
            return await axios.request<T>(requestConfig);
        } catch (error) {
            const retryable = axios.isAxiosError(error)
                ? isRetryableNewApiReadFailure({
                      channelMode: config.channelMode,
                      method: requestConfig.method,
                      code: error.code,
                      message: error.message,
                      hasResponse: Boolean(error.response),
                      status: error.response?.status,
                      aborted: requestConfig.signal?.aborted || axios.isCancel(error),
                  })
                : false;
            if (!retryable || retry >= NEW_API_READ_RETRY_DELAYS_MS.length) throw error;
            await retryDelay(NEW_API_READ_RETRY_DELAYS_MS[retry], requestConfig.signal as AbortSignal | undefined);
        }
    }
}

export async function channelFetch(_config: ChannelTransportConfig, input: string | URL, init: RequestInit = {}) {
    return fetch(input, init);
}

function retryDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new axios.CanceledError("请求已取消"));
        const onAbort = () => {
            clearTimeout(timer);
            reject(new axios.CanceledError("请求已取消"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
