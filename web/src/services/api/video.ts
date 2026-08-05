import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { isRequestCanceled, readAxiosError } from "@/services/api/ai-utils";
import { channelAxiosRequest } from "@/services/api/channel-request";
import { resolveModelPluginResultUrl, runModelPlugin } from "@/services/api/model-plugin";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl, resolveImageUrl } from "@/services/image-storage";
import { assertVideoSecondsSupported, modelKey, supportsVideoAudioGeneration } from "@/lib/video-model-capabilities";
import { isTransientVideoPollError, reachedVideoPollFailureLimit } from "@/lib/video-polling";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import {
    buildApiUrl,
    isNewApiConfig,
    modelOptionName,
    resolveCapabilityModel,
    resolveModelChannel,
    resolveModelRequestConfig,
    resolveModelScript,
    resolveNewApiGroup,
    type AiConfig,
    type ModelCapability,
    type VideoElementReference,
} from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; progress?: number; video_url?: string; url?: string; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
type ReferenceMediaUploadResponse = { id: string; url: string; mimeType: string; bytes: number };
type SeedancePayload = {
    model: string;
    content: Array<Record<string, unknown>>;
    ratio: string;
    resolution: string;
    duration: number;
    generate_audio: boolean;
    watermark: boolean;
};

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "plugin"; model: string; channelModel?: string };
export type VideoGenerationTaskState = { status: "pending"; progress?: number } | { status: "retrying"; error: string } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };
export type VideoReferenceInput = {
    references?: ReferenceImage[];
    videoReferences?: ReferenceVideo[];
    audioReferences?: ReferenceAudio[];
    firstFrame?: ReferenceImage | null;
    lastFrame?: ReferenceImage | null;
};
type NormalizedVideoReferenceInput = Required<VideoReferenceInput>;
type RequestOptions = { signal?: AbortSignal };
type WaitForVideoTaskOptions = RequestOptions & { onProgress?: (progress: number | undefined) => void };

const pluginVideoResults = new Map<string, { result: VideoGenerationResult; timer: ReturnType<typeof setTimeout> }>();

function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    if (config.channelMode === "remote") {
        return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(contentType ? { "Content-Type": contentType } : {}),
        };
    }
    if (isNewApiConfig(config)) {
        return {
            ...(contentType ? { "Content-Type": contentType } : {}),
        };
    }
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

function aiRequestConfig(config: AiConfig, contentType?: string, params?: Record<string, string>, capability?: ModelCapability) {
    const nextParams = { ...(params || {}) };
    if (isNewApiConfig(config)) nextParams.group = resolveNewApiGroup(config, capability);
    return {
        headers: aiHeaders(config, contentType),
        ...(Object.keys(nextParams).length ? { params: nextParams } : {}),
        ...(isNewApiConfig(config) ? { withCredentials: true } : {}),
    };
}

function refreshRemoteUser(config: AiConfig) {
    if (config.channelMode === "remote") void useUserStore.getState().hydrateUser();
}

