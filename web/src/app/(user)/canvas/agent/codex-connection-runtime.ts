import type { createCodexAgentClient } from "@/services/api/codex-agent";
import { createCanvasAgentExecutionBudget, createCanvasAgentState, executeActions } from "./canvas-agent-runtime";
import type { CanvasAgentAction, CanvasAgentToolResult } from "./canvas-agent-tools";

// 外部 MCP 没有 turn 标记，预算和去重记录在一次网页连接内累计，重新连接才重置。
export function createExternalCodexExecutor(executeTool: (action: CanvasAgentAction, signal: AbortSignal) => Promise<CanvasAgentToolResult>) {
    const budget = createCanvasAgentExecutionBudget();
    const writes = new Set<string>();
    let state = createCanvasAgentState();
    return async (action: CanvasAgentAction, signal: AbortSignal) => {
        const execution = await executeActions([action], state, budget, writes, (action) => executeTool(action, signal), signal);
        signal.throwIfAborted();
        state = execution.state;
        const result = execution.items[0].result;
        return result.code === "turn_budget_exceeded"
            ? { ...result, message: `本次网页连接的外部工具预算已用尽（最多 24 次写入、6 个媒体任务、12 张图片）。请检查已完成结果，重新连接后再继续。` }
            : result;
    };
}

type ArchiveClient = Pick<ReturnType<typeof createCodexAgentClient>, "connected" | "serviceId" | "rpc">;
export async function archiveCodexThread(client: ArchiveClient | null, threadId: string, serviceId?: string) {
    if (!client?.connected() || !serviceId || serviceId !== client.serviceId) return { status: "skipped" as const };
    try {
        await client.rpc("thread/archive", { threadId });
        return { status: "archived" as const };
    } catch (error) {
        return { status: "failed" as const, message: error instanceof Error ? error.message : "归档请求失败" };
    }
}
