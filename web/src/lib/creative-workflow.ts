import { nanoid } from "nanoid";

import type { AiConfig } from "@/stores/use-config-store";

export type WorkflowVariableType = "text" | "textarea" | "number" | "select" | "boolean";
export type WorkflowMode = "single_image" | "multi_image_series";
export type WorkflowScope = "private" | "public";

export type WorkflowVariable = {
    id: string;
    key: string;
    label: string;
    type: WorkflowVariableType;
    required: boolean;
    defaultValue: string;
    options: string[];
    placeholder?: string;
};

export type WorkflowGenerationConfig = {
    imageModel: string;
    quality: string;
    size: string;
    count: string;
    background: string;
    promptTemplate: string;
    negativePrompt: string;
};

export type WorkflowSeriesConfig = {
    targetCount: string;
    promptModel: string;
    promptInstruction: string;
    reviewRequired: boolean;
    concurrency: string;
};

export type CreativeWorkflow = {
    id: string;
    scope: WorkflowScope;
    editable: boolean;
    mode: WorkflowMode;
    name: string;
    category: string;
    description: string;
    variables: WorkflowVariable[];
    config: WorkflowGenerationConfig;
    seriesConfig: WorkflowSeriesConfig;
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;
};

export type SeriesPromptDraft = {
    id: string;
    title: string;
    prompt: string;
    status: "draft" | "running" | "success" | "failed";
    error?: string;
    resultIds?: string[];
};

export type WorkflowExportFile = {
    app: "infinite-canvas";
    version: 1;
    type: "creative-workflows";
    exportedAt: string;
    workflows: CreativeWorkflow[];
};

type ConfigDefaults = Partial<Pick<AiConfig, "model" | "imageModel" | "textModel" | "quality" | "size" | "count" | "background">>;

export const MAX_WORKFLOW_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_WORKFLOW_SERIES_CONCURRENCY = 3;

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_TEXT_MODEL = "gpt-5.5";
const DEFAULT_QUALITY = "auto";
const DEFAULT_SIZE = "1:1";
const MAX_WORKFLOW_TEXT_LENGTH = 30_000;

export function createWorkflowVariable(key = "", label = "", type: WorkflowVariableType = "text"): WorkflowVariable {
    return {
        id: nanoid(),
        key,
        label,
        type,
        required: false,
        defaultValue: "",
        options: [],
        placeholder: "",
    };
}

export function createBlankWorkflow(config: ConfigDefaults = {}, mode: WorkflowMode = "single_image"): CreativeWorkflow {
    const now = Date.now();
    const series = mode === "multi_image_series";
    return normalizeWorkflow(
        {
            id: nanoid(),
            scope: "private",
            editable: true,
            mode,
            name: series ? "多图系列生成" : "",
            category: series ? "多图创作" : "",
            description: series ? "根据主题生成一组连贯图片提示词，审核后批量生成图片。" : "",
            variables: series
                ? [createWorkflowVariable("topic", "主题", "textarea"), createWorkflowVariable("style", "统一风格"), createWorkflowVariable("platform", "发布平台")]
                : [createWorkflowVariable("product_name", "产品名称"), createWorkflowVariable("selling_points", "产品卖点", "textarea")],
            config: {
                ...createGenerationConfig(config),
                ...(series
                    ? {
                          count: "1",
                          promptTemplate: "围绕 {{topic}} 生成一组适合 {{platform}} 发布的连贯配图。\n统一风格：{{style}}\n要求：主题一致、画面重点各不相同、适合连续发布。",
                      }
                    : {}),
            },
            seriesConfig: createSeriesConfig(config),
            createdAt: now,
            updatedAt: now,
        },
        config,
    );
}

