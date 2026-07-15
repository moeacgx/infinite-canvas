import assert from "node:assert/strict";
import test from "node:test";

import {
  createPinnedLookup,
  decodeChannelHeaders,
  isBlockedIpAddress,
  resolvePublicChannelTarget,
} from "../dist/channel-proxy-security.js";

test("本机渠道转发拒绝内网、环回、元数据和保留地址", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::1",
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }
  assert.equal(isBlockedIpAddress("8.8.8.8"), false);
  await assert.rejects(
    () => resolvePublicChannelTarget("http://localhost/v1/models"),
    /本机或内网/,
  );
  await assert.rejects(
    () => resolvePublicChannelTarget("http://169.254.169.254/latest/meta-data"),
    /本机、内网或保留地址/,
  );
  await assert.rejects(
    () => resolvePublicChannelTarget("https://8.8.8.8:22/v1/models"),
    /端口不允许/,
  );
});

test("渠道请求头不会把本机令牌、Cookie 和浏览器来源转发给上游", () => {
  const encoded = encodeURIComponent(
    JSON.stringify({
      Authorization: "Bearer provider",
      Cookie: "session=secret",
      Origin: "https://canvas.example",
      Referer: "https://canvas.example/canvas/1",
      "x-canvas-agent-token": "agent-secret",
      "x-channel-target": "https://evil.example",
    }),
  );
  const headers = decodeChannelHeaders(encoded);
  assert.equal(headers.get("authorization"), "Bearer provider");
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("origin"), false);
  assert.equal(headers.has("referer"), false);
  assert.equal(headers.has("x-canvas-agent-token"), false);
  assert.equal(headers.has("x-channel-target"), false);
});

test("DNS 固定 lookup 只返回安全审查过的地址", async () => {
  const lookup = createPinnedLookup([
    { address: "203.0.113.10", family: 4 },
    { address: "2001:db8::10", family: 6 },
  ]);
  await new Promise((resolve, reject) => {
    lookup("changed.example", { family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, "203.0.113.10");
      assert.equal(family, 4);
      resolve();
    });
  });
});
