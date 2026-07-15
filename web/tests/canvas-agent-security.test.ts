import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLocalAgentEndpoint, normalizeLocalAgentToken, removeAgentCredentialsFromUrl } from "../src/app/(user)/canvas/utils/canvas-agent-security.ts";

test("本地 Agent 仅允许环回地址", () => {
    assert.equal(normalizeLocalAgentEndpoint("http://127.0.0.1:17371/"), "http://127.0.0.1:17371");
    assert.equal(normalizeLocalAgentEndpoint("http://localhost:17371"), "http://localhost:17371");
    assert.equal(normalizeLocalAgentEndpoint("http://[::1]:17371"), "http://[::1]:17371");
    assert.throws(() => normalizeLocalAgentEndpoint("https://agent.example.com"), /环回地址/);
    assert.throws(() => normalizeLocalAgentEndpoint("http://127.0.0.1.evil.example"), /环回地址/);
    assert.throws(() => normalizeLocalAgentEndpoint("http://127.0.0.1:17371/path"), /额外路径/);
});

test("本地 Agent token 有长度和字符边界", () => {
    assert.equal(normalizeLocalAgentToken("0123456789abcdef"), "0123456789abcdef");
    assert.throws(() => normalizeLocalAgentToken("short"), /格式不正确/);
    assert.throws(() => normalizeLocalAgentToken("0123456789abcde!"), /格式不正确/);
});

test("连接凭据会从地址栏移除并保留其他参数", () => {
    assert.equal(
        removeAgentCredentialsFromUrl("https://canvas.example/canvas/1?mode=new&agentUrl=http%3A%2F%2F127.0.0.1%3A17371&agentToken=secret#x"),
        "/canvas/1?mode=new#x",
    );
});
