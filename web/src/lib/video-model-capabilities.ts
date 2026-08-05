import { modelOptionName, resolveCapabilityModel, type AiConfig } from "@/stores/use-config-store";

const DEFAULT_VIDEO_MAX_SECONDS = 20;
const NEW_API_GROK_MAX_SECONDS = 15;
const NEW_API_GROK_VIDEO_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5"]);

export function modelKey(modelName: string) {
    return modelOptionName(modelName)
        .trim()
        .toLowerCase()
        .replace(/[._/]+/g, "-");
}

export function supportsVideoFrameReferences(modelName: string) {
    const model = modelKey(modelName);
    return (
        model.includes("seedance") ||
        model.includes("image-to-video") ||
        model.includes("hailuo") ||
        model.includes("kling") ||
        model.includes("veo") ||
        model.includes("skyreels") ||
        model.includes("pixverse") ||
        model.includes("vidu") ||
        model.includes("happyhorse")
    );
}

export function supportsVideoAudioGeneration(modelName: string) {
    const model = modelKey(modelName);
    if (model.includes("motion-control")) return false;
    return (
        model === "kling-2-6-text-to-video" ||
        model === "kling-2-6-image-to-video" ||
        model === "kling-text-to-video" ||
        model === "kling-image-to-video" ||
        model === "bytedance-seedance-2" ||
        model === "bytedance-seedance-2-fast" ||
        model === "bytedance-seedance-2-mini" ||
        model === "wan-2-6-flash-image-to-video" ||
        model === "wan-2-6-flash-video-to-video" ||
        model.includes("bytedance-seedance-1-5") ||
        model.includes("doubao-seedance-2-0") ||
        model.includes("doubao-seedance-1-5") ||
        (model.includes("veo") && model.includes("official")) ||
        model === "wan2-6" ||
        model === "wan2-6-i2v-flash" ||
        model.includes("kling-v2-6") ||
        model.includes("kling-2-6") ||
        ((model.includes("kling-v3") || model.includes("kling-3-0")) && !model.includes("turbo")) ||
        model.includes("pixverse-v6") ||
        model.includes("viduq3-pro") ||
        model.includes("vidu-q3-pro") ||
        model.includes("viduq3-turbo")
    );
}

export function resolveVideoModelName(config: AiConfig, selectedModel?: string) {
    const model = selectedModel?.trim() || resolveCapabilityModel(config, "video", config.videoModel || config.model);
    return modelOptionName(model).trim();
}

export function getVideoMaxSeconds(config: AiConfig, selectedModel?: string) {
    if (config.channelMode !== "newapi") return DEFAULT_VIDEO_MAX_SECONDS;
    const model = resolveVideoModelName(config, selectedModel).toLowerCase();
    return NEW_API_GROK_VIDEO_MODELS.has(model) ? NEW_API_GROK_MAX_SECONDS : DEFAULT_VIDEO_MAX_SECONDS;
}

export function assertVideoSecondsSupported(config: AiConfig, selectedModel?: string) {
    const maxSeconds = getVideoMaxSeconds(config, selectedModel);
    const seconds = Math.floor(Number(config.videoSeconds) || 6);
    if (seconds <= maxSeconds) return;
    const model = resolveVideoModelName(config, selectedModel);
    throw new Error(`New API 的 ${model} 模型最多支持 ${maxSeconds} 秒，请将视频时长调整为 ${maxSeconds} 秒以内`);
}