export function createStarterWorkflows(config: ConfigDefaults = {}): CreativeWorkflow[] {
    const poster = createBlankWorkflow(config);
    poster.scope = "public";
    poster.name = "电商海报生成";
    poster.category = "电商海报";
    poster.description = "固定商业摄影质感和营销文案结构，只替换产品与卖点。";
    poster.variables = [createWorkflowVariable("product_name", "产品名称"), createWorkflowVariable("selling_points", "核心卖点", "textarea"), createWorkflowVariable("campaign", "活动信息")];
    poster.config.promptTemplate = "为 {{product_name}} 生成一张高端电商海报。\n核心卖点：{{selling_points}}\n活动信息：{{campaign}}\n要求：主体清晰、构图高级、商品有强烈质感，画面适合社交媒体和电商首图。";

    const series = createBlankWorkflow(config, "multi_image_series");
    series.scope = "public";
    series.name = "小红书文章配图组";
    series.description = "根据文章主题和内容生成风格统一的封面、步骤、要点和总结配图。";
    series.variables = [createWorkflowVariable("article_topic", "文章主题"), createWorkflowVariable("article_content", "文章内容", "textarea"), createWorkflowVariable("visual_style", "视觉风格")];
    series.config.promptTemplate = "为文章《{{article_topic}}》生成系列配图。\n文章内容：{{article_content}}\n视觉风格：{{visual_style}}\n要求：画面适合移动端阅读，主题连贯，每张图表达一个清晰信息点。";
    series.seriesConfig = {
        ...series.seriesConfig,
        targetCount: "6",
        promptInstruction: "拆成封面图、问题或痛点图、核心步骤图、细节说明图、对比或案例图和总结图；每张图都需要独立完整的图片提示词。",
        concurrency: "3",
    };

    return [normalizeWorkflow(poster, config), normalizeWorkflow(series, config)];
}

export function normalizeWorkflow(input: unknown, defaults: ConfigDefaults = {}): CreativeWorkflow {
    const value = isRecord(input) ? input : {};
    const createdAt = positiveNumber(value.createdAt) || Date.now();
    const rawVariables = Array.isArray(value.variables) ? value.variables : [];
    const usedKeys = new Set<string>();
    const variables = rawVariables.slice(0, 50).map((item, index) => normalizeVariable(item, index, usedKeys));
    const config = isRecord(value.config) ? value.config : {};
    const seriesConfig = isRecord(value.seriesConfig) ? value.seriesConfig : {};

    return {
        id: boundedString(value.id, 128) || nanoid(),
        scope: value.scope === "public" ? "public" : "private",
        editable: value.editable !== false,
        mode: value.mode === "multi_image_series" ? "multi_image_series" : "single_image",
        name: boundedString(value.name, 120),
        category: boundedString(value.category, 80),
        description: boundedString(value.description, 2_000),
        variables,
        config: {
            ...createGenerationConfig(defaults),
            imageModel: boundedString(config.imageModel, 256) || boundedString(config.model, 256) || defaults.imageModel || defaults.model || DEFAULT_IMAGE_MODEL,
            quality: boundedString(config.quality, 64) || defaults.quality || DEFAULT_QUALITY,
            size: boundedString(config.size, 64) || defaults.size || DEFAULT_SIZE,
            count: clampString(config.count, 1, 15, defaults.count || "1"),
            background: boundedString(config.background, 64),
            promptTemplate: boundedString(config.promptTemplate, MAX_WORKFLOW_TEXT_LENGTH),
            negativePrompt: boundedString(config.negativePrompt, 10_000),
        },
        seriesConfig: {
            ...createSeriesConfig(defaults),
            targetCount: clampString(seriesConfig.targetCount, 1, 20, "6"),
            promptModel: boundedString(seriesConfig.promptModel, 256) || defaults.textModel || defaults.model || DEFAULT_TEXT_MODEL,
            promptInstruction: boundedString(seriesConfig.promptInstruction, 10_000),
            reviewRequired: seriesConfig.reviewRequired !== false,
            concurrency: clampString(seriesConfig.concurrency, 1, MAX_WORKFLOW_SERIES_CONCURRENCY, "3"),
        },
        createdAt,
        updatedAt: positiveNumber(value.updatedAt) || createdAt,
        ...(positiveNumber(value.lastRunAt) ? { lastRunAt: positiveNumber(value.lastRunAt) } : {}),
    };
}

export function normalizeWorkflowVariableKey(value: string) {
    const normalized = value
        .trim()
        .replace(/[^\w.-]/g, "_")
        .slice(0, 64);
    return /[a-z0-9]/i.test(normalized) ? normalized : "";
}

export function createDefaultWorkflowInputs(workflow: CreativeWorkflow) {
    return Object.fromEntries(workflow.variables.map((variable) => [variable.key, variable.defaultValue || (variable.type === "boolean" ? "false" : "")]));
}

export function renderPromptTemplate(template: string, values: Record<string, string>) {
    return template.replace(/{{\s*([\w.-]+)\s*}}/g, (_match, key: string) => values[key] || "");
}

export function renderWorkflowPrompt(workflow: CreativeWorkflow, values: Record<string, string>) {
    const formatted = Object.fromEntries(
        workflow.variables.map((variable) => {
            const raw = values[variable.key] ?? variable.defaultValue ?? "";
            return [variable.key, variable.type === "boolean" ? (raw === "true" ? "开启" : "关闭") : raw];
        }),
    );
    const prompt = renderPromptTemplate(workflow.config.promptTemplate, formatted).trim();
    const negativePrompt = workflow.config.negativePrompt.trim();
    return negativePrompt ? `${prompt}\n\n避免：${negativePrompt}` : prompt;
}

