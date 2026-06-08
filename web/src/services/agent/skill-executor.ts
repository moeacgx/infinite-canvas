import type { AiConfig } from "@/stores/use-config-store";
import { requestGeneration } from "@/services/api/image";
import { requestVideoGeneration, type VideoGenerationResult } from "@/services/api/video";
import { requestAudioGeneration } from "@/services/api/audio";

export type SkillResult = {
    type: "image" | "video" | "audio" | "error";
    images?: Array<{ id: string; dataUrl: string }>;
    video?: VideoGenerationResult;
    audioUrl?: string;
    error?: string;
};

/**
 * Execute a skill call, routing to the appropriate generation API.
 * Overrides model/size/quality in config based on skill args.
 */
export async function executeSkill(config: AiConfig, skillName: string, args: Record<string, unknown>): Promise<SkillResult> {
    try {
        switch (skillName) {
            case "generate_image": {
                const prompt = String(args.prompt || "");
                const overrides: Partial<AiConfig> = {};
                if (args.model) overrides.imageModel = String(args.model);
                if (args.size) overrides.size = String(args.size);
                if (args.quality) overrides.quality = String(args.quality);
                if (args.count) overrides.count = String(args.count);
                const effectiveConfig = { ...config, ...overrides };
                const images = await requestGeneration(effectiveConfig, prompt);
                return { type: "image", images };
            }
            case "generate_video": {
                const prompt = String(args.prompt || "");
                const overrides: Partial<AiConfig> = {};
                if (args.model) overrides.videoModel = String(args.model);
                const effectiveConfig = { ...config, ...overrides };
                const video = await requestVideoGeneration(effectiveConfig, prompt);
                return { type: "video", video };
            }
            case "generate_audio": {
                const text = String(args.text || "");
                const overrides: Partial<AiConfig> = {};
                if (args.model) overrides.audioModel = String(args.model);
                if (args.voice) overrides.audioVoice = String(args.voice);
                const effectiveConfig = { ...config, ...overrides };
                const blob = await requestAudioGeneration(effectiveConfig, text);
                const audioUrl = URL.createObjectURL(blob);
                return { type: "audio", audioUrl };
            }
            default:
                return { type: "error", error: `未知技能: ${skillName}` };
        }
    } catch (error) {
        return { type: "error", error: error instanceof Error ? error.message : "技能执行失败" };
    }
}