export function requestVideoGeneration(config: AiConfig, prompt: string, input?: VideoReferenceInput, options?: RequestOptions): Promise<VideoGenerationResult>;
export function requestVideoGeneration(config: AiConfig, prompt: string, references?: ReferenceImage[], videoReferences?: ReferenceVideo[], audioReferences?: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationResult>;
export async function requestVideoGeneration(
    config: AiConfig,
    prompt: string,
    input: ReferenceImage[] | VideoReferenceInput = [],
    videoReferencesOrOptions: ReferenceVideo[] | RequestOptions = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationResult> {
    const requestOptions = Array.isArray(videoReferencesOrOptions) ? options : videoReferencesOrOptions;
    const references = normalizeVideoReferenceInput(input, Array.isArray(videoReferencesOrOptions) ? videoReferencesOrOptions : [], audioReferences);
    const task = await createVideoGenerationTask(config, prompt, references, requestOptions);
    return waitForVideoGenerationTask(config, task, requestOptions);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: WaitForVideoTaskOptions): Promise<VideoGenerationResult> {
    const delayMs = task.provider === "seedance" ? 5000 : 2500;
    let consecutivePollFailures = 0;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "retrying") {
            consecutivePollFailures += 1;
            if (reachedVideoPollFailureLimit(consecutivePollFailures)) throw new Error(state.error);
        } else {
            consecutivePollFailures = 0;
            options?.onProgress?.(state.progress);
        }
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export function createVideoGenerationTask(config: AiConfig, prompt: string, input: VideoReferenceInput, options?: RequestOptions): Promise<VideoGenerationTask>;
export function createVideoGenerationTask(config: AiConfig, prompt: string, references?: ReferenceImage[], videoReferences?: ReferenceVideo[], audioReferences?: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask>;
export async function createVideoGenerationTask(
    config: AiConfig,
    prompt: string,
    input: ReferenceImage[] | VideoReferenceInput = [],
    videoReferencesOrOptions: ReferenceVideo[] | RequestOptions = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const requestOptions = Array.isArray(videoReferencesOrOptions) ? options : videoReferencesOrOptions;
    const references = normalizeVideoReferenceInput(input, Array.isArray(videoReferencesOrOptions) ? videoReferencesOrOptions : [], audioReferences);
    const channelModel = resolveCapabilityModel(config, "video", config.model || config.videoModel);
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    const model = requestConfig.model.trim();
    assertVideoConfig(requestConfig, model);
    const requestPrompt = withVideoSystemPrompt(requestConfig, prompt);
    const script = resolveModelScript(config, channelModel, "video");
    if (script) return createPluginVideoTask(requestConfig, channelModel, script, requestPrompt, references.references, references.videoReferences, references.audioReferences, requestOptions);
    if (requestConfig.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请为视频模型选择 OpenAI 格式渠道");
    if (isSeedanceVideoConfig({ ...requestConfig, model })) {
        return createSeedanceTask(requestConfig, model, requestPrompt, seedanceReferenceImages(references), references.videoReferences, references.audioReferences, requestOptions, channelModel);
    }
    assertVideoSecondsSupported(requestConfig, model);
    return createOpenAIVideoTask(requestConfig, model, requestPrompt, references, requestOptions, channelModel);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const entry = pluginVideoResults.get(task.id);
        if (!entry) return { status: "failed", error: "自定义脚本视频结果已失效，请重新生成" };
        clearTimeout(entry.timer);
        pluginVideoResults.delete(task.id);
        return { status: "completed", result: entry.result };
    }
    const requestConfig = resolveModelRequestConfig(config, task.channelModel || task.model);
    assertVideoConfig(requestConfig, task.model);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(
    config: AiConfig,
    channelModel: string,
    script: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const [images, videos, audios] = await Promise.all([
        Promise.all(references.map((image) => imageToDataUrl(image, options?.signal))),
        Promise.all(videoReferences.map((video) => resolveSeedanceVideoUrl(video, options?.signal))),
        Promise.all(audioReferences.map((audio) => resolveSeedanceAudioUrl(audio, options?.signal))),
    ]);
    try {
        const raw = await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                videoReferences: videos,
                audioReferences: audios,
            },
            signal: options?.signal,
        });
        const result = await materializePluginVideoResult(config, normalizePluginVideoResult(raw, config.baseUrl), options?.signal);
        const id = `plugin-${nanoid()}`;
        while (pluginVideoResults.size >= 32) {
            const oldest = pluginVideoResults.entries().next().value as [string, { result: VideoGenerationResult; timer: ReturnType<typeof setTimeout> }] | undefined;
            if (!oldest) break;
            clearTimeout(oldest[1].timer);
            pluginVideoResults.delete(oldest[0]);
        }
        const timer = setTimeout(() => pluginVideoResults.delete(id), 10 * 60 * 1000);
        pluginVideoResults.set(id, { result, timer });
        return { id, provider: "plugin", model: config.model, channelModel };
    } catch (error) {
        throw new Error(readAxiosError(error, "自定义视频脚本执行失败"));
    }
}

function normalizePluginVideoResult(value: unknown, baseUrl: string): VideoGenerationResult {
    if (value instanceof Blob) return { blob: value };
    if (value instanceof ArrayBuffer) return { blob: new Blob([value], { type: "video/mp4" }) };
    if (typeof value === "string" && value.trim()) return { url: resolveModelPluginResultUrl(baseUrl, value.trim()), mimeType: "video/mp4" };
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        if (typeof record.url === "string" && record.url.trim()) return { url: resolveModelPluginResultUrl(baseUrl, record.url.trim()), mimeType: typeof record.mimeType === "string" ? record.mimeType : "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

async function materializePluginVideoResult(config: AiConfig, result: VideoGenerationResult, signal?: AbortSignal) {
    if (result.blob || !result.url) return result;
    const headers = config.apiFormat === "gemini" ? { "x-goog-api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` };
    const response = await channelAxiosRequest<Blob>(config, { method: "GET", url: result.url, headers, responseType: "blob", signal });
    await assertVideoBlob(response.data);
    return { blob: response.data, mimeType: response.data.type || result.mimeType };
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, input: NormalizedVideoReferenceInput, options?: RequestOptions, channelModel?: string): Promise<VideoGenerationTask> {
    const kling = resolveKlingRequest(config, model, channelModel);
    const motionControl = resolveKlingMotionControlRequest(config, model, channelModel);
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    if (kling) {
        body.append("mode", kling.variant === "v3" ? normalizeKlingV3Mode(config.videoMode) : normalizeKlingV26Mode(config.videoMode));
        body.append("duration", kling.variant === "v3" ? normalizeKlingV3Duration(config.videoSeconds) : normalizeKlingV26Duration(config.videoSeconds));
        body.append("aspect_ratio", normalizeKlingAspectRatio(config.size));
        if (kling.provider !== "kie" && config.videoNegativePrompt.trim()) body.append("negative_prompt", config.videoNegativePrompt.trim());
        if (kling.variant === "v3" && boolConfig(config.videoMultiShot, false)) {
            body.append("multi_shot", "true");
            if (kling.provider === "kie") {
                body.append("multi_prompt", JSON.stringify(normalizeKieMultiPrompt(config.videoMultiPrompt)));
            } else {
                const shotType = normalizeKlingShotType(config.videoShotType);
                body.append("shot_type", shotType);
                if (shotType === "customize") body.append("multi_prompt", JSON.stringify(normalizeKlingMultiPrompt(config.videoMultiPrompt)));
            }
        }
        if (kling.variant === "v3") {
            const elements = await normalizeKlingElementList(config.videoElementList, kling.provider, options?.signal);
            if (elements.length) body.append("element_list", JSON.stringify(elements));
        }
    } else if (motionControl) {
        body.append("mode", normalizeVideoResolution(config.vquality) === "1080p" ? "pro" : "std");
        body.append("character_orientation", normalizeCharacterOrientation(config.videoCharacterOrientation));
    } else {
        body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
        if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
        body.append("resolution_name", normalizeVideoResolution(config.vquality));
        if (isKieGrokVideoRequest(config, model, channelModel)) body.append("mode", normalizeGrokVideoMode(config.videoMode));
        else body.append("preset", "normal");
    }
    if (supportsVideoAudioGeneration(model)) {
        const generateAudio = boolConfig(config.videoGenerateAudio, false) && (!kling || kling.variant !== "v26" || normalizeKlingV26Mode(config.videoMode) === "pro");
        body.append("video_generate_audio", String(generateAudio));
    }
    const files = await Promise.all(input.references.slice(0, kling ? 2 : 9).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image, options?.signal) })));
    files.forEach((file) => body.append("input_reference[]", file));
    if (!kling && input.firstFrame) body.append("first_frame_url", await imageReferenceToFormValue(input.firstFrame, options?.signal));
    if (!kling && input.lastFrame) body.append("last_frame_url", await imageReferenceToFormValue(input.lastFrame, options?.signal));
    const videoFiles = kling ? [] : await Promise.all(input.videoReferences.map((video) => mediaReferenceToFormValue(video, options?.signal)));
    videoFiles.forEach((file) => body.append("video_reference[]", file));
    const audioFiles = kling ? [] : await Promise.all(input.audioReferences.map((audio) => mediaReferenceToFormValue(audio, options?.signal)));
    audioFiles.forEach((file) => body.append("audio_reference[]", file));
    try {
        const created = unwrapVideoResponse((await channelAxiosRequest<ApiVideoResponse>(config, { method: "POST", url: aiApiUrl(config, "/videos"), data: body, ...aiRequestConfig(config, undefined, undefined, "video"), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model, ...(channelModel ? { channelModel } : {}) };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const params = config.channelMode === "remote" || isNewApiConfig(config) ? { model: task.model } : undefined;
    try {
        const video = unwrapVideoResponse((await channelAxiosRequest<ApiVideoResponse>(config, { method: "GET", url: aiApiUrl(config, `/videos/${task.id}`), ...aiRequestConfig(config, undefined, params, "video"), signal: options?.signal })).data);
        const resultUrl = video.video_url || video.url;
        if (isCompletedVideoStatus(video.status) || resultUrl) {
            if (resultUrl) {
                refreshRemoteUser(config);
                return { status: "completed", result: { url: resultUrl, mimeType: "video/mp4" } };
            }
            const content = await channelAxiosRequest<Blob>(config, { method: "GET", url: aiApiUrl(config, `/videos/${task.id}/content`), ...aiRequestConfig(config, undefined, params, "video"), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            refreshRemoteUser(config);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: video.error?.message || "视频生成失败" };
        return { status: "pending", ...(typeof video.progress === "number" ? { progress: video.progress } : {}) };
    } catch (error) {
        if (isTransientVideoPollError(error, options?.signal)) return { status: "retrying", error: readAxiosError(error, "视频任务查询暂时失败，请稍后重试") };
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
    channelModel?: string,
): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences, options?.signal);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model,
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, model),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    if (isNewApiConfig(config)) {
        return requestNewApiSeedanceGeneration(config, model, prompt, payload, options, channelModel);
    }

    try {
        const created = unwrapSeedanceTask(
            (await channelAxiosRequest<ApiEnvelope<SeedanceTask>>(config, { method: "POST", url: seedanceApiUrl(config), data: payload, ...aiRequestConfig(config, "application/json", undefined, "video"), signal: options?.signal })).data,
        );
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model, ...(channelModel ? { channelModel } : {}) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const params = config.channelMode === "remote" || isNewApiConfig(config) ? { model: task.model } : undefined;
    try {
        const state = unwrapSeedanceTask((await channelAxiosRequest<ApiEnvelope<SeedanceTask>>(config, { method: "GET", url: seedanceApiUrl(config, task.id), ...aiRequestConfig(config, undefined, params, "video"), signal: options?.signal })).data);
        if (state.status === "succeeded") {
            const url = state.content?.video_url;
            if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            refreshRemoteUser(config);
            return { status: "completed", result: await videoResultFromUrl(url, options) };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        if (isTransientVideoPollError(error, options?.signal)) return { status: "retrying", error: readAxiosError(error, "Seedance 任务查询暂时失败，请稍后重试") };
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

async function requestNewApiSeedanceGeneration(config: AiConfig, model: string, prompt: string, payload: SeedancePayload, options?: RequestOptions, channelModel?: string) {
    const body = {
        model,
        prompt,
        seconds: String(payload.duration),
        size: payload.ratio,
        metadata: {
            content: payload.content,
            ratio: payload.ratio,
            resolution: payload.resolution,
            duration: payload.duration,
            generate_audio: payload.generate_audio,
            watermark: payload.watermark,
        },
    };

    try {
        const created = unwrapVideoResponse(
            (await channelAxiosRequest<ApiVideoResponse>(config, { method: "POST", url: aiApiUrl(config, "/videos"), data: body, ...aiRequestConfig(config, "application/json", undefined, "video"), signal: options?.signal })).data,
        );
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "openai" as const, model, ...(channelModel ? { channelModel } : {}) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    if (config.channelMode === "remote") return taskId ? `/api/v1/videos/${encodeURIComponent(taskId)}` : "/api/v1/videos";
    if (isNewApiConfig(config)) return buildApiUrl(config.baseUrl, taskId ? `/videos/${encodeURIComponent(taskId)}` : "/videos");
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], signal?: AbortSignal) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image, signal) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video, signal) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio, signal) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image, signal);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    if (config.channelMode === "remote") {
        return uploadReferenceMedia(dataUrlToFile({ ...image, dataUrl }), signal);
    }
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    signal?.throwIfAborted();
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url, { signal })).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    const file = new File([blob], video.name || "reference-video.mp4", { type: video.type || blob.type || "video/mp4" });
    return uploadReferenceMedia(file, signal);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    signal?.throwIfAborted();
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url, { signal })).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    const file = new File([blob], audio.name || "reference-audio.mp3", { type: audio.type || blob.type || "audio/mpeg" });
    return uploadReferenceMedia(file, signal);
}

