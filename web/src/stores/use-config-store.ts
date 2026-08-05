"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";

export type ApiCallFormat = "openai" | "gemini";
export type ChannelRequestMode = "auto" | "direct" | "agent";
export type ImageApiMode = "images" | "responses";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    requestMode?: ChannelRequestMode;
    imageApiMode?: ImageApiMode;
    responsesImageModel?: string;
    streamImages?: boolean;
    streamPartialImages?: number;
    responseFormatB64Json?: boolean;
    models: string[];
    modelScripts?: ModelScriptMap;
    modelScriptApprovals?: ModelScriptMap;
};

export type ModelScriptMap = Record<string, Partial<Record<ModelCapability, string>>>;

export type VideoMultiPromptItem = { prompt: string; duration: string };
export type VideoElementReference = {
    id: string;
    kind: "image" | "video" | "audio";
    name: string;
    type: string;
    dataUrl?: string;
    url?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};
export type VideoElementItem = { name: string; description: string; references: VideoElementReference[] };
export type PublicModelChannel = {
    id?: string;
    name?: string;
    baseUrl?: string;
    models?: string[];
    weight?: number;
    timeout?: number;
    enabled?: boolean;
    remark?: string;
};

export type AiConfig = {
    channelMode: "remote" | "local" | "newapi";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    requestMode?: ChannelRequestMode;
    channels: ModelChannel[];
    newApiGroup: string;
    newApiTextGroup: string;
    newApiImageGroup: string;
    newApiVideoGroup: string;
    newApiAudioGroup: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    videoMode: string;
    videoNegativePrompt: string;
    videoMultiShot: string;
    videoShotType: string;
    videoMultiPrompt: VideoMultiPromptItem[];
    videoElementList: VideoElementItem[];
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoCharacterOrientation: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    videoSize: string;
    background: string;
    count: string;
    canvasImageCount: string;
    timeout: string;
    apiMode: string;
    streamImages: string;
    streamPartialImages: string;
    responseFormatB64Json: string;
    codexCli: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    publicChannels: PublicModelChannel[];
    activeChannelId: string;
    imageChannelId: string;
    videoChannelId: string;
    textChannelId: string;
    audioChannelId: string;
};

export type WebdavSyncConfig = {
    proxyMode: "direct" | "nextjs";
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelMode = AiConfig["channelMode"];
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
export type FetchedModelLists = {
    models: string[];
    imageModels?: string[];
    videoModels?: string[];
    textModels?: string[];
    audioModels?: string[];
};

export type ModelSelectionState = {
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
};

export type NewApiConnectionState = Pick<AiConfig, "baseUrl" | "newApiGroup" | "newApiTextGroup" | "newApiImageGroup" | "newApiVideoGroup" | "newApiAudioGroup">;

export type ImageChannelOptions = {
    apiMode: ImageApiMode;
    responsesModel: string;
    stream: boolean;
    partialImages: number;
    responseFormatB64Json: boolean;
};

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            requestMode: "auto",
            models: [],
        },
    ],
    newApiGroup: "",
    newApiTextGroup: "",
    newApiImageGroup: "",
    newApiVideoGroup: "",
    newApiAudioGroup: "",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    videoModel: "grok-imagine-video",
    textModel: "gpt-5.5",
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    videoMode: "std",
    videoNegativePrompt: "",
    videoMultiShot: "false",
    videoShotType: "intelligence",
    videoMultiPrompt: [{ prompt: "", duration: "1" }],
    videoElementList: [{ name: "", description: "", references: [] }],
    vquality: "720",
    videoGenerateAudio: "false",
    videoWatermark: "false",
    videoCharacterOrientation: "video",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    videoSize: "1280x720",
    background: "",
    count: "1",
    canvasImageCount: "3",
    timeout: "600",
    apiMode: "images",
    streamImages: "",
    streamPartialImages: "1",
    responseFormatB64Json: "",
    codexCli: "",
    systemPrompts: {
        image: "",
        video: "",
        text: "",
        workflow: "",
        workflowAgent: "",
    },
    publicChannels: [],
    activeChannelId: "",
    imageChannelId: "",
    videoChannelId: "",
    textChannelId: "",
    audioChannelId: "",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    proxyMode: "direct",
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    localModelState: ModelSelectionState;
    newApiModelState: ModelSelectionState;
    newApiConnectionState: NewApiConnectionState;
    webdav: WebdavSyncConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    setChannelMode: (mode: ChannelMode) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null) {
    const channelMode = resolveAllowedChannelMode(config.channelMode, modelChannel);
    if (channelMode === "newapi") {
        return applyFetchedModelsToConfig(
            { ...config, channelMode },
            {
                models: config.models,
                imageModels: config.imageModels,
                videoModels: config.videoModels,
                textModels: config.textModels,
                audioModels: config.audioModels,
            },
        );
    }
    if (!channelMode) {
        return { ...config, channelMode: config.channelMode, models: [], imageModels: [], videoModels: [], textModels: [], audioModels: [], model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "" };
    }
    if (channelMode === "local" || !modelChannel) return { ...config, channelMode };
    const models = modelChannel.availableModels;
    const textModels = filterModelsByCapability(models, "text");
    const imageModels = filterModelsByCapability(models, "image");
    const videoModels = filterModelsByCapability(models, "video");
    const audioModels = filterModelsByCapability(models, "audio");
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredModel(textModels, isTextModelName);
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: textModels.includes(config.model) ? config.model : fallbackModel,
        imageModel: imageModels.includes(config.imageModel) ? config.imageModel : fallbackImageModel,
        videoModel: videoModels.includes(config.videoModel) ? config.videoModel : fallbackVideoModel,
        textModel: textModels.includes(config.textModel) ? config.textModel : fallbackTextModel || fallbackModel,
        audioModel: audioModels.includes(config.audioModel) ? config.audioModel : fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
        publicChannels: publicChannelsFromSettings(modelChannel),
    };
}

