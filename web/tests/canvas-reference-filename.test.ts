import assert from "node:assert/strict";
import test from "node:test";

import { buildNodeGenerationInputs, canvasNodeReferenceFileName } from "../src/app/(user)/canvas/components/canvas-node-generation.ts";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";

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
