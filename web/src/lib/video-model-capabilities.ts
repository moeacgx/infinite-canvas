import { modelOptionName, resolveCapabilityModel, type AiConfig } from "@/stores/use-config-store";

const DEFAULT_VIDEO_MAX_SECONDS = 20;
const NEW_API_GROK_MAX_SECONDS = 15;
const NEW_API_GROK_VIDEO_MODELS = new Set(["grok-imagine-video", "grok-imagine-video-1.5"]);

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
