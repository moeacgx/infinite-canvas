import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/video-settings-panel.tsx", import.meta.url), "utf8");

test("共享视频规格面板覆盖 Kling、Grok 和 Seedance 专用配置", () => {
    assert.match(source, /KlingV26VideoSettingsPanel/);
    assert.match(source, /klingV3ModeOptions/);
    assert.match(source, /videoNegativePrompt/);
    assert.match(source, /isGrokVideoSettingsModel/);
    assert.match(source, /grokVideoModeOptions/);
    assert.match(source, /SeedanceVideoSettingsPanel/);
    assert.match(source, /AudioGenerationSetting/);
});

test("共享视频规格面板保留 New API 时长限制和多渠道模型识别", () => {
    assert.match(source, /getVideoMaxSeconds\(config, resolvedModel\)/);
    assert.match(source, /secondOptions[\s\S]{0,100}\.filter\(\(value\) => value <= maxSeconds\)/);
    assert.match(source, /decodeChannelModel\(modelName\)\?\.channelId/);
    assert.match(source, /model\?: string/);
    assert.match(source, /modelName\?: string/);
    assert.match(source, /visualOnly\?: boolean/);
});
