"use client";

import { ArrowRight, ArrowUp, ChevronDown, ImagePlus, Video } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { App, Button, Dropdown, Image, Tag } from "antd";
import { useRouter } from "next/navigation";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { HomeBannerCarousel, type HomeBanner } from "./home-banner-carousel";

const BANNER_ROOT = "https://gcore.jsdelivr.net/gh/tigerowo/infinite-canvas@v0.5.0/web/public/banners";
const HOME_BANNERS: HomeBanner[] = [
    { imageUrl: `${BANNER_ROOT}/agent.webp`, videoUrl: `${BANNER_ROOT}/agent.webm`, alt: "Agent 一句话成片功能演示" },
    { imageUrl: `${BANNER_ROOT}/panorama.webp`, alt: "全景图生成与查看功能演示" },
    { imageUrl: `${BANNER_ROOT}/3ddirector.webp`, alt: "3D 导演台与下界轴功能演示" },
];

type QuickCreateMode = "image" | "video";

const IMAGE_PRESETS = [
    { key: "1:1", size: "1:1", label: "自动 · 1:1" },
    { key: "16:9", size: "16:9", label: "自动 · 16:9" },
    { key: "9:16", size: "9:16", label: "自动 · 9:16" },
    { key: "3:2", size: "3:2", label: "自动 · 3:2" },
] as const;

const VIDEO_PRESETS = [
    { key: "720-landscape", size: "1280x720", quality: "720", label: "720p · 横屏" },
    { key: "720-portrait", size: "720x1280", quality: "720", label: "720p · 竖屏" },
    { key: "1080-landscape", size: "1920x1080", quality: "1080", label: "1080p · 横屏" },
    { key: "1080-portrait", size: "1080x1920", quality: "1080", label: "1080p · 竖屏" },
] as const;

