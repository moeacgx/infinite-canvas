"use client";

import { Copy, FolderPlus } from "lucide-react";
import { Fragment } from "react";
import { Button, Modal, Space, Tag } from "antd";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

function renderPreview(preview: string) {
    const parts = preview.split(/(!\[[^\]]*]\([^)]+\))/g);
    return parts.map((part, index) => {
        const match = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (match) {
            return <img key={index} src={match[2]} alt={match[1]} className="w-full rounded-lg" loading="lazy" />;
        }
        const text = part.trim();
        return text ? (
            <pre key={index} className="whitespace-pre-wrap text-xs leading-5 text-stone-600 dark:text-stone-300">
                {text}
            </pre>
        ) : null;
    });
}

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <img src={prompt.coverUrl} alt={prompt.title} className="w-full rounded-lg" loading="lazy" />
                                {prompt.preview ? <div className="space-y-3 rounded-lg bg-stone-100 p-3 dark:bg-stone-900">{renderPreview(prompt.preview)}</div> : null}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-1.5">
                                    {prompt.tags.map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                                <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                    创建：{formatPromptDate(prompt.createdAt)} · 更新：{formatPromptDate(prompt.updatedAt)}
                                </div>
                                <Space wrap className="mt-5">
                                    <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                        复制提示词
                                    </Button>
                                    {onSaveAsset ? (
                                        <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                            加入我的素材
                                        </Button>
                                    ) : null}
                                </Space>
                            </div>
                        </div>
                    </>
                ) : null}
            </Modal>
        </>
    );
}
