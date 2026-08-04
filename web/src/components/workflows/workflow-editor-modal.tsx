"use client";

import { App, Button, Input, Modal, Segmented, Select, Switch } from "antd";
import { Braces, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { createWorkflowVariable, MAX_WORKFLOW_SERIES_CONCURRENCY, normalizeWorkflow, type CreativeWorkflow, type WorkflowMode, type WorkflowVariable, type WorkflowVariableType } from "@/lib/creative-workflow";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = {
    open: boolean;
    workflow: CreativeWorkflow | null;
    config: AiConfig;
    onClose: () => void;
    onSave: (workflow: CreativeWorkflow) => Promise<void> | void;
};

const variableTypeOptions: Array<{ value: WorkflowVariableType; label: string }> = [
    { value: "text", label: "短文本" },
    { value: "textarea", label: "长文本" },
    { value: "number", label: "数字" },
    { value: "select", label: "选项" },
    { value: "boolean", label: "开关" },
];

export function WorkflowEditorModal({ open, workflow, config, onClose, onSave }: Props) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<CreativeWorkflow | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDraft(workflow ? normalizeWorkflow(workflow, config) : null);
    }, [config, workflow]);

    const previewConfig = useMemo(
        () =>
            draft
                ? {
                      ...config,
                      imageModel: draft.config.imageModel,
                      quality: draft.config.quality,
                      size: draft.config.size,
                      count: draft.config.count,
                      background: draft.config.background,
                  }
                : config,
        [config, draft],
    );

    if (!draft) return null;

    const patchDraft = (patch: Partial<CreativeWorkflow>) => setDraft((value) => (value ? { ...value, ...patch } : value));
    const patchConfig = (patch: Partial<CreativeWorkflow["config"]>) => setDraft((value) => (value ? { ...value, config: { ...value.config, ...patch } } : value));
    const patchSeries = (patch: Partial<CreativeWorkflow["seriesConfig"]>) => setDraft((value) => (value ? { ...value, seriesConfig: { ...value.seriesConfig, ...patch } } : value));
    const patchVariable = (id: string, patch: Partial<WorkflowVariable>) => patchDraft({ variables: draft.variables.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

    const submit = async () => {
        const normalized = normalizeWorkflow({ ...draft, updatedAt: Date.now() }, config);
        if (!normalized.name.trim()) return message.error("请输入工作流名称");
        if (!normalized.config.promptTemplate.trim()) return message.error("请输入提示词模板");
        const keys = normalized.variables.map((item) => item.key);
        if (new Set(keys).size !== keys.length) return message.error("变量 key 不能重复");
        setSaving(true);
        try {
            await onSave(normalized);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title={draft.name ? `编辑工作流 · ${draft.name}` : "新建工作流"}
            open={open}
            width={920}
            destroyOnHidden
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>
                    取消
                </Button>,
                <Button key="save" type="primary" loading={saving} onClick={() => void submit()}>
                    保存工作流
                </Button>,
            ]}
        >
            <div className="grid max-h-[72vh] gap-7 overflow-y-auto pr-2 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-6">
                    <EditorSection title="基本信息">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="名称" required>
                                <Input value={draft.name} maxLength={80} placeholder="例如：电商主图生成" onChange={(event) => patchDraft({ name: event.target.value })} />
                            </Field>
                            <Field label="分类">
                                <Input value={draft.category} maxLength={40} placeholder="例如：电商海报" onChange={(event) => patchDraft({ category: event.target.value })} />
                            </Field>
                        </div>
                        <Field label="说明">
                            <Input.TextArea value={draft.description} maxLength={240} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="这个工作流适合解决什么问题" onChange={(event) => patchDraft({ description: event.target.value })} />
                        </Field>
                        <Field label="模式">
                            <Segmented<WorkflowMode>
                                block
                                value={draft.mode}
                                options={[
                                    { value: "single_image", label: "单图生成" },
                                    { value: "multi_image_series", label: "多图系列" },
                                ]}
                                onChange={(mode) => patchDraft({ mode })}
                            />
                        </Field>
                    </EditorSection>

                    <EditorSection
                        title="输入变量"
                        action={
                            <Button size="small" type="text" icon={<Plus className="size-4" />} onClick={() => patchDraft({ variables: [...draft.variables, createWorkflowVariable()] })}>
                                添加变量
                            </Button>
                        }
                    >
                        {draft.variables.length ? (
                            <div className="space-y-3">
                                {draft.variables.map((variable, index) => (
                                    <div key={variable.id} className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <span className="text-sm font-medium">变量 {index + 1}</span>
                                            <Button
                                                type="text"
                                                danger
                                                size="small"
                                                icon={<Trash2 className="size-4" />}
                                                aria-label="删除变量"
                                                title="删除变量"
                                                onClick={() => patchDraft({ variables: draft.variables.filter((item) => item.id !== variable.id) })}
                                            />
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field label="变量 key">
                                                <Input value={variable.key} placeholder="product_name" onChange={(event) => patchVariable(variable.id, { key: event.target.value })} />
                                            </Field>
                                            <Field label="显示名称">
                                                <Input value={variable.label} placeholder="产品名称" onChange={(event) => patchVariable(variable.id, { label: event.target.value })} />
                                            </Field>
                                            <Field label="输入类型">
                                                <Select className="w-full" value={variable.type} options={variableTypeOptions} onChange={(type) => patchVariable(variable.id, { type })} />
                                            </Field>
                                            <Field label="默认值">
                                                <Input value={variable.defaultValue} onChange={(event) => patchVariable(variable.id, { defaultValue: event.target.value })} />
                                            </Field>
                                        </div>
                                        {variable.type === "select" ? (
                                            <div className="mt-3">
                                                <Field label="选项（每行一个）">
                                                    <Input.TextArea
                                                        value={variable.options.join("\n")}
                                                        autoSize={{ minRows: 2, maxRows: 5 }}
                                                        onChange={(event) =>
                                                            patchVariable(variable.id, {
                                                                options: event.target.value
                                                                    .split(/\n/)
                                                                    .map((item) => item.trim())
                                                                    .filter(Boolean),
                                                            })
                                                        }
                                                    />
                                                </Field>
                                            </div>
                                        ) : null}
                                        <div className="mt-3 flex items-center justify-between gap-3">
                                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                                模板写法：{`{{${variable.key || "key"}}}`}
                                            </span>
                                            <label className="flex items-center gap-2 text-sm">
                                                必填
                                                <Switch size="small" checked={variable.required} onChange={(required) => patchVariable(variable.id, { required })} />
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="py-4 text-center text-sm" style={{ color: theme.node.muted }}>
                                没有变量，工作流会直接使用固定提示词。
                            </div>
                        )}
                    </EditorSection>

                    <EditorSection title="提示词模板">
                        {draft.variables.length ? (
                            <div className="flex flex-wrap gap-2">
                                {draft.variables.map((variable) => (
                                    <Button
                                        key={variable.id}
                                        size="small"
                                        icon={<Braces className="size-3.5" />}
                                        onClick={() => patchConfig({ promptTemplate: `${draft.config.promptTemplate}${draft.config.promptTemplate ? " " : ""}{{${variable.key}}}` })}
                                    >
                                        {variable.label || variable.key}
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                        <Field label="生成提示词" required>
                            <Input.TextArea value={draft.config.promptTemplate} autoSize={{ minRows: 8, maxRows: 18 }} placeholder="使用 {{variable_key}} 插入变量" onChange={(event) => patchConfig({ promptTemplate: event.target.value })} />
                        </Field>
                        <Field label="负向要求">
                            <Input.TextArea value={draft.config.negativePrompt} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：文字变形、低清晰度" onChange={(event) => patchConfig({ negativePrompt: event.target.value })} />
                        </Field>
                    </EditorSection>

                    {draft.mode === "multi_image_series" ? (
                        <EditorSection title="多图策划">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="文本模型">
                                    <ModelPicker config={config} capability="text" fullWidth value={draft.seriesConfig.promptModel} onChange={(promptModel) => patchSeries({ promptModel })} />
                                </Field>
                                <Field label="目标张数">
                                    <Input type="number" min={1} max={20} value={draft.seriesConfig.targetCount} onChange={(event) => patchSeries({ targetCount: event.target.value })} />
                                </Field>
                                <Field label="并发数">
                                    <Input type="number" min={1} max={MAX_WORKFLOW_SERIES_CONCURRENCY} value={draft.seriesConfig.concurrency} onChange={(event) => patchSeries({ concurrency: event.target.value })} />
                                </Field>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 text-sm">
                                        生成前审核提示词
                                        <Switch checked={draft.seriesConfig.reviewRequired} onChange={(reviewRequired) => patchSeries({ reviewRequired })} />
                                    </label>
                                </div>
                            </div>
                            <Field label="拆分要求">
                                <Input.TextArea
                                    value={draft.seriesConfig.promptInstruction}
                                    autoSize={{ minRows: 3, maxRows: 7 }}
                                    placeholder="例如：封面、痛点、步骤、案例、总结"
                                    onChange={(event) => patchSeries({ promptInstruction: event.target.value })}
                                />
                            </Field>
                        </EditorSection>
                    ) : null}
                </div>

                <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
                    <EditorSection title="图像设置">
                        <Field label="生图模型">
                            <ModelPicker config={config} capability="image" fullWidth value={draft.config.imageModel} onChange={(imageModel) => patchConfig({ imageModel })} />
                        </Field>
                        <ImageSettingsPanel config={previewConfig} theme={theme} showTitle={false} className="space-y-4 py-1" onConfigChange={(key, value) => patchConfig({ [key]: value })} />
                    </EditorSection>
                </div>
            </div>
        </Modal>
    );
}

function EditorSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <div className="flex min-h-8 items-center justify-between gap-3 border-b pb-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {label}
                {required ? <span className="ml-1 text-red-500">*</span> : null}
            </span>
            {children}
        </label>
    );
}
