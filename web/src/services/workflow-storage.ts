"use client";

import localforage from "localforage";
import { nanoid } from "nanoid";

import { createStarterWorkflows, mergeWorkflows, normalizeSeriesPromptDraft, normalizeWorkflow, type CreativeWorkflow, type SeriesPromptDraft } from "@/lib/creative-workflow";
import type { AiConfig } from "@/stores/use-config-store";

const WORKFLOW_LIST_KEY = "items";
const SERIES_DRAFT_PREFIX = "series:";
const MAX_WORKFLOWS = 500;
const MAX_SERIES_DRAFTS = 20;

const workflowStore = localforage.createInstance({ name: "infinite-canvas", storeName: "creative_workflows" });

export async function loadWorkflows(config?: Partial<AiConfig>) {
    try {
        const stored = await workflowStore.getItem<unknown>(WORKFLOW_LIST_KEY);
        if (Array.isArray(stored)) return normalizeWorkflowList(stored, config);
    } catch {
        // IndexedDB 暂时不可用时仍允许使用内置工作流。
    }
    const starter = createStarterWorkflows(config);
    await replaceWorkflows(starter, config).catch(() => undefined);
    return starter;
}

export async function readStoredWorkflows(config?: Partial<AiConfig>) {
    try {
        const stored = await workflowStore.getItem<unknown>(WORKFLOW_LIST_KEY);
        return Array.isArray(stored) ? normalizeWorkflowList(stored, config) : [];
    } catch {
        return [];
    }
}

export async function replaceWorkflows(workflows: CreativeWorkflow[], config?: Partial<AiConfig>) {
    const normalized = normalizeWorkflowList(workflows, config).slice(0, MAX_WORKFLOWS);
    await workflowStore.setItem(WORKFLOW_LIST_KEY, normalized);
    return normalized;
}

export async function saveWorkflow(workflows: CreativeWorkflow[], workflow: CreativeWorkflow, config?: Partial<AiConfig>) {
    const normalized = normalizeWorkflow({ ...workflow, updatedAt: Date.now() }, config);
    const next = workflows.some((item) => item.id === normalized.id) ? workflows.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...workflows];
    return replaceWorkflows(next, config);
}

export async function duplicateWorkflow(workflows: CreativeWorkflow[], workflow: CreativeWorkflow, config?: Partial<AiConfig>) {
    const now = Date.now();
    const copy = normalizeWorkflow(
        {
            ...workflow,
            id: nanoid(),
            scope: "private",
            editable: true,
            name: `${workflow.name} 副本`,
            createdAt: now,
            updatedAt: now,
            lastRunAt: undefined,
        },
        config,
    );
    return { copy, workflows: await replaceWorkflows([copy, ...workflows], config) };
}

export async function deleteWorkflow(workflows: CreativeWorkflow[], id: string, config?: Partial<AiConfig>) {
    await workflowStore.removeItem(seriesDraftKey(id));
    return replaceWorkflows(
        workflows.filter((workflow) => workflow.id !== id),
        config,
    );
}

export async function mergeStoredWorkflows(workflows: CreativeWorkflow[], config?: Partial<AiConfig>) {
    const local = await readStoredWorkflows(config);
    return replaceWorkflows(mergeWorkflows(local, workflows), config);
}

export async function loadSeriesPromptDrafts(workflowId: string) {
    try {
        const stored = await workflowStore.getItem<unknown>(seriesDraftKey(workflowId));
        return Array.isArray(stored) ? stored.slice(0, MAX_SERIES_DRAFTS).map(normalizeSeriesPromptDraft) : [];
    } catch {
        return [];
    }
}

export async function saveSeriesPromptDrafts(workflowId: string, drafts: SeriesPromptDraft[]) {
    await workflowStore.setItem(seriesDraftKey(workflowId), drafts.slice(0, MAX_SERIES_DRAFTS).map(normalizeSeriesPromptDraft));
}

function normalizeWorkflowList(items: unknown[], config?: Partial<AiConfig>) {
    return items.map((item) => normalizeWorkflow(item, config)).sort((a, b) => b.updatedAt - a.updatedAt);
}

function seriesDraftKey(workflowId: string) {
    return `${SERIES_DRAFT_PREFIX}${workflowId.slice(0, 128)}`;
}
