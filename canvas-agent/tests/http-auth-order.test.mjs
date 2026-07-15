import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/http-server.ts", import.meta.url),
  "utf8",
);

test("大请求体仅在 token 校验通过后解析", () => {
  const authIndex = source.indexOf("if (validToken(req");
  const proxyIndex = source.indexOf('app.post("/channel-proxy"');
  const jsonIndex = source.indexOf('express.json({ limit: "30mb" })');
  assert.ok(authIndex >= 0);
  assert.ok(proxyIndex > authIndex);
  assert.ok(jsonIndex > proxyIndex);
  assert.ok(jsonIndex > authIndex);
});

test("本机渠道转发预检声明专用鉴权和协议请求头", () => {
  assert.match(
    source,
    /x-canvas-agent-token,x-channel-target,x-channel-method,x-channel-headers/,
  );
  assert.doesNotMatch(source, /Access-Control-Allow-Origin", origin \|\| "\*"/);
});
