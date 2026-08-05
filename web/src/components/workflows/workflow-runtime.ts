import { decodeChannelModel, normalizeLocalChannels, resolveCapabilityModel, type AiConfig, type ImageApiMode } from "@/stores/use-config-store";

export type WorkflowGenerationConfig = Pick<AiConfig, "model" | "imageModel" | "imageChannelId" | "quality" | "size" | "count" | "background" | "timeout" | "streamImages" | "streamPartialImages" | "responseFormatB64Json" | "codexCli"> & {
    apiMode: ImageApiMode;
    systemPrompt: string;
    promptTemplate: string;
    negativePrompt: string;
};

export type WorkflowImageRuntime = {
    model: string;
    apiMode: ImageApiMode;
    channelId: string;
};

export function resolveWorkflowRuntime(workflow: { config: WorkflowGenerationConfig }, baseConfig: AiConfig): WorkflowImageRuntime {
    const savedModel = workflow.config.imageModel || workflow.config.model;
    const preferredModel = resolveSavedWorkflowModel(baseConfig, savedModel, workflow.config.imageChannelId);
    const model = resolveCapabilityModel(baseConfig, "image", preferredModel);
    return {
        model,
        apiMode: normalizeApiMode(workflow.config.apiMode || baseConfig.apiMode),
        channelId: resolveWorkflowImageChannelId(baseConfig, model, workflow.config.imageChannelId, baseConfig.imageChannelId, baseConfig.activeChannelId),
    };
}

export function resolveWorkflowImageChannelId(config: AiConfig, model: string, ...preferredIds: Array<string | undefined>) {
    if (config.channelMode === "newapi") return "";
    const decoded = decodeChannelModel(model);
    const modelName = decoded?.model || model;
    const channels = config.channelMode === "remote" ? config.publicChannels.map((channel) => ({ id: channel.id || "", models: channel.models || [] })) : normalizeLocalChannels(config).map((channel) => ({ id: channel.id, models: channel.models }));

    if (decoded?.channelId && channels.some((channel) => channel.id === decoded.channelId && channel.models.includes(modelName))) return decoded.channelId;
    for (const id of preferredIds) {
        const channelId = (id || "").trim();
        if (channelId && channels.some((channel) => channel.id === channelId && channel.models.includes(modelName))) return channelId;
    }
    return channels.find((channel) => channel.models.includes(modelName))?.id || "";
}

export function buildWorkflowRunConfig(baseConfig: AiConfig, workflowConfig: WorkflowGenerationConfig, runtime: WorkflowImageRuntime): AiConfig {
    const channels =
        baseConfig.channelMode === "local" && runtime.channelId
            ? baseConfig.channels.map((channel) =>
                  channel.id === runtime.channelId
                      ? {
                            ...channel,
                            imageApiMode: runtime.apiMode,
                            streamImages: enabled(workflowConfig.streamImages),
                            streamPartialImages: boundedPartialImages(workflowConfig.streamPartialImages),
                            responseFormatB64Json: enabled(workflowConfig.responseFormatB64Json),
                        }
                      : channel,
              )
            : baseConfig.channels;

    return {
        ...baseConfig,
        ...workflowConfig,
        channels,
        model: runtime.model,
        imageModel: runtime.model,
        imageChannelId: runtime.channelId,
        activeChannelId: runtime.channelId,
        apiMode: runtime.apiMode,
        systemPrompt: workflowConfig.systemPrompt || baseConfig.systemPrompts.workflow || baseConfig.systemPrompt,
        count: workflowConfig.count || "1",
    };
}

function resolveSavedWorkflowModel(config: AiConfig, savedModel: string, channelId?: string) {
    const value = savedModel.trim();
    if (!value || config.channelMode !== "local" || decodeChannelModel(value)) return value;

    const matchingEncodedModel = config.imageModels.find((candidate) => {
        const decoded = decodeChannelModel(candidate);
        return decoded?.model === value && (!channelId || decoded.channelId === channelId);
    });
    return matchingEncodedModel || value;
}

function enabled(value: string) {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeApiMode(value: string): ImageApiMode {
    return value === "responses" ? "responses" : "images";
}

function boundedPartialImages(value: string) {
    return Math.max(1, Math.min(3, Math.floor(Number(value) || 1)));
}