function publicChannelsFromSettings(modelChannel: AdminPublicSettings["modelChannel"]): PublicModelChannel[] {
    const channels = (modelChannel as AdminPublicSettings["modelChannel"] & { channels?: PublicModelChannel[] }).channels;
    if (Array.isArray(channels) && channels.length) return channels;
    return modelChannel.availableModels.length ? [{ id: "remote", name: "云端渠道", models: modelChannel.availableModels }] : [];
}

export function channelModeAllowed(modelChannel: AdminPublicSettings["modelChannel"] | null | undefined, mode: ChannelMode) {
    if (!modelChannel) return mode !== "local";
    if (mode === "local") return modelChannel.allowLocalChannel ?? modelChannel.allowCustomChannel;
    if (mode === "newapi") return modelChannel.allowNewApiChannel !== false;
    return modelChannel.allowRemoteChannel !== false;
}

export function resolveAllowedChannelMode(mode: ChannelMode, modelChannel: AdminPublicSettings["modelChannel"] | null | undefined): ChannelMode | null {
    if (channelModeAllowed(modelChannel, mode)) return mode;
    const fallbackModes: ChannelMode[] = ["remote", "newapi", "local"];
    return fallbackModes.find((item) => channelModeAllowed(modelChannel, item)) || null;
}

export function applyFetchedModelsToConfig(config: AiConfig, fetchedModels: string[] | FetchedModelLists): AiConfig {
    const fetched = Array.isArray(fetchedModels) ? { models: fetchedModels } : fetchedModels;
    const models = normalizeModelList(fetched.models);
    const suggestedImageModels = normalizeCapabilityModelList(fetched.imageModels, models, "image");
    const suggestedVideoModels = normalizeCapabilityModelList(fetched.videoModels, models, "video");
    const suggestedTextModels = normalizeCapabilityModelList(fetched.textModels, models, "text");
    const suggestedAudioModels = normalizeCapabilityModelList(fetched.audioModels, models, "audio");
    const imageModels = resolveNextCapabilityModels(config.imageModels, suggestedImageModels, suggestedImageModels);
    const videoModels = resolveNextCapabilityModels(config.videoModels, suggestedVideoModels, suggestedVideoModels);
    const textModels = resolveNextCapabilityModels(config.textModels, suggestedTextModels, suggestedTextModels);
    const audioModels = resolveNextCapabilityModels(config.audioModels, suggestedAudioModels, suggestedAudioModels);

    return {
        ...config,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: validDefault(config.model, textModels) || textModels[0] || "",
        imageModel: validDefault(config.imageModel, imageModels) || imageModels[0] || "",
        videoModel: validDefault(config.videoModel, videoModels) || videoModels[0] || "",
        textModel: validDefault(config.textModel, textModels) || textModels[0] || "",
        audioModel: validDefault(config.audioModel, audioModels) || audioModels[0] || "",
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function isVideoModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("image") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("flux") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney"))
    );
}

