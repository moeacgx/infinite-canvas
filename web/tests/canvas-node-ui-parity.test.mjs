import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentRoot = new URL("../src/app/(user)/canvas/components/", import.meta.url);
const canvasRoot = new URL("../src/app/(user)/canvas/", import.meta.url);

async function readComponent(name) {
    return readFile(new URL(name, componentRoot), "utf8");
}

async function readCanvasFile(name) {
    return readFile(new URL(name, canvasRoot), "utf8");
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

test("全景节点使用 420×210 预览并明确保留图像设置、固定比例和质量面板", async () => {
    const [panoramaSource, constantsSource, promptPanelSource, popoverSource, imageSettingsSource] = await Promise.all([
        readCanvasFile("utils/canvas-panorama.ts"),
        readCanvasFile("constants.ts"),
        readComponent("canvas-node-prompt-panel.tsx"),
        readComponent("canvas-image-settings-popover.tsx"),
        readFile(new URL("../src/components/image-settings-panel.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(panoramaSource, /export const PANORAMA_IMAGE_SIZE\s*=\s*["']2:1["']/);
    assert.match(panoramaSource, /export const PANORAMA_NODE_SIZE\s*=\s*\{\s*width:\s*420,\s*height:\s*210\s*\}/);
    assert.match(panoramaSource, /function resolvePanoramaPreviewSize/);
    assert.match(constantsSource, /\[CanvasNodeType\.Panorama\]:\s*\{\s*\.\.\.PANORAMA_NODE_SIZE/);

    const settingsStart = promptPanelSource.indexOf("<CanvasImageSettingsPopover");
    const settingsEnd = promptPanelSource.indexOf("showSize={!isPanorama}", settingsStart);
    assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, "全景应复用图像设置入口并隐藏可变尺寸选择");
    const settingsBlock = promptPanelSource.slice(settingsStart, settingsEnd + "showSize={!isPanorama}".length);
    assert.match(settingsBlock, /buttonLabel[=:{][^\n]*图像设置/);
    assert.match(settingsBlock, /fixedSizeLabel[=:{][^\n]*(PANORAMA_OUTPUT_LABEL|全景 2:1)/);
    assert.match(settingsBlock, /fixedSizeHint[=:{][^\n]*panoramaSettingsHint/);

    assert.match(popoverSource, /aria-label=\{buttonLabel \|\| "图像设置"\}/);
    assert.match(popoverSource, /title=\{buttonLabel \|\| "图像设置"\}/);
    assert.match(popoverSource, /<span>输出比例<\/span>/);
    assert.match(popoverSource, /<ImageSettingsPanel[\s\S]*showSize=\{showSize\}/);
    assert.match(imageSettingsSource, /<SettingTitle[^>]*>质量<\/SettingTitle>[\s\S]*qualityOptions\.map/);
});

test("全景首次生成和重试共用 2:1 配置归一化并将自动质量提升为中质量", async () => {
    const source = await readCanvasFile("[id]/canvas-client-page.tsx");
    const normalizer = source.match(/function normalizePanoramaGenerationConfig\([\s\S]*?\n\}/)?.[0];

    assert.ok(normalizer, "全景应有统一的生成配置归一化入口");
    assert.match(normalizer, /size:\s*PANORAMA_IMAGE_SIZE/);
    assert.match(normalizer, /quality:\s*normalizePanoramaQuality\(config\.quality\)/);

    const firstGenerationStart = source.indexOf("const panoramaGenerationConfig = normalizePanoramaGenerationConfig(generationConfig)");
    assert.ok(firstGenerationStart >= 0, "首次全景生成必须先归一化配置");
    const firstGenerationBlock = source.slice(firstGenerationStart, source.indexOf("const hasSuccess", firstGenerationStart));
    assert.match(firstGenerationBlock, /requestEdit\(\{\s*\.\.\.panoramaGenerationConfig/);
    assert.match(firstGenerationBlock, /requestGeneration\(\{\s*\.\.\.panoramaGenerationConfig/);
    assert.match(firstGenerationBlock, /resolvePanoramaPreviewSize\(sourceNode\?\.width, sourceNode\?\.height\)/);
    assert.match(source, /quality:\s*node\?\.metadata\?\.quality\s*\|\|\s*\(isPanoramaNodeType\(node\?\.type\)\s*\?\s*PANORAMA_DEFAULT_QUALITY/);

    const retryStart = source.indexOf("if (isPanorama) generationConfig = normalizePanoramaGenerationConfig(");
    assert.ok(retryStart >= 0, "全景重试必须复用同一个归一化入口");
    const retryBlock = source.slice(retryStart, source.indexOf("const uploadedImage", retryStart));
    assert.match(retryBlock, /quality:\s*savedImageMetadata\?\.quality\s*\|\|\s*sourceNode\.metadata\?\.quality\s*\|\|\s*PANORAMA_DEFAULT_QUALITY/);
    assert.match(retryBlock, /requestEdit\(generationConfig,/);
    assert.match(retryBlock, /requestGeneration\(generationConfig,/);
    assert.match(source, /if \(!isCanvasImageNodeType\(node\.type\) && node\.type !== CanvasNodeType\.Video && node\.type !== CanvasNodeType\.Audio\)/);
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
