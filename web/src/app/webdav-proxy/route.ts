import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import type { NextRequest } from "next/server";

import { hasAuthenticatedUser } from "@/lib/server/authenticated-user";
import { createPinnedLookup, resolvePublicProxyTarget } from "@/lib/server/webdav-proxy-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBDAV_PROXY_TIMEOUT_MS = 120000;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "PUT", "MKCOL", "PROPFIND"]);
const BODYLESS_METHODS = new Set(["GET", "HEAD", "MKCOL", "PROPFIND"]);

export async function POST(request: NextRequest) {
    if (!(await hasAuthenticatedUser(request))) return new Response("请先登录后再使用 WebDAV 服务端转发", { status: 401 });

    const target = request.headers.get("x-webdav-target") || "";
    const method = (request.headers.get("x-webdav-method") || "GET").toUpperCase();
    if (!target) return new Response("缺少 WebDAV 目标地址", { status: 400 });
    if (!ALLOWED_METHODS.has(method)) return new Response("不支持该 WebDAV 请求方法", { status: 405, headers: { Allow: Array.from(ALLOWED_METHODS).join(", ") } });

    let resolvedTarget;
    try {
        resolvedTarget = await resolvePublicProxyTarget(target);
    } catch (error) {
        return new Response(error instanceof Error ? error.message : "WebDAV 目标地址无效", { status: 400 });
    }

    const headers = new Headers();
    copyHeader(request, headers, "x-webdav-authorization", "Authorization");
    copyHeader(request, headers, "x-webdav-depth", "Depth");
    copyHeader(request, headers, "x-webdav-content-type", "Content-Type");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBDAV_PROXY_TIMEOUT_MS);
    const abortFromClient = () => controller.abort();
    request.signal.addEventListener("abort", abortFromClient, { once: true });
    try {
        const declaredLength = Number(request.headers.get("content-length") || 0);
        if (declaredLength > MAX_REQUEST_BYTES) return new Response("WebDAV 请求体过大", { status: 413 });
        const body = BODYLESS_METHODS.has(method) ? undefined : await request.arrayBuffer();
        if (body && body.byteLength > MAX_REQUEST_BYTES) return new Response("WebDAV 请求体过大", { status: 413 });

        const response = await requestWebdav(resolvedTarget, method, headers, body, controller.signal);
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            response.destroy();
            return new Response("WebDAV 服务端转发不允许重定向，请直接填写最终地址", { status: 502 });
        }
        const responseBody = method === "HEAD" ? null : await readLimitedResponse(response);
        if (method === "HEAD") response.destroy();
        return new Response(responseBody, {
            status: response.statusCode || 502,
            headers: responseHeaders(response.headers, responseBody?.byteLength),
        });
    } catch (error) {
        if (controller.signal.aborted) return new Response("WebDAV 服务端转发超时或已取消", { status: 504 });
        console.error("WebDAV proxy request failed", error instanceof Error ? error.message : error);
        return new Response(error instanceof Error && error.message === "WebDAV 响应体过大" ? error.message : "WebDAV 服务端转发失败", { status: 502 });
    } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abortFromClient);
    }
}

function requestWebdav(target: Awaited<ReturnType<typeof resolvePublicProxyTarget>>, method: string, headers: Headers, body: ArrayBuffer | undefined, signal: AbortSignal) {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const requestImpl = target.url.protocol === "https:" ? httpsRequest : httpRequest;
        const upstream = requestImpl(
            target.url,
            {
                method,
                headers: Object.fromEntries(headers.entries()),
                lookup: createPinnedLookup(target.addresses),
                signal,
            },
            resolve,
        );
        upstream.once("error", reject);
        upstream.end(body?.byteLength ? Buffer.from(body) : undefined);
    });
}

async function readLimitedResponse(response: IncomingMessage) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
            response.destroy();
            throw new Error("WebDAV 响应体过大");
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
}

function copyHeader(request: NextRequest, headers: Headers, from: string, to: string) {
    const value = request.headers.get(from);
    if (value) headers.set(to, value);
}

function responseHeaders(headers: IncomingMessage["headers"], contentLength?: number) {
    const result = new Headers();
    ["content-type", "etag", "last-modified", "dav"].forEach((key) => {
        const value = headers[key];
        if (typeof value === "string") result.set(key, value);
    });
    if (typeof contentLength === "number") result.set("content-length", String(contentLength));
    return result;
}
