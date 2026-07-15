import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";

import { useUserStore } from "@/stores/use-user-store";
import type { AiConfig } from "@/stores/use-config-store";

import { channelProxyHeaders, isRetryableChannelNetworkFailure } from "./channel-proxy-client";

export async function channelAxiosRequest<T = unknown>(config: Pick<AiConfig, "channelMode">, requestConfig: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    try {
        return await axios.request<T>(requestConfig);
    } catch (error) {
        const headers = axiosHeaderRecord(requestConfig.headers);
        const retryable = axios.isAxiosError(error)
            ? isRetryableChannelNetworkFailure({
                  channelMode: config.channelMode,
                  method: requestConfig.method,
                  code: error.code,
                  message: error.message,
                  hasResponse: Boolean(error.response),
                  aborted: requestConfig.signal?.aborted || axios.isCancel(error),
                  headers,
              })
            : false;
        if (!retryable) throw error;
        return requestThroughChannelProxy<T>(requestConfig, headers);
    }
}

export async function channelFetch(config: Pick<AiConfig, "channelMode">, input: string | URL, init: RequestInit = {}) {
    try {
        return await fetch(input, init);
    } catch (error) {
        const headers = fetchHeaderRecord(init.headers);
        const retryable = isRetryableChannelNetworkFailure({
            channelMode: config.channelMode,
            method: init.method,
            message: error instanceof Error ? error.message : String(error),
            aborted: init.signal?.aborted,
            headers,
        });
        if (!retryable) throw error;
        const token = requireAppToken();
        const target = typeof input === "string" ? input : input.toString();
        const proxyHeaders = new Headers(channelProxyHeaders(target, init.method || "GET", headers, token));
        const bodyIsFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
        const contentType = new Headers(init.headers).get("content-type");
        if (contentType && !bodyIsFormData) proxyHeaders.set("content-type", contentType);
        const response = await fetch("/channel-proxy", { ...init, method: "POST", headers: proxyHeaders });
        return response;
    }
}

async function requestThroughChannelProxy<T>(requestConfig: AxiosRequestConfig, providerHeaders: Record<string, string>) {
    const token = requireAppToken();
    const method = (requestConfig.method || "GET").toUpperCase();
    const target = axios.getUri(requestConfig);
    const headers = new AxiosHeaders(channelProxyHeaders(target, method, providerHeaders, token));
    const bodyIsFormData = typeof FormData !== "undefined" && requestConfig.data instanceof FormData;
    const contentType = headerValue(providerHeaders, "content-type");
    if (contentType && !bodyIsFormData) headers.set("content-type", contentType);
    try {
        return await axios.request<T>({
            ...requestConfig,
            url: "/channel-proxy",
            baseURL: undefined,
            method: "POST",
            params: undefined,
            paramsSerializer: undefined,
            headers,
            auth: undefined,
            withCredentials: false,
        });
    } catch (error) {
        throw new Error(await proxyErrorMessage(error));
    }
}

function requireAppToken() {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("浏览器直连被拦截；自动服务端转发需要先登录本站，并且只应在信任当前部署时发送渠道 API Key");
    return token;
}

function axiosHeaderRecord(headers: AxiosRequestConfig["headers"]) {
    const normalized = AxiosHeaders.from(headers as Parameters<typeof AxiosHeaders.from>[0]).toJSON();
    return Object.fromEntries(
        Object.entries(normalized)
            .filter((entry): entry is [string, string | string[]] => typeof entry[1] === "string" || Array.isArray(entry[1]))
            .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
    );
}

function fetchHeaderRecord(headers?: HeadersInit) {
    return Object.fromEntries(new Headers(headers).entries());
}

function headerValue(headers: Record<string, string>, name: string) {
    const target = name.toLowerCase();
    return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

async function proxyErrorMessage(error: unknown) {
    if (!axios.isAxiosError(error) || !error.response) return error instanceof Error ? error.message : "渠道服务端转发失败";
    const data = error.response.data;
    let detail = "";
    if (typeof data === "string") detail = data;
    else if (typeof Blob !== "undefined" && data instanceof Blob) detail = await data.text();
    else if (data && typeof data === "object") {
        const value = data as { error?: { message?: string } | string; msg?: string; message?: string };
        detail = typeof value.error === "string" ? value.error : value.error?.message || value.msg || value.message || "";
    }
    return detail.trim().slice(0, 500) || `渠道服务端转发失败：HTTP ${error.response.status}`;
}
