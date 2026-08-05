import assert from "node:assert/strict";
import test from "node:test";

import { buildNodeGenerationContext, buildNodeGenerationInputs, canvasNodeReferenceFileName } from "../src/app/(user)/canvas/components/canvas-node-generation.ts";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";

function node(id: string, type: CanvasNodeType, title: string, content?: string, mimeType?: string, storageKey?: string): CanvasNodeData {
    return { id, type, title, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content, mimeType, storageKey } };
}

test("节点引用媒体使用稳定文件名且不混入用户标题", () => {
    const target = node("target", CanvasNodeType.Config, "目标");
    const nodes = [
        node("image-node", CanvasNodeType.Image, "https://example.com/image?name=危险标题", "data:image/webp;base64,aW1hZ2U=", "image/webp", "image:key"),
        node("video-node", CanvasNodeType.Video, "视频/标题", "https://example.com/video", "video/webm", "media:video"),
        node("audio-node", CanvasNodeType.Audio, "音频?标题", "https://example.com/audio", "audio/wav", "media:audio"),
        target,
    ];
    const connections: CanvasConnection[] = nodes.slice(0, 3).map((source, index) => ({ id: `connection-${index}`, fromNodeId: source.id, toNodeId: target.id }));

    const inputs = buildNodeGenerationInputs(target.id, nodes, connections);

    assert.equal(inputs[0]?.image?.name, "image-image-node.png");
    assert.equal(inputs[1]?.video?.name, "video-video-node.mp4");
    assert.equal(inputs[2]?.audio?.name, "audio-audio-node.mp3");
    assert.deepEqual(
        inputs.map((input) => input.image?.storageKey || input.video?.storageKey || input.audio?.storageKey),
        ["image:key", "media:video", "media:audio"],
    );
    assert.deepEqual(
        inputs.map((input) => input.image?.dataUrl || input.video?.url || input.audio?.url),
        ["data:image/webp;base64,aW1hZ2U=", "https://example.com/video", "https://example.com/audio"],
    );
    assert.deepEqual(
        inputs.map((input) => input.image?.type || input.video?.type || input.audio?.type),
        ["image/webp", "video/webm", "audio/wav"],
    );
});

test("节点引用文件名按媒体类型生成", () => {
    assert.equal(canvasNodeReferenceFileName(CanvasNodeType.Image, "node-1"), "image-node-1.png");
    assert.equal(canvasNodeReferenceFileName(CanvasNodeType.Video, "node-1"), "video-node-1.mp4");
    assert.equal(canvasNodeReferenceFileName(CanvasNodeType.Audio, "node-1"), "audio-node-1.mp3");
});

test("视频节点把首尾帧、多镜头和元素素材分别映射到生成上下文", () => {
    const target = node("target", CanvasNodeType.Config, "视频配置");
    target.metadata = {
        ...target.metadata,
        firstFrameNodeId: "first",
        lastFrameNodeId: "last",
        klingImageNodeIds: ["reference"],
        klingMultiPrompt: [{ textNodeId: "shot", duration: "2" }],
        klingElementList: [{ name: "人物", description: "主角", nodeIds: ["element", "clip"] }],
    };
    const sources = [
        node("first", CanvasNodeType.Image, "首帧", "data:image/png;base64,Zmlyc3Q="),
        node("last", CanvasNodeType.Image, "尾帧", "data:image/png;base64,bGFzdA=="),
        node("reference", CanvasNodeType.Image, "参考图", "data:image/png;base64,cmVm"),
        node("element", CanvasNodeType.Image, "元素图", "data:image/png;base64,ZWxlbWVudA=="),
        node("clip", CanvasNodeType.Video, "元素视频", "https://example.com/clip.mp4", "video/mp4"),
        { ...node("shot", CanvasNodeType.Text, "镜头提示"), metadata: { content: "镜头向左推进" } },
        { ...node("general", CanvasNodeType.Text, "普通提示"), metadata: { content: "保持电影质感" } },
    ];
    const connections: CanvasConnection[] = sources.map((source, index) => ({ id: `advanced-${index}`, fromNodeId: source.id, toNodeId: target.id }));

    const context = buildNodeGenerationContext(target.id, [...sources, target], connections, "生成视频");

    assert.equal(context.firstFrame?.id, "first");
    assert.equal(context.lastFrame?.id, "last");
    assert.deepEqual(context.referenceImages.map((image) => image.id), ["reference"]);
    assert.deepEqual(context.videoMultiPrompt, [{ prompt: "镜头向左推进", duration: "2" }]);
    assert.equal(context.videoElementList[0]?.references[0]?.id, "element");
    assert.equal(context.videoElementList[0]?.references[1]?.id, "clip");
    assert.equal(context.referenceVideos.length, 0);
    assert.match(context.prompt, /保持电影质感/);
    assert.doesNotMatch(context.prompt, /镜头向左推进/);
});

test("插件声明的媒体资源可以作为 Agent 生成参考", () => {
    registerNodeDefinitions(
        [
            {
                type: "test:panorama",
                title: "测试全景",
                icon: "🌐",
                defaultSize: { width: 320, height: 180 },
                resource: (value) => ({ kind: "image", url: String(value.metadata?.content || "") }),
            },
        ],
        "test-media-resource",
    );
    try {
        const source: CanvasNodeData = {
            id: "plugin-image",
            type: "test:panorama",
            title: "全景参考",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { content: "data:image/png;base64,cGx1Z2lu", mimeType: "image/png" },
        };
        const target = node("plugin-target", CanvasNodeType.Config, "目标");
        const inputs = buildNodeGenerationInputs(target.id, [source, target], [{ id: "plugin-connection", fromNodeId: source.id, toNodeId: target.id }]);

        assert.equal(inputs[0]?.type, "image");
        assert.equal(inputs[0]?.image?.dataUrl, "data:image/png;base64,cGx1Z2lu");
    } finally {
        unregisterPluginNodes("test-media-resource");
    }
});