async function mediaReferenceToFormValue(media: ReferenceVideo | ReferenceAudio, signal?: AbortSignal): Promise<string | File> {
    signal?.throwIfAborted();
    const resolvedUrl = await resolveMediaUrl(media.storageKey, media.url);
    for (const value of [resolvedUrl, media.url]) {
        if (isPublicMediaUrl(value) || value.startsWith("asset://")) return value;
    }
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    signal?.throwIfAborted();
    const localUrl = resolvedUrl || media.url;
    if (!blob && localUrl?.startsWith("blob:")) blob = await (await fetch(localUrl, { signal })).blob();
    if (!blob) throw new Error(`${media.type.startsWith("audio/") ? "参考音频" : "参考视频"}读取失败，请重新上传或使用公网 URL`);
    return new File([blob], media.name || "reference", { type: media.type || blob.type || "application/octet-stream" });
}

async function uploadReferenceMedia(file: File, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const token = useUserStore.getState().token;
    if (!token) throw new Error("使用本地参考素材需要先登录，并在服务端配置 PUBLIC_BASE_URL");
    const body = new FormData();
    body.append("file", file, file.name);
    let response;
    try {
        response = await axios.post<ApiEnvelope<ReferenceMediaUploadResponse>>("/api/v1/media/references", body, { headers: { Authorization: `Bearer ${token}` }, signal });
    } catch (error) {
        if (isRequestCanceled(error, signal)) throw new DOMException("请求已取消", "AbortError");
        throw error;
    }
    const payload = unwrapEnvelope(response.data, "参考素材上传失败");
    if (!payload.url) throw new Error("参考素材上传后没有返回公网 URL");
    return payload.url;
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (isRequestCanceled(error, options?.signal)) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (isNewApiConfig(config) && !config.baseUrl.trim()) throw new Error("请先配置 New API Base URL");
    if (isNewApiConfig(config) && !resolveNewApiGroup(config, "video")) throw new Error("请先选择 New API 分组");
    if (config.channelMode === "local" && !config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (config.channelMode === "local" && !config.apiKey.trim()) throw new Error("请先配置 API Key");
}

function normalizeVideoReferenceInput(input: ReferenceImage[] | VideoReferenceInput, videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = []): NormalizedVideoReferenceInput {
    if (Array.isArray(input)) return { references: input, videoReferences, audioReferences, firstFrame: null, lastFrame: null };
    return {
        references: input.references || [],
        videoReferences: input.videoReferences || [],
        audioReferences: input.audioReferences || [],
        firstFrame: input.firstFrame || null,
        lastFrame: input.lastFrame || null,
    };
}

function seedanceReferenceImages(input: NormalizedVideoReferenceInput) {
    const references = [input.firstFrame, ...input.references, input.lastFrame].filter((item): item is ReferenceImage => Boolean(item));
    return references.filter((item, index) => references.findIndex((candidate) => candidate.id === item.id) === index);
}

type KlingRequest = { provider: "apimart" | "kie"; variant: "v26" | "v3" };

function resolveKlingRequest(config: AiConfig, model: string, channelModel?: string): KlingRequest | null {
    const key = modelKey(model);
    const channel = videoChannelText(config, model, channelModel);
    if (key === "kling-v2-6") return { provider: channel.includes("kie") ? "kie" : "apimart", variant: "v26" };
    if (key === "kling-v3") return { provider: channel.includes("kie") ? "kie" : "apimart", variant: "v3" };
    if (key === "kling-3-0-video") return { provider: "kie", variant: "v3" };
    return null;
}

function resolveKlingMotionControlRequest(config: AiConfig, model: string, channelModel?: string) {
    const key = modelKey(model);
    if (!["kling-v2-6-motion-control", "kling-v3-motion-control", "kling-2-6-motion-control", "kling-3-0-motion-control"].includes(key)) return false;
    const channel = videoChannelText(config, model, channelModel);
    return channel.includes("apimart") || channel.includes("kie") || key.includes("motion-control");
}

function isKieGrokVideoRequest(config: AiConfig, model: string, channelModel?: string) {
    return modelKey(model).includes("grok") && videoChannelText(config, model, channelModel).includes("kie");
}

function videoChannelText(config: AiConfig, model: string, channelModel?: string) {
    if (config.channelMode === "local") {
        const channel = resolveModelChannel(config, channelModel || model);
        return [channel.id, channel.name, channel.baseUrl].filter(Boolean).join(" ").toLowerCase();
    }
    const activeId = config.videoChannelId || config.activeChannelId;
    const channel = config.publicChannels.find((item) => item.id === activeId) || config.publicChannels.find((item) => item.models?.some((value) => modelOptionName(value) === model)) || config.publicChannels[0];
    return [channel?.id, channel?.name, channel?.baseUrl, channel?.remark].filter(Boolean).join(" ").toLowerCase();
}

function normalizeKlingV26Mode(value: string) {
    return value === "pro" ? "pro" : "std";
}

function normalizeKlingV3Mode(value: string) {
    return value === "4k" ? "4k" : value === "pro" ? "pro" : "std";
}

function normalizeKlingV26Duration(value: string) {
    return String(value).trim() === "10" ? "10" : "5";
}

function normalizeKlingV3Duration(value: string) {
    const seconds = Math.floor(Number(value) || 3);
    return String(Math.max(3, Math.min(15, seconds)));
}

function normalizeKlingAspectRatio(value: string) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (["9:16", "720x1280", "1080x1920"].includes(normalized)) return "9:16";
    if (["1:1", "1024x1024", "1080x1080"].includes(normalized)) return "1:1";
    return "16:9";
}

