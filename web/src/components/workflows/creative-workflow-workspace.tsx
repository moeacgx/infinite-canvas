"use client";

import { App, Button, Dropdown, Empty, Input, Modal, Select, Tag, Tooltip, type MenuProps } from "antd";
import { Bot, Copy, Download, Edit3, FilePlus2, MoreHorizontal, Plus, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useRef, useState } from "react";

import { WorkflowEditorModal } from "@/components/workflows/workflow-editor-modal";
import { WorkflowRunner } from "@/components/workflows/workflow-runner";
import { ModelPicker } from "@/components/model-picker";
import { buildWorkflowDraftRequest, createBlankWorkflow, createWorkflowExport, MAX_WORKFLOW_IMPORT_BYTES, mergeWorkflows, parseWorkflowDraft, parseWorkflowExport, type CreativeWorkflow, type WorkflowMode } from "@/lib/creative-workflow";
import { requestImageQuestion } from "@/services/api/image";
import { deleteWorkflow, duplicateWorkflow, loadWorkflows, replaceWorkflows, saveWorkflow } from "@/services/workflow-storage";
import { resolveCapabilityModel, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

export function CreativeWorkflowWorkspace() {
    const { message, modal } = App.useApp();
    const importInputRef = useRef<HTMLInputElement>(null);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [workflows, setWorkflows] = useState<CreativeWorkflow[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");
    const [editingWorkflow, setEditingWorkflow] = useState<CreativeWorkflow | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [draftModalOpen, setDraftModalOpen] = useState(false);
    const [draftPrompt, setDraftPrompt] = useState("");
    const [draftModel, setDraftModel] = useState("");
    const [drafting, setDrafting] = useState(false);

    useEffect(() => {
        void loadWorkflows(effectiveConfig)
            .then((items) => {
                setWorkflows(items);
                setSelectedId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "工作流读取失败"));
    }, []);

    useEffect(() => {
        if (!draftModel) setDraftModel(resolveCapabilityModel(effectiveConfig, "text"));
    }, [draftModel, effectiveConfig]);

    const categories = useMemo(() => Array.from(new Set(workflows.map((item) => item.category || "未分类"))).sort((a, b) => a.localeCompare(b, "zh-CN")), [workflows]);
    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return workflows.filter((workflow) => {
            if (category !== "all" && (workflow.category || "未分类") !== category) return false;
            if (!keyword) return true;
            return [workflow.name, workflow.category, workflow.description].some((value) => value.toLowerCase().includes(keyword));
        });
    }, [category, query, workflows]);
    const selected = workflows.find((workflow) => workflow.id === selectedId) || filtered[0] || workflows[0];

    const openNewWorkflow = (mode: WorkflowMode) => {
        setEditingWorkflow(createBlankWorkflow(effectiveConfig, mode));
        setEditorOpen(true);
    };

    const persistWorkflow = async (workflow: CreativeWorkflow) => {
        const next = await saveWorkflow(workflows, workflow, effectiveConfig);
        setWorkflows(next);
        setSelectedId(workflow.id);
        setEditorOpen(false);
        setEditingWorkflow(null);
        message.success("工作流已保存");
    };

    const updateWorkflowAfterRun = async (workflow: CreativeWorkflow) => {
        const next = await saveWorkflow(workflows, workflow, effectiveConfig);
        setWorkflows(next);
        setSelectedId(workflow.id);
    };

    const copyWorkflow = async (workflow: CreativeWorkflow) => {
        const result = await duplicateWorkflow(workflows, workflow, effectiveConfig);
        setWorkflows(result.workflows);
        setSelectedId(result.copy.id);
        message.success("已创建副本");
    };

    const confirmDeleteWorkflow = (workflow: CreativeWorkflow) => {
        modal.confirm({
            title: "删除工作流",
            content: `确定删除「${workflow.name}」吗？已生成的图片和记录不会删除。`,
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                const next = await deleteWorkflow(workflows, workflow.id, effectiveConfig);
                setWorkflows(next);
                if (selectedId === workflow.id) setSelectedId(next[0]?.id || "");
            },
        });
    };

    const exportWorkflows = () => {
        const file = new Blob([JSON.stringify(createWorkflowExport(workflows), null, 2)], { type: "application/json" });
        saveAs(file, `infinite-canvas-workflows-${new Date().toISOString().slice(0, 10)}.json`);
    };

    const importWorkflows = async (file?: File) => {
        if (!file) return;
        try {
            if (file.size > MAX_WORKFLOW_IMPORT_BYTES) throw new Error("工作流文件不能超过 10 MB");
            const imported = parseWorkflowExport(JSON.parse(await file.text()), effectiveConfig);
            const merged = mergeWorkflows(workflows, imported);
            const saved = await replaceWorkflows(merged, effectiveConfig);
            setWorkflows(saved);
            if (imported[0]) setSelectedId(imported[0].id);
            message.success(`已导入 ${imported.length} 个工作流`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工作流导入失败");
        }
    };

    const createWithAi = async () => {
        const prompt = draftPrompt.trim();
        if (!prompt) return message.error("请输入工作流需求");
        const model = draftModel || resolveCapabilityModel(effectiveConfig, "text");
        const textConfig = { ...effectiveConfig, model, textModel: model };
        if (!isAiConfigReady(textConfig, model)) {
            message.warning("请先完成文本模型配置");
            openConfigDialog(true);
            return;
        }
        setDrafting(true);
        try {
            const answer = await requestImageQuestion(textConfig, [{ role: "user", content: buildWorkflowDraftRequest(prompt) }], () => undefined);
            const { workflow, warnings } = parseWorkflowDraft(answer, effectiveConfig);
            workflow.seriesConfig.promptModel = model;
            setEditingWorkflow(workflow);
            setDraftModalOpen(false);
            setEditorOpen(true);
            if (warnings.length) message.warning(warnings.join("；"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 创建工作流失败");
        } finally {
            setDrafting(false);
        }
    };

    const createMenu: MenuProps["items"] = [
        { key: "single", label: "单图工作流", icon: <FilePlus2 className="size-4" />, onClick: () => openNewWorkflow("single_image") },
        { key: "series", label: "多图系列工作流", icon: <Sparkles className="size-4" />, onClick: () => openNewWorkflow("multi_image_series") },
    ];

    return (
        <main className="min-h-[calc(100vh-4rem)] bg-stone-50 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 py-5 sm:px-6">
                <header className="flex flex-col items-stretch justify-between gap-4 border-b border-stone-200 pb-4 sm:flex-row sm:items-center">
                    <div>
                        <h1 className="text-xl font-semibold">创意工作流</h1>
                        <div className="mt-1 text-xs text-stone-500">{workflows.length} 个模板</div>
                    </div>
                    <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                        <input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importWorkflows(event.target.files?.[0]).finally(() => (event.target.value = ""))} />
                        <Tooltip title="导入工作流">
                            <Button icon={<Upload className="size-4" />} aria-label="导入工作流" onClick={() => importInputRef.current?.click()} />
                        </Tooltip>
                        <Tooltip title="导出全部工作流">
                            <Button icon={<Download className="size-4" />} aria-label="导出全部工作流" disabled={!workflows.length} onClick={exportWorkflows} />
                        </Tooltip>
                        <Button icon={<Bot className="size-4" />} onClick={() => setDraftModalOpen(true)}>
                            AI 创建
                        </Button>
                        <Dropdown menu={{ items: createMenu }} trigger={["click"]}>
                            <Button type="primary" icon={<Plus className="size-4" />}>
                                新建
                            </Button>
                        </Dropdown>
                    </div>
                </header>

                <div className="mt-4 grid min-h-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <aside className="min-w-0 lg:border-r lg:border-stone-200 lg:pr-5 dark:lg:border-stone-800">
                        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px] lg:grid-cols-1">
                            <Input prefix={<Search className="size-4 text-stone-400" />} allowClear value={query} placeholder="搜索工作流" onChange={(event) => setQuery(event.target.value)} />
                            <Select value={category} options={[{ value: "all", label: "全部分类" }, ...categories.map((item) => ({ value: item, label: item }))]} onChange={setCategory} />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                            {filtered.map((workflow) => (
                                <WorkflowListItem
                                    key={workflow.id}
                                    workflow={workflow}
                                    selected={workflow.id === selected?.id}
                                    onSelect={() => setSelectedId(workflow.id)}
                                    onRun={() => setSelectedId(workflow.id)}
                                    onEdit={() => {
                                        setEditingWorkflow(workflow);
                                        setEditorOpen(true);
                                    }}
                                    onCopy={() => void copyWorkflow(workflow)}
                                    onDelete={() => confirmDeleteWorkflow(workflow)}
                                />
                            ))}
                        </div>
                        {!filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的工作流" /> : null}
                    </aside>

                    <section className="min-w-0 pb-10">
                        {selected ? <WorkflowRunner workflow={selected} config={effectiveConfig} onRunComplete={updateWorkflowAfterRun} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="新建或导入工作流后开始创作" />}
                    </section>
                </div>
            </div>

            <WorkflowEditorModal
                open={editorOpen}
                workflow={editingWorkflow}
                config={effectiveConfig}
                onClose={() => {
                    setEditorOpen(false);
                    setEditingWorkflow(null);
                }}
                onSave={persistWorkflow}
            />

            <Modal title="AI 创建工作流" open={draftModalOpen} width={620} okText="生成草稿" cancelText="取消" confirmLoading={drafting} onOk={() => void createWithAi()} onCancel={() => setDraftModalOpen(false)}>
                <div className="space-y-4 pt-2">
                    <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-stone-500">文本模型</span>
                        <ModelPicker config={effectiveConfig} capability="text" fullWidth value={draftModel} onChange={setDraftModel} onMissingConfig={() => openConfigDialog(true)} />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-stone-500">需求</span>
                        <Input.TextArea value={draftPrompt} autoSize={{ minRows: 7, maxRows: 14 }} placeholder="例如：为同一款商品生成不同节日主题的社交媒体海报" onChange={(event) => setDraftPrompt(event.target.value)} />
                    </label>
                </div>
            </Modal>
        </main>
    );
}

function WorkflowListItem({ workflow, selected, onSelect, onRun, onEdit, onCopy, onDelete }: { workflow: CreativeWorkflow; selected: boolean; onSelect: () => void; onRun: () => void; onEdit: () => void; onCopy: () => void; onDelete: () => void }) {
    const menu: MenuProps["items"] = [
        { key: "edit", label: "编辑", icon: <Edit3 className="size-4" />, onClick: onEdit },
        { key: "copy", label: "创建副本", icon: <Copy className="size-4" />, onClick: onCopy },
        { type: "divider" },
        { key: "delete", label: "删除", danger: true, icon: <Trash2 className="size-4" />, onClick: onDelete },
    ];
    return (
        <article
            className={`cursor-pointer rounded-lg border bg-card p-3 transition ${selected ? "border-stone-950 ring-1 ring-stone-950/10 dark:border-stone-100 dark:ring-stone-100/10" : "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"}`}
            onClick={onSelect}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{workflow.name || "未命名工作流"}</h2>
                    <div className="mt-1 flex flex-wrap gap-1">
                        <Tag className="m-0" variant="filled">
                            {workflow.mode === "multi_image_series" ? "多图" : "单图"}
                        </Tag>
                        {workflow.category ? (
                            <Tag className="m-0" variant="filled">
                                {workflow.category}
                            </Tag>
                        ) : null}
                    </div>
                </div>
                <Dropdown menu={{ items: menu }} trigger={["click"]}>
                    <Button type="text" size="small" icon={<MoreHorizontal className="size-4" />} aria-label="工作流操作" title="工作流操作" onClick={(event) => event.stopPropagation()} />
                </Dropdown>
            </div>
            <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-stone-500 dark:text-stone-400">{workflow.description || "暂无说明"}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] text-stone-400">{formatDate(workflow.lastRunAt || workflow.updatedAt)}</span>
                <Button
                    size="small"
                    type={selected ? "primary" : "default"}
                    icon={<Sparkles className="size-3.5" />}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRun();
                    }}
                >
                    打开
                </Button>
            </div>
        </article>
    );
}

function formatDate(value: number) {
    return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
