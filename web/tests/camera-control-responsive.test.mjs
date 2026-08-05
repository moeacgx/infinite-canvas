import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/app/(user)/canvas/components/canvas-camera-control.tsx", import.meta.url), "utf8");

test("摄像机面板在 320px 和 390px 手机端限制到视口并使用两列参数布局", () => {
    assert.match(source, /viewport\.width <= 720/);
    assert.match(source, /left: 8,[\s\S]{0,80}right: 8,[\s\S]{0,80}bottom: 8/);
    assert.match(source, /compact \? "overflow-x-hidden" : "overflow-x-auto"/);
    assert.match(source, /compact \? "grid min-w-0 grid-cols-2 gap-y-6" : "grid min-w-\[840px\] grid-cols-4 gap-y-0"/);
    assert.doesNotMatch(source, /sm:min-w-\[840px\]/);
    assert.match(source, /separator=\{!compact\}/);
});

test("摄像机面板桌面端保留四列内容和原有缩放定位", () => {
    assert.match(source, /const scale = 0\.75/);
    assert.match(source, /width: 900/);
    assert.match(source, /transform: "translateX\(-50%\) scale\(0\.75\)"/);
    assert.match(source, /"grid min-w-\[840px\] grid-cols-4 gap-y-0"/);
});
