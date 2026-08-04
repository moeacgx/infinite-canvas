import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { isRequestCanceled, readAxiosError } from "@/services/api/ai-utils";
import { channelAxiosRequest } from "@/services/api/channel-request";
import { resolveModelPluginResultUrl, runModelPlugin } from "@/services/api/model-plugin";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { assertVideoSecondsSupported } from "@/lib/video-model-capabilities";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, isNewApiConfig, resolveCapabilityModel, resolveModelRequestConfig, resolveModelScript, resolveNewApiGroup, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string } };
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
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };
type RequestOptions = { signal?: AbortSignal };

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

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "seedance" ? 5000 : 2500;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const channelModel = resolveCapabilityModel(config, "video", config.model || config.videoModel);
    const requestConfig = resolveModelRequestConfig(config, channelModel);
    const model = requestConfig.model.trim();
    assertVideoConfig(requestConfig, model);
    const script = resolveModelScript(config, channelModel, "video");
    if (script) return createPluginVideoTask(requestConfig, channelModel, script, prompt, references, videoReferences, audioReferences, options);
    if (requestConfig.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请为视频模型选择 OpenAI 格式渠道");
    if (isSeedanceVideoConfig({ ...requestConfig, model })) {
        return createSeedanceTask(requestConfig, model, prompt, references, videoReferences, audioReferences, options, channelModel);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    assertVideoSecondsSupported(requestConfig, model);
    return createOpenAIVideoTask(requestConfig, model, prompt, references, options, channelModel);
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
        Promise.all(references.map((image) => imageToDataUrl(image))),
        Promise.all(videoReferences.map(resolveSeedanceVideoUrl)),
        Promise.all(audioReferences.map(resolveSeedanceAudioUrl)),
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

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions, channelModel?: string): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
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
        if (video.status === "completed") {
            const content = await channelAxiosRequest<Blob>(config, { method: "GET", url: aiApiUrl(config, `/videos/${task.id}/content`), ...aiRequestConfig(config, undefined, params, "video"), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            refreshRemoteUser(config);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: video.error?.message || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
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
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
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
        const created = unwrapSeedanceTask((await channelAxiosRequest<ApiEnvelope<SeedanceTask>>(config, { method: "POST", url: seedanceApiUrl(config), data: payload, ...aiRequestConfig(config, "application/json", undefined, "video"), signal: options?.signal })).data);
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
        const created = unwrapVideoResponse((await channelAxiosRequest<ApiVideoResponse>(config, { method: "POST", url: aiApiUrl(config, "/videos"), data: body, ...aiRequestConfig(config, "application/json", undefined, "video"), signal: options?.signal })).data);
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

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    if (config.channelMode === "remote") {
        return uploadReferenceMedia(dataUrlToFile({ ...image, dataUrl }));
    }
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    const file = new File([blob], video.name || "reference-video.mp4", { type: video.type || blob.type || "video/mp4" });
    return uploadReferenceMedia(file);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    const file = new File([blob], audio.name || "reference-audio.mp3", { type: audio.type || blob.type || "audio/mpeg" });
    return uploadReferenceMedia(file);
}

async function uploadReferenceMedia(file: File) {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("使用本地参考素材需要先登录，并在服务端配置 PUBLIC_BASE_URL");
    const body = new FormData();
    body.append("file", file, file.name);
    const response = await axios.post<ApiEnvelope<ReferenceMediaUploadResponse>>("/api/v1/media/references", body, { headers: { Authorization: `Bearer ${token}` } });
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
