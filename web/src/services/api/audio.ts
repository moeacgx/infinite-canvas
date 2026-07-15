import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { readAxiosError } from "@/services/api/ai-utils";
import { channelAxiosRequest } from "@/services/api/channel-request";
import { resolveModelPluginResultUrl, runModelPlugin } from "@/services/api/model-plugin";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, isNewApiConfig, resolveCapabilityModel, resolveModelRequestConfig, resolveModelScript, resolveNewApiGroup, type AiConfig } from "@/stores/use-config-store";
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
    const channelModel = resolveCapabilityModel(config, "audio", config.model || config.audioModel);
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    const format = normalizeAudioFormatValue(requestConfig.audioFormat);
    const instructions = requestConfig.audioInstructions.trim();
    const script = resolveModelScript(config, channelModel, "audio");

    if (script) {
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: { voice: normalizeAudioVoiceValue(requestConfig.audioVoice), format, speed: normalizeAudioSpeedValue(requestConfig.audioSpeed), instructions },
                signal: options?.signal,
            });
            return await audioPluginBlob(result, format, requestConfig, options?.signal);
        } catch (error) {
            throw new Error(readAxiosError(error, "音频生成失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持语音生成，请为音频模型选择 OpenAI 格式渠道或配置自定义调用脚本");

    try {
        const response = await channelAxiosRequest<Blob>(requestConfig, {
            method: "POST",
            url: aiApiUrl(requestConfig, "/audio/speech"),
            data: {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(requestConfig.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(requestConfig.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            ...aiRequestConfig(requestConfig),
            responseType: "blob",
            signal: options?.signal,
        });
        await assertAudioBlob(response.data);
        refreshRemoteUser(requestConfig);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

async function audioPluginBlob(result: unknown, format: string, config: AiConfig, signal?: AbortSignal): Promise<Blob> {
    if (result instanceof Blob) return result;
    if (result instanceof ArrayBuffer) return new Blob([result], { type: audioMimeType(format) });
    const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (record.blob instanceof Blob) return record.blob;
    const mimeType = typeof record.mimeType === "string" && record.mimeType.startsWith("audio/") ? record.mimeType : audioMimeType(format);
    const value = typeof result === "string" ? result : typeof record.data === "string" ? record.data : typeof record.b64_json === "string" ? record.b64_json : "";
    const url = typeof record.url === "string" ? record.url : "";
    if (url) {
        const resultUrl = resolveModelPluginResultUrl(config.baseUrl, url);
        const sameOrigin = (() => {
            try {
                return new URL(resultUrl).origin === new URL(config.baseUrl).origin;
            } catch {
                return false;
            }
        })();
        const response = await channelAxiosRequest<Blob>(config, { method: "GET", url: resultUrl, headers: sameOrigin && config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined, responseType: "blob", signal });
        return response.data;
    }
    if (!value) throw new Error("模型调用脚本没有返回音频");
    if (value.startsWith("data:")) return await (await fetch(value)).blob();
    try {
        const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
        if (/pcm|l16/i.test(mimeType)) return pcm16ToWav(bytes, Number(mimeType.match(/rate=(\d+)/i)?.[1]) || 24_000);
        return new Blob([bytes], { type: mimeType });
    } catch {
        throw new Error("模型调用脚本返回的音频格式无效");
    }
}

function pcm16ToWav(pcm: Uint8Array, sampleRate: number) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const write = (offset: number, value: string) => Array.from(value).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, pcm.byteLength, true);
    const body = new ArrayBuffer(pcm.byteLength);
    new Uint8Array(body).set(pcm);
    return new Blob([header, body], { type: "audio/wav" });
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
