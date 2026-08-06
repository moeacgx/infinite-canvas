import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    canvasAgentActionAttachmentIds,
    canvasAgentSessionAssets,
    createPendingAgentAsset,
    findCanvasAgentAttachmentPosition,
    materializePendingAgentAssetsOnce,
    mergeCanvasAssistantReferences,
    pendingAgentAssetFromReference,
    pendingAgentAssetsFromReferences,
} from "../src/app/(user)/canvas/agent/canvas-agent-attachments.ts";
import { buildCanvasAgentUserContent, createCanvasAgentState } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import type { CanvasAgentAction } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";
import { CanvasNodeType, type CanvasAssistantReference, type InsertAssetPayload } from "../src/app/(user)/canvas/types.ts";

test("Agent 草稿附件为四类素材保留预分配节点 ID 和媒体元数据", () => {
    const cases: Array<{ payload: InsertAssetPayload; nodeId: string; expectedReference: CanvasAssistantReference }> = [
        {
            payload: { kind: "text", title: "旁白.txt", content: "雨夜中的城市旁白" },
            nodeId: "attachment-text",
            expectedReference: { id: "attachment-text", type: CanvasNodeType.Text, title: "旁白.txt", origin: "attachment", text: "雨夜中的城市旁白" },
        },
        {
            payload: {
                kind: "image",
                title: "参考图.png",
                dataUrl: "data:image/png;base64,aW1hZ2U=",
                storageKey: "asset/image",
                mimeType: "image/png",
                width: 1920,
                height: 1080,
                bytes: 2048,
            },
            nodeId: "attachment-image",
            expectedReference: {
                id: "attachment-image",
                type: CanvasNodeType.Image,
                title: "参考图.png",
                origin: "attachment",
                dataUrl: "data:image/png;base64,aW1hZ2U=",
                storageKey: "asset/image",
                mimeType: "image/png",
                width: 1920,
                height: 1080,
                bytes: 2048,
            },
        },
        {
            payload: {
                kind: "video",
                title: "运镜.mp4",
                url: "https://assets.example/video.mp4",
                storageKey: "asset/video",
                mimeType: "video/mp4",
                width: 1280,
                height: 720,
                bytes: 4096,
            },
            nodeId: "attachment-video",
            expectedReference: {
                id: "attachment-video",
                type: CanvasNodeType.Video,
                title: "运镜.mp4",
                origin: "attachment",
                url: "https://assets.example/video.mp4",
                storageKey: "asset/video",
                mimeType: "video/mp4",
                width: 1280,
                height: 720,
                bytes: 4096,
            },
        },
        {
            payload: {
                kind: "audio",
                title: "配乐.wav",
                url: "https://assets.example/music.wav",
                storageKey: "asset/audio",
                mimeType: "audio/wav",
                bytes: 8192,
                durationMs: 12_345,
            },
            nodeId: "attachment-audio",
            expectedReference: {
                id: "attachment-audio",
                type: CanvasNodeType.Audio,
                title: "配乐.wav",
                origin: "attachment",
                url: "https://assets.example/music.wav",
                storageKey: "asset/audio",
                mimeType: "audio/wav",
                bytes: 8192,
                durationMs: 12_345,
            },
        },
    ];

    for (const { payload, nodeId, expectedReference } of cases) {
        const asset = createPendingAgentAsset(payload, nodeId);
        assert.equal(asset.nodeId, nodeId);
        assert.equal(asset.payload, payload);
        assert.deepEqual(Object.fromEntries(Object.entries(asset.reference).filter(([, value]) => value !== undefined)), expectedReference);
    }
});

test("Agent 可从历史消息引用恢复附件且不会把真实画布节点当成附件", () => {
    const references: CanvasAssistantReference[] = [
        { id: "canvas-image", type: CanvasNodeType.Image, title: "画布图片", origin: "canvas", dataUrl: "data:image/png;base64,Y2FudmFz" },
        { id: "legacy-canvas", type: CanvasNodeType.Text, title: "旧画布节点", text: "旧数据没有 origin" },
        { id: "attachment-text", type: CanvasNodeType.Text, title: "文案", origin: "attachment", text: "第一版" },
        { id: "attachment-image", type: CanvasNodeType.Image, title: "参考图", origin: "attachment", dataUrl: "data:image/webp;base64,aW1hZ2U=", width: 800, height: 600, bytes: 512, mimeType: "image/webp" },
        { id: "attachment-text", type: CanvasNodeType.Text, title: "文案最新版", origin: "attachment", text: "第二版" },
        { id: "broken-video", type: CanvasNodeType.Video, title: "缺少地址", origin: "attachment" },
    ];

    assert.equal(pendingAgentAssetFromReference(references[0]), null);
    assert.equal(pendingAgentAssetFromReference(references[1]), null);
    assert.equal(pendingAgentAssetFromReference(references[5]), null);
    assert.deepEqual(pendingAgentAssetsFromReferences(references), [
        {
            nodeId: "attachment-text",
            payload: { kind: "text", title: "文案最新版", content: "第二版" },
            reference: references[4],
        },
        {
            nodeId: "attachment-image",
            payload: { kind: "image", title: "参考图", dataUrl: "data:image/webp;base64,aW1hZ2U=", width: 800, height: 600, bytes: 512, mimeType: "image/webp", storageKey: undefined },
            reference: references[3],
        },
    ]);
});

