import axios, { AxiosHeaders, type AxiosRequestConfig, type AxiosResponse } from "axios";

import { useCanvasAgentStore } from "@/stores/use-agent-store";
import type { AiConfig, ChannelRequestMode } from "@/stores/use-config-store";
import { normalizeLocalAgentEndpoint, normalizeLocalAgentToken } from "@/app/(user)/canvas/utils/canvas-agent-security";

import { channelAgentHeaders, isRetryableChannelNetworkFailure, isRetryableNewApiReadFailure } from "./channel-proxy-client";

type ChannelTransportConfig = Pick<AiConfig, "channelMode"> & { requestMode?: ChannelRequestMode };
const AGENT_PREFERRED_ORIGINS_KEY = "infinite-canvas:agent-channel-origins";
const agentPreferredOrigins = new Set<string>();
const channelProxyCapableAgents = new Set<string>();
let agentOriginsLoaded = false;

export function rememberLocalAgentCapabilities(endpoint: string, capabilities: unknown) {
    if (Array.isArray(capabilities) && capabilities.includes("channel-proxy")) channelProxyCapableAgents.add(normalizeLocalAgentEndpoint(endpoint));
}

export async function channelAxiosRequest<T = unknown>(config: ChannelTransportConfig, requestConfig: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const target = axios.getUri(requestConfig);
    if (shouldUseLocalAgent(config, target)) return requestThroughLocalAgent<T>(requestConfig, axiosHeaderRecord(requestConfig.headers));
    try {
        return await requestWithNewApiReadRetry<T>(config, requestConfig);
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
        const response = await requestThroughLocalAgent<T>(requestConfig, headers);
        rememberAgentOrigin(target);
        return response;
    }
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
            if (!retryable || retry >= 2) throw error;
            await retryDelay(300 * 2 ** retry, requestConfig.signal as AbortSignal | undefined);
        }
    }
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

export async function channelFetch(config: ChannelTransportConfig, input: string | URL, init: RequestInit = {}) {
    const target = typeof input === "string" ? input : input.toString();
    if (shouldUseLocalAgent(config, target)) return fetchThroughLocalAgent(target, init);
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
        const response = await fetchThroughLocalAgent(target, init, headers);
        if (response.headers.get("x-channel-proxy") === "local-agent") rememberAgentOrigin(target);
        return response;
    }
}

async function fetchThroughLocalAgent(target: string, init: RequestInit, providerHeaders = fetchHeaderRecord(init.headers)) {
    const { endpoint, token } = requireLocalAgentConnection();
    await requireLocalAgentCapability(endpoint, init.signal || undefined);
    const proxyHeaders = new Headers(channelAgentHeaders(target, init.method || "GET", providerHeaders, token));
    const bodyIsFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const contentType = new Headers(init.headers).get("content-type");
    if (contentType && !bodyIsFormData) proxyHeaders.set("content-type", contentType);
    let response: Response;
    try {
        response = await fetch(`${endpoint}/channel-proxy`, { ...init, method: "POST", headers: proxyHeaders, credentials: "omit", mode: "cors" });
    } catch (error) {
        if (init.signal?.aborted) throw error;
        throw new Error(`无法连接本机 Canvas Agent：${error instanceof Error ? error.message : "网络错误"}`);
    }
    if (!response.ok && response.headers.get("x-channel-proxy") !== "local-agent") {
        const detail = (await response.text().catch(() => "")).trim().slice(0, 500);
        if (response.status === 404) throw new Error("本机 Canvas Agent 版本过旧，请按 Agent 面板中的命令更新后重启");
        throw new Error(detail || `本机 Canvas Agent 转发失败：HTTP ${response.status}`);
    }
    return response;
}

