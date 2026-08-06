import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-composer.tsx", import.meta.url), "utf8");

test("创作 Agent 同时提供完整图片与视频规格入口", () => {
    assert.match(composerSource, /aria-label="图片生成规格"/);
    assert.match(composerSource, /aria-label="视频生成规格"/);
    assert.match(composerSource, /<ModelPicker[\s\S]*capability="image"/);
    assert.match(composerSource, /<ModelPicker[\s\S]*capability="video"/);
    assert.match(composerSource, /<ImageSettingsPanel[\s\S]*showCount/);
    assert.match(composerSource, /<VideoSettingsPanel[\s\S]*onConfigChange=\{onVideoConfigChange\}/);
});

test("创作 Agent 保留多渠道和图片接口模式配置", () => {
    assert.match(composerSource, /resolveAgentImageChannelId/);
    assert.match(composerSource, /updateConfig\("imageChannelId"/);
    assert.match(composerSource, /updateConfig\("videoChannelId"/);
    assert.match(composerSource, /imageApiMode: mode/);
    assert.match(composerSource, /value: "responses", label: "Responses"/);
});

test("创作 Agent 输入法提交和运行状态不会重复发送", () => {
    assert.match(composerSource, /event\.nativeEvent\.isComposing/);
    assert.match(composerSource, /if \(isRunning \|\| submitDisabled \|\| \(!prompt\.trim\(\) && !references\.length\)\) return/);
});