function isAudioModelName(model: string) {
    const value = modelOptionName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

export function resolveCapabilityModel(config: AiConfig, capability: ModelCapability, preferred?: string) {
    const selected = (preferred || "").trim();
    const models = selectableModelsByCapability(config, capability);
    if (selected && models.includes(selected)) return selected;
    const fallback = config[defaultModelKey(capability)].trim();
    if (fallback && (!models.length || models.includes(fallback))) return fallback;
    return models[0] || defaultConfig[defaultModelKey(capability)] || defaultConfig.model;
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function defaultModelKey(capability: ModelCapability) {
    return `${capability}Model` as "imageModel" | "videoModel" | "textModel" | "audioModel";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (!model.trim()) return false;
    if (config.channelMode === "remote") return true;
    if (config.channelMode === "newapi") return Boolean(config.baseUrl.trim() && config.newApiGroup.trim());
    const requestConfig = resolveModelRequestConfig(config, model);
    return Boolean(requestConfig.model.trim() && requestConfig.baseUrl.trim() && requestConfig.apiKey.trim());
}

export function isNewApiConfig(config: AiConfig) {
    return config.channelMode === "newapi";
}

export function resolveNewApiGroup(config: AiConfig, capability?: ModelCapability) {
    if (capability === "text") return config.newApiTextGroup.trim() || config.newApiGroup.trim();
    if (capability === "image") return config.newApiImageGroup.trim() || config.newApiGroup.trim();
    if (capability === "video") return config.newApiVideoGroup.trim() || config.newApiGroup.trim();
    if (capability === "audio") return config.newApiAudioGroup.trim() || config.newApiGroup.trim();
    return config.newApiGroup.trim();
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            localModelState: modelSelectionState(defaultConfig),
            newApiModelState: emptyModelSelectionState(),
            newApiConnectionState: newApiConnectionState(defaultConfig),
            webdav: defaultWebdavSyncConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            setChannelMode: (mode) =>
                set((state) => {
                    const localModelState = state.config.channelMode === "local" ? modelSelectionState(withLocalChannels(state.config, state.config.channels)) : state.localModelState;
                    const newApiModelState = state.config.channelMode === "newapi" ? modelSelectionState(state.config) : state.newApiModelState;
                    const savedNewApiConnection = state.config.channelMode === "newapi" ? newApiConnectionState(state.config) : state.newApiConnectionState;
                    if (mode === "local") {
                        return {
                            localModelState,
                            newApiModelState,
                            newApiConnectionState: savedNewApiConnection,
                            config: withLocalChannels({ ...state.config, ...localModelState, channelMode: "local" }, state.config.channels),
                        };
                    }
                    if (mode === "newapi") {
                        return {
                            localModelState,
                            newApiModelState,
                            newApiConnectionState: savedNewApiConnection,
                            config: { ...state.config, ...savedNewApiConnection, ...newApiModelState, channelMode: "newapi" },
                        };
                    }
                    return { localModelState, newApiModelState, newApiConnectionState: savedNewApiConnection, config: { ...state.config, channelMode: "remote" } };
                }),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config, localModelState: state.localModelState, newApiModelState: state.newApiModelState, newApiConnectionState: state.newApiConnectionState, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                const channels = normalizeChannels({
                    ...config,
                    channels: Array.isArray(persistedConfig.channels) ? persistedConfig.channels : [],
                });
                const normalizedConfig = config.channelMode === "local" ? withLocalChannels({ ...config, channels }, channels) : { ...config, channels };
                const inferredLocalState =
                    config.channelMode === "local" || (config.channelMode === "remote" && !config.newApiGroup)
                        ? modelSelectionState(withLocalChannels({ ...config, channels }, channels))
                        : modelSelectionState(withLocalChannels({ ...defaultConfig, channels }, channels));
                const inferredNewApiState = config.channelMode === "newapi" || (config.channelMode === "remote" && Boolean(config.newApiGroup)) ? modelSelectionState(config) : emptyModelSelectionState();
                const inferredNewApiConnection = newApiConnectionState(config);
                return {
                    ...current,
                    localModelState: normalizeModelSelectionState(persistedState.localModelState, inferredLocalState),
                    newApiModelState: normalizeModelSelectionState(persistedState.newApiModelState, inferredNewApiState),
                    newApiConnectionState: normalizeNewApiConnectionState(persistedState.newApiConnectionState, inferredNewApiConnection),
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: {
                        ...normalizedConfig,
                        channelMode: config.channelMode || "remote",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        newApiGroup: config.newApiGroup || "",
                        newApiTextGroup: config.newApiTextGroup || "",
                        newApiImageGroup: config.newApiImageGroup || "",
                        newApiVideoGroup: config.newApiVideoGroup || "",
                        newApiAudioGroup: config.newApiAudioGroup || "",
                        imageModel: normalizedConfig.imageModel || defaultConfig.imageModel,
                        videoModel: normalizedConfig.videoModel || "grok-imagine-video",
                        textModel: normalizedConfig.textModel || normalizedConfig.model,
                        audioModel: normalizedConfig.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        videoMode: config.videoMode || defaultConfig.videoMode,
                        videoNegativePrompt: config.videoNegativePrompt || "",
                        videoMultiShot: config.videoMultiShot || "false",
                        videoShotType: config.videoShotType || defaultConfig.videoShotType,
                        videoMultiPrompt: normalizeVideoMultiPrompt(config.videoMultiPrompt),
                        videoElementList: normalizeVideoElementList(config.videoElementList),
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
                        videoWatermark: config.videoWatermark || "false",
                        videoCharacterOrientation: config.videoCharacterOrientation || defaultConfig.videoCharacterOrientation,
                        videoSize: config.videoSize || defaultConfig.videoSize,
                        canvasImageCount: config.canvasImageCount || "3",
                        timeout: config.timeout || defaultConfig.timeout,
                        apiMode: config.apiMode || defaultConfig.apiMode,
                        streamImages: config.streamImages || "",
                        streamPartialImages: config.streamPartialImages || defaultConfig.streamPartialImages,
                        responseFormatB64Json: config.responseFormatB64Json || "",
                        codexCli: config.codexCli || "",
                        systemPrompts: { ...defaultConfig.systemPrompts, ...(config.systemPrompts || {}) },
                        publicChannels: Array.isArray(config.publicChannels) ? config.publicChannels : [],
                        activeChannelId: config.activeChannelId || "",
                        imageChannelId: config.imageChannelId || "",
                        videoChannelId: config.videoChannelId || "",
                        textChannelId: config.textChannelId || "",
                        audioChannelId: config.audioChannelId || "",
                        imageModels: config.channelMode === "local" ? normalizedConfig.imageModels : Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels) : filterModelsByCapability(config.models, "image"),
                        videoModels: config.channelMode === "local" ? normalizedConfig.videoModels : Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels) : filterModelsByCapability(config.models, "video"),
                        textModels: config.channelMode === "local" ? normalizedConfig.textModels : Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels) : filterModelsByCapability(config.models, "text"),
                        audioModels: config.channelMode === "local" ? normalizedConfig.audioModels : Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels) : filterModelsByCapability(config.models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function normalizeVideoMultiPrompt(value: VideoMultiPromptItem[] | undefined) {
    if (!Array.isArray(value) || !value.length) return defaultConfig.videoMultiPrompt;
    return value.map((item) => ({ prompt: typeof item?.prompt === "string" ? item.prompt : "", duration: typeof item?.duration === "string" ? item.duration : "1" }));
}

function normalizeVideoElementList(value: VideoElementItem[] | undefined) {
    if (!Array.isArray(value) || !value.length) return defaultConfig.videoElementList;
    return value.map((item) => ({
        name: typeof item?.name === "string" ? item.name : "",
        description: typeof item?.description === "string" ? item.description : "",
        references: Array.isArray(item?.references) ? item.references : [],
    }));
}

function normalizeCapabilityModelList(models: string[] | undefined, allModels: string[], capability: ModelCapability) {
    return Array.isArray(models) ? normalizeModelList(models) : filterModelsByCapability(allModels, capability);
}

function resolveNextCapabilityModels(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = normalizeModelList(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    return useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const rawModels = channel?.models || [];
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        requestMode: normalizeChannelRequestMode(channel?.requestMode),
        imageApiMode: normalizeImageApiMode(channel?.imageApiMode),
        responsesImageModel: normalizeResponsesImageModel(channel?.responsesImageModel, rawModels),
        streamImages: normalizeBoolean(channel?.streamImages, false),
        streamPartialImages: normalizeStreamPartialImages(channel?.streamPartialImages),
        responseFormatB64Json: normalizeBoolean(channel?.responseFormatB64Json, true),
        models: uniqueRawModels(rawModels),
        modelScripts: normalizeModelScripts(channel?.modelScripts, rawModels),
        modelScriptApprovals: normalizeModelScriptApprovals(channel?.modelScriptApprovals, channel?.modelScripts),
    };
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function isChannelModelValue(value: string) {
    return Boolean(decodeChannelModel(value));
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = (config.channels || []).find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model))));
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const channels = config.channels || [];
    const matched = decoded ? channels.find((channel) => channel.id === decoded.channelId) : channels.find((channel) => channel.models.includes(model));
    return matched || channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName) });
}

