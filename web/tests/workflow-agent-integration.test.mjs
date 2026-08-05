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
