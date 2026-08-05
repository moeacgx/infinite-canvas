import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../src/app/(user)/assets/page.tsx", import.meta.url), "utf8");
const transferSource = await readFile(new URL("../src/app/(user)/assets/asset-transfer.ts", import.meta.url), "utf8");

test("全局素材页完整展示、播放和下载音频", () => {
    assert.match(pageSource, /label: "音频", value: "audio"/);
    assert.match(pageSource, /asset\.kind === "audio"/);
    assert.match(pageSource, /<audio src=\{asset\.data\.url\} controls/);
    assert.match(pageSource, /下载音频/);
    assert.match(pageSource, /assetKindLabel/);
});

test("素材压缩包导入导出保留音频文件", () => {
    assert.match(transferSource, /asset\.kind !== "audio"/);
    assert.match(transferSource, /mimeType\.includes\("mpeg"\)/);
    assert.match(transferSource, /mimeType\.includes\("wav"\)/);
});
