import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

const sourcePath = new URL("../src/app/(user)/canvas/components/canvas-config-composer.tsx", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
    compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
    },
    fileName: "canvas-config-composer.tsx",
}).outputText;

const module = { exports: {} };
const dependencyStub = new Proxy(() => undefined, {
    get: () => dependencyStub,
});
const evaluateModule = new Function("require", "module", "exports", transpiled);
evaluateModule(() => dependencyStub, module, module.exports);

const { normalizeComposerPastedText, referenceBoundarySpacing, serializeComposerTree } = module.exports;

const text = (value) => ({ kind: "text", value });
const lineBreak = () => ({ kind: "break" });
const reference = (nodeId) => ({ kind: "reference", nodeId });
const block = (...children) => ({ kind: "block", children });
const inline = (...children) => ({ kind: "inline", children });

test("配置节点序列化保留连续空行且不会重复块换行", () => {
    assert.equal(serializeComposerTree([block(text("第一行")), block(lineBreak()), block(lineBreak()), block(text("第四行"))]), "第一行\n\n\n第四行");
    assert.equal(serializeComposerTree([block(text("第一行"), lineBreak()), block(text("第二行"))]), "第一行\n第二行");
});

test("配置节点序列化为嵌套 DIV/P 补齐块边界", () => {
    assert.equal(serializeComposerTree([block(text("外层前"), block(text("内层")), inline(text("外层后"))), block(inline(text("末行")))]), "外层前\n内层\n外层后\n末行");
});

test("配置节点序列化保留引用 chip 前后的文本", () => {
    const spacing = referenceBoundarySpacing("前文", "后文");
    assert.deepEqual(spacing, { before: " ", after: " " });
    assert.equal(serializeComposerTree([text(`前文${spacing.before}`), reference("image-1"), text(`${spacing.after}后文`)]), "前文 @[node:image-1] 后文");
    assert.deepEqual(referenceBoundarySpacing("前文 ", "\n后文"), { before: "", after: "" });
});

test("纯文本粘贴统一换行符并保留多行与空行", () => {
    assert.equal(normalizeComposerPastedText("第一行\r\n\r\n第三行\r第四行"), "第一行\n\n第三行\n第四行");
    assert.equal(normalizeComposerPastedText("<b>按纯文本插入</b>"), "<b>按纯文本插入</b>");
});
