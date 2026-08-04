import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

const sourcePath = new URL("../src/app/(user)/canvas/components/canvas-prompt-chip-input.tsx", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
    compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: "canvas-prompt-chip-input.tsx",
}).outputText;

const module = { exports: {} };
const dependencyStub = new Proxy(() => undefined, {
    get: () => dependencyStub,
});
const evaluateModule = new Function("require", "module", "exports", transpiled);
evaluateModule(() => dependencyStub, module, module.exports);

const { parsePromptTokens } = module.exports;

test("提示词中的资源标签会转换为原子引用 token", () => {
    assert.deepEqual(parsePromptTokens("让 图片1 参考文本1生成", ["图片1", "文本1"]), [
        { type: "text", value: "让 " },
        { type: "reference", label: "图片1" },
        { type: "text", value: " 参考" },
        { type: "reference", label: "文本1" },
        { type: "text", value: "生成" },
    ]);
});

test("资源标签支持正则特殊字符并保留换行", () => {
    assert.deepEqual(parsePromptTokens("第一行\n图[1]\n第三行", ["图[1]"]), [
        { type: "text", value: "第一行\n" },
        { type: "reference", label: "图[1]" },
        { type: "text", value: "\n第三行" },
    ]);
});

test("没有资源标签时保持原始提示词", () => {
    assert.deepEqual(parsePromptTokens("普通提示词", []), [{ type: "text", value: "普通提示词" }]);
    assert.deepEqual(parsePromptTokens("", []), []);
});
