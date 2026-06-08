"use client";

import { Image as AntImage, Spin, Tag } from "antd";
import { Bot, ImageIcon, User, Video, Volume2, AlertCircle } from "lucide-react";
import type { AgentMessage } from "@/services/agent/agent-engine";
import type { SkillResult } from "@/services/agent/skill-executor";

const SKILL_LABELS: Record<string, string> = {
    generate_image: "生成图片",
    generate_video: "生成视频",
    generate_audio: "生成音频",
};

function SkillResultView({ result }: { result: SkillResult }) {
    if (result.type === "image" && result.images?.length) {
        return (
            <div className="mt-3 flex flex-wrap gap-2">
                <AntImage.PreviewGroup>
                    {result.images.map((img) => (
                        <AntImage
                            key={img.id}
                            src={img.dataUrl}
                            alt="生成结果"
                            className="rounded-lg"
                            style={{ maxWidth: 280, maxHeight: 360 }}
                        />
                    ))}
                </AntImage.PreviewGroup>
            </div>
        );
    }
    if (result.type === "video" && result.video?.url) {
        return (
            <div className="mt-3">
                <video src={result.video.url} controls className="max-w-sm rounded-lg" />
            </div>
        );
    }
    if (result.type === "audio" && result.audioUrl) {
        return (
            <div className="mt-3">
                <audio src={result.audioUrl} controls />
            </div>
        );
    }
    if (result.type === "error") {
        return (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                <AlertCircle className="size-3.5" />
                {result.error}
            </div>
        );
    }
    return null;
}

export function ChatMessage({
    message,
    isExecutingSkill,
    executingSkillName,
}: {
    message: AgentMessage;
    isExecutingSkill?: boolean;
    executingSkillName?: string;
}) {
    const isUser = message.role === "user";
    const isTool = message.role === "tool";

    // Don't render tool messages as separate bubbles - their results are shown on the assistant message
    if (isTool) return null;

    return (
        <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
            <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    isUser
                        ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-800"
                        : "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200"
                }`}
            >
                {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
            </div>
            <div
                className={`min-w-0 max-w-[75%] rounded-2xl px-4 py-3 ${
                    isUser
                        ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-800"
                        : "bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200"
                }`}
            >
                {message.content ? (
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {message.content}
                    </div>
                ) : null}
                {message.isStreaming && !message.content ? (
                    <div className="flex items-center gap-2 text-sm text-stone-400">
                        <Spin size="small" />
                        思考中...
                    </div>
                ) : null}
                {message.toolCalls?.map((tc) => (
                    <div key={tc.id} className="mt-2">
                        <Tag
                            icon={
                                tc.name === "generate_video" ? (
                                    <Video className="mr-1 inline size-3" />
                                ) : tc.name === "generate_audio" ? (
                                    <Volume2 className="mr-1 inline size-3" />
                                ) : (
                                    <ImageIcon className="mr-1 inline size-3" />
                                )
                            }
                            color="blue"
                        >
                            {SKILL_LABELS[tc.name] || tc.name}
                        </Tag>
                    </div>
                ))}
                {isExecutingSkill ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                        <Spin size="small" />
                        正在{SKILL_LABELS[executingSkillName || ""] || "执行技能"}...
                    </div>
                ) : null}
                {message.skillResults?.map((result, i) => (
                    <SkillResultView key={i} result={result} />
                ))}
            </div>
        </div>
    );
}
