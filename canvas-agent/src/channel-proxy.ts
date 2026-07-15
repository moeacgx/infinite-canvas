import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { request as httpsRequest } from "node:https";

import type { Request, Response } from "express";

import {
  createPinnedLookup,
  decodeChannelHeaders,
  resolvePublicChannelTarget,
  type PublicChannelTarget,
} from "./channel-proxy-security.js";

const CHANNEL_PROXY_TIMEOUT_MS = 180_000;
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 4;
const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);
let activeRequests = 0;

type ChannelProxyDependencies = {
  resolveTarget?: typeof resolvePublicChannelTarget;
};

export async function handleChannelProxy(
  req: Request,
  res: Response,
  dependencies: ChannelProxyDependencies = {},
) {
  const origin = req.headers.origin;
  if (!origin || origin === "null")
    return void res.status(403).send("本机渠道转发要求可信网页来源");
  if (activeRequests >= MAX_ACTIVE_REQUESTS)
    return void res.status(503).send("本机渠道转发繁忙，请稍后重试");

  const rawTarget = singleHeader(req.headers["x-channel-target"]);
  const method = (
    singleHeader(req.headers["x-channel-method"]) || "GET"
  ).toUpperCase();
  if (!rawTarget || rawTarget.length > 8192)
    return void res.status(400).send("缺少或超长的渠道目标地址");
  if (!ALLOWED_METHODS.has(method))
    return void res.status(405).send("不支持该渠道请求方法");

  const declaredLength = Number(req.headers["content-length"] || 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_REQUEST_BYTES
  )
    return void res.status(413).send("渠道请求体过大");

  activeRequests += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHANNEL_PROXY_TIMEOUT_MS);
  const abortFromClient = () => controller.abort();
  req.once("aborted", abortFromClient);
  res.once("close", abortFromClient);
  try {
    let target: PublicChannelTarget;
    let headers: Map<string, string>;
    try {
      target = await raceWithAbort(
        (dependencies.resolveTarget || resolvePublicChannelTarget)(rawTarget),
        controller.signal,
      );
      headers = decodeChannelHeaders(
        singleHeader(req.headers["x-channel-headers"]),
      );
    } catch (error) {
      if (controller.signal.aborted) throw error;
      res
        .status(400)
        .send(error instanceof Error ? error.message : "渠道目标地址无效");
      return;
    }

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await readLimitedRequestBody(req, controller.signal);
    const contentType = req.headers["content-type"];
    if (typeof contentType === "string")
      headers.set("content-type", contentType);
    if (body?.byteLength)
      headers.set("content-length", String(body.byteLength));

    const upstream = await requestChannel(
      target,
      method,
      headers,
      body,
      controller.signal,
    );
    const status = upstream.statusCode || 502;
    if (status >= 300 && status < 400) {
      upstream.destroy();
      res.status(502).send("本机渠道转发不允许重定向，请填写最终接口地址");
      return;
    }
    const responseLength = Number(upstream.headers["content-length"] || 0);
    if (
      !Number.isFinite(responseLength) ||
      responseLength < 0 ||
      responseLength > MAX_RESPONSE_BYTES
    ) {
      upstream.destroy();
      res.status(502).send("渠道响应体过大");
      return;
    }

    res.status(status);
    applyResponseHeaders(res, upstream.headers);
    if (method === "HEAD") {
      upstream.destroy();
      res.end();
      return;
    }
    await streamLimitedResponse(upstream, res, controller);
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (isBodyTooLarge(error)) res.status(413).send("渠道请求体过大");
    else if (controller.signal.aborted)
      res.status(504).send("本机渠道转发超时或已取消");
    else res.status(502).send("本机渠道转发失败");
  } finally {
    clearTimeout(timer);
    req.off("aborted", abortFromClient);
    res.off("close", abortFromClient);
    activeRequests = Math.max(0, activeRequests - 1);
  }
}

async function readLimitedRequestBody(req: Request, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let total = 0;
  const abort = () => req.destroy(new Error("CHANNEL_REQUEST_ABORTED"));
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const rawChunk of req) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BYTES)
        throw new Error("CHANNEL_REQUEST_TOO_LARGE");
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
  return chunks.length ? Buffer.concat(chunks, total) : undefined;
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("CHANNEL_REQUEST_ABORTED"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function requestChannel(
  target: PublicChannelTarget,
  method: string,
  headers: Map<string, string>,
  body: Buffer | undefined,
  signal: AbortSignal,
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const requestImpl =
      target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = requestImpl(
      target.url,
      {
        method,
        headers: Object.fromEntries(headers),
        lookup: createPinnedLookup(target.addresses),
        signal,
      },
      resolve,
    );
    upstream.once("error", reject);
    upstream.end(body);
  });
}

function streamLimitedResponse(
  upstream: IncomingMessage,
  res: Response,
  controller: AbortController,
) {
  return new Promise<void>((resolve, reject) => {
    let total = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    upstream.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        upstream.destroy();
        controller.abort();
        finish(new Error("CHANNEL_RESPONSE_TOO_LARGE"));
        return;
      }
      if (!res.write(chunk)) upstream.pause();
    });
    res.on("drain", () => upstream.resume());
    upstream.once("end", () => {
      res.end();
      finish();
    });
    upstream.once("aborted", () => finish(new Error("渠道响应被上游中断")));
    upstream.once("error", finish);
    upstream.once("close", () => {
      if (!upstream.complete) finish(new Error("渠道响应连接提前关闭"));
    });
  });
}

function applyResponseHeaders(res: Response, headers: IncomingHttpHeaders) {
  res.setHeader("x-channel-proxy", "local-agent");
  [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "x-request-id",
  ].forEach((key) => {
    const value = headers[key];
    if (typeof value === "string") res.setHeader(key, value);
  });
}

function singleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function isBodyTooLarge(error: unknown) {
  return (
    error instanceof Error && error.message === "CHANNEL_REQUEST_TOO_LARGE"
  );
}