test("合并画布引用与附件时按 ID 去重并保留首次出现顺序", () => {
    const canvasReference: CanvasAssistantReference = { id: "canvas-1", type: CanvasNodeType.Text, title: "画布节点", origin: "canvas", text: "画布内容" };
    const firstAttachment: CanvasAssistantReference = { id: "attachment-1", type: CanvasNodeType.Image, title: "旧标题", origin: "attachment", dataUrl: "data:image/png;base64,b2xk" };
    const latestAttachment: CanvasAssistantReference = { ...firstAttachment, title: "新标题", dataUrl: "data:image/png;base64,bmV3" };

    assert.deepEqual(mergeCanvasAssistantReferences([canvasReference, firstAttachment], [latestAttachment, canvasReference]), [canvasReference, latestAttachment]);
});

test("历史消息、当前草稿和本轮引用合并为可继续使用的附件注册表", () => {
    const historyAsset = createPendingAgentAsset({ kind: "text", title: "历史素材", content: "历史版本" }, "shared");
    const draftAsset = createPendingAgentAsset({ kind: "text", title: "草稿素材", content: "草稿内容" }, "draft-only");
    const latestAsset = createPendingAgentAsset({ kind: "text", title: "本轮素材", content: "本轮覆盖" }, "shared");
    const currentAsset = createPendingAgentAsset({ kind: "text", title: "本轮新增", content: "当前内容" }, "current-only");
    const session = {
        id: "session-1",
        title: "附件会话",
        messages: [{ id: "message-1", role: "user" as const, text: "上一轮", references: [historyAsset.reference] }],
        draftAssets: [draftAsset],
        agentState: createCanvasAgentState(),
        protocolMessages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const assets = canvasAgentSessionAssets(session, [latestAsset.reference, currentAsset.reference]);
    assert.deepEqual(
        assets.map((asset) => asset.nodeId),
        ["shared", "draft-only", "current-only"],
    );
    assert.equal(assets[0]?.payload.kind, "text");
    assert.equal(assets[0]?.payload.kind === "text" ? assets[0].payload.content : "", "本轮覆盖");
});

test("并行媒体动作引用同一附件时只执行一次物化并在完成后释放锁", async () => {
    const asset = createPendingAgentAsset({ kind: "image", title: "参考图", dataUrl: "data:image/png;base64,aW1hZ2U=" }, "shared-image");
    const inFlight = new Map<string, Promise<void>>();
    let materialized = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const materialize = async () => {
        materialized += 1;
        await gate;
    };

    const first = materializePendingAgentAssetsOnce([asset, asset], inFlight, materialize);
    const second = materializePendingAgentAssetsOnce([asset], inFlight, materialize);
    await Promise.resolve();
    assert.equal(materialized, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(inFlight.size, 0);

    const retryMap = new Map<string, Promise<void>>();
    let attempts = 0;
    const materializeWithFailure = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("首次落地失败");
    };
    await assert.rejects(materializePendingAgentAssetsOnce([asset], retryMap, materializeWithFailure), /首次落地失败/);
    assert.equal(retryMap.size, 0);
    await materializePendingAgentAssetsOnce([asset], retryMap, materializeWithFailure);
    assert.equal(attempts, 2);
});

test("并发附件会把异步待落点占位纳入碰撞检测", () => {
    const first = findCanvasAgentAttachmentPosition({ x: 1000, y: 600 }, { width: 420, height: 240 }, 0, []);
    const occupied = [{ x: first.x - 210, y: first.y - 120, width: 420, height: 240 }];
    const second = findCanvasAgentAttachmentPosition({ x: 1000, y: 600 }, { width: 320, height: 180 }, 1, occupied);

    const separatedHorizontally = Math.abs(first.x - second.x) >= (420 + 320) / 2 + 72;
    const separatedVertically = Math.abs(first.y - second.y) >= (240 + 180) / 2 + 72;
    assert.ok(separatedHorizontally || separatedVertically);
});

test("工具动作可从所有节点 ID 字段提取已知附件并去重", () => {
    const assets = ["single", "plural", "source", "from", "to", "reference", "approved"].map((nodeId) => createPendingAgentAsset({ kind: "text", title: nodeId, content: nodeId }, nodeId));
    const action: CanvasAgentAction = {
        id: "attachment-ids",
        name: "get_canvas_summary",
        arguments: {
            nodeId: "single",
            nodeIds: ["plural", "unknown"],
            sourceNodeIds: ["source", "single"],
            fromNodeId: "from",
            toNodeId: "to",
            referenceNodeIds: ["reference"],
            approvedNodeIds: ["approved"],
            prompt: "single",
        },
    };

    assert.deepEqual(canvasAgentActionAttachmentIds(action, assets), ["single", "plural", "source", "from", "to", "reference", "approved"]);
});

test("模型用户内容明确区分真实画布节点与草稿附件并包含文本附件正文", () => {
    const content = buildCanvasAgentUserContent("请分析后再决定是否生成", [
        { id: "canvas-node", type: CanvasNodeType.Text, title: "现有分镜", origin: "canvas", text: "画布正文" },
        { id: "legacy-node", type: CanvasNodeType.Text, title: "旧版画布节点" },
        { id: "text-attachment", type: CanvasNodeType.Text, title: "用户文案", origin: "attachment", text: "附件中的完整创作要求" },
        { id: "video-attachment", type: CanvasNodeType.Video, title: "参考视频", origin: "attachment", url: "https://assets.example/reference.mp4" },
    ]);

    assert.equal(typeof content, "string");
    assert.match(content as string, /本次明确引用的真实节点：canvas-node（现有分镜）、legacy-node（旧版画布节点）/);
    assert.match(content as string, /本次明确附加的素材：text-attachment（用户文案）：附件中的完整创作要求、video-attachment（参考视频）/);
    assert.match(content as string, /首次使用时将素材落为真实节点/);
    assert.doesNotMatch((content as string).split("本次明确附加的素材：")[0], /text-attachment/);
});

test("模型用户内容为有效图片引用生成 image_url 并忽略无效媒体地址", () => {
    const content = buildCanvasAgentUserContent("参考这些图片", [
        { id: "data-image", type: CanvasNodeType.Image, title: "上传图片", origin: "attachment", dataUrl: "data:image/png;base64,aW1hZ2U=" },
        { id: "remote-image", type: CanvasNodeType.Image, title: "画布图片", origin: "canvas", dataUrl: "https://assets.example/reference.webp" },
        { id: "invalid-image", type: CanvasNodeType.Image, title: "无效地址", origin: "attachment", dataUrl: "blob:https://canvas.example/temporary" },
    ]);

    assert.ok(Array.isArray(content));
    assert.equal(content[0]?.type, "text");
    assert.match(content[0]?.type === "text" ? content[0].text : "", /data-image（上传图片）/);
    assert.deepEqual(content.slice(1), [
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
        { type: "image_url", image_url: { url: "https://assets.example/reference.webp" } },
    ]);
});

test("创作 Agent 素材入口只更新草稿附件而不复用页面立即插入节点回调", () => {
    const panelSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
    const pageSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
    const propsSource = panelSource.slice(panelSource.indexOf("type CanvasAssistantPanelProps"), panelSource.indexOf("type PendingDeleteConfirmation"));
    const panelCallStart = pageSource.indexOf("<CanvasAssistantPanel");
    const panelCallEnd = pageSource.indexOf("\n                />", panelCallStart);
    assert.ok(panelCallStart >= 0 && panelCallEnd > panelCallStart);
    const panelCallSource = pageSource.slice(panelCallStart, panelCallEnd);

    assert.doesNotMatch(propsSource, /onOpenUpload|onOpenAssets|onPasteImage/);
    assert.doesNotMatch(panelCallSource, /onOpenUpload|onOpenAssets|onPasteImage/);
    assert.match(panelSource, /onOpenUpload=\{\(\) => uploadInputRef\.current\?\.click\(\)\}/);
    assert.match(panelSource, /onOpenAssets=\{\(\) => setAssetPickerOpen\(true\)\}/);
    assert.match(panelSource, /onPasteImage=\{\(file\) => void handleAssistantFile\(file\)\}/);
    assert.match(panelSource, /onInsert=\{\(payload\) => \{\s*addDraftAsset\(payload\);/);
    assert.match(pageSource, /<CanvasAssistantPanel\s+key=\{projectId\}/);
    const actionSource = panelSource.slice(panelSource.indexOf("executeAction: async (action)"), panelSource.indexOf("signal: controller.signal", panelSource.indexOf("executeAction: async (action)")));
    assert.ok(actionSource.indexOf("const confirmed") < actionSource.indexOf("await onMaterializeReferences"));
});
