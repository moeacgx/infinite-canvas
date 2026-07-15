import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";

import { handleChannelProxy } from "../dist/channel-proxy.js";

function createResponse() {
  const state = { status: 200, body: undefined };
  const response = Object.assign(new EventEmitter(), {
    headersSent: false,
    destroyed: false,
    status(code) {
      state.status = code;
      return this;
    },
    send(body) {
      state.body = body;
      return this;
    },
  });
  return { response, state };
}

async function invoke(headers) {
  const { response, state } = createResponse();
  const request = Readable.from([]);
  request.headers = headers;
  await handleChannelProxy(request, response);
  return state;
}

test("本机渠道转发拒绝没有浏览器 Origin 的请求", async () => {
  const result = await invoke({
    "x-channel-target": "https://8.8.8.8/v1/models",
    "x-channel-method": "GET",
  });
  assert.equal(result.status, 403);
  assert.match(String(result.body), /可信网页来源/);
});

test("本机渠道转发在联网前拒绝缺失目标和非法方法", async () => {
  const missingTarget = await invoke({ origin: "https://canvas.example" });
  assert.equal(missingTarget.status, 400);
  assert.match(String(missingTarget.body), /渠道目标地址/);

  const invalidMethod = await invoke({
    origin: "https://canvas.example",
    "x-channel-target": "https://8.8.8.8/v1/models",
    "x-channel-method": "OPTIONS",
  });
  assert.equal(invalidMethod.status, 405);
  assert.match(String(invalidMethod.body), /请求方法/);
});

test("本机渠道转发在读取请求体前拒绝超大 Content-Length", async () => {
  const result = await invoke({
    origin: "https://canvas.example",
    "content-length": String(128 * 1024 * 1024 + 1),
    "x-channel-target": "https://8.8.8.8/v1/models",
    "x-channel-method": "POST",
  });
  assert.equal(result.status, 413);
  assert.match(String(result.body), /请求体过大/);
});

test("本机渠道转发拒绝损坏的上游请求头信封", async () => {
  const result = await invoke({
    origin: "https://canvas.example",
    "x-channel-target": "https://8.8.8.8/v1/models",
    "x-channel-method": "GET",
    "x-channel-headers": "%E0%A4%A",
  });
  assert.equal(result.status, 400);
  assert.match(String(result.body), /请求头格式无效/);
});
