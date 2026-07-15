import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import express from "express";

import { handleChannelProxy } from "../dist/channel-proxy.js";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

function pinnedLoopbackTarget(rawTarget) {
  return Promise.resolve({
    url: new URL(rawTarget),
    addresses: [{ address: "127.0.0.1", family: 4 }],
  });
}

test("本机 Agent 完整转发方法、请求头、请求体和响应状态", async () => {
  const received = {};
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.method = request.method;
    received.url = request.url;
    received.authorization = request.headers.authorization;
    received.cookie = request.headers.cookie;
    received.body = Buffer.concat(chunks).toString("utf8");
    response.writeHead(201, {
      "content-type": "application/json",
      "x-request-id": "request-1",
    });
    response.end(JSON.stringify({ ok: true }));
  });
  const upstreamPort = await listen(upstream);

  const app = express();
  app.post(
    "/channel-proxy",
    (request, response) =>
      void handleChannelProxy(request, response, {
        resolveTarget: pinnedLoopbackTarget,
      }),
  );
  const agent = app.listen(0, "127.0.0.1");
  await once(agent, "listening");
  const agentAddress = agent.address();
  assert.ok(agentAddress && typeof agentAddress === "object");

  try {
    const target = `http://provider.example:${upstreamPort}/v1/chat/completions?mode=test`;
    const response = await fetch(
      `http://127.0.0.1:${agentAddress.port}/channel-proxy`,
      {
        method: "POST",
        headers: {
          origin: "https://canvas.example",
          "content-type": "application/json",
          "x-channel-target": target,
          "x-channel-method": "POST",
          "x-channel-headers": encodeURIComponent(
            JSON.stringify({
              Authorization: "Bearer provider-key",
              Cookie: "must-not-forward",
            }),
          ),
        },
        body: JSON.stringify({ prompt: "本机转发" }),
      },
    );
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-channel-proxy"), "local-agent");
    assert.equal(response.headers.get("x-request-id"), "request-1");
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(received.method, "POST");
    assert.equal(received.url, "/v1/chat/completions?mode=test");
    assert.equal(received.authorization, "Bearer provider-key");
    assert.equal(received.cookie, undefined);
    assert.deepEqual(JSON.parse(received.body), { prompt: "本机转发" });
  } finally {
    await close(agent);
    await close(upstream);
  }
});

test("浏览器取消请求会立即终止 Agent 的上游连接", async () => {
  let resolveClosed;
  const upstreamClosed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const upstream = createServer((_request, response) => {
    const timer = setTimeout(() => response.end("late"), 5_000);
    response.once("close", () => {
      clearTimeout(timer);
      resolveClosed();
    });
  });
  const upstreamPort = await listen(upstream);

  const app = express();
  app.post(
    "/channel-proxy",
    (request, response) =>
      void handleChannelProxy(request, response, {
        resolveTarget: pinnedLoopbackTarget,
      }),
  );
  const agent = app.listen(0, "127.0.0.1");
  await once(agent, "listening");
  const agentAddress = agent.address();
  assert.ok(agentAddress && typeof agentAddress === "object");

  try {
    const controller = new AbortController();
    const pending = fetch(
      `http://127.0.0.1:${agentAddress.port}/channel-proxy`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          origin: "https://canvas.example",
          "x-channel-target": `http://provider.example:${upstreamPort}/slow`,
          "x-channel-method": "GET",
        },
      },
    );
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, /abort/i);
    await Promise.race([
      upstreamClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("上游连接未及时终止")), 1_000),
      ),
    ]);
  } finally {
    await close(agent);
    await close(upstream);
  }
});