export default function IndexPage() {
    const { message } = App.useApp();
    const router = useRouter();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const dispatchImage = useWorkbenchAgentStore((state) => state.dispatchImage);
    const dispatchVideo = useWorkbenchAgentStore((state) => state.dispatchVideo);
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [quickPrompt, setQuickPrompt] = useState("");
    const [quickMode, setQuickMode] = useState<QuickCreateMode>("image");
    const [imagePreset, setImagePreset] = useState<(typeof IMAGE_PRESETS)[number]>(IMAGE_PRESETS[0]);
    const [videoPreset, setVideoPreset] = useState<(typeof VIDEO_PRESETS)[number]>(VIDEO_PRESETS[0]);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message]);

    const openWorkbench = () => {
        const prompt = quickPrompt.trim();
        if (!prompt) {
            message.info("先描述一下你想创作的画面");
            return;
        }
        if (quickMode === "image") {
            updateConfig("size", imagePreset.size);
            dispatchImage({ prompt, run: false });
            router.push("/image");
            return;
        }
        updateConfig("size", videoPreset.size);
        updateConfig("vquality", videoPreset.quality);
        dispatchVideo({ prompt, run: false });
        router.push("/video");
    };

    const onQuickPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        openWorkbench();
    };

    return (
        <main className="relative h-full overflow-x-hidden overflow-y-auto bg-background bg-[radial-gradient(#d6d3d1_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 sm:px-6">
                <div className="pointer-events-none absolute left-1/2 top-8 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,.08),transparent_68%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(245,158,11,.06),transparent_68%)]" />

                <section className="relative flex min-h-[650px] flex-col items-center justify-center py-8 sm:py-12">
                    <HomeBannerCarousel banners={HOME_BANNERS} />

                    <div className="mt-8 w-full max-w-[820px] sm:mt-11">
                        <div className="relative overflow-hidden rounded-[24px] border border-stone-200/90 bg-white/90 shadow-[0_18px_55px_rgba(28,25,23,.11)] backdrop-blur-xl transition focus-within:border-stone-400 dark:border-white/10 dark:bg-[#1b1a18]/92 dark:shadow-[0_22px_70px_rgba(0,0,0,.34)] dark:focus-within:border-white/20">
                            <textarea
                                value={quickPrompt}
                                onChange={(event) => setQuickPrompt(event.target.value)}
                                onKeyDown={onQuickPromptKeyDown}
                                rows={3}
                                placeholder={quickMode === "image" ? "描述你想生成的画面，例如：雨夜霓虹中的未来城市……" : "描述镜头运动、主体动作和场景氛围……"}
                                className="block min-h-28 w-full resize-none bg-transparent px-5 pb-2 pt-5 text-[15px] leading-7 text-stone-900 outline-none placeholder:text-stone-400 sm:min-h-32 sm:px-6 sm:pt-6 dark:text-stone-100 dark:placeholder:text-stone-600"
                                aria-label="快速创作提示词"
                            />
                            <div className="flex min-h-16 items-end justify-between gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
                                <div className="flex min-w-0 flex-wrap items-center gap-2 pr-12 sm:pr-0">
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            selectable: true,
                                            selectedKeys: [quickMode],
                                            items: [
                                                { key: "image", icon: <ImagePlus className="size-4" />, label: "生成图片" },
                                                { key: "video", icon: <Video className="size-4" />, label: "生成视频" },
                                            ],
                                            onClick: ({ key }) => setQuickMode(key as QuickCreateMode),
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-stone-100 px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-200 dark:bg-white/7 dark:text-stone-200 dark:hover:bg-white/12"
                                        >
                                            {quickMode === "image" ? <ImagePlus className="size-4" /> : <Video className="size-4" />}
                                            <span>{quickMode === "image" ? "生成图片" : "生成视频"}</span>
                                            <ChevronDown className="size-3.5 opacity-55" />
                                        </button>
                                    </Dropdown>

                                    {quickMode === "image" ? (
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                selectable: true,
                                                selectedKeys: [imagePreset.key],
                                                items: IMAGE_PRESETS.map((item) => ({ key: item.key, label: item.label })),
                                                onClick: ({ key }) => setImagePreset(IMAGE_PRESETS.find((item) => item.key === key) || IMAGE_PRESETS[0]),
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-stone-100 px-3 text-sm text-stone-700 transition hover:bg-stone-200 dark:bg-white/7 dark:text-stone-300 dark:hover:bg-white/12"
                                            >
                                                <span>{imagePreset.label}</span>
                                                <ChevronDown className="size-3.5 opacity-55" />
                                            </button>
                                        </Dropdown>
                                    ) : (
                                        <Dropdown
                                            trigger={["click"]}
                                            menu={{
                                                selectable: true,
                                                selectedKeys: [videoPreset.key],
                                                items: VIDEO_PRESETS.map((item) => ({ key: item.key, label: item.label })),
                                                onClick: ({ key }) => setVideoPreset(VIDEO_PRESETS.find((item) => item.key === key) || VIDEO_PRESETS[0]),
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-stone-100 px-3 text-sm text-stone-700 transition hover:bg-stone-200 dark:bg-white/7 dark:text-stone-300 dark:hover:bg-white/12"
                                            >
                                                <span>{videoPreset.label}</span>
                                                <ChevronDown className="size-3.5 opacity-55" />
                                            </button>
                                        </Dropdown>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    disabled={!quickPrompt.trim()}
                                    onClick={openWorkbench}
                                    className="absolute bottom-3 right-3 z-10 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-stone-900 text-white transition hover:-translate-y-0.5 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 sm:static dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                                    aria-label="带入工作台"
                                    title="带入工作台（Ctrl / Command + Enter）"
                                >
                                    <ArrowUp className="size-4" />
                                </button>
                            </div>
                        </div>
                        <p className="mt-3 text-center text-xs text-stone-400 dark:text-stone-600">将在工作台中继续确认参数，不会直接开始生成</p>
                    </div>
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
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
