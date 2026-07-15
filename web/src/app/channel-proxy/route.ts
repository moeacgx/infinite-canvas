import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import type { NextRequest } from "next/server";

import { hasAuthenticatedUser } from "@/lib/server/authenticated-user";
import { assertAllowedChannelPort, decodeChannelHeaders } from "@/lib/server/channel-proxy-security";
import { createPinnedLookup, resolvePublicProxyTarget } from "@/lib/server/webdav-proxy-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNEL_PROXY_TIMEOUT_MS = 180_000;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 32;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
let activeRequests = 0;

export async function POST(request: NextRequest) {
    if (!(await hasAuthenticatedUser(request))) return new Response("请先登录后再使用本地渠道服务端转发", { status: 401 });
    if (activeRequests >= MAX_ACTIVE_REQUESTS) return new Response("渠道服务端转发繁忙，请稍后重试", { status: 503 });

    const rawTarget = request.headers.get("x-channel-target") || "";
    const method = (request.headers.get("x-channel-method") || "GET").toUpperCase();
    if (!rawTarget || rawTarget.length > 8192) return new Response("缺少或超长的渠道目标地址", { status: 400 });
    if (!ALLOWED_METHODS.has(method)) return new Response("不支持该渠道请求方法", { status: 405 });

    let target: Awaited<ReturnType<typeof resolvePublicProxyTarget>>;
    let headers: Headers;
    try {
        target = await resolvePublicProxyTarget(rawTarget);
        assertAllowedChannelPort(target.url);
        headers = decodeChannelHeaders(request.headers.get("x-channel-headers"));
    } catch (error) {
        return new Response(error instanceof Error ? error.message : "渠道目标地址无效", { status: 400 });
    }

    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    headers.delete("content-length");

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_REQUEST_BYTES) return new Response("渠道请求体过大", { status: 413 });
    let body: ArrayBuffer | undefined;
    try {
        body = method === "GET" || method === "HEAD" ? undefined : await readLimitedRequestBody(request);
    } catch {
        return new Response("渠道请求体过大", { status: 413 });
    }

    activeRequests += 1;
    let handedToStream = false;
    let cleanedUp = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHANNEL_PROXY_TIMEOUT_MS);
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener("abort", abortFromClient, { once: true });
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abortFromClient);
        activeRequests = Math.max(0, activeRequests - 1);
    };
    try {
        const response = await requestChannel(target, method, headers, body, controller.signal);
        const status = response.statusCode || 502;
        if (status >= 300 && status < 400) {
            response.destroy();
            return new Response("渠道服务端转发不允许重定向，请填写最终接口地址", { status: 502 });
        }
        const responseLength = Number(response.headers["content-length"] || 0);
        if (responseLength > MAX_RESPONSE_BYTES) {
            response.destroy();
            return new Response("渠道响应体过大", { status: 502 });
        }
        if (method === "HEAD") {
            response.destroy();
            return new Response(null, { status, headers: responseHeaders(response.headers) });
        }
        handedToStream = true;
        return new Response(createLimitedResponseStream(response, cleanup), { status, headers: responseHeaders(response.headers) });
    } catch (error) {
        if (controller.signal.aborted) return new Response("渠道服务端转发超时或已取消", { status: 504 });
        console.error("Channel proxy request failed", error instanceof Error ? error.message : error);
        return new Response("渠道服务端转发失败", { status: 502 });
    } finally {
        if (!handedToStream) cleanup();
    }
}

async function readLimitedRequestBody(request: NextRequest) {
    if (!request.body) return undefined;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
            await reader.cancel();
            throw new Error("渠道请求体过大");
        }
        chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return body.buffer;
}

function requestChannel(target: Awaited<ReturnType<typeof resolvePublicProxyTarget>>, method: string, headers: Headers, body: ArrayBuffer | undefined, signal: AbortSignal) {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const requestImpl = target.url.protocol === "https:" ? httpsRequest : httpRequest;
        const upstream = requestImpl(target.url, { method, headers: Object.fromEntries(headers.entries()), lookup: createPinnedLookup(target.addresses), signal }, resolve);
        upstream.once("error", reject);
        upstream.end(body?.byteLength ? Buffer.from(body) : undefined);
    });
}

function createLimitedResponseStream(response: IncomingMessage, release: () => void) {
    let total = 0;
    let released = false;
    const finish = () => {
        if (released) return;
        released = true;
        release();
    };
    return new ReadableStream<Uint8Array>({
        start(controller) {
            response.on("data", (chunk: Buffer) => {
                total += chunk.byteLength;
                if (total > MAX_RESPONSE_BYTES) {
                    response.destroy();
                    controller.error(new Error("渠道响应体过大"));
                    finish();
                    return;
                }
                controller.enqueue(new Uint8Array(chunk));
            });
            response.once("end", () => {
                controller.close();
                finish();
            });
            response.once("aborted", () => {
                controller.error(new Error("渠道响应被上游中断"));
                finish();
            });
            response.once("error", (error) => {
                controller.error(error);
                finish();
            });
            response.once("close", finish);
        },
        cancel() {
            response.destroy();
            finish();
        },
    });
}

function responseHeaders(headers: IncomingHttpHeaders) {
    const result = new Headers({ "x-channel-proxy": "server" });
    ["cache-control", "content-disposition", "content-type", "etag", "last-modified", "x-request-id"].forEach((key) => {
        const value = headers[key];
        if (typeof value === "string") result.set(key, value);
    });
    return result;
}