export function normalizeLocalChannels(config: Partial<AiConfig>) {
    const fallback = { ...defaultConfig, ...config } as AiConfig;
    return normalizeChannels(fallback);
}

export function localChannelForActiveModel(config: AiConfig) {
    const decoded = decodeChannelModel(config.model || config.imageModel || config.videoModel || config.textModel || config.audioModel);
    const activeId = decoded?.channelId || config.activeChannelId;
    const channels = normalizeLocalChannels(config);
    if (activeId) {
        const active = channels.find((channel) => channel.id === activeId);
        if (active) return active;
    }
    return resolveModelChannel(config, config.model || config.imageModel || config.videoModel || config.textModel || config.audioModel);
}

export function resolveModelRequestConfig(config: AiConfig, value: string): AiConfig {
    if (config.channelMode !== "local") return { ...config, model: modelOptionName(value), apiFormat: "openai" };
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        requestMode: normalizeChannelRequestMode(channel.requestMode),
    };
}

export function resolveImageChannelOptions(config: AiConfig, value: string): ImageChannelOptions {
    if (config.channelMode !== "local") return { apiMode: "images", responsesModel: "", stream: false, partialImages: 1, responseFormatB64Json: true };
    const channel = resolveModelChannel(config, value);
    const apiMode = normalizeImageApiMode(channel.imageApiMode);
    return {
        apiMode,
        responsesModel: apiMode === "responses" ? normalizeResponsesImageModel(channel.responsesImageModel, channel.models) : "",
        stream: normalizeBoolean(channel.streamImages, false),
        partialImages: normalizeStreamPartialImages(channel.streamPartialImages),
        responseFormatB64Json: normalizeBoolean(channel.responseFormatB64Json, true),
    };
}

