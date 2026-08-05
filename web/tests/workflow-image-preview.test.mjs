import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const imagePageSource = await readFile(new URL("../src/app/(user)/image/page.tsx", import.meta.url), "utf8");
const workflowSource = await readFile(new URL("../src/components/workflows/creative-workflow-workspace.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("生图工作台把同一工作流任务的全部结果放入原图预览组", () => {
    assert.match(imagePageSource, /target\.workflowTaskId \? results\.filter\(\(item\) => item\.workflowTaskId === target\.workflowTaskId\)/);
    assert.match(imagePageSource, /<Image\.PreviewGroup[\s\S]*items=\{previewItems\}[\s\S]*countRender: \(current, total\) => `第 \$\{current\} \/ \$\{total\} 张`/);
    assert.match(imagePageSource, /<ResultImageCard[\s\S]*onPreview=\{\(\) => openResultPreview\(result\)\}/);
    assert.match(imagePageSource, /aria-label="查看原图"[\s\S]*<Maximize2/);
});

test("历史任务可以查看全部图片并从任意缩略图进入对应原图", () => {
    assert.match(imagePageSource, /const openLogPreview = \(log: GenerationLog, current = 0\)/);
    assert.match(imagePageSource, /const \[activeImageIndex, setActiveImageIndex\] = useState\(0\)/);
    assert.match(imagePageSource, /previewImageIndex=\{previewLogId === log\.id \? previewIndex : undefined\}/);
    assert.match(imagePageSource, /previewImageIndex \?\? activeImageIndex/);
    assert.match(imagePageSource, /onClick=\{\(\) => openImage\(imageIndex\)\}/);
    assert.match(imagePageSource, /`查看全部 \$\{displayImages\.length\} 张`/);
    assert.match(imagePageSource, /onSync\(activeImage\)/);
    assert.match(imagePageSource, /onSaveAsset\(activeImage, selectedImageIndex\)/);
    assert.match(imagePageSource, /onEdit\(activeImage, selectedImageIndex\)/);
    assert.match(imagePageSource, /onDownload\(activeImage, selectedImageIndex\)/);
    assert.match(imagePageSource, /aria-pressed=\{selectedImageIndex === imageIndex\}/);
});

test("删除生成记录会阻止未结束的轮询重新写回", () => {
    assert.match(imagePageSource, /const deletedLogIdsRef = useRef\(new Set<string>\(\)\)/);
    assert.match(imagePageSource, /deletedLogs\.forEach\(\(log\) => deletedLogIdsRef\.current\.add\(log\.id\)\)/);
    assert.match(imagePageSource, /if \(deletedLogIdsRef\.current\.has\(log\.id\)\) return;[\s\S]*const prevChain = saveLogChainRef\.current/);
    assert.match(imagePageSource, /saveLogChainRef\.current[\s\S]*deleteCanvasImageTask\(imageTaskConfig\(\), log\.task\)/);
    assert.match(imagePageSource, /filter\(\(result\) => !deletedLogs\.some\(\(log\) => imageResultMatchesLog\(result, log\)\)\)/);
    assert.match(imagePageSource, /const currentLog = logsRef\.current\.find\(\(item\) => item\.id === log\.id\)/);
    assert.match(imagePageSource, /await saveLog\(nextLog\);[\s\S]{0,180}deletedLogIdsRef\.current\.has\(log\.id\)/);
});

test("加入素材保存对应生成任务的提示词", () => {
    assert.match(imagePageSource, /metadata:\s*\{\s*source:\s*"image-page",\s*prompt:\s*sourcePrompt\s*\}/);
    assert.match(imagePageSource, /onSaveAsset\(image, imageIndex, result\.prompt\)/);
    assert.match(imagePageSource, /onSaveAsset\(image, imageIndex, log\.prompt\)/);
});

test("历史卡明确展示工作流部分成功张数", () => {
    assert.match(imagePageSource, /const partiallySuccessful = log\.successCount > 0 && log\.failCount > 0/);
    assert.match(imagePageSource, /`成功 \$\{log\.successCount\} \/ 失败 \$\{log\.failCount\}`/);
});

test("工作流任务区和最近结果都提供带张数的完整图片预览", () => {
    assert.ok([...workflowSource.matchAll(/<Image\.PreviewGroup/g)].length >= 2);
    assert.match(workflowSource, /const runnerOpenedAtRef = useRef\(0\)/);
    assert.match(workflowSource, /task\.workflowId === runningWorkflow\.id && \(task\.status === "running" \|\| task\.startedAt >= runnerOpenedAtRef\.current\)/);
    assert.match(workflowSource, /runnerOpenedAtRef\.current = Date\.now\(\)/);
    assert.match(workflowSource, /const runnerImages = runnerTasks\.flatMap\(\(task\) => task\.images\)/);
    assert.match(workflowSource, /工作流生成结果[\s\S]*查看全部 \{runnerImages\.length\} 张[\s\S]*onPreviewImage=/);
    assert.match(workflowSource, /items=\{runnerImages\.map\([\s\S]*open: runnerPreviewOpen/);
    assert.match(workflowSource, /查看全部 \{runResults\.length\} 张/);
    assert.match(workflowSource, /task\.images\.length > 1 \? `查看 \$\{task\.images\.length\} 张` : "查看原图"/);
    assert.match(workflowSource, /countRender: \(current, total\) => `第 \$\{current\} \/ \$\{total\} 张`/);
});

test("原图灯箱的关闭、切换、计数和缩放控件保持高对比度", () => {
    assert.match(globalStyles, /\.ant-image-preview-close,[\s\S]*\.ant-image-preview-switch[\s\S]*color: rgba\(255, 255, 255, 0\.92\) !important/);
    assert.match(globalStyles, /\.ant-image-preview-progress[\s\S]*color: #ffffff !important/);
    assert.match(globalStyles, /\.ant-image-preview-actions-action[\s\S]*color: inherit !important/);
    assert.match(globalStyles, /@media \(max-width: 359px\)[\s\S]*\.ant-image-preview-actions[\s\S]*gap: 4px !important[\s\S]*padding-inline: 12px !important/);
});
