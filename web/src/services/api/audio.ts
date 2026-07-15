import axios from "axios";

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { readAxiosError } from "@/services/api/ai-utils";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, isNewApiConfig, resolveCapabilityModel, resolveModelRequestConfig, resolveNewApiGroup, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type RequestOptions = { signal?: AbortSignal };

function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    const token = useUserStore.getState().token;
    if (config.channelMode === "remote") {
        return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
        };
    }
    if (isNewApiConfig(config)) {
        return {
            "Content-Type": "application/json",
        };
    }
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

function aiRequestConfig(config: AiConfig) {
    return {
        headers: aiHeaders(config),
        ...(isNewApiConfig(config) ? { params: { group: resolveNewApiGroup(config, "audio") }, withCredentials: true } : {}),
    };
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, resolveCapabilityModel(config, "audio", config.model || config.audioModel));
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    if (requestConfig.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持语音生成，请为音频模型选择 OpenAI 格式渠道");
    const format = normalizeAudioFormatValue(requestConfig.audioFormat);
    const instructions = requestConfig.audioInstructions.trim();

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(requestConfig.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(requestConfig.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            { ...aiRequestConfig(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        refreshRemoteUser(requestConfig);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (isNewApiConfig(config) && !config.baseUrl.trim()) throw new Error("请先配置 New API Base URL");
    if (isNewApiConfig(config) && !resolveNewApiGroup(config, "audio")) throw new Error("请先选择 New API 分组");
    if (config.channelMode === "local" && !config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (config.channelMode === "local" && !config.apiKey.trim()) throw new Error("请先配置 API Key");
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}