export function missingRequiredWorkflowVariable(workflow: CreativeWorkflow, values: Record<string, string>) {
    return workflow.variables.find((variable) => variable.required && !String(values[variable.key] || "").trim());
}

export function buildSeriesPromptDraftRequest(workflow: CreativeWorkflow, basePrompt: string, count: number, values: Record<string, string>) {
    const variables = Object.entries(values)
        .filter(([, value]) => String(value).trim())
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
    return [
        "你是多图创作策划助手。请为同一主题生成一组互相连贯、画面重点不同的图片提示词。",
        '只返回 JSON，不要使用 Markdown。格式：{"items":[{"title":"第1张标题","prompt":"可独立生图的完整提示词"}]}。',
        `目标张数：${clamp(count, 1, 20)}`,
        `工作流名称：${workflow.name}`,
        workflow.category ? `分类：${workflow.category}` : "",
        workflow.description ? `说明：${workflow.description}` : "",
        workflow.seriesConfig.promptInstruction ? `拆分规则：${workflow.seriesConfig.promptInstruction}` : "",
        variables ? `用户输入：\n${variables}` : "",
        `基础提示词：\n${basePrompt}`,
        "每条 prompt 必须可以独立用于图片生成；保持统一主题、统一风格和连续叙事；避免重复构图。",
    ]
        .filter(Boolean)
        .join("\n\n");
}

