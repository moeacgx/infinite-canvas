"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";

export type ApiCallFormat = "openai" | "gemini";

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: string[];
};

export type AiConfig = {
    channelMode: "remote" | "local" | "newapi";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
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
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
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
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    count: "1",
    canvasImageCount: "3",
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
    };
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
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
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
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: uniqueRawModels(channel?.models || []),
    };
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return apiFormat === "gemini" ? GEMINI_BASE_URL : OPENAI_BASE_URL;
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${modelOptionName(model).trim()}`;
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

export function resolveModelRequestConfig(config: AiConfig, value: string): AiConfig {
    if (config.channelMode !== "local") return { ...config, model: modelOptionName(value), apiFormat: "openai" };
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

export function withLocalChannels(config: AiConfig, inputChannels: ModelChannel[]): AiConfig {
    const channels = inputChannels.map((channel) => ({
        id: channel.id?.trim() || nanoid(),
        name: channel.name ?? "",
        baseUrl: channel.baseUrl ?? "",
        apiKey: channel.apiKey ?? "",
        apiFormat: normalizeApiFormat(channel.apiFormat),
        models: uniqueRawModels(channel.models || []),
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

function uniqueRawModels(models: string[]) {
    return Array.from(new Set((models || []).map((model) => modelOptionName(model).trim()).filter(Boolean)));
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
