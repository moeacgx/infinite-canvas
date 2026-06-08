import { apiGet } from "@/services/api/request";
import type { AiConfig } from "@/stores/use-config-store";

export type SkillParameter = {
    name: string;
    type: string;
    description: string;
    enum?: string[];
    required: boolean;
};

export type Skill = {
    name: string;
    description: string;
    parameters: SkillParameter[];
};

export type SkillsResponse = {
    skills: Skill[];
    imageModels: string[];
    videoModels: string[];
    audioModels: string[];
    textModels: string[];
};

export async function fetchSkills(config: AiConfig): Promise<SkillsResponse> {
    if (config.channelMode === "remote") {
        return apiGet<SkillsResponse>("/api/skills");
    }
    // For local/newapi: build skills from config model lists
    return buildLocalSkills(config);
}

function buildLocalSkills(config: AiConfig): SkillsResponse {
    const skills: Skill[] = [];
    const imageModels = config.imageModels.length ? config.imageModels : config.models.filter((m) => /image|seedream/i.test(m));
    const videoModels = config.videoModels.length ? config.videoModels : config.models.filter((m) => /video|seedance/i.test(m));
    const audioModels = config.audioModels.length ? config.audioModels : config.models.filter((m) => /tts|audio|speech/i.test(m));
    const textModels = config.textModels.length
        ? config.textModels
        : config.models.filter((m) => !imageModels.includes(m) && !videoModels.includes(m) && !audioModels.includes(m));

    if (imageModels.length) {
        skills.push({
            name: "generate_image",
            description: "根据文字描述生成图片。当用户想要创建、绘制、设计图片时调用此技能。",
            parameters: [
                { name: "prompt", type: "string", description: "详细的图片描述提示词，英文效果更佳", required: true },
                { name: "model", type: "string", description: "图片生成模型", enum: imageModels, required: false },
                { name: "size", type: "string", description: "图片尺寸", enum: ["1024x1024", "1536x1024", "1024x1536", "auto"], required: false },
                { name: "quality", type: "string", description: "图片质量", enum: ["low", "medium", "high"], required: false },
                { name: "count", type: "integer", description: "生成数量，1-4张", required: false },
            ],
        });
    }
    if (videoModels.length) {
        skills.push({
            name: "generate_video",
            description: "根据文字描述生成视频。当用户想要创建视频、动画时调用此技能。",
            parameters: [
                { name: "prompt", type: "string", description: "详细的视频描述提示词", required: true },
                { name: "model", type: "string", description: "视频生成模型", enum: videoModels, required: false },
            ],
        });
    }
    if (audioModels.length) {
        skills.push({
            name: "generate_audio",
            description: "根据文字内容生成语音朗读。当用户想要文字转语音时调用此技能。",
            parameters: [
                { name: "text", type: "string", description: "需要朗读的文字内容", required: true },
                { name: "model", type: "string", description: "语音模型", enum: audioModels, required: false },
                {
                    name: "voice",
                    type: "string",
                    description: "语音角色",
                    enum: ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"],
                    required: false,
                },
            ],
        });
    }
    return { skills, imageModels, videoModels, audioModels, textModels };
}