export function parseSeriesPromptDrafts(content: string, requestedCount: number, fallbackPrompt: string): SeriesPromptDraft[] {
    const count = clamp(requestedCount, 1, 20);
    const parsed = parseJSONFragment(content);
    if (parsed) {
        const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
        const drafts = list
            .map((item, index) => {
                const value = isRecord(item) ? item : {};
                return {
                    id: nanoid(),
                    title: stringValue(value.title).trim() || `第 ${index + 1} 张`,
                    prompt: stringValue(value.prompt).trim(),
                    status: "draft" as const,
                };
            })
            .filter((item) => item.prompt)
            .slice(0, count);
        if (drafts.length) return drafts;
    }

    const lines = content
        .split(/\n+/)
        .map((line) => line.replace(/^[-*\d.、\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, count);
    if (lines.length) return lines.map((prompt, index) => ({ id: nanoid(), title: `第 ${index + 1} 张`, prompt, status: "draft" }));

    return Array.from({ length: count }, (_, index) => ({
        id: nanoid(),
        title: `第 ${index + 1} 张`,
        prompt: `${fallbackPrompt}\n\n系列图片：第 ${index + 1} 张，画面重点与其他图片保持差异。`.trim(),
        status: "draft" as const,
    }));
}

export function parseWorkflowDraft(content: string, defaults: ConfigDefaults = {}) {
    const parsed = parseJSONFragment(content);
    if (!parsed || Array.isArray(parsed)) throw new Error("AI 没有返回有效的工作流 JSON");
    const warnings: string[] = [];
    const workflow = normalizeWorkflow(parsed, defaults);
    if (!workflow.name.trim()) warnings.push("AI 未填写工作流名称");
    if (!workflow.config.promptTemplate.trim()) warnings.push("AI 未填写提示词模板");
    if (!workflow.variables.length) warnings.push("AI 未定义变量，可在保存前手动添加");
    workflow.scope = "private";
    workflow.editable = true;
    workflow.id = nanoid();
    workflow.createdAt = Date.now();
    workflow.updatedAt = workflow.createdAt;
    return { workflow, warnings };
}

export function buildWorkflowDraftRequest(prompt: string) {
    return [
        "你是创意工作流设计助手。根据需求生成可复用的图片生成工作流。",
        "只返回一个 JSON 对象，不要使用 Markdown。",
        "字段结构：",
        '{"name":"名称","category":"分类","description":"说明","mode":"single_image 或 multi_image_series","variables":[{"key":"英文变量名","label":"中文标签","type":"text|textarea|number|select|boolean","required":true,"defaultValue":"","options":[]}],"config":{"promptTemplate":"使用 {{key}} 插值的完整提示词","negativePrompt":"","quality":"auto","size":"1:1","count":"1"},"seriesConfig":{"targetCount":"6","promptInstruction":"拆分要求","reviewRequired":true,"concurrency":"3"}}',
        "变量 key 只能包含字母、数字、下划线、点和短横线。提示词必须完整、可直接用于生成图片。",
        `用户需求：\n${prompt.trim()}`,
    ].join("\n\n");
}

export function createWorkflowExport(workflows: CreativeWorkflow[]): WorkflowExportFile {
    return {
        app: "infinite-canvas",
        version: 1,
        type: "creative-workflows",
        exportedAt: new Date().toISOString(),
        workflows: workflows.map((workflow) => normalizeWorkflow(workflow)),
    };
}

export function parseWorkflowExport(value: unknown, defaults: ConfigDefaults = {}) {
    if (!isRecord(value) || value.app !== "infinite-canvas" || value.version !== 1 || value.type !== "creative-workflows" || !Array.isArray(value.workflows)) {
        throw new Error("不是有效的无限画布工作流文件");
    }
    return value.workflows.slice(0, 500).map((workflow) => normalizeWorkflow(workflow, defaults));
}

export function mergeWorkflows(local: CreativeWorkflow[], remote: CreativeWorkflow[]) {
    const byId = new Map<string, CreativeWorkflow>();
    for (const item of [...remote, ...local]) {
        const workflow = normalizeWorkflow(item);
        const current = byId.get(workflow.id);
        if (!current || workflow.updatedAt >= current.updatedAt) byId.set(workflow.id, workflow);
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function normalizeSeriesPromptDraft(input: unknown): SeriesPromptDraft {
    const draft = isRecord(input) ? input : {};
    const status = draft.status === "success" || draft.status === "failed" ? draft.status : "draft";
    return {
        id: boundedString(draft.id, 128) || nanoid(),
        title: boundedString(draft.title, 200) || "未命名",
        prompt: boundedString(draft.prompt, MAX_WORKFLOW_TEXT_LENGTH),
        status,
        error: boundedString(draft.error, 2_000) || undefined,
        resultIds: Array.isArray(draft.resultIds)
            ? draft.resultIds
                  .map((id) => boundedString(id, 128))
                  .filter(Boolean)
                  .slice(0, 20)
            : [],
    };
}

function createGenerationConfig(config: ConfigDefaults): WorkflowGenerationConfig {
    return {
        imageModel: config.imageModel || config.model || DEFAULT_IMAGE_MODEL,
        quality: config.quality || DEFAULT_QUALITY,
        size: config.size || DEFAULT_SIZE,
        count: clampString(config.count, 1, 15, "1"),
        background: config.background || "",
        promptTemplate: "",
        negativePrompt: "",
    };
}

function createSeriesConfig(config: ConfigDefaults): WorkflowSeriesConfig {
    return {
        targetCount: "6",
        promptModel: config.textModel || config.model || DEFAULT_TEXT_MODEL,
        promptInstruction: "",
        reviewRequired: true,
        concurrency: String(MAX_WORKFLOW_SERIES_CONCURRENCY),
    };
}

function normalizeVariable(input: unknown, index: number, usedKeys: Set<string>): WorkflowVariable {
    const value = isRecord(input) ? input : {};
    const type = isVariableType(value.type) ? value.type : "text";
    const baseKey = normalizeWorkflowVariableKey(stringValue(value.key)) || `variable_${index + 1}`;
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${baseKey}_${suffix++}`;
    usedKeys.add(key);
    return {
        id: boundedString(value.id, 128) || nanoid(),
        key,
        label: boundedString(value.label, 120) || key,
        type,
        required: value.required === true,
        defaultValue: boundedString(value.defaultValue == null ? "" : String(value.defaultValue), 10_000),
        options: normalizeOptions(value.options),
        placeholder: boundedString(value.placeholder, 500),
    };
}

function normalizeOptions(value: unknown) {
    const options = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\/\n]/) : [];
    return Array.from(new Set(options.map((item) => String(item).trim().slice(0, 500)).filter(Boolean))).slice(0, 50);
}

function parseJSONFragment(content: string): unknown {
    const trimmed = content
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```\s*$/, "")
        .trim();
    for (const [open, close] of [
        ["{", "}"],
        ["[", "]"],
    ]) {
        const start = trimmed.indexOf(open);
        const end = trimmed.lastIndexOf(close);
        if (start < 0 || end <= start) continue;
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
            continue;
        }
    }
    return null;
}

function clampString(value: unknown, min: number, max: number, fallback: string) {
    const number = Number(value);
    return Number.isFinite(number) ? String(clamp(Math.floor(Math.abs(number)), min, max)) : fallback;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function boundedString(value: unknown, maxLength: number) {
    return stringValue(value).slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isVariableType(value: unknown): value is WorkflowVariableType {
    return value === "text" || value === "textarea" || value === "number" || value === "select" || value === "boolean";
}
