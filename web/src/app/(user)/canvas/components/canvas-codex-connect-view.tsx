"use client";

import { useEffect, useState } from "react";
import { Button, Input, Tooltip, Typography } from "antd";
import { Copy, KeyRound, Link2, MessageSquare, PlugZap } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { useCodexAgent } from "../agent/use-codex-agent";

const pluginCommand = "codex plugin marketplace add https://github.com/tigerowo/infinite-canvas.git\ncodex plugin add canvas-agent@infinite-canvas";
const startCommand = "npm --prefix canvas-agent install\nnpm --prefix canvas-agent start";

export function CanvasCodexConnectView({ agent, onChat }: {
    agent: Pick<ReturnType<typeof useCodexAgent>, "connection" | "status" | "error" | "connect" | "disconnect">;
    onChat: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const [draft, setDraft] = useState(agent.connection);
    const connected = agent.status === "ready";
    const connecting = agent.status === "connecting";
    const statusText = { idle: "未连接", connecting: "连接中", ready: "已连接", error: "连接失败" }[agent.status];
    useEffect(() => setDraft(agent.connection), [agent.connection.endpoint, agent.connection.token]);
    const commandBlock = (command: string, label?: string) => (
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: theme.node.stroke }}>
            {label ? <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>{label}</span> : null}
            <code className="thin-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11px] leading-5">{command}</code>
            <Tooltip title="复制命令"><Button type="text" size="small" className="!size-6 !min-w-6 shrink-0" style={{ color: theme.node.muted }} icon={<Copy className="size-3.5" />} onClick={() => copyText(command, "命令已复制")} aria-label={label ? `复制${label}命令` : "复制命令"} /></Tooltip>
        </div>
    );
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-base font-semibold leading-6">连接本地 Agent</h2>
                <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>请先启动并保持本仓库服务运行，再通过插件或手动填写连接信息。</p>
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <h3 className="text-sm font-medium">第一步：启动本仓库 Agent（必需）</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>需要 Node.js 22+。在本仓库根目录运行以下命令，安装依赖并启动已修复的服务，连接期间保持终端运行。首次启动会生成并保存 Token。</p>
                {commandBlock(startCommand)}
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>上游 npm 包尚不包含本次修复；如果本地服务未启动，上游插件可能自动启动旧 npm 服务。请确认本仓库服务已成功启动，再进行下一步。</p>
            </div>
            <div className="space-y-2 px-3 py-2.5">
                <h3 className="text-sm font-medium">第二步：通过插件或手动连接</h3>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>使用插件时，安装 Infinite Canvas 插件后让 Codex 连接正在运行的本仓库服务，自动带入连接信息。</p>
                {commandBlock(pluginCommand)}
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>安装插件后新建 Codex 对话，说“帮我打开并连接到 Infinite Canvas”。</p>
            </div>
            <div className="space-y-2 rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke }}>
                <div className="text-xs font-medium">Codex 插件提醒</div>
                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>安装插件或手动添加 MCP 后，画布工具才会进入 Codex 上下文。仅启动本地 Agent 不会安装 MCP。</p>
                {commandBlock("codex plugin remove canvas-agent", "移除插件")}
                {commandBlock("codex mcp remove infinite-canvas", "移除 MCP")}
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">网页连接</span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, color: connected ? theme.node.text : theme.node.muted }}><span className="size-1.5 rounded-full bg-current" />{statusText}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>本仓库服务启动后，可手动填写终端中的 Local URL 和 Connect token；通过插件打开时自动填入，网页会记住连接信息。</p>
                    </div>
                    <Button type={connected || connecting ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={async () => {
                        if (connected || connecting) agent.disconnect();
                        else if (await agent.connect(draft)) onChat();
                    }}>{connected || connecting ? "断开" : "连接"}</Button>
                </div>
                <div className="mt-3 grid gap-3">
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><Link2 className="size-3.5" />本地地址 <span className="opacity-70">Local URL</span></span>
                        <Input size="large" prefix={<Link2 className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="本地 Agent 地址" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder="http://127.0.0.1:3210" />
                    </label>
                    <label className="grid gap-1.5">
                        <span className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><KeyRound className="size-3.5" />连接 Token <span className="opacity-70">Connect token</span></span>
                        <Input.Password size="large" prefix={<KeyRound className="mr-1 size-4" style={{ color: theme.node.faint }} />} aria-label="连接 Token" value={draft.token} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder="插件自动填入，或粘贴 Connect token" />
                    </label>
                    {agent.error ? <Typography.Text type="danger" role="alert" className="!text-xs leading-5">{agent.error}</Typography.Text> : null}
                    {connected ? <Button type="primary" icon={<MessageSquare className="size-4" />} onClick={onChat}>进入 Codex 对话</Button> : null}
                </div>
            </div>
        </div>
    );
}