export function resolveModelScript(config: AiConfig, value: string, capability: ModelCapability) {
    if (config.channelMode !== "local") return "";
    const model = modelOptionName(value).trim();
    if (!model) return "";
    const channel = resolveModelChannel(config, value);
    const source = channel.modelScripts?.[model]?.[capability]?.trim() || "";
    return source && channel.modelScriptApprovals?.[model]?.[capability] === modelScriptFingerprint(source) ? source : "";
}

export function modelScriptFingerprint(source: string) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 0x01000193);
    return `v1-${source.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function withLocalChannels(config: AiConfig, inputChannels: ModelChannel[]): AiConfig {
    const channels = inputChannels.map((channel) => ({
        id: channel.id?.trim() || nanoid(),
        name: channel.name ?? "",
        baseUrl: channel.baseUrl ?? "",
        apiKey: channel.apiKey ?? "",
        apiFormat: normalizeApiFormat(channel.apiFormat),
        requestMode: normalizeChannelRequestMode(channel.requestMode),
        imageApiMode: normalizeImageApiMode(channel.imageApiMode),
        responsesImageModel: normalizeResponsesImageModel(channel.responsesImageModel, channel.models),
        streamImages: normalizeBoolean(channel.streamImages, false),
        streamPartialImages: normalizeStreamPartialImages(channel.streamPartialImages),
        responseFormatB64Json: normalizeBoolean(channel.responseFormatB64Json, true),
        models: uniqueRawModels(channel.models || []),
        modelScripts: normalizeModelScripts(channel.modelScripts, channel.models),
        modelScriptApprovals: normalizeModelScriptApprovals(channel.modelScriptApprovals, channel.modelScripts),
    }));
    const models = modelOptionsFromChannels(channels);
    const capabilityLists = {
        imageModels: nextLocalCapabilityModels(config.imageModels, models, "image"),
        videoModels: nextLocalCapabilityModels(config.videoModels, models, "video"),
        textModels: nextLocalCapabilityModels(config.textModels, models, "text"),
        audioModels: nextLocalCapabilityModels(config.audioModels, models, "audio"),
    };
    return {
        ...config,
        channels,
        baseUrl: channels[0]?.baseUrl ?? config.baseUrl,
        apiKey: channels[0]?.apiKey ?? config.apiKey,
        apiFormat: channels[0]?.apiFormat ?? config.apiFormat,
        requestMode: channels[0]?.requestMode ?? config.requestMode ?? "auto",
        models,
        ...capabilityLists,
        model: nextLocalDefault(config.model, capabilityLists.textModels),
        imageModel: nextLocalDefault(config.imageModel, capabilityLists.imageModels),
        videoModel: nextLocalDefault(config.videoModel, capabilityLists.videoModels),
        textModel: nextLocalDefault(config.textModel, capabilityLists.textModels),
        audioModel: nextLocalDefault(config.audioModel, capabilityLists.audioModels),
    };
}

function normalizeChannels(config: AiConfig) {
    const channels = (config.channels || []).map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
        }),
    );
    if (channels.length) return channels;
    return [
        createModelChannel({
            id: "default",
            name: "默认渠道",
            baseUrl: config.baseUrl || OPENAI_BASE_URL,
            apiKey: config.apiKey || "",
            apiFormat: config.apiFormat,
            models: uniqueRawModels([...(config.models || []), config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel]),
        }),
    ];
}

function nextLocalCapabilityModels(current: string[], models: string[], capability: ModelCapability) {
    const available = new Set(models);
    const kept = uniqueModelOptions(current.map((model) => normalizeLocalModelOption(model, models)).filter((model) => available.has(model) && modelMatchesCapability(model, capability)));
    return kept.length ? kept : filterModelsByCapability(models, capability);
}

function normalizeLocalModelOption(value: string, models: string[]) {
    if (models.includes(value)) return value;
    const rawModel = modelOptionName(value);
    return models.find((model) => modelOptionName(model) === rawModel) || "";
}

function nextLocalDefault(current: string, models: string[]) {
    return normalizeLocalModelOption(current, models) || models[0] || "";
}

function normalizeApiFormat(value: unknown): ApiCallFormat {
    return value === "gemini" ? "gemini" : "openai";
}

function normalizeChannelRequestMode(value: unknown): ChannelRequestMode {
    // v0.8.1 的 proxy 表示生产后端转发；迁移后统一改为用户本机 Agent。
    if (value === "proxy") return "agent";
    return value === "direct" || value === "agent" ? value : "auto";
}

function normalizeImageApiMode(value: unknown): ImageApiMode {
    return value === "responses" ? "responses" : "images";
}

function normalizeResponsesImageModel(value: unknown, models: unknown) {
    const available = uniqueRawModels(models);
    const selected = rawChannelModelName(value);
    if (selected && available.includes(selected)) return selected;
    return available.find((model) => isTextModelName(model)) || available[0] || "";
}

function normalizeStreamPartialImages(value: unknown) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(0, Math.min(3, parsed)) : 1;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return fallback;
}

function uniqueRawModels(models: unknown) {
    if (!Array.isArray(models)) return [];
    return Array.from(new Set(models.map(rawChannelModelName).filter(Boolean)));
}

function normalizeModelScripts(value: unknown, legacyModels?: unknown): ModelScriptMap {
    const result: ModelScriptMap = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
        Object.entries(value)
            .slice(0, 256)
            .forEach(([rawModel, scripts]) => {
                const model = rawModel.trim().slice(0, 256);
                if (!model || !scripts || typeof scripts !== "object" || Array.isArray(scripts)) return;
                for (const capability of ["image", "video", "text", "audio"] as const) {
                    const source = (scripts as Record<string, unknown>)[capability];
                    if (typeof source === "string" && source.trim()) (result[model] ||= {})[capability] = source.slice(0, 100_000);
                }
            });
    }
    if (Array.isArray(legacyModels)) {
        legacyModels.slice(0, 256).forEach((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return;
            const record = item as Record<string, unknown>;
            const model = typeof record.name === "string" ? record.name.trim().slice(0, 256) : "";
            const capability = record.capability;
            const source = record.script;
            if (model && (capability === "image" || capability === "video" || capability === "text" || capability === "audio") && typeof source === "string" && source.trim()) {
                (result[model] ||= {})[capability] ||= source.slice(0, 100_000);
            }
        });
    }
    return result;
}

function normalizeModelScriptApprovals(value: unknown, scripts: unknown): ModelScriptMap {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalizedScripts = normalizeModelScripts(scripts);
    const result: ModelScriptMap = {};
    Object.entries(value)
        .slice(0, 256)
        .forEach(([rawModel, approvals]) => {
            const model = rawModel.trim().slice(0, 256);
            if (!model || !approvals || typeof approvals !== "object" || Array.isArray(approvals)) return;
            for (const capability of ["image", "video", "text", "audio"] as const) {
                const approval = (approvals as Record<string, unknown>)[capability];
                const source = normalizedScripts[model]?.[capability];
                if (typeof approval === "string" && source && approval === modelScriptFingerprint(source.trim())) (result[model] ||= {})[capability] = approval;
            }
        });
    return result;
}

function rawChannelModelName(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { name?: unknown }).name === "string") return (value as { name: string }).name.trim();
    return "";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

function modelSelectionState(config: AiConfig): ModelSelectionState {
    return {
        model: config.model,
        imageModel: config.imageModel,
        videoModel: config.videoModel,
        textModel: config.textModel,
        audioModel: config.audioModel,
        models: [...config.models],
        imageModels: [...config.imageModels],
        videoModels: [...config.videoModels],
        textModels: [...config.textModels],
        audioModels: [...config.audioModels],
    };
}

function emptyModelSelectionState(): ModelSelectionState {
    return { model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "", models: [], imageModels: [], videoModels: [], textModels: [], audioModels: [] };
}

function newApiConnectionState(config: Pick<AiConfig, keyof NewApiConnectionState>): NewApiConnectionState {
    return {
        baseUrl: config.baseUrl || "",
        newApiGroup: config.newApiGroup || "",
        newApiTextGroup: config.newApiTextGroup || "",
        newApiImageGroup: config.newApiImageGroup || "",
        newApiVideoGroup: config.newApiVideoGroup || "",
        newApiAudioGroup: config.newApiAudioGroup || "",
    };
}

function normalizeNewApiConnectionState(value: NewApiConnectionState | undefined, fallback: NewApiConnectionState): NewApiConnectionState {
    if (!value) return fallback;
    return {
        baseUrl: value.baseUrl || fallback.baseUrl,
        newApiGroup: value.newApiGroup || "",
        newApiTextGroup: value.newApiTextGroup || "",
        newApiImageGroup: value.newApiImageGroup || "",
        newApiVideoGroup: value.newApiVideoGroup || "",
        newApiAudioGroup: value.newApiAudioGroup || "",
    };
}

function normalizeModelSelectionState(value: ModelSelectionState | undefined, fallback: ModelSelectionState): ModelSelectionState {
    if (!value) return fallback;
    return {
        model: value.model || "",
        imageModel: value.imageModel || "",
        videoModel: value.videoModel || "",
        textModel: value.textModel || "",
        audioModel: value.audioModel || "",
        models: normalizeModelList(value.models || []),
        imageModels: normalizeModelList(value.imageModels || []),
        videoModels: normalizeModelList(value.videoModels || []),
        textModels: normalizeModelList(value.textModels || []),
        audioModels: normalizeModelList(value.audioModels || []),
    };
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
