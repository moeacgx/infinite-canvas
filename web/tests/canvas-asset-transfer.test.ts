import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CANVAS_ASSET_DRAG_MARKER,
    CANVAS_ASSET_DRAG_TYPE,
    createCanvasAssetInsertGuard,
    isCanvasAssetInsertCanceled,
    normalizeCanvasAssetDragPayload,
    resolveCanvasAssetDropPayload,
    resolveCanvasImageForInsert,
    startCanvasAssetDrag,
} from "../src/app/(user)/canvas/utils/canvas-asset-transfer.ts";
import type { CanvasAssistantImage, InsertAssetPayload } from "../src/app/(user)/canvas/types.ts";

test("图片拖拽只向 DataTransfer 写入短标记并通过内存保留完整载荷", () => {
    const payload: InsertAssetPayload = { kind: "image", title: "大图", dataUrl: `data:image/png;base64,${"a".repeat(256_000)}`, width: 1920, height: 1080 };
    const writes: Array<{ format: string; data: string }> = [];
    const order: string[] = [];
    const transfer = {
        effectAllowed: "all",
        setData: (format: string, data: string) => {
            order.push("marker");
            writes.push({ format, data });
        },
    };
    let received: InsertAssetPayload | null = null;

    startCanvasAssetDrag(transfer, payload, (next) => {
        order.push("memory");
        received = next;
    });

    assert.equal(received, payload);
    assert.deepEqual(writes, [{ format: CANVAS_ASSET_DRAG_TYPE, data: CANVAS_ASSET_DRAG_MARKER }]);
    assert.deepEqual(order, ["marker", "memory"]);
    assert.equal(transfer.effectAllowed, "copy");

    let failedDragReceived = false;
    assert.throws(() =>
        startCanvasAssetDrag(
            {
                effectAllowed: "all",
                setData: () => {
                    throw new Error("DataTransfer 不可写");
                },
            },
            payload,
            () => {
                failedDragReceived = true;
            },
        ),
    );
    assert.equal(failedDragReceived, false);
});

test("拖拽载荷允许 storageKey 恢复图片并拒绝完全缺失地址的图片", () => {
    const storedImage: InsertAssetPayload = { kind: "image", title: "已存图片", dataUrl: "", storageKey: "image:stored" };
    const text: InsertAssetPayload = { kind: "text", title: "文案", content: "保持文本拖入" };

    assert.equal(normalizeCanvasAssetDragPayload(storedImage), storedImage);
    assert.equal(normalizeCanvasAssetDragPayload(text), text);
    assert.equal(normalizeCanvasAssetDragPayload({ kind: "image", title: "空图片", dataUrl: "", storageKey: "" }), null);
    assert.equal(normalizeCanvasAssetDragPayload({ kind: "text", title: "空文本", content: " " }), null);
    assert.equal(normalizeCanvasAssetDragPayload({ kind: "video", title: "空视频", url: "" }), null);
    assert.equal(normalizeCanvasAssetDragPayload({ kind: "audio", title: "空音频", url: "" }), null);
});

test("资产短标记门控内存载荷且无关文件拖放不会消费陈旧素材", () => {
    const storedImage: InsertAssetPayload = { kind: "image", title: "已存图片", dataUrl: "", storageKey: "image:stored" };

    assert.deepEqual(resolveCanvasAssetDropPayload(CANVAS_ASSET_DRAG_MARKER, storedImage), { matched: true, payload: storedImage });
    assert.deepEqual(resolveCanvasAssetDropPayload("", storedImage), { matched: false, payload: null });
    assert.deepEqual(resolveCanvasAssetDropPayload(CANVAS_ASSET_DRAG_MARKER, { kind: "image", title: "空图片", dataUrl: "", storageKey: "" }), {
        matched: true,
        payload: null,
        error: "图片素材没有可用地址",
    });
    assert.deepEqual(resolveCanvasAssetDropPayload("not-asset-marker", storedImage), { matched: true, payload: null, error: "素材拖拽数据无效" });
});

