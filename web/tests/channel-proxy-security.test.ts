import assert from "node:assert/strict";
import test from "node:test";

import { assertAllowedChannelPort, decodeChannelHeaders } from "../src/lib/server/channel-proxy-security.ts";

test("渠道转发请求头过滤宿主与代理相关字段", () => {
    const headers = decodeChannelHeaders(
        encodeURIComponent(JSON.stringify({ Authorization: "Bearer provider", "x-goog-api-key": "secret", Host: "internal", Cookie: "sid=x", "X-Forwarded-For": "127.0.0.1" })),
    );
    assert.equal(headers.get("authorization"), "Bearer provider");
    assert.equal(headers.get("x-goog-api-key"), "secret");
    assert.equal(headers.has("host"), false);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("x-forwarded-for"), false);
});

test("渠道转发阻断敏感端口并允许常见 API 端口", () => {
    assert.doesNotThrow(() => assertAllowedChannelPort(new URL("https://api.example.com/v1/models")));
    assert.doesNotThrow(() => assertAllowedChannelPort(new URL("http://api.example.com:8080/v1/models")));
    assert.throws(() => assertAllowedChannelPort(new URL("http://api.example.com:22/v1/models")), /端口不允许/);
    assert.throws(() => assertAllowedChannelPort(new URL("http://api.example.com:6379/")), /端口不允许/);
});
