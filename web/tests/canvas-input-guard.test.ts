import assert from "node:assert/strict";
import test from "node:test";

import { shouldIgnoreCanvasDoubleClick, shouldIgnoreCanvasWheel, shouldStopCanvasPan } from "../src/lib/canvas-input-guard.ts";

function targetMatching(expectedSelectorPart: string) {
    return {
        closest(selector: string) {
            return selector.includes(expectedSelectorPart) ? this : null;
        },
    };
}

test("画布浮层保留自己的滚轮交互", () => {
    assert.equal(shouldIgnoreCanvasWheel(targetMatching("[data-canvas-no-zoom]")), true);
    assert.equal(shouldIgnoreCanvasWheel(targetMatching(".ant-modal")), true);
    assert.equal(shouldIgnoreCanvasWheel(targetMatching(".ant-select-dropdown")), true);
    assert.equal(shouldIgnoreCanvasWheel(targetMatching("[data-node-id]")), false);
    assert.equal(shouldIgnoreCanvasWheel(null), false);
});

test("双击连线创建菜单不会在画布上误建节点", () => {
    assert.equal(shouldIgnoreCanvasDoubleClick(targetMatching("[data-connection-create-menu]")), true);
    assert.equal(shouldIgnoreCanvasDoubleClick(targetMatching("[data-node-id]")), true);
    assert.equal(shouldIgnoreCanvasDoubleClick(targetMatching("[data-connection-id]")), true);
    assert.equal(shouldIgnoreCanvasDoubleClick(targetMatching(".ant-modal")), false);
});

test("指针按键已经释放时终止残留拖拽", () => {
    assert.equal(shouldStopCanvasPan(0), true);
    assert.equal(shouldStopCanvasPan(1), false);
    assert.equal(shouldStopCanvasPan(4), false);
});
