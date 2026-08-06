"use client";

import { ArrowRight } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useRouter } from "next/navigation";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { AssetPickerModal } from "./canvas/components/asset-picker-modal";
import { CanvasAssistantComposer } from "./canvas/components/canvas-assistant-composer";
import { createPendingAgentAsset } from "./canvas/agent/canvas-agent-attachments";
import { useCanvasStore } from "./canvas/stores/use-canvas-store";
import { HomeBannerCarousel, type HomeBanner } from "./home-banner-carousel";
import { DEFAULT_CANVAS_AGENT_VIDEO_SIZE, type CanvasAgentConfig, type InsertAssetPayload, type PendingAgentAsset } from "./canvas/types";

const BANNER_ROOT = "https://gcore.jsdelivr.net/gh/tigerowo/infinite-canvas@v0.5.0/web/public/banners";
const HOME_BANNERS: HomeBanner[] = [
    { imageUrl: `${BANNER_ROOT}/agent.webp`, videoUrl: `${BANNER_ROOT}/agent.webm`, alt: "Agent 一句话成片功能演示" },
    { imageUrl: `${BANNER_ROOT}/panorama.webp`, alt: "全景图生成与查看功能演示" },
    { imageUrl: `${BANNER_ROOT}/3ddirector.webp`, alt: "3D 导演台与下界轴功能演示" },
];

export default function IndexPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const effectiveConfig = useEffectiveConfig();
    const createProject = useCanvasStore((state) => state.createProject);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [pendingAssets, setPendingAssets] = useState<PendingAgentAsset[]>([]);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const uploadingCountRef = useRef(0);
    const [agentConfig, setAgentConfig] = useState<CanvasAgentConfig>(() => ({
        imageQuality: effectiveConfig.quality,
        imageSize: effectiveConfig.size,
        imageCount: effectiveConfig.canvasImageCount || effectiveConfig.count,
        imageBackground: effectiveConfig.background,
        videoQuality: effectiveConfig.vquality,
        videoSize: DEFAULT_CANVAS_AGENT_VIDEO_SIZE,
        videoSeconds: effectiveConfig.videoSeconds,
        videoMode: effectiveConfig.videoMode,
        videoNegativePrompt: effectiveConfig.videoNegativePrompt,
        videoGenerateAudio: effectiveConfig.videoGenerateAudio,
        videoWatermark: effectiveConfig.videoWatermark,
    }));
    const uploadInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message]);

    const addPendingAsset = (payload: InsertAssetPayload) => {
        setPendingAssets((current) => [...current, createPendingAgentAsset(payload)]);
    };

    const uploadFile = async (file: File) => {
        uploadingCountRef.current += 1;
        setUploadingCount(uploadingCountRef.current);
        try {
            if (file.type.startsWith("image/")) {
                const uploaded = await uploadImage(file);
                addPendingAsset({ kind: "image", dataUrl: uploaded.url, title: file.name, ...uploaded });
            } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
                const uploaded = await uploadMediaFile(file, file.type.startsWith("video/") ? "video" : "audio");
                if (file.type.startsWith("video/")) addPendingAsset({ kind: "video", title: file.name, ...uploaded });
                else addPendingAsset({ kind: "audio", title: file.name, ...uploaded });
            } else {
                throw new Error("仅支持图片、视频和音频文件");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        } finally {
            uploadingCountRef.current = Math.max(0, uploadingCountRef.current - 1);
            setUploadingCount(uploadingCountRef.current);
        }
    };

    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void uploadFile(file);
    };

    const submit = () => {
        const text = prompt.trim();
        if ((!text && !pendingAssets.length) || submitting) return;
        if (uploadingCountRef.current) {
            message.info("素材仍在上传，请稍后发送");
            return;
        }
        if (!hydrated) {
            message.info("画布数据正在加载，请稍后再试");
            return;
        }
        setSubmitting(true);
        const titles = new Set(useCanvasStore.getState().projects.map(({ title }) => title));
        let title = "无限画布";
        for (let i = 1; titles.has(title); i++) title = `无限画布 ${i}`;
        const projectId = createProject(title, {
            agentConfig,
            pendingAgentRequest: { prompt: text, assets: pendingAssets },
        });
        router.push(`/canvas/${projectId}`);
    };

    return (
        <main className="relative h-full overflow-x-hidden overflow-y-auto bg-background bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 sm:px-6">
                <div className="pointer-events-none absolute left-1/2 top-8 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,.08),transparent_68%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(245,158,11,.06),transparent_68%)]" />

                <section className="relative flex min-h-[650px] flex-col items-center justify-center py-8 sm:py-12">
                    <HomeBannerCarousel banners={HOME_BANNERS} />
                    <div className="mt-8 w-full max-w-[820px] sm:mt-11">
                        <CanvasAssistantComposer
                            prompt={prompt}
                            isRunning={false}
                            submitDisabled={submitting || uploadingCount > 0}
                            references={pendingAssets.map((asset) => asset.reference)}
                            agentConfig={agentConfig}
                            onAgentConfigChange={(patch) => setAgentConfig((current) => ({ ...current, ...patch }))}
                            onPromptChange={setPrompt}
                            onSubmit={submit}
                            onOpenUpload={() => uploadInputRef.current?.click()}
                            onOpenAssets={() => setAssetPickerOpen(true)}
                            onRemoveReference={(id) => setPendingAssets((current) => current.filter((asset) => asset.nodeId !== id))}
                            onPasteImage={(file) => void uploadFile(file)}
                        />
                    </div>
                    <input ref={uploadInputRef} hidden type="file" accept="image/*,video/*,audio/*" onChange={onUploadInputChange} />
                </section>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">沉淀每一次好结果</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button type="link" href="/prompts" className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-stone-200 bg-stone-100 text-left dark:border-stone-800 dark:bg-stone-900",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            </section>
            <AssetPickerModal
                open={assetPickerOpen}
                defaultTab="my-assets"
                onInsert={(payload) => {
                    addPendingAsset(payload);
                    setAssetPickerOpen(false);
                }}
                onClose={() => setAssetPickerOpen(false)}
            />
            <Image.PreviewGroup
                items={promptShowcase.map((item) => ({
                    src: item.coverUrl,
                    alt: item.title,
                }))}
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            />
        </main>
    );
}
