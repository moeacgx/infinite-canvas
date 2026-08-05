import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/app/(user)/canvas/components/canvas-camera-control.tsx", import.meta.url), "utf8");

test("摄像机面板在手机端限制到视口并使用两列参数布局", () => {
    assert.match(source, /viewport\.width <= 720/);
    assert.match(source, /left: 8,[\s\S]{0,80}right: 8,[\s\S]{0,80}bottom: 8/);
    assert.match(source, /grid min-w-0 grid-cols-2 gap-y-6 sm:min-w-\[840px\] sm:grid-cols-4/);
    assert.match(source, /separator=\{!compact\}/);
});
