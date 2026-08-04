import assert from "node:assert/strict";
import test from "node:test";

import { isSeedanceFastOrMiniModel, normalizeSeedanceResolution } from "../src/lib/seedance-video.ts";

test("Seedance fast 和 mini 模型将 1080p 归一化为 720p", () => {
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2.0-fast"), "720p");
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2.0-mini"), "720p");
});

test("Seedance fast 和 mini 模型保留支持的较低分辨率", () => {
    assert.equal(normalizeSeedanceResolution("480p", "doubao-seedance-2.0-fast"), "480p");
    assert.equal(normalizeSeedanceResolution("720p", "doubao-seedance-2.0-mini"), "720p");
});

test("Seedance pro 和其他模型保留 1080p", () => {
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2.0-pro"), "1080p");
    assert.equal(normalizeSeedanceResolution("1080p", "doubao-seedance-2.0"), "1080p");
});

test("Seedance fast 和 mini 判断不区分大小写", () => {
    assert.equal(isSeedanceFastOrMiniModel("DOUBAO-SEEDANCE-2.0-FAST"), true);
    assert.equal(isSeedanceFastOrMiniModel("Doubao-Seedance-2.0-Mini"), true);
    assert.equal(normalizeSeedanceResolution("1080P", "DOUBAO-SEEDANCE-2.0-MINI"), "720p");
});

test("非 Seedance mini 模型不受分辨率约束", () => {
    assert.equal(isSeedanceFastOrMiniModel("gpt-5-mini"), false);
    assert.equal(normalizeSeedanceResolution("1080p", "gpt-5-mini"), "1080p");
});
