import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentRoot = new URL("../src/app/(user)/canvas/components/", import.meta.url);

async function readComponent(name) {
    return readFile(new URL(name, componentRoot), "utf8");
}

test("全景查看器保留交互并显示完整中文文案", async () => {
    const source = await readComponent("canvas-panorama-viewer.tsx");

    assert.doesNotMatch(source, /\?{4}/);
    assert.match(source, /正在加载全景图\.\.\./);
    assert.match(source, /全景图加载失败/);
    assert.match(source, /title="拖动节点"/);
    assert.match(source, /title="沉浸式查看"/);
    assert.match(source, /MAX_ACTIVE_PANORAMA_VIEWERS/);
    assert.match(source, /onContextMenu/);
});

test("图片和全景快捷工具过滤后仍保留插件工具", async () => {
    const source = await readComponent("canvas-node-hover-toolbar.tsx");

    assert.match(source, /const toolbarTools = hasImage[\s\S]{0,500}\.\.\.extraTools[\s\S]{0,250}:\s*\[\.\.\.baseToolbarTools,\s*\.\.\.nodeToolbarTools,\s*\.\.\.extraTools\]/);
    assert.match(source, /const isImage = isCanvasImageNodeType\(node\.type\)/);
    assert.match(source, /PANORAMA_QUICK_TOOLS_STORAGE_KEY/);
    assert.match(source, /defaultPanoramaQuickToolIds/);
    assert.match(source, /tool\.id !== "replace"/);
});

test("节点生成态显示耗时、进度和视频专用进度条", async () => {
    const source = await readComponent("canvas-node.tsx");

    assert.match(source, /formatDuration/);
    assert.match(source, /startedAt/);
    assert.match(source, /node\.type === CanvasNodeType\.Video/);
    assert.match(source, /正在创作 \{progress\}%/);
    assert.match(source, /当前创作进度/);
    assert.match(source, /width: `\$\{progress\}%`/);
    assert.match(source, /<LoadingContent node=\{props\.node\} theme=\{props\.theme\} now=\{props\.now\}/);
    assert.match(source, /PanoramaNodeContent/);
});
