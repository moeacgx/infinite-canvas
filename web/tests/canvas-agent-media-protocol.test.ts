import assert from "node:assert/strict";
import test from "node:test";

import { CANVAS_AGENT_TOOLS, normalizeCanvasAgentAction } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";

const mediaTools = ["generate_image", "edit_image", "generate_video", "generate_audio"] as const;

test("所有媒体工具都在协议层强制显式提供 sourceNodeIds", () => {
    for (const name of mediaTools) {
        const definition = CANVAS_AGENT_TOOLS.find((tool) => tool.function.name === name);
        assert.ok(definition, `缺少 ${name} 工具定义`);
        assert.ok(definition.function.parameters.required?.includes("sourceNodeIds"), `${name} 未声明 sourceNodeIds 为必填`);
        assert.throws(() => normalizeCanvasAgentAction(name, { prompt: "测试" }), /sourceNodeIds/);
    }
});

test("独立生成必须显式传空素材数组，图片编辑仍要求真实来源", () => {
    assert.deepEqual(normalizeCanvasAgentAction("generate_image", { prompt: "猫", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.deepEqual(normalizeCanvasAgentAction("generate_video", { prompt: "猫在奔跑", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.deepEqual(normalizeCanvasAgentAction("generate_audio", { prompt: "旁白", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.throws(() => normalizeCanvasAgentAction("edit_image", { prompt: "改成夜景", sourceNodeIds: [] }), /图片来源节点/);
});

test("媒体工具保留 Agent 可配置的图片和视频规格", () => {
    const image = normalizeCanvasAgentAction("generate_image", {
        prompt: "产品图",
        sourceNodeIds: [],
        size: "2048x1152",
        quality: "high",
        count: 3,
        background: "transparent",
    });
    assert.deepEqual(image.arguments, {
        prompt: "产品图",
        sourceNodeIds: [],
        size: "2048x1152",
        quality: "high",
        count: 3,
        background: "transparent",
    });

    const video = normalizeCanvasAgentAction("generate_video", {
        prompt: "横向推进镜头",
        sourceNodeIds: [],
        size: "1280x720",
        quality: "1080",
        seconds: 10,
        generateAudio: true,
    });
    assert.deepEqual(video.arguments, {
        prompt: "横向推进镜头",
        sourceNodeIds: [],
        size: "1280x720",
        quality: "1080",
        seconds: 10,
        generateAudio: true,
    });
});
