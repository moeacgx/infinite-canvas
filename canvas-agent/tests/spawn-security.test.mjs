import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/agents.ts", import.meta.url), "utf8");

test("外部 Agent 进程禁止通过系统 shell 拼接用户提示词", () => {
    assert.doesNotMatch(source, /shell:\s*process\.platform\s*===\s*["']win32["']/);
    assert.match(source, /shell:\s*false/);
    assert.match(source, /Windows 暂不直接启动 Claude CLI/);
});
