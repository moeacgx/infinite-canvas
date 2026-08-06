"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Bot, FileText, FolderOpen, ImageIcon, Menu, Music2, Square, Upload, Video, X } from "lucide-react";
import { Button, Dropdown, Segmented } from "antd";

import { ImageSettingsPanel, imageQualityLabel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { decodeChannelModel, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasAgentConfig, type CanvasAssistantReference, type CanvasNodeTypeId } from "../types";
import { isCanvasImageNodeType } from "../utils/canvas-node-type";

export type CanvasAssistantComposerProps = {
    prompt: string;
    isRunning: boolean;
    submitDisabled?: boolean;
    references: CanvasAssistantReference[];
    agentConfig: CanvasAgentConfig;
    onAgentConfigChange: (patch: Partial<CanvasAgentConfig>) => void;
    onPromptChange: (prompt: string) => void;
    onSubmit: () => void | Promise<void>;
    onStop?: () => void;
    onOpenUpload: () => void;
    onOpenAssets: () => void;
    onRemoveReference: (id: string) => void;
    onPasteImage: (file: File) => void;
};

export function CanvasAssistantComposer({
    prompt,
    isRunning,
    submitDisabled = false,
    references,
    agentConfig,
    onAgentConfigChange,
    onPromptChange,
    onSubmit,
    onStop,
    onOpenUpload,
    onOpenAssets,
    onRemoveReference,
    onPasteImage,
}: CanvasAssistantComposerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const storedConfig = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const effectiveConfig = useEffectiveConfig();
    const imageConfig = useMemo(() => {
        const model = effectiveConfig.imageModel || effectiveConfig.model;
        return { ...effectiveConfig, model, imageModel: model, quality: agentConfig.imageQuality, size: agentConfig.imageSize, count: agentConfig.imageCount, canvasImageCount: agentConfig.imageCount, background: agentConfig.imageBackground };
    }, [agentConfig.imageBackground, agentConfig.imageCount, agentConfig.imageQuality, agentConfig.imageSize, effectiveConfig]);
    const videoConfig = useMemo(() => {
        const model = effectiveConfig.videoModel || effectiveConfig.model;
        return {
            ...effectiveConfig,
            model,
            videoModel: model,
            vquality: agentConfig.videoQuality,
            size: agentConfig.videoSize,
            videoSize: agentConfig.videoSize,
            videoSeconds: agentConfig.videoSeconds,
            videoMode: agentConfig.videoMode,
            videoNegativePrompt: agentConfig.videoNegativePrompt,
            videoGenerateAudio: agentConfig.videoGenerateAudio,
            videoWatermark: agentConfig.videoWatermark,
        };
    }, [agentConfig, effectiveConfig]);

    const updateImageConfig = (key: "quality" | "size" | "count" | "background", value: string) => {
        if (key === "quality") onAgentConfigChange({ imageQuality: value });
        else if (key === "size") onAgentConfigChange({ imageSize: value });
        else if (key === "count") onAgentConfigChange({ imageCount: value });
        else onAgentConfigChange({ imageBackground: value });
    };
    const updateVideoConfig = (key: AgentVideoConfigKey, value: string) => {
        if (key === "vquality") onAgentConfigChange({ videoQuality: value });
        else if (key === "size") onAgentConfigChange({ videoSize: value });
        else if (key === "videoSeconds") onAgentConfigChange({ videoSeconds: value });
        else if (key === "videoMode") onAgentConfigChange({ videoMode: value });
        else if (key === "videoNegativePrompt") onAgentConfigChange({ videoNegativePrompt: value });
        else if (key === "videoGenerateAudio") onAgentConfigChange({ videoGenerateAudio: value });
        else onAgentConfigChange({ videoWatermark: value });
    };
    const selectImageModel = (model: string, channelId: string | undefined) => {
        updateConfig("imageModel", model);
        const resolvedChannelId = channelId || resolveAgentImageChannelId(storedConfig, model);
        if (resolvedChannelId) {
            updateConfig("imageChannelId", resolvedChannelId);
            updateConfig("activeChannelId", resolvedChannelId);
        }
        if (storedConfig.channelMode !== "local") return;
        const channel = storedConfig.channels.find((item) => item.id === resolvedChannelId);
        if (!channel) return;
        updateConfig("apiMode", channel.imageApiMode || "images");
        updateConfig("streamImages", channel.streamImages ? "1" : "");
        updateConfig("streamPartialImages", String(channel.streamPartialImages || 1));
        updateConfig("responseFormatB64Json", channel.responseFormatB64Json === false ? "" : "1");
    };
    const selectVideoModel = (model: string, channelId: string | undefined) => {
        updateConfig("videoModel", model);
        const resolvedChannelId = channelId || decodeChannelModel(model)?.channelId;
        if (!resolvedChannelId) return;
        updateConfig("videoChannelId", resolvedChannelId);
        updateConfig("activeChannelId", resolvedChannelId);
    };
    const selectImageApiMode = (mode: "images" | "responses") => {
        updateConfig("apiMode", mode);
        if (storedConfig.channelMode !== "local") return;
        const channelId = resolveAgentImageChannelId(storedConfig, imageConfig.imageModel);
        if (!channelId) return;
        updateConfig(
            "channels",
            storedConfig.channels.map((channel) => (channel.id === channelId ? { ...channel, imageApiMode: mode } : channel)),
        );
    };

    return (
        <div className="min-w-0 px-2 pb-2" onWheelCapture={(event) => event.stopPropagation()}>
            {references.length ? (
                <div className="thin-scrollbar mb-1.5 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
                    {references.map((item) => (
                        <AssistantReferenceChip key={item.id} item={item} onRemove={() => onRemoveReference(item.id)} />
                    ))}
                </div>
            ) : null}
            <div className="rounded-2xl border px-3 pb-3 pt-3" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    onPaste={(event) => {
                        const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
                        if (!file) return;
                        event.preventDefault();
                        onPasteImage(file);
                    }}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.key !== "Enter" || event.ctrlKey || event.metaKey || event.shiftKey) return;
                        event.preventDefault();
                        if (isRunning || submitDisabled || (!prompt.trim() && !references.length)) return;
                        void onSubmit();
                    }}
                    className="thin-scrollbar h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-40"
                    style={{ color: theme.node.text }}
                    placeholder="描述创作目标，或让我继续操作画布"
                />
                <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    { key: "upload", icon: <Upload className="size-4" />, label: "上传文件" },
                                    { key: "assets", icon: <FolderOpen className="size-4" />, label: "我的素材" },
                                ],
                                onClick: ({ key }) => (key === "upload" ? onOpenUpload() : onOpenAssets()),
                            }}
                        >
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8 !shrink-0" style={{ color: theme.node.text }} icon={<Menu className="size-4" />} aria-label="添加素材" />
                        </Dropdown>
                        <AgentMediaSettings
                            theme={theme}
                            imageConfig={imageConfig}
                            videoConfig={videoConfig}
                            onImageConfigChange={updateImageConfig}
                            onVideoConfigChange={updateVideoConfig}
                            onImageModelChange={selectImageModel}
                            onVideoModelChange={selectVideoModel}
                            onImageApiModeChange={selectImageApiMode}
                            onMissingConfig={() => openConfigDialog(false)}
                        />
                    </div>
                    <Button
                        type="primary"
                        shape="circle"
                        className="!size-10 !min-w-10 !shrink-0"
                        disabled={!isRunning && (submitDisabled || (!prompt.trim() && !references.length))}
                        onClick={() => (isRunning ? onStop?.() : void onSubmit())}
                        aria-label={isRunning ? "停止" : "发送"}
                        icon={isRunning ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-4" />}
                    />
                </div>
            </div>
        </div>
    );
}