function normalizeKlingShotType(value: string) {
    return value === "customize" ? "customize" : "intelligence";
}

function normalizeKlingMultiPrompt(value: AiConfig["videoMultiPrompt"]) {
    const items = Array.isArray(value) && value.length ? value : [{ prompt: "", duration: "1" }];
    return items.map((item, index) => ({ index: index + 1, prompt: item.prompt || "", duration: normalizeKlingMultiPromptDuration(item.duration) }));
}

function normalizeKieMultiPrompt(value: AiConfig["videoMultiPrompt"]) {
    return normalizeKlingMultiPrompt(value).map(({ prompt, duration }) => ({ prompt, duration }));
}

function normalizeKlingMultiPromptDuration(value: string) {
    return Math.max(1, Math.min(15, Math.floor(Number(value) || 1)));
}

async function normalizeKlingElementList(value: AiConfig["videoElementList"], provider: KlingRequest["provider"], signal?: AbortSignal) {
    const result: Array<Record<string, unknown>> = [];
    for (const item of (Array.isArray(value) ? value : []).slice(0, 3)) {
        const references = (
            await Promise.all(
                (Array.isArray(item.references) ? item.references : []).slice(0, 4).map(async (reference) => ({
                    kind: reference.kind,
                    url: await elementReferenceToInputUrl(reference, signal),
                })),
            )
        ).filter((reference) => reference.url);
        if (!references.length) continue;
        result.push(provider === "kie" ? { name: item.name || "", description: item.description || "", references } : { name: item.name || "", description: item.description || "", element_input_urls: references.map((reference) => reference.url) });
    }
    return result;
}

