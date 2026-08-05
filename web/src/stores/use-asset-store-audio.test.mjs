import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(new URL("./use-asset-store.ts", import.meta.url), "utf8");
const sidePanelSource = readFileSync(new URL("../app/(user)/canvas/components/canvas-side-panel.tsx", import.meta.url), "utf8");
const pickerSource = readFileSync(new URL("../app/(user)/canvas/components/asset-picker-modal.tsx", import.meta.url), "utf8");

test("资产存储把音频作为一等类型并恢复持久化媒体地址", () => {
    assert.match(storeSource, /AssetKind\s*=\s*"text"\s*\|\s*"image"\s*\|\s*"video"\s*\|\s*"audio"/);
    assert.match(storeSource, /type AudioAsset\s*=\s*AssetBase<"audio">/);
    assert.match(storeSource, /asset\.kind === "audio"[\s\S]*resolveMediaUrl\(asset\.data\.storageKey, asset\.data\.url\)/);
    assert.match(storeSource, /Asset\s*=\s*TextAsset\s*\|\s*ImageAsset\s*\|\s*VideoAsset\s*\|\s*AudioAsset/);
});

test("画布资产侧栏支持筛选、预览和拖入音频", () => {
    assert.match(sidePanelSource, /label:\s*"音频",\s*value:\s*"audio"/);
    assert.match(sidePanelSource, /asset\.kind === "video"\s*\|\|\s*asset\.kind === "audio"/);
    assert.match(sidePanelSource, /kind === "audio"[\s\S]*AudioLines/);
    assert.match(sidePanelSource, /return \{ kind: "audio", url: asset\.data\.url[\s\S]*durationMs: asset\.data\.durationMs/);
    assert.match(sidePanelSource, /uploadAssetMediaFile\(file, kind === "video" \? "asset-video" : "asset-audio"\)/);
    assert.match(sidePanelSource, /accept=\{kind === "image" \? "image\/\*" : kind === "video" \? "video\/\*" : "audio\/\*"\}/);
});

test("素材选择器支持音频且远程图片走安全存储代理链路", () => {
    assert.match(pickerSource, /label:\s*"音频",\s*value:\s*"audio"/);
    assert.match(pickerSource, /assetType === "audio"[\s\S]*kind: "audio"/);
    assert.match(pickerSource, /asset\.kind === "audio"[\s\S]*durationMs: asset\.data\.durationMs/);
    assert.match(pickerSource, /await uploadImage\(asset\.url\)/);
    assert.doesNotMatch(pickerSource, /axios\.get|remoteImageToDataUrl/);
});
