import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");

test("画布资源拖放和蒙版编辑进入真实生成配置", () => {
    assert.match(source, /CANVAS_ASSET_DRAG_TYPE/);
    assert.match(source, /resolveCanvasAssetDropPayload\(serializedAsset, draggedAssetPayload\)/);
    assert.match(source, /insertAssetForCurrentProject\(assetDrop\.payload, screenToCanvas/);
    assert.match(source, /payload\.channelId \|\| decodeChannelModel\(selectedModel\)/);
    assert.match(source, /imageChannelId: selectedChannelId/);
    assert.match(source, /channelId: config\.imageChannelId \|\| config\.activeChannelId/);
});

test("用户快捷分组和创作 Agent 共用同一分组逻辑", () => {
    assert.match(source, /const createGroupFromSelection = useCallback/);
    assert.match(source, /key === "g"/);
    assert.match(source, /const groupId = createGroupFromSelection\(nodeIds/);
    assert.match(source, /onAddGroup=\{\(\) => \{[\s\S]{0,250}createGroupFromSelection\(\)/);
    assert.match(source, /keys=\{\["Ctrl \/ Cmd", "G"\]\}/);
});

test("创作 Agent 读取完整图片和视频规格而非固定数量", () => {
    assert.match(source, /channels: \{/);
    assert.match(source, /imageApiMode: agentEffectiveConfig\.apiMode/);
    assert.match(source, /imageBackground: agentEffectiveConfig\.background/);
    assert.match(source, /imageCount: Math\.max\(1, Number\(agentEffectiveConfig\.canvasImageCount/);
    assert.match(source, /videoMode: agentEffectiveConfig\.videoMode/);
    assert.match(source, /videoWatermark: agentEffectiveConfig\.videoWatermark/);
    assert.doesNotMatch(source, /imageCount: 1,/);
});

test("画布持久化视频任务并在刷新后恢复查询", () => {
    assert.match(source, /createVideoGenerationTask\(/);
    assert.match(source, /canvasVideoTaskMetadata\(task\)/);
    assert.match(source, /videoTaskProvider/);
    assert.match(source, /pollingVideoNodeIdsRef/);
    assert.match(source, /pollingVideoNodeIdsRef\.current\.has\(node\.id\) \|\| generationRequestsRef\.current\.has\(node\.id\)/);
    assert.match(source, /canvasVideoTaskFromMetadata\(node\.metadata\)/);
    assert.match(source, /waitForVideoGenerationTask\(generationConfig, task/);
    assert.match(source, /status === "loading" && !canvasVideoTaskFromMetadata/);
    assert.match(source, /startGenerationRequest\(node\.id, node\.id, node\.id\)/);
    assert.match(source, /item\.metadata\?\.videoTaskId === task\.id/);
    assert.match(source, /videoTaskChannelModel: task\.channelModel/);
    assert.match(source, /videoTaskId: undefined/);
});

test("Agent 技能只引用工具实际返回的视频时长字段", async () => {
    const videoSkill = await readFile(new URL("../src/app/(user)/canvas/agent/skills/video.ts", import.meta.url), "utf8");
    const scriptSkill = await readFile(new URL("../src/app/(user)/canvas/agent/skills/script.ts", import.meta.url), "utf8");
    assert.doesNotMatch(videoSkill + scriptSkill, /videoDuration/);
    assert.match(videoSkill, /videoSeconds/);
});
