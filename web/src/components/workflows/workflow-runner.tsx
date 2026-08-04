"use client";

import { App, Button, Empty, Image, Input, Select, Spin, Switch, Tag } from "antd";
import { Download, FolderPlus, ImagePlus, Play, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useRef, useState } from "react";

import { AssetPickerModal, type InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import {
    buildSeriesPromptDraftRequest,
    createDefaultWorkflowInputs,
    MAX_WORKFLOW_SERIES_CONCURRENCY,
    missingRequiredWorkflowVariable,
    parseSeriesPromptDrafts,
    renderWorkflowPrompt,
    type CreativeWorkflow,
    type SeriesPromptDraft,
    type WorkflowVariable,
} from "@/lib/creative-workflow";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { loadSeriesPromptDrafts, saveSeriesPromptDrafts } from "@/services/workflow-storage";
import { modelOptionLabel, resolveCapabilityModel, type AiConfig, useConfigStore } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

type WorkflowReference = ReferenceImage & { temporary?: boolean };
type GeneratedWorkflowImage = {
    id: string;
    title: string;
    prompt: string;
    dataUrl: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    durationMs: number;
};
type RunItem = {
    id: string;
    title: string;
    prompt: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedWorkflowImage;
    error?: string;
};

type Props = {
    workflow: CreativeWorkflow;
    config: AiConfig;
    onRunComplete: (workflow: CreativeWorkflow) => Promise<void> | void;
};

const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export function WorkflowRunner({ workflow, config, onRunComplete }: Props) {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const referencesRef = useRef<WorkflowReference[]>([]);
    const seriesDraftsLoadedForRef = useRef("");
    const startedAtRef = useRef(0);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const [inputs, setInputs] = useState(() => createDefaultWorkflowInputs(workflow));
    const [references, setReferences] = useState<WorkflowReference[]>([]);
    const [results, setResults] = useState<RunItem[]>([]);
    const [seriesDrafts, setSeriesDrafts] = useState<SeriesPromptDraft[]>([]);
    const [planning, setPlanning] = useState(false);
    const [running, setRunning] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);

    const prompt = useMemo(() => renderWorkflowPrompt(workflow, inputs), [inputs, workflow]);
    const imageModel = resolveCapabilityModel(config, "image", workflow.config.imageModel);
    const textModel = resolveCapabilityModel(config, "text", workflow.seriesConfig.promptModel);
    const runConfig = useMemo(
        () => ({
            ...config,
            imageModel,
            quality: workflow.config.quality,
            size: workflow.config.size,
            count: workflow.config.count,
            background: workflow.config.background,
        }),
        [config, imageModel, workflow.config],
    );

    const updateReferences = (updater: (current: WorkflowReference[]) => WorkflowReference[]) => {
        setReferences((current) => {
            const next = updater(current);
            referencesRef.current = next;
            return next;
        });
    };

    const cleanupTemporaryReferences = (items = referencesRef.current) => {
        const keys = items.filter((item) => item.temporary && item.storageKey).map((item) => item.storageKey!);
        if (keys.length) void deleteStoredImages(keys).catch(() => undefined);
    };

    const persistReferenceOwnership = () => {
        updateReferences((current) => current.map((item) => (item.temporary ? { ...item, temporary: false } : item)));
    };

    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        cleanupTemporaryReferences();
        referencesRef.current = [];
        setPlanning(false);
        setRunning(false);
        setInputs(createDefaultWorkflowInputs(workflow));
        setReferences([]);
        setResults([]);
        setSeriesDrafts([]);
        seriesDraftsLoadedForRef.current = "";
        let active = true;
        if (workflow.mode === "multi_image_series") {
            void loadSeriesPromptDrafts(workflow.id)
                .then((drafts) => {
                    if (!active) return;
                    seriesDraftsLoadedForRef.current = workflow.id;
                    setSeriesDrafts(drafts);
                })
                .catch((error) => {
                    if (!active) return;
                    seriesDraftsLoadedForRef.current = workflow.id;
                    message.error(errorText(error));
                });
        }
        return () => {
            active = false;
        };
    }, [workflow.id, workflow.mode]);

    useEffect(() => {
        if (workflow.mode === "multi_image_series" && seriesDraftsLoadedForRef.current === workflow.id) {
            void saveSeriesPromptDrafts(workflow.id, seriesDrafts).catch(() => undefined);
        }
    }, [seriesDrafts, workflow.id, workflow.mode]);

    useEffect(() => {
        if (!running && !planning) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 1000);
        return () => window.clearInterval(timer);
    }, [planning, running]);

    useEffect(
        () => () => {
            controllerRef.current?.abort();
            cleanupTemporaryReferences();
        },
        [],
    );

    const addReferences = async (files?: FileList | null) => {
        const images = Array.from(files || [])
            .filter((file) => file.type.startsWith("image/"))
            .slice(0, Math.max(0, 10 - references.length));
        const next: WorkflowReference[] = [];
        try {
            for (const file of images) {
                const stored = await uploadImage(file);
                next.push({ id: nanoid(), name: file.name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey, temporary: true });
            }
            updateReferences((value) => [...value, ...next]);
        } catch (error) {
            cleanupTemporaryReferences(next);
            message.error(errorText(error));
        }
    };

    const removeReference = async (reference: WorkflowReference) => {
        updateReferences((value) => value.filter((item) => item.id !== reference.id));
        if (reference.temporary && reference.storageKey) await deleteStoredImages([reference.storageKey]).catch(() => undefined);
    };

    const insertAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            const variable = workflow.variables.find((item) => item.type === "textarea" || item.type === "text");
            if (variable) setInputs((value) => ({ ...value, [variable.key]: payload.content }));
            else message.warning("当前工作流没有文本变量");
        } else if (payload.kind === "image") {
            if (referencesRef.current.length >= 10) return message.warning("参考图最多 10 张");
            updateReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "image/png", dataUrl: payload.dataUrl, storageKey: payload.storageKey }]);
        } else {
            message.warning("视频素材不能作为图片工作流参考图");
            return;
        }
        setAssetPickerOpen(false);
    };

    const validateRun = () => {
        const missing = missingRequiredWorkflowVariable(workflow, inputs);
        if (missing) {
            message.error(`请填写 ${missing.label}`);
            return false;
        }
        if (!prompt.trim()) {
            message.error("提示词不能为空");
            return false;
        }
        if (!isAiConfigReady(runConfig, imageModel)) {
            message.warning("请先完成生图模型配置");
            openConfigDialog(true);
            return false;
        }
        return true;
    };

    const runSingle = async () => {
        if (!validateRun()) return;
        const count = Math.max(1, Math.min(15, Number(workflow.config.count) || 1));
        const slots = Array.from({ length: count }, (_, index) => ({ id: nanoid(), title: `结果 ${index + 1}`, prompt, status: "pending" as const }));
        setResults(slots);
        const controller = beginRun();
        try {
            const requestConfig = { ...runConfig, count: String(count) };
            const response = references.length ? await requestEdit(requestConfig, prompt, references, undefined, { signal: controller.signal }) : await requestGeneration(requestConfig, prompt, { signal: controller.signal });
            throwIfAborted(controller.signal);
            const stored = await Promise.all(response.map((item, index) => storeGeneratedImage(item.dataUrl, `结果 ${index + 1}`, prompt, performance.now() - startedAtRef.current)));
            throwIfAborted(controller.signal);
            setResults(slots.map((slot, index) => (stored[index] ? { ...slot, status: "success", image: stored[index] } : { ...slot, status: "failed", error: `接口只返回 ${stored.length} 张图片` })));
            await saveGenerationLog(prompt, requestConfig, imageModel, references, stored, count - stored.length, performance.now() - startedAtRef.current, workflow);
            persistReferenceOwnership();
            if (stored.length) await markRunComplete();
            message.success(`生成完成，共 ${stored.length} 张`);
        } catch (error) {
            if (controller.signal.aborted) return;
            const text = errorText(error);
            setResults(slots.map((slot) => ({ ...slot, status: "failed", error: text })));
            await saveGenerationLog(prompt, { ...runConfig, count: String(count) }, imageModel, references, [], count, performance.now() - startedAtRef.current, workflow);
            persistReferenceOwnership();
            message.error(text);
        } finally {
            finishRun(controller);
        }
    };

    const planSeries = async () => {
        const missing = missingRequiredWorkflowVariable(workflow, inputs);
        if (missing) return message.error(`请填写 ${missing.label}`);
        if (!prompt.trim()) return message.error("提示词不能为空");
        const textConfig = { ...config, model: textModel, textModel };
        if (!isAiConfigReady(textConfig, textModel)) {
            message.warning("请先完成文本模型配置");
            openConfigDialog(true);
            return;
        }
        const count = Math.max(1, Math.min(20, Number(workflow.seriesConfig.targetCount) || 6));
        const controller = beginRun(true);
        try {
            const answer = await requestImageQuestion(textConfig, [{ role: "user", content: buildSeriesPromptDraftRequest(workflow, prompt, count, inputs) }], () => undefined, { signal: controller.signal });
            throwIfAborted(controller.signal);
            const drafts = parseSeriesPromptDrafts(answer, count, prompt);
            setSeriesDrafts(drafts);
            message.success("多图提示词已生成");
            if (!workflow.seriesConfig.reviewRequired) await runDraftList(drafts, controller);
        } catch (error) {
            if (!controller.signal.aborted) message.error(errorText(error));
        } finally {
            finishRun(controller, true);
        }
    };

    const runDraftList = async (drafts: SeriesPromptDraft[], existingController?: AbortController) => {
        if (!validateRun()) return;
        const runnable = drafts.filter((draft) => draft.prompt.trim() && draft.status !== "running");
        if (!runnable.length) return message.warning("没有可生成的提示词");
        const controller = existingController || beginRun();
        if (existingController) {
            setPlanning(false);
            setRunning(true);
        }
        const concurrency = Math.max(1, Math.min(MAX_WORKFLOW_SERIES_CONCURRENCY, Number(workflow.seriesConfig.concurrency) || MAX_WORKFLOW_SERIES_CONCURRENCY));
        let successCount = 0;
        let failureCount = 0;
        setSeriesDrafts(drafts.map((draft) => (runnable.some((item) => item.id === draft.id) ? { ...draft, status: "running", error: undefined } : draft)));
        setResults(runnable.map((draft) => ({ id: draft.id, title: draft.title, prompt: draft.prompt, status: "pending" })));
        try {
            await runWithConcurrency(runnable, concurrency, controller.signal, async (draft) => {
                try {
                    throwIfAborted(controller.signal);
                    const requestConfig = { ...runConfig, count: "1" };
                    const response = references.length ? await requestEdit(requestConfig, draft.prompt, references, undefined, { signal: controller.signal }) : await requestGeneration(requestConfig, draft.prompt, { signal: controller.signal });
                    throwIfAborted(controller.signal);
                    const first = response[0];
                    if (!first) throw new Error("接口没有返回图片");
                    const image = await storeGeneratedImage(first.dataUrl, draft.title, draft.prompt, performance.now() - startedAtRef.current);
                    throwIfAborted(controller.signal);
                    setResults((value) => value.map((item) => (item.id === draft.id ? { ...item, status: "success", image } : item)));
                    setSeriesDrafts((value) => value.map((item) => (item.id === draft.id ? { ...item, status: "success", resultIds: [image.id], error: undefined } : item)));
                    await saveGenerationLog(draft.prompt, requestConfig, imageModel, references, [image], 0, image.durationMs, workflow, draft.title);
                    persistReferenceOwnership();
                    successCount += 1;
                } catch (error) {
                    if (controller.signal.aborted) {
                        setResults((value) => value.filter((item) => item.id !== draft.id || item.status === "success"));
                        setSeriesDrafts((value) => value.map((item) => (item.id === draft.id && item.status === "running" ? { ...item, status: "draft", error: undefined } : item)));
                        return;
                    }
                    const text = errorText(error);
                    setResults((value) => value.map((item) => (item.id === draft.id ? { ...item, status: "failed", error: text } : item)));
                    setSeriesDrafts((value) => value.map((item) => (item.id === draft.id ? { ...item, status: "failed", error: text } : item)));
                    await saveGenerationLog(draft.prompt, { ...runConfig, count: "1" }, imageModel, references, [], 1, performance.now() - startedAtRef.current, workflow, draft.title);
                    persistReferenceOwnership();
                    failureCount += 1;
                }
            });
            if (!controller.signal.aborted) {
                if (successCount) await markRunComplete();
                if (!failureCount) message.success(`系列图片生成完成，共 ${successCount} 张`);
                else if (successCount) message.warning(`系列图片生成完成：成功 ${successCount} 张，失败 ${failureCount} 张`);
                else message.error(`系列图片生成失败，共 ${failureCount} 张`);
            }
        } finally {
            if (existingController) {
                if (controllerRef.current === controller) setRunning(false);
            } else finishRun(controller);
        }
    };

    const retryResult = async (item: RunItem) => {
        if (!validateRun()) return;
        const controller = beginRun();
        setResults((value) => value.map((result) => (result.id === item.id ? { ...result, status: "pending", error: undefined } : result)));
        try {
            const requestConfig = { ...runConfig, count: "1" };
            const response = references.length ? await requestEdit(requestConfig, item.prompt, references, undefined, { signal: controller.signal }) : await requestGeneration(requestConfig, item.prompt, { signal: controller.signal });
            throwIfAborted(controller.signal);
            if (!response[0]) throw new Error("接口没有返回图片");
            const image = await storeGeneratedImage(response[0].dataUrl, item.title, item.prompt, performance.now() - startedAtRef.current);
            throwIfAborted(controller.signal);
            setResults((value) => value.map((result) => (result.id === item.id ? { ...result, status: "success", image } : result)));
            await saveGenerationLog(item.prompt, requestConfig, imageModel, references, [image], 0, image.durationMs, workflow, item.title);
            persistReferenceOwnership();
            await markRunComplete();
            message.success("重试成功");
        } catch (error) {
            if (!controller.signal.aborted) setResults((value) => value.map((result) => (result.id === item.id ? { ...result, status: "failed", error: errorText(error) } : result)));
        } finally {
            finishRun(controller);
        }
    };

    const beginRun = (isPlanning = false) => {
        if (controllerRef.current) {
            controllerRef.current.abort();
            setResults((value) => value.filter((item) => item.status !== "pending"));
            setSeriesDrafts((value) => value.map((item) => (item.status === "running" ? { ...item, status: "draft", error: undefined } : item)));
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        startedAtRef.current = performance.now();
        setElapsedMs(0);
        if (isPlanning) setPlanning(true);
        else setRunning(true);
        return controller;
    };

    const finishRun = (controller: AbortController, isPlanning = false) => {
        if (controllerRef.current !== controller) return;
        controllerRef.current = null;
        if (isPlanning) setPlanning(false);
        else setRunning(false);
    };

    const stop = () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setPlanning(false);
        setRunning(false);
        setResults((value) => value.filter((item) => item.status !== "pending"));
        setSeriesDrafts((value) => value.map((item) => (item.status === "running" ? { ...item, status: "draft", error: undefined } : item)));
        message.info("已停止当前任务");
    };

    const markRunComplete = async () => onRunComplete({ ...workflow, lastRunAt: Date.now(), updatedAt: Date.now() });

    const saveResultToAssets = async (image: GeneratedWorkflowImage) => {
        try {
            const stored = await uploadImage(image.dataUrl);
            addAsset({
                kind: "image",
                title: `${workflow.name} · ${image.title}`,
                coverUrl: stored.url,
                tags: workflow.category ? [workflow.category] : [],
                source: "创意工作流",
                data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "workflow", workflowId: workflow.id, prompt: image.prompt },
            });
            message.success("已加入我的素材");
        } catch (error) {
            message.error(errorText(error));
        }
    };

    const busy = running || planning;

    return (
        <div className="min-w-0 space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
                <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold">{workflow.name}</h2>
                        <Tag color={workflow.mode === "multi_image_series" ? "blue" : undefined}>{workflow.mode === "multi_image_series" ? "多图系列" : "单图"}</Tag>
                        {workflow.category ? <Tag>{workflow.category}</Tag> : null}
                    </div>
                    <p className="max-w-3xl text-sm text-stone-500 dark:text-stone-400">{workflow.description || "暂无说明"}</p>
                </div>
                <div className="text-right text-xs text-stone-500 dark:text-stone-400">
                    <div>{modelOptionLabel(config, imageModel)}</div>
                    <div className="mt-1">
                        {workflow.config.size} · {workflow.config.quality} · {workflow.config.count} 张
                    </div>
                </div>
            </header>

            <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">输入内容</h3>
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                        选择素材
                    </Button>
                </div>
                {workflow.variables.length ? (
                    <div className="grid gap-4 md:grid-cols-2">
                        {workflow.variables.map((variable) => (
                            <WorkflowVariableInput key={variable.id} variable={variable} value={inputs[variable.key] || ""} onChange={(value) => setInputs((current) => ({ ...current, [variable.key]: value }))} />
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-stone-500">该模板使用固定提示词，无需填写变量。</div>
                )}
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">参考图</h3>
                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                        上传图片
                    </Button>
                </div>
                <input ref={fileInputRef} className="hidden" type="file" accept="image/*" multiple onChange={(event) => void addReferences(event.target.files).finally(() => (event.target.value = ""))} />
                <div className="flex min-h-24 gap-2 overflow-x-auto rounded-lg border border-dashed border-stone-300 p-2 dark:border-stone-700">
                    {references.map((reference, index) => (
                        <div key={reference.id} className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                            <img src={reference.dataUrl} alt={reference.name} className="size-full object-cover" />
                            <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">图片 {index + 1}</span>
                            <button
                                type="button"
                                className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/65 text-white group-hover:flex"
                                title="移除参考图"
                                aria-label="移除参考图"
                                onClick={() => void removeReference(reference)}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    ))}
                    {!references.length ? <div className="grid min-w-full place-items-center text-sm text-stone-500">可选，最多 10 张</div> : null}
                </div>
            </section>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold">最终提示词</h3>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-700 dark:bg-stone-900 dark:text-stone-300">{prompt || "填写变量后将在这里预览"}</pre>
            </section>

            {workflow.mode === "multi_image_series" ? (
                <SeriesPlanner
                    drafts={seriesDrafts}
                    planning={planning}
                    running={running}
                    elapsedMs={elapsedMs}
                    onPlan={() => void planSeries()}
                    onRunAll={() => void runDraftList(seriesDrafts)}
                    onStop={stop}
                    onChange={(id, patch) => setSeriesDrafts((value) => value.map((item) => (item.id === id ? { ...item, ...patch, status: patch.prompt === undefined ? item.status : "draft" } : item)))}
                    onDelete={(id) => setSeriesDrafts((value) => value.filter((item) => item.id !== id))}
                />
            ) : (
                <div className="flex items-center gap-3">
                    <Button type="primary" size="large" icon={running ? <Square className="size-4" /> : <Play className="size-4" />} onClick={running ? stop : () => void runSingle()}>
                        {running ? `停止生成 · ${formatDuration(elapsedMs)}` : "运行工作流"}
                    </Button>
                </div>
            )}

            <section className="space-y-3 border-t pt-5">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">生成结果</h3>
                    {busy ? <Spin size="small" /> : null}
                </div>
                {results.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {results.map((item, index) => (
                            <div key={item.id} className="overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
                                <div className="relative aspect-square bg-stone-100 dark:bg-stone-900">
                                    {item.image ? <Image src={item.image.dataUrl} alt={item.title} width="100%" height="100%" className="!h-full !w-full object-cover" /> : null}
                                    {item.status === "pending" ? (
                                        <div className="absolute inset-0 grid place-items-center">
                                            <Spin />
                                        </div>
                                    ) : null}
                                    {item.status === "failed" ? <div className="absolute inset-0 grid place-items-center p-5 text-center text-sm text-red-500">{item.error || "生成失败"}</div> : null}
                                </div>
                                <div className="space-y-2 p-3">
                                    <div className="truncate text-sm font-medium">{item.title}</div>
                                    {item.image ? (
                                        <div className="text-xs text-stone-500">
                                            {item.image.width}×{item.image.height} · {formatBytes(item.image.bytes)} · {formatDuration(item.image.durationMs)}
                                        </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1">
                                        {item.image ? (
                                            <>
                                                <Button size="small" type="text" icon={<Download className="size-3.5" />} onClick={() => saveAs(item.image!.dataUrl, `${safeFileName(workflow.name)}-${index + 1}.png`)}>
                                                    下载
                                                </Button>
                                                <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} onClick={() => saveResultToAssets(item.image!)}>
                                                    存素材
                                                </Button>
                                            </>
                                        ) : null}
                                        {item.status === "failed" ? (
                                            <Button size="small" type="text" disabled={busy} icon={<RotateCcw className="size-3.5" />} onClick={() => void retryResult(item)}>
                                                重试
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="运行后在这里查看结果" />
                )}
            </section>

            <AssetPickerModal open={assetPickerOpen} onInsert={(payload) => void insertAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function WorkflowVariableInput({ variable, value, onChange }: { variable: WorkflowVariable; value: string; onChange: (value: string) => void }) {
    const label = (
        <span className="mb-1.5 block text-xs font-medium text-stone-500 dark:text-stone-400">
            {variable.label || variable.key}
            {variable.required ? <span className="ml-1 text-red-500">*</span> : null}
        </span>
    );
    if (variable.type === "boolean")
        return (
            <label className="flex min-h-14 items-center justify-between rounded-lg border border-stone-200 px-3 dark:border-stone-800">
                <span className="text-sm">{variable.label || variable.key}</span>
                <Switch checked={value === "true"} onChange={(checked) => onChange(checked ? "true" : "false")} />
            </label>
        );
    if (variable.type === "select")
        return (
            <label>
                {label}
                <Select className="w-full" value={value || undefined} placeholder={variable.placeholder || "请选择"} options={variable.options.map((item) => ({ label: item, value: item }))} onChange={onChange} />
            </label>
        );
    if (variable.type === "textarea")
        return (
            <label className="md:col-span-2">
                {label}
                <Input.TextArea value={value} autoSize={{ minRows: 3, maxRows: 8 }} placeholder={variable.placeholder} onChange={(event) => onChange(event.target.value)} />
            </label>
        );
    return (
        <label>
            {label}
            <Input type={variable.type === "number" ? "number" : "text"} value={value} placeholder={variable.placeholder} onChange={(event) => onChange(event.target.value)} />
        </label>
    );
}

function SeriesPlanner({
    drafts,
    planning,
    running,
    elapsedMs,
    onPlan,
    onRunAll,
    onStop,
    onChange,
    onDelete,
}: {
    drafts: SeriesPromptDraft[];
    planning: boolean;
    running: boolean;
    elapsedMs: number;
    onPlan: () => void;
    onRunAll: () => void;
    onStop: () => void;
    onChange: (id: string, patch: Partial<SeriesPromptDraft>) => void;
    onDelete: (id: string) => void;
}) {
    return (
        <section className="space-y-3 border-t pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold">系列提示词</h3>
                    <p className="mt-1 text-xs text-stone-500">先由文本模型拆分画面，再审核并批量生成。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button disabled={running} icon={planning ? <Square className="size-4" /> : <Play className="size-4" />} onClick={planning ? onStop : onPlan}>
                        {planning ? `停止策划 · ${formatDuration(elapsedMs)}` : drafts.length ? "重新策划" : "生成提示词"}
                    </Button>
                    <Button type="primary" disabled={planning || !drafts.length} icon={running ? <Square className="size-4" /> : <ImagePlus className="size-4" />} onClick={running ? onStop : onRunAll}>
                        {running ? `停止生成 · ${formatDuration(elapsedMs)}` : "批量生图"}
                    </Button>
                </div>
            </div>
            <div className="space-y-2">
                {drafts.map((draft, index) => (
                    <div key={draft.id} className="grid gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800 sm:grid-cols-[120px_minmax(0,1fr)_32px]">
                        <Input value={draft.title} placeholder={`第 ${index + 1} 张`} onChange={(event) => onChange(draft.id, { title: event.target.value })} />
                        <Input.TextArea value={draft.prompt} autoSize={{ minRows: 2, maxRows: 7 }} onChange={(event) => onChange(draft.id, { prompt: event.target.value })} />
                        <Button type="text" danger icon={<Trash2 className="size-4" />} title="删除提示词" aria-label="删除提示词" onClick={() => onDelete(draft.id)} />
                        {draft.error ? <div className="text-xs text-red-500 sm:col-start-2">{draft.error}</div> : null}
                    </div>
                ))}
            </div>
        </section>
    );
}

async function storeGeneratedImage(dataUrl: string, title: string, prompt: string, durationMs: number): Promise<GeneratedWorkflowImage> {
    const stored = await uploadImage(dataUrl);
    return { id: nanoid(), title, prompt, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, durationMs };
}

async function saveGenerationLog(prompt: string, config: AiConfig, model: string, references: WorkflowReference[], images: GeneratedWorkflowImage[], failCount: number, durationMs: number, workflow: CreativeWorkflow, seriesTitle?: string) {
    const id = nanoid();
    await imageLogStore.setItem(id, {
        id,
        createdAt: Date.now(),
        title: seriesTitle ? `${workflow.name} · ${seriesTitle}` : workflow.name,
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: { model, imageModel: model, quality: config.quality, size: config.size, count: config.count },
        references: references.map((item) => ({ id: item.id, name: item.name, type: item.type, dataUrl: item.storageKey ? "" : item.dataUrl, url: item.url, storageKey: item.storageKey })),
        durationMs,
        successCount: images.length,
        failCount,
        imageCount: images.length + failCount,
        size: config.size,
        quality: config.quality,
        status: images.length ? "成功" : "失败",
        images: images.map((image) => ({ ...image, dataUrl: "" })),
        thumbnails: [],
        workflowId: workflow.id,
        workflowName: workflow.name,
    });
}

async function runWithConcurrency<T>(items: T[], limit: number, signal: AbortSignal, worker: (item: T) => Promise<void>) {
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (!signal.aborted && nextIndex < items.length) await worker(items[nextIndex++]);
        }),
    );
}

function throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("任务已停止", "AbortError");
}

function errorText(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return "任务已停止";
    return error instanceof Error ? error.message : "生成失败";
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_") || "workflow";
}
