import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cropSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-node-crop-dialog.tsx", import.meta.url), "utf8");
const maskSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-node-mask-edit-dialog.tsx", import.meta.url), "utf8");
const sidePanelSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-side-panel.tsx", import.meta.url), "utf8");

test("画布裁剪支持常用比例、原图比例和异步提交锁", () => {
    for (const ratio of ["original", "1:1", "4:3", "16:9", "3:4", "9:16"]) {
        assert.match(cropSource, new RegExp(`key: "${ratio.replace(":", "\\:")}"`));
    }
    assert.match(cropSource, /onConfirm: \(crop: CanvasImageCropRect\) => Promise<void> \| void/);
    assert.match(cropSource, /loading=\{loading\}/);
    assert.match(cropSource, /aspectRatio: number \| null/);
});

test("局部蒙版编辑保留标准 mask 并增加模型渠道和标记参考图", () => {
    assert.match(maskSource, /maskDataUrl: string/);
    assert.match(maskSource, /markedDataUrl: string/);
    assert.match(maskSource, /<ModelPicker/);
    assert.match(maskSource, /capability="image"/);
    assert.match(maskSource, /downloadRemoteImage/);
    assert.doesNotMatch(maskSource, /downloadRemoteMedia/);
    assert.match(maskSource, /globalCompositeOperation = "destination-in"/);
    assert.match(maskSource, /model: model \|\| config\?\.model/);
    assert.match(maskSource, /channelId: channelId \|\| config\?\.imageChannelId/);
});

test("左侧面板包含画布、资产、提示词库，并继续支持插件节点注册表", () => {
    assert.match(sidePanelSource, /label="画布"/);
    assert.match(sidePanelSource, /label="资产"/);
    assert.match(sidePanelSource, /label="提示词库"/);
    assert.match(sidePanelSource, /listNodeDefinitions\(\)/);
    assert.match(sidePanelSource, /getNodeDefinition\(node\.type\)/);
    assert.match(sidePanelSource, /useNodeRegistryVersion/);
    assert.match(sidePanelSource, /fetchAssetLibrary/);
    assert.match(sidePanelSource, /fetchPrompts/);
    assert.match(sidePanelSource, /QuickAssetFormModal/);
    assert.match(sidePanelSource, /startCanvasAssetDrag\(event\.dataTransfer, payload, onAssetDragStart\)/);
    assert.match(sidePanelSource, /data-canvas-side-panel-backdrop/);
});