async function requestThroughLocalAgent<T>(requestConfig: AxiosRequestConfig, providerHeaders: Record<string, string>) {
    const { endpoint, token } = requireLocalAgentConnection();
    await requireLocalAgentCapability(endpoint, requestConfig.signal as AbortSignal | undefined);
    const method = (requestConfig.method || "GET").toUpperCase();
    const target = axios.getUri(requestConfig);
    const headers = new AxiosHeaders(channelAgentHeaders(target, method, providerHeaders, token));
    const bodyIsFormData = typeof FormData !== "undefined" && requestConfig.data instanceof FormData;
    const contentType = headerValue(providerHeaders, "content-type");
    if (contentType && !bodyIsFormData) headers.set("content-type", contentType);
    try {
        return await axios.request<T>({
            ...requestConfig,
            url: `${endpoint}/channel-proxy`,
            baseURL: undefined,
            method: "POST",
            params: undefined,
            paramsSerializer: undefined,
            headers,
            auth: undefined,
            withCredentials: false,
        });
    } catch (error) {
        if (requestConfig.signal?.aborted || axios.isCancel(error)) throw error;
        if (axios.isAxiosError(error) && error.response?.headers?.["x-channel-proxy"] === "local-agent") throw error;
        throw new Error(await localAgentErrorMessage(error));
    }
}

function requireLocalAgentConnection() {
    const state = useCanvasAgentStore.getState();
    if (!state.token.trim()) throw new Error("浏览器直连被拦截；请先在右上角 Agent 面板启动并连接本机 Canvas Agent");
    return { endpoint: normalizeLocalAgentEndpoint(state.url), token: normalizeLocalAgentToken(state.token) };
}

async function requireLocalAgentCapability(endpoint: string, signal?: AbortSignal) {
    if (channelProxyCapableAgents.has(endpoint)) return;
    let response: Response;
    try {
        response = await fetch(`${endpoint}/config`, { credentials: "omit", mode: "cors", signal });
    } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`无法连接本机 Canvas Agent：${error instanceof Error ? error.message : "网络错误"}`);
    }
    const data = (await response.json().catch(() => ({}))) as { capabilities?: unknown };
    if (!response.ok || !Array.isArray(data.capabilities) || !data.capabilities.includes("channel-proxy")) {
        throw new Error("本机 Canvas Agent 版本过旧，请按 Agent 面板中的命令更新后重启");
    }
    channelProxyCapableAgents.add(endpoint);
}

function shouldUseLocalAgent(config: ChannelTransportConfig, target: string) {
    if (config.channelMode !== "local" || config.requestMode === "direct") return false;
    if (config.requestMode === "agent") return true;
    if (!useCanvasAgentStore.getState().token.trim()) return false;
    loadAgentPreferredOrigins();
    const origin = targetOrigin(target);
    return Boolean(origin && agentPreferredOrigins.has(origin));
}

function rememberAgentOrigin(target: string) {
    loadAgentPreferredOrigins();
    const origin = targetOrigin(target);
    if (!origin) return;
    agentPreferredOrigins.add(origin);
    try {
        if (typeof window !== "undefined") sessionStorage.setItem(AGENT_PREFERRED_ORIGINS_KEY, JSON.stringify(Array.from(agentPreferredOrigins).slice(-64)));
    } catch {}
}

function loadAgentPreferredOrigins() {
    if (agentOriginsLoaded) return;
    agentOriginsLoaded = true;
    if (typeof window === "undefined") return;
    try {
        const raw = sessionStorage.getItem(AGENT_PREFERRED_ORIGINS_KEY) || "";
        if (!raw || raw.length > 16 * 1024) return;
        const values: unknown = JSON.parse(raw);
        if (!Array.isArray(values)) return;
        values.slice(-64).forEach((value) => {
            if (typeof value !== "string") return;
            try {
                const url = new URL(value);
                if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === value) agentPreferredOrigins.add(value);
            } catch {}
        });
    } catch {}
}

function targetOrigin(target: string) {
    try {
        return new URL(target, typeof location === "undefined" ? undefined : location.href).origin;
    } catch {
        return "";
    }
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

async function localAgentErrorMessage(error: unknown) {
    if (!axios.isAxiosError(error) || !error.response) return `无法连接本机 Canvas Agent：${error instanceof Error ? error.message : "网络错误"}`;
    if (error.response.status === 404) return "本机 Canvas Agent 版本过旧，请按 Agent 面板中的命令更新后重启";
    const data = error.response.data;
    let detail = "";
    if (typeof data === "string") detail = data;
    else if (typeof Blob !== "undefined" && data instanceof Blob) detail = await data.text();
    else if (data && typeof data === "object") {
        const value = data as { error?: { message?: string } | string; msg?: string; message?: string };
        detail = typeof value.error === "string" ? value.error : value.error?.message || value.msg || value.message || "";
    }
    return detail.trim().slice(0, 500) || `本机 Canvas Agent 转发失败：HTTP ${error.response.status}`;
}