type AgentMediaSettingsTab = "image" | "video";
type AgentVideoConfigKey = "vquality" | "size" | "videoSeconds" | "videoMode" | "videoNegativePrompt" | "videoGenerateAudio" | "videoWatermark";

function AgentMediaSettings({
    theme,
    imageConfig,
    videoConfig,
    onImageConfigChange,
    onVideoConfigChange,
    onImageModelChange,
    onVideoModelChange,
    onImageApiModeChange,
    onMissingConfig,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    imageConfig: AiConfig;
    videoConfig: AiConfig;
    onImageConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    onVideoConfigChange: (key: AgentVideoConfigKey, value: string) => void;
    onImageModelChange: (model: string, channelId: string | undefined) => void;
    onVideoModelChange: (model: string, channelId: string | undefined) => void;
    onImageApiModeChange: (mode: "images" | "responses") => void;
    onMissingConfig: () => void;
}) {
    const imageButtonRef = useRef<HTMLSpanElement>(null);
    const videoButtonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [tab, setTab] = useState<AgentMediaSettingsTab>("image");
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const imageModel = imageConfig.imageModel || imageConfig.model;
    const videoModel = videoConfig.videoModel || videoConfig.model;
    const imageCount = Math.max(1, Math.min(15, Math.floor(Number(imageConfig.count) || 1)));
    const openTab = (nextTab: AgentMediaSettingsTab) => {
        const trigger = nextTab === "image" ? imageButtonRef.current : videoButtonRef.current;
        setTab(nextTab);
        setButtonRect(trigger?.getBoundingClientRect() || null);
        setOpen((current) => (current && tab === nextTab ? false : true));
    };

    useEffect(() => {
        if (!open) return;
        const activeButton = () => (tab === "image" ? imageButtonRef.current : videoButtonRef.current);
        const syncPosition = () => setButtonRect(activeButton()?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (imageButtonRef.current?.contains(target) || videoButtonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (target.closest("[data-canvas-no-zoom], [data-radix-popper-content-wrapper]")) return;
            setOpen(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open, tab]);

    return (
        <>
            <span ref={imageButtonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className="!h-8 !min-w-0 !max-w-[112px] !justify-start !gap-1.5 !rounded-full !px-2.5 !text-xs sm:!max-w-[132px] sm:!text-sm"
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={<ImageIcon className="size-3.5 shrink-0" />}
                    onClick={() => openTab("image")}
                    aria-label="图片生成规格"
                    aria-expanded={open && tab === "image"}
                    title={`图片：${modelOptionName(imageModel) || "未选择模型"}`}
                >
                    <span className="truncate">
                        {imageQualityLabel(imageConfig.quality)} · {imageCount} 张
                    </span>
                </Button>
            </span>
            <span ref={videoButtonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className="!h-8 !min-w-0 !max-w-[112px] !justify-start !gap-1.5 !rounded-full !px-2.5 !text-xs sm:!max-w-[132px] sm:!text-sm"
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={<Video className="size-3.5 shrink-0" />}
                    onClick={() => openTab("video")}
                    aria-label="视频生成规格"
                    aria-expanded={open && tab === "video"}
                    title={`视频：${modelOptionName(videoModel) || "未选择模型"}`}
                >
                    <span className="truncate">
                        {videoResolutionLabel(videoConfig.vquality)} · {videoSecondsLabel(videoConfig.videoSeconds)}
                    </span>
                </Button>
            </span>
            {open && buttonRect
                ? createPortal(
                      <AgentMediaSettingsPanel
                          panelRef={panelRef}
                          buttonRect={buttonRect}
                          tab={tab}
                          onTabChange={setTab}
                          onClose={() => setOpen(false)}
                          theme={theme}
                          imageConfig={imageConfig}
                          videoConfig={videoConfig}
                          imageModel={imageModel}
                          videoModel={videoModel}
                          onImageConfigChange={onImageConfigChange}
                          onVideoConfigChange={onVideoConfigChange}
                          onImageModelChange={onImageModelChange}
                          onVideoModelChange={onVideoModelChange}
                          onImageApiModeChange={onImageApiModeChange}
                          onMissingConfig={onMissingConfig}
                      />,
                      document.body,
                  )
                : null}
        </>
    );
}

function AgentMediaSettingsPanel({
    panelRef,
    buttonRect,
    tab,
    onTabChange,
    onClose,
    theme,
    imageConfig,
    videoConfig,
    imageModel,
    videoModel,
    onImageConfigChange,
    onVideoConfigChange,
    onImageModelChange,
    onVideoModelChange,
    onImageApiModeChange,
    onMissingConfig,
}: {
    panelRef: RefObject<HTMLDivElement | null>;
    buttonRect: DOMRect;
    tab: AgentMediaSettingsTab;
    onTabChange: (tab: AgentMediaSettingsTab) => void;
    onClose: () => void;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    imageConfig: AiConfig;
    videoConfig: AiConfig;
    imageModel: string;
    videoModel: string;
    onImageConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    onVideoConfigChange: (key: AgentVideoConfigKey, value: string) => void;
    onImageModelChange: (model: string, channelId: string | undefined) => void;
    onVideoModelChange: (model: string, channelId: string | undefined) => void;
    onImageApiModeChange: (mode: "images" | "responses") => void;
    onMissingConfig: () => void;
}) {
    const margin = 12;
    const gap = 8;
    const width = Math.min(388, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, buttonRect.left));
    const placeAbove = buttonRect.top > window.innerHeight - buttonRect.bottom;
    const availableHeight = placeAbove ? buttonRect.top - margin - gap : window.innerHeight - buttonRect.bottom - margin - gap;
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left,
        ...(placeAbove ? { bottom: window.innerHeight - buttonRect.top + gap } : { top: buttonRect.bottom + gap }),
        maxHeight: Math.max(240, Math.min(620, availableHeight)),
        background: theme.toolbar.panel,
        border: `1px solid ${theme.node.stroke}`,
        borderRadius: 8,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        color: theme.node.text,
    } as const;

    return (
        <div ref={panelRef} data-canvas-no-zoom className="thin-scrollbar overflow-y-auto p-4" style={style} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">创作规格</div>
                <Button type="text" shape="circle" size="small" className="!size-7 !min-w-7" style={{ color: theme.node.muted }} icon={<X className="size-4" />} onClick={onClose} aria-label="关闭创作规格" />
            </div>
            <Segmented
                block
                value={tab}
                options={[
                    { value: "image", label: "图片规格", icon: <ImageIcon className="size-3.5" /> },
                    { value: "video", label: "视频规格", icon: <Video className="size-3.5" /> },
                ]}
                onChange={(value) => onTabChange(value as AgentMediaSettingsTab)}
            />
            {tab === "image" ? (
                <div className="mt-4 space-y-4">
                    <SettingLabel color={theme.node.muted}>模型与渠道</SettingLabel>
                    <ModelPicker config={imageConfig} value={imageModel} channelId={imageConfig.imageChannelId} capability="image" fullWidth onChange={onImageModelChange} onMissingConfig={onMissingConfig} />
                    {imageConfig.channelMode === "local" ? (
                        <div className="space-y-2">
                            <SettingLabel color={theme.node.muted}>接口模式</SettingLabel>
                            <Segmented
                                block
                                value={imageConfig.apiMode === "responses" ? "responses" : "images"}
                                options={[
                                    { value: "images", label: "Images" },
                                    { value: "responses", label: "Responses" },
                                ]}
                                onChange={(value) => onImageApiModeChange(value as "images" | "responses")}
                            />
                        </div>
                    ) : null}
                    <ImageSettingsPanel config={imageConfig} onConfigChange={onImageConfigChange} theme={theme} showTitle={false} showCount className="space-y-4" />
                </div>
            ) : (
                <div className="mt-4 space-y-4">
                    <SettingLabel color={theme.node.muted}>模型与渠道</SettingLabel>
                    <ModelPicker config={videoConfig} value={videoModel} channelId={videoConfig.videoChannelId} capability="video" fullWidth onChange={onVideoModelChange} onMissingConfig={onMissingConfig} />
                    <VideoSettingsPanel config={videoConfig} model={videoModel} onConfigChange={onVideoConfigChange} theme={theme} showTitle={false} className="space-y-4" />
                </div>
            )}
        </div>
    );
}

function SettingLabel({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

export function AssistantReferenceChip({ item, onRemove }: { item: CanvasAssistantReference; onRemove?: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="group/chip relative inline-flex h-8 max-w-[160px] shrink-0 items-center gap-1.5 rounded-lg text-sm" style={{ color: theme.node.text }}>
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}>
                {item.dataUrl ? <img src={item.dataUrl} alt="" className="size-8 object-cover" /> : <ReferenceIcon type={item.type} />}
            </span>
            <span className="max-w-[112px] truncate text-xs">{item.title}</span>
            {onRemove ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border opacity-0 transition group-hover/chip:opacity-100"
                    style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}
                    onClick={onRemove}
                    aria-label="移除引用"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </div>
    );
}

function ReferenceIcon({ type }: { type: CanvasNodeTypeId }) {
    if (type === CanvasNodeType.Video) return <Video className="size-4" />;
    if (type === CanvasNodeType.Audio) return <Music2 className="size-4" />;
    if (type === CanvasNodeType.Text) return <FileText className="size-4" />;
    if (isCanvasImageNodeType(type)) return <ImageIcon className="size-4" />;
    return <Bot className="size-4" />;
}

function resolveAgentImageChannelId(config: AiConfig, model: string) {
    const decodedChannelId = decodeChannelModel(model)?.channelId;
    for (const channelId of [decodedChannelId, config.imageChannelId, config.activeChannelId]) {
        if (channelId && config.channels.some((channel) => channel.id === channelId)) return channelId;
    }
    const modelName = modelOptionName(model);
    return config.channels.find((channel) => channel.models.includes(modelName))?.id || config.channels[0]?.id || "";
}
