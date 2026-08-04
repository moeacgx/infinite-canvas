import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canvasPage = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const sidePanel = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-side-panel.tsx", import.meta.url), "utf8");

test("手机元素侧栏提供遮罩且遮罩与关闭按钮均可关闭", () => {
    assert.match(sidePanel, /data-canvas-side-panel-backdrop/);
    assert.match(sidePanel, /className="absolute inset-0 z-\[130\][^"]*md:hidden"/);
    assert.match(sidePanel, /className="absolute inset-y-0 left-0 z-\[140\][^"]*md:z-\[60\]"/);
    assert.match(sidePanel, /animate=\{\{ opacity: open \? 1 : 0 \}\}/);
    assert.match(sidePanel, /onClick=\{onClose\}[\s\S]*aria-label="关闭画布元素面板"/);
    assert.match(sidePanel, /onClick=\{onClose\} aria-label="收起左侧面板"/);
});

test("元素侧栏打开时仅在手机隐藏画布浮动控件", () => {
    assert.match(canvasPage, /<main className="relative flex h-full min-h-0 overflow-hidden"/);
    assert.match(canvasPage, /className=\{sidePanel\.open \? "hidden md:contents" : "contents"\} data-canvas-floating-controls/);

    const controlsStart = canvasPage.indexOf("data-canvas-floating-controls");
    assert.ok(controlsStart >= 0);
    const toolbar = canvasPage.indexOf("<CanvasToolbar", controlsStart);
    const minimap = canvasPage.indexOf("<Minimap", controlsStart);
    const zoom = canvasPage.indexOf("<CanvasZoomControls", controlsStart);
    assert.ok(toolbar > controlsStart);
    assert.ok(minimap > toolbar);
    assert.ok(zoom > minimap);
});