test("带 storageKey 的空地址图片会先解析存储地址并保留元数据", async () => {
    const image: CanvasAssistantImage = {
        id: "stored-image",
        prompt: "参考图",
        dataUrl: "",
        storageKey: "image:stored",
        width: 1600,
        height: 900,
        bytes: 4096,
        mimeType: "image/webp",
    };
    let uploaded = false;

    const resolved = await resolveCanvasImageForInsert(
        image,
        async (storageKey, fallback) => {
            assert.equal(storageKey, "image:stored");
            assert.equal(fallback, "");
            return "blob:https://canvas.test/stored-image";
        },
        async () => {
            uploaded = true;
            throw new Error("不应重复上传本地图片");
        },
    );

    assert.equal(uploaded, false);
    assert.deepEqual(resolved, {
        url: "blob:https://canvas.test/stored-image",
        storageKey: "image:stored",
        width: 1600,
        height: 900,
        bytes: 4096,
        mimeType: "image/webp",
    });
});

test("远程图片继续走现有上传代理，空图片不会创建节点", async () => {
    const uploadedImage = { url: "blob:https://canvas.test/remote", storageKey: "image:remote", width: 800, height: 600, bytes: 1024, mimeType: "image/png" };
    let uploadedUrl = "";

    const resolved = await resolveCanvasImageForInsert(
        { id: "remote-image", prompt: "远程图", dataUrl: "https://assets.example/reference.png" },
        async () => {
            throw new Error("无 storageKey 时不应解析本地存储");
        },
        async (url) => {
            uploadedUrl = url;
            return uploadedImage;
        },
    );

    assert.equal(uploadedUrl, "https://assets.example/reference.png");
    assert.equal(resolved, uploadedImage);
    await assert.rejects(
        resolveCanvasImageForInsert(
            { id: "empty-image", prompt: "空图", dataUrl: "" },
            async () => "",
            async () => uploadedImage,
        ),
        /图片素材没有可用地址/,
    );
});

test("切换画布后会中止仍在解析的素材插入", () => {
    let currentEpoch = 7;
    const assertActive = createCanvasAssetInsertGuard(currentEpoch, () => currentEpoch);

    assert.doesNotThrow(assertActive);
    currentEpoch += 1;
    assert.throws(assertActive, (error: unknown) => {
        assert.equal(isCanvasAssetInsertCanceled(error), true);
        assert.equal((error as Error).message, "画布已切换，已停止素材插入");
        return true;
    });
    assert.equal(isCanvasAssetInsertCanceled(new Error("图片下载失败")), false);
});

test("画布页面保留图片素材地址、解析存储图片并保护异步插入", () => {
    const pageSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
    const sidePanelSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-side-panel.tsx", import.meta.url), "utf8");

    assert.match(pageSource, /const dataUrl = node\.metadata\.content/);
    assert.match(pageSource, /resolveCanvasImageForInsert\(image, resolveImageUrl, uploadImage\)/);
    assert.match(pageSource, /resolveCanvasAssetDropPayload\(serializedAsset, draggedAssetPayload\)/);
    assert.match(pageSource, /message\.error\(assetDrop\.error \|\| "素材内容无效，无法插入"\)/);
    assert.match(pageSource, /createCanvasAssetInsertGuard\(projectEpochRef\.current, \(\) => projectEpochRef\.current\)/);
    assert.match(pageSource, /insertAssetForCurrentProject\(assetDrop\.payload,[\s\S]*?\.catch\(reportAssetInsertError\)/);
    assert.match(pageSource, /const handleAssetInsert[\s\S]*?insertAssetForCurrentProject\(payload\)\.catch\(reportAssetInsertError\)/);
    assert.match(pageSource, /const appendInsertedNode[\s\S]*?options\?\.assertActive\?\.\(\)[\s\S]*?nodesRef\.current/);
    assert.match(pageSource, /if \(isCanvasAssetInsertCanceled\(error\)\) return/);
    assert.match(sidePanelSource, /dataUrl: asset\.data\.dataUrl \|\| asset\.coverUrl/);
    assert.match(sidePanelSource, /dataUrl: asset\.url \|\| asset\.coverUrl/);
    assert.doesNotMatch(sidePanelSource, /JSON\.stringify\(payload\)/);
});
