import assert from "node:assert/strict";
import test from "node:test";

import { channelAgentHeaders, isRetryableChannelNetworkFailure, isRetryableNewApiReadFailure } from "../src/services/api/channel-proxy-client.ts";

test("New API 只重试幂等读取的瞬时网络错误", () => {
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", code: "ERR_NETWORK" }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "HEAD", code: "ETIMEDOUT" }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", hasResponse: true, status: 502 }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "POST", code: "ERR_NETWORK" }), false);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", code: "ERR_CANCELED", aborted: true }), false);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "local", method: "GET", code: "ERR_NETWORK" }), false);
});

test("本地 GET 网络错误可回退，remote/New API 与取消请求不回退", () => {
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "GET", code: "ERR_NETWORK" }), true);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "remote", method: "GET", code: "ERR_NETWORK" }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "newapi", method: "GET", code: "ERR_NETWORK" }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "GET", code: "ERR_CANCELED", aborted: true }), false);
});

test("本地写请求网络错误不自动重放，避免重复生成和扣费", () => {
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "POST", code: "ERR_NETWORK", headers: { Authorization: "Bearer key" } }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "POST", code: "ERR_NETWORK", headers: { "Content-Type": "application/json" } }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "POST", code: "ERR_NETWORK", headers: { "Content-Type": "text/plain" } }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "PUT", code: "ERR_NETWORK", headers: { Authorization: "Bearer key" } }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "DELETE", code: "ERR_NETWORK", headers: { Authorization: "Bearer key" } }), false);
    assert.equal(isRetryableChannelNetworkFailure({ channelMode: "local", method: "POST", code: "ERR_NETWORK", hasResponse: true, headers: { Authorization: "Bearer key" } }), false);
});

test("本机 Agent 协议隔离配对 token 与上游请求头", () => {
    const headers = channelAgentHeaders("https://api.example.com/v1/models", "get", { Authorization: "Bearer provider" }, "agent-token");
    assert.equal(headers["x-canvas-agent-token"], "agent-token");
    assert.equal(headers["x-channel-method"], "GET");
    assert.deepEqual(JSON.parse(decodeURIComponent(headers["x-channel-headers"])), { Authorization: "Bearer provider" });
});
