import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasAgentContext, canvasAgentMediaTaskId, serializeCanvasAgentContext } from "../src/app/(user)/canvas/agent/canvas-agent-context.ts";
import { createCanvasAgentState } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";

function textNode(id: string, content: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 220,
        metadata: { content, prompt: content, status: "success" },
    };
}

function mediaNode(type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: String(type), type, title: String(type), position: { x: 0, y: 0 }, width: 320, height: 180, metadata };
}

test("Agent 按图片、全景、视频和音频类型读取对应任务 ID", () => {
    assert.equal(canvasAgentMediaTaskId(mediaNode(CanvasNodeType.Image, { imageTaskId: "image-task" })), "image-task");
    assert.equal(canvasAgentMediaTaskId(mediaNode(CanvasNodeType.Panorama, { imageTaskId: "panorama-task" })), "panorama-task");
    assert.equal(canvasAgentMediaTaskId(mediaNode(CanvasNodeType.Video, { videoTaskId: "video-task" })), "video-task");
    assert.equal(canvasAgentMediaTaskId(mediaNode(CanvasNodeType.Audio, { audioTaskId: "audio-task" })), "audio-task");
});

test("Agent 上下文限制总文本规模且优先保留选中节点", () => {
    const nodes = Array.from({ length: 120 }, (_, index) => textNode(`node-${index}`, String(index).padStart(3, "0") + "x".repeat(3997)));
    const selectedId = nodes.at(-1)!.id;
    const context = buildCanvasAgentContext({
        projectId: "project",
        projectTitle: "上下文预算",
        nodes,
        connections: [],
        selectedNodeIds: [selectedId],
        config: defaultConfig,
        agentState: createCanvasAgentState(),
    });

    assert.equal(context.nodes[0].id, selectedId);
    assert.ok(context.nodes.length < nodes.length);
    assert.ok(serializeCanvasAgentContext(context).length < 60_000);
});

test("Agent 上下文保留全局视频声音配置且不静态猜测自定义模型能力", () => {
    const context = buildCanvasAgentContext({
        projectId: "project",
        projectTitle: "能力",
        nodes: [],
        connections: [],
        selectedNodeIds: [],
        config: { ...defaultConfig, model: "text-model", videoModel: "bytedance/seedance_2" },
        agentState: createCanvasAgentState(),
    });

    assert.equal(context.generation.videoModel, "bytedance/seedance_2");
    assert.equal(context.generation.videoGenerateAudio, defaultConfig.videoGenerateAudio);
    assert.equal(Object.hasOwn(context.generation, "videoSupportsAudio"), false);
});

test("Agent 上下文公开用户选定的图片与视频生成规格", () => {
    const context = buildCanvasAgentContext({
        projectId: "project",
        projectTitle: "规格",
        nodes: [],
        connections: [],
        selectedNodeIds: [],
        config: {
            ...defaultConfig,
            channelMode: "local",
            imageChannelId: "image-channel",
            videoChannelId: "video-channel",
            apiMode: "responses",
            background: "transparent",
            count: "4",
            canvasImageCount: "4",
            videoMode: "pro",
            videoWatermark: "false",
        },
        agentState: createCanvasAgentState(),
    });

    assert.deepEqual(
        {
            channelMode: context.generation.channelMode,
            imageChannelId: context.generation.imageChannelId,
            videoChannelId: context.generation.videoChannelId,
            imageApiMode: context.generation.imageApiMode,
            imageBackground: context.generation.imageBackground,
            imageCount: context.generation.imageCount,
            videoMode: context.generation.videoMode,
            videoWatermark: context.generation.videoWatermark,
        },
        {
            channelMode: "local",
            imageChannelId: "image-channel",
            videoChannelId: "video-channel",
            imageApiMode: "responses",
            imageBackground: "transparent",
            imageCount: "4",
            videoMode: "pro",
            videoWatermark: "false",
        },
    );
});
