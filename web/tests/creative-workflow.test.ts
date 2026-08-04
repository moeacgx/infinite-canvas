import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSeriesPromptDraftRequest,
    createBlankWorkflow,
    createDefaultWorkflowInputs,
    createWorkflowExport,
    MAX_WORKFLOW_SERIES_CONCURRENCY,
    mergeWorkflows,
    missingRequiredWorkflowVariable,
    normalizeWorkflow,
    parseSeriesPromptDrafts,
    parseWorkflowDraft,
    parseWorkflowExport,
    renderWorkflowPrompt,
} from "../src/lib/creative-workflow.ts";

test("工作流变量会规范化非法和重复 key", () => {
    const workflow = normalizeWorkflow({
        id: "workflow-1",
        name: "测试",
        variables: [
            { key: "product name", label: "产品", type: "text" },
            { key: "product name", label: "产品副本", type: "textarea" },
            { key: "中文键", label: "非法变量", type: "unknown" },
        ],
        config: { promptTemplate: "{{product_name}}" },
    });

    assert.deepEqual(
        workflow.variables.map((item) => [item.key, item.type]),
        [
            ["product_name", "text"],
            ["product_name_2", "textarea"],
            ["variable_3", "text"],
        ],
    );
});

test("模板变量、布尔值和负向提示词会正确渲染", () => {
    const workflow = normalizeWorkflow({
        id: "workflow-2",
        name: "海报",
        variables: [
            { key: "product", label: "产品", type: "text", required: true, defaultValue: "咖啡" },
            { key: "transparent", label: "透明", type: "boolean", defaultValue: "true" },
        ],
        config: { promptTemplate: "产品：{{ product }}；透明：{{transparent}}；缺失：{{missing}}", negativePrompt: "文字变形" },
    });
    const values = createDefaultWorkflowInputs(workflow);

    assert.equal(renderWorkflowPrompt(workflow, values), "产品：咖啡；透明：开启；缺失：\n\n避免：文字变形");
    assert.equal(missingRequiredWorkflowVariable(workflow, { ...values, product: "" })?.key, "product");
});

test("多图解析支持 Markdown 包裹 JSON 和纯文本回退", () => {
    const json = parseSeriesPromptDrafts('```json\n{"items":[{"title":"封面","prompt":"红色封面"},{"prompt":"蓝色步骤图"}]}\n```', 4, "基础提示词");
    assert.deepEqual(
        json.map((item) => [item.title, item.prompt]),
        [
            ["封面", "红色封面"],
            ["第 2 张", "蓝色步骤图"],
        ],
    );

    const lines = parseSeriesPromptDrafts("1. 第一张\n- 第二张", 2, "基础提示词");
    assert.deepEqual(
        lines.map((item) => item.prompt),
        ["第一张", "第二张"],
    );

    const fallback = parseSeriesPromptDrafts("", 2, "基础提示词");
    assert.equal(fallback.length, 2);
    assert.match(fallback[0].prompt, /基础提示词/);
});

test("多图策划请求会限制目标数量并带上变量", () => {
    const workflow = createBlankWorkflow({}, "multi_image_series");
    const request = buildSeriesPromptDraftRequest(workflow, "基础提示词", 99, { topic: "夏日饮品", empty: "" });
    assert.match(request, /目标张数：20/);
    assert.match(request, /topic: 夏日饮品/);
    assert.doesNotMatch(request, /empty:/);
});

test("AI 工作流草稿只接收对象 JSON 并强制为本地私有模板", () => {
    const { workflow, warnings } = parseWorkflowDraft('说明文字\n```json\n{"name":"商品图","scope":"public","variables":[],"config":{"promptTemplate":""}}\n```');
    assert.equal(workflow.name, "商品图");
    assert.equal(workflow.scope, "private");
    assert.equal(workflow.editable, true);
    assert.ok(warnings.length >= 2);
    assert.throws(() => parseWorkflowDraft("[]"), /有效的工作流 JSON/);
});

test("导入导出校验格式并按更新时间合并", () => {
    const older = normalizeWorkflow({ id: "same", name: "旧", updatedAt: 100, createdAt: 100 });
    const newer = normalizeWorkflow({ id: "same", name: "新", updatedAt: 200, createdAt: 100 });
    const another = normalizeWorkflow({ id: "another", name: "另一个", updatedAt: 150, createdAt: 150 });
    const merged = mergeWorkflows([newer], [older, another]);
    assert.deepEqual(
        merged.map((item) => item.name),
        ["新", "另一个"],
    );

    const exported = createWorkflowExport(merged);
    assert.equal(parseWorkflowExport(exported).length, 2);
    assert.throws(() => parseWorkflowExport({ workflows: [] }), /有效的无限画布工作流文件/);
    assert.throws(() => parseWorkflowExport({ ...exported, version: 2 }), /有效的无限画布工作流文件/);
});

test("导入工作流会限制字段长度和系列并发", () => {
    const workflow = normalizeWorkflow({
        id: "x".repeat(300),
        name: "名称".repeat(100),
        variables: [{ key: "a".repeat(100), label: "标签".repeat(100), defaultValue: "d".repeat(20_000) }],
        config: { promptTemplate: "p".repeat(50_000) },
        seriesConfig: { concurrency: "99" },
    });

    assert.equal(workflow.id.length, 128);
    assert.equal(workflow.name.length, 120);
    assert.equal(workflow.variables[0].key.length, 64);
    assert.equal(workflow.variables[0].label.length, 120);
    assert.equal(workflow.variables[0].defaultValue.length, 10_000);
    assert.equal(workflow.config.promptTemplate.length, 30_000);
    assert.equal(workflow.seriesConfig.concurrency, String(MAX_WORKFLOW_SERIES_CONCURRENCY));
});
