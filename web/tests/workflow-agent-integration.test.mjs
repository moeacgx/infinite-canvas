import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceSource = await readFile(new URL("../src/components/workflows/creative-workflow-workspace.tsx", import.meta.url), "utf8");
const userConfigSource = await readFile(new URL("../src/services/api/user-config.ts", import.meta.url), "utf8");

test("工作流创建 Agent 直接使用当前文本渠道并支持参考图", () => {
    assert.match(workspaceSource, /requestImageQuestion\(textConfig, \[\{ role: "user", content \}\]/);
    assert.match(workspaceSource, /validReferences\.map\(\(url\) => \(\{ type: "image_url"/);
    assert.match(workspaceSource, /buildWorkflowAgentDraftRequest\(text, agentScope\)/);
    assert.doesNotMatch(workspaceSource, /请先登录后使用工作流创建 Agent/);
    assert.doesNotMatch(workspaceSource + userConfigSource, /\/api\/v1\/workflows\/agent-draft/);
});

test("工作流即时生成结果经过稳定图片存储后才写入历史", () => {
    assert.match(workspaceSource, /storeWorkflowGeneratedImages\(flattened, durationMs\)/);
    assert.match(workspaceSource, /images: log\.images\.map\(serializeWorkflowStoredImage\)/);
});

test("工作流批量生成会保留部分成功图片并记录失败张数", () => {
    assert.match(workspaceSource, /const settledImages = await Promise\.allSettled/);
    assert.match(workspaceSource, /const flattened = settledImages\.flatMap/);
    assert.match(workspaceSource, /errors: partialErrors/);
    assert.match(workspaceSource, /successCount: images\.length/);
    assert.match(workspaceSource, /failCount: errors\.length \|\| \(status === "失败" \? 1 : 0\)/);
    assert.match(workspaceSource, /工作流部分完成/);
});

test("工作流历史保留实际渠道，任务取消信号会传递到图片请求", () => {
    assert.match(workspaceSource, /config: \{ \.\.\.taskConfig, channelMode: runConfig\.channelMode, activeChannelId: runConfig\.activeChannelId \}/);
    assert.match(workspaceSource, /workflowControllersRef = useRef\(new Map<string, AbortController>\(\)\)/);
    assert.match(workspaceSource, /requestEdit\(\{ \.\.\.runConfig, count: "1" \}, prompt, references, undefined, \{ signal \}\)/);
    assert.match(workspaceSource, /requestGeneration\(\{ \.\.\.runConfig, count: "1" \}, prompt, \{ signal \}\)/);
    assert.match(workspaceSource, /const cancelWorkflowTask[\s\S]{0,240}controller\.abort\(\)[\s\S]{0,120}正在取消工作流任务/);
    assert.match(workspaceSource, /task\.status === "running" \?[\s\S]{0,200}<Square[\s\S]{0,120}取消/);
    assert.match(workspaceSource, /const task = startWorkflowImageTask[\s\S]{0,520}if \(!task\)[\s\S]{0,220}status: "failed"/);
    assert.match(workspaceSource, /await imageLogStore\.setItem\(log\.id, serializeHistoryLog\(log\)\);[\s\S]{0,420}if \(signal\.aborted\)[\s\S]{0,280}imageLogStore\.removeItem\(log\.id\)/);
    assert.match(workspaceSource, /let workflowCategoryWriteChain: Promise<void> = Promise\.resolve\(\)/);
    assert.match(workspaceSource, /const operation = workflowCategoryWriteChain\.then[\s\S]{0,700}workflowCategoryWriteChain = operation\.then/);
    assert.match(workspaceSource, /task\.workflowId === runningWorkflow\.id && \(task\.status === "running" \|\| task\.startedAt >= runnerOpenedAtRef\.current\)/);
});

test("切换工作流会取消旧提示词请求并隔离迟到结果", () => {
    assert.match(workspaceSource, /const runnerSessionRef = useRef\(0\)/);
    assert.match(workspaceSource, /seriesDraftControllerRef\.current\?\.abort\(\)[\s\S]{0,260}runnerSessionRef\.current = sessionId/);
    assert.match(workspaceSource, /requestImageQuestion\([\s\S]{0,900}\{ signal: controller\.signal \}\)/);
    assert.match(workspaceSource, /controller\.signal\.aborted \|\| runnerSessionRef\.current !== sessionId/);
    assert.match(workspaceSource, /runnerSessionRef\.current !== sessionId \|\| seriesDraftsLoadedRef\.current/);
    assert.match(workspaceSource, /seriesDraftControllerRef\.current = controller;[\s\S]{0,120}seriesDraftsLoadedRef\.current = true/);
});

test("多图提示词工具栏在 320px 手机端换行且生成按钮保持可达", () => {
    assert.match(workspaceSource, /mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between/);
    assert.match(workspaceSource, /w-full sm:max-w-\[280px\]/);
    assert.match(workspaceSource, /flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:shrink-0/);
});