async function elementReferenceToInputUrl(reference: VideoElementReference, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (reference.kind === "image") {
        const resolvedUrl = await resolveImageUrl(reference.storageKey, "");
        for (const value of [reference.url, resolvedUrl]) {
            const url = publicHttpUrl(value);
            if (url) return url;
        }
        if (reference.dataUrl) return reference.dataUrl;
        return imageToDataUrl({ dataUrl: reference.url || resolvedUrl, storageKey: reference.storageKey }, signal);
    }
    const resolvedUrl = await resolveMediaUrl(reference.storageKey, reference.url || "");
    return publicHttpUrl(resolvedUrl) || publicHttpUrl(reference.url) || resolvedUrl || reference.url || "";
}

async function imageReferenceToFormValue(image: ReferenceImage, signal?: AbortSignal) {
    const resolvedUrl = await resolveImageUrl(image.storageKey, "");
    for (const value of [image.url, resolvedUrl, image.dataUrl]) {
        const url = publicHttpUrl(value);
        if (url) return url;
    }
    return dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image, signal) });
}

function publicHttpUrl(value?: string) {
    if (!value || value.startsWith("blob:") || value.startsWith("data:")) return "";
    try {
        const url = new URL(value, typeof window === "undefined" ? undefined : window.location.origin);
        if (!["http:", "https:"].includes(url.protocol) || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return "";
        return url.href;
    } catch {
        return "";
    }
}

function normalizeCharacterOrientation(value: string) {
    return value === "image" ? "image" : "video";
}

function normalizeGrokVideoMode(value: string) {
    return value === "fun" || value === "spicy" ? value : "normal";
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function isCompletedVideoStatus(status?: string) {
    return ["completed", "complete", "done", "succeeded", "success"].includes((status || "").toLowerCase());
}

function withVideoSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = (config.systemPrompts?.video || config.systemPrompt).trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("请求已取消", "AbortError"));
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
