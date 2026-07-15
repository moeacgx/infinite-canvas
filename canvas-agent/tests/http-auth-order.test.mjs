import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/http-server.ts", import.meta.url), "utf8");

test("大请求体仅在 token 校验通过后解析", () => {
    const authIndex = source.indexOf("if (validToken(req");
    const jsonIndex = source.indexOf('express.json({ limit: "30mb" })');
    assert.ok(authIndex >= 0);
    assert.ok(jsonIndex > authIndex);
});
