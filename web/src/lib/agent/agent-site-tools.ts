import { fetchPrompts } from "@/services/api/prompts";
import { uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

export const SITE_TOOL_NAMES = ["canvas_list_projects", "workbench_image_get_config", "workbench_image_generate", "workbench_video_get_config", "workbench_video_generate", "prompts_search", "assets_list", "assets_add"] as const;

export type SiteToolName = (typeof SITE_TOOL_NAMES)[number];
type SiteToolInput = Record<string, unknown>;
type Navigate = (path: string) => void;

export const SITE_TOOL_LABELS: Record<SiteToolName, string> = {
    canvas_list_projects: "画布列表",
    workbench_image_get_config: "生图配置",
    workbench_image_generate: "生图工作台生成",
    workbench_video_get_config: "视频配置",
    workbench_video_generate: "视频创作台生成",
    prompts_search: "搜索提示词",
    assets_list: "素材列表",
    assets_add: "添加素材",
};

export function isSiteTool(name: string): name is SiteToolName {
    return (SITE_TOOL_NAMES as readonly string[]).includes(name);
}

export async function runSiteTool(name: SiteToolName, input: SiteToolInput, navigate: Navigate): Promise<unknown> {
    switch (name) {
        case "canvas_list_projects":
            return listCanvasProjects(input);
        case "workbench_image_get_config":
            return getImageConfig();
        case "workbench_image_generate":
            return runImageWorkbench(input, navigate);
        case "workbench_video_get_config":
            return getVideoConfig();
        case "workbench_video_generate":
            return runVideoWorkbench(input, navigate);
        case "prompts_search":
            return searchPrompts(input);
        case "assets_list":
            return listAssets(input);
        case "assets_add":
            return addAsset(input);
    }
}

export function normalizeSitePath(value: unknown) {
    const path = String(value || "/").trim() || "/";
    if (!/^\/(?:canvas(?:\/[A-Za-z0-9_-]+)?|image|video|prompts|assets|asset-library)?(?:\?[^#]*)?$/.test(path)) throw new Error("不允许跳转到站外地址");
    return path;
}

function listCanvasProjects(input: SiteToolInput) {
    const { projects, hydrated } = useCanvasStore.getState();
    if (!hydrated) throw new Error("画布还在加载中，请稍后重试");
    const keyword = String(input.keyword || "")
        .trim()
        .toLowerCase();
    const filtered = keyword ? projects.filter((project) => project.title.toLowerCase().includes(keyword)) : projects;
    const { page, pageSize, start, end } = paginate(input, filtered.length, 20);
    return {
        total: filtered.length,
        page,
        pageSize,
        items: filtered.slice(start, end).map((project) => ({ id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, nodeCount: project.nodes.length, connectionCount: project.connections.length })),
        hint: "用 site_navigate 跳转 /canvas/{id} 打开对应画布",
    };
}

function getImageConfig() {
    const { config } = useConfigStore.getState();
    const model = config.imageModel || config.model;
    return {
        current: { model, modelName: modelOptionName(model), quality: config.quality || "auto", size: config.size || "1:1", count: config.count || "1" },
        models: modelOptions(config, "image"),
        qualityOptions: ["auto", "high", "medium", "low"],
        sizeOptions: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840", "auto"],
        countRange: { min: 1, max: 10 },
    };
}

function runImageWorkbench(input: SiteToolInput, navigate: Navigate) {
    const store = useConfigStore.getState();
    const applied: Record<string, unknown> = {};
    applyModel(store.config, "image", input.model, (value) => store.updateConfig("imageModel", value), applied);
    applyString(input.quality, (value) => store.updateConfig("quality", value), "quality", applied);
    applyString(input.size, (value) => store.updateConfig("size", value), "size", applied);
    if (input.count != null) {
        const count = String(Math.max(1, Math.min(10, Math.floor(Number(input.count)) || 1)));
        store.updateConfig("count", count);
        applied.count = count;
    }
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    useWorkbenchAgentStore.getState().dispatchImage({ prompt, run });
    navigate("/image");
    return { ok: true, navigated: "/image", prompt, run, applied, note: run ? "已跳转生图工作台并触发生成" : "已跳转生图工作台并填入参数" };
}

function getVideoConfig() {
    const { config } = useConfigStore.getState();
    const model = config.videoModel || config.model;
    return {
        current: {
            model,
            modelName: modelOptionName(model),
            size: config.videoSize || "1280x720",
            seconds: config.videoSeconds || "6",
            resolution: config.vquality || "720",
            generateAudio: config.videoGenerateAudio !== "false",
            watermark: config.videoWatermark === "true",
        },
        models: modelOptions(config, "video"),
        sizeOptions: ["1280x720", "720x1280", "1024x1024", "1792x1024", "1024x1792", "16:9", "9:16", "1:1", "adaptive", "auto"],
        secondsOptions: ["6", "10", "12", "16", "20"],
        resolutionOptions: ["480", "720", "1080"],
    };
}

function runVideoWorkbench(input: SiteToolInput, navigate: Navigate) {
    const store = useConfigStore.getState();
    const applied: Record<string, unknown> = {};
    applyModel(store.config, "video", input.model, (value) => store.updateConfig("videoModel", value), applied);
    applyString(input.size, (value) => store.updateConfig("videoSize", value), "size", applied);
    applyString(input.seconds, (value) => store.updateConfig("videoSeconds", value), "seconds", applied);
    applyString(input.resolution, (value) => store.updateConfig("vquality", value), "resolution", applied);
    if (typeof input.generateAudio === "boolean") {
        store.updateConfig("videoGenerateAudio", String(input.generateAudio));
        applied.generateAudio = input.generateAudio;
    }
    if (typeof input.watermark === "boolean") {
        store.updateConfig("videoWatermark", String(input.watermark));
        applied.watermark = input.watermark;
    }
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const run = input.run !== false;
    useWorkbenchAgentStore.getState().dispatchVideo({ prompt, run });
    navigate("/video");
    return { ok: true, navigated: "/video", prompt, run, applied, note: run ? "已跳转视频创作台并触发生成" : "已跳转视频创作台并填入参数" };
}

async function searchPrompts(input: SiteToolInput) {
    const page = Math.max(1, Math.floor(Number(input.page)) || 1);
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input.pageSize)) || 20));
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const result = await fetchPrompts({ keyword: String(input.keyword || ""), category: String(input.category || "全部"), tag: tags, page, pageSize });
    return {
        total: result.total,
        page,
        pageSize,
        categories: result.categories,
        tags: result.tags.slice(0, 60),
        items: result.items.map((prompt) => ({ id: prompt.id, title: prompt.title, prompt: prompt.prompt, category: prompt.category, tags: prompt.tags, coverUrl: prompt.coverUrl, githubUrl: prompt.githubUrl })),
    };
}

function listAssets(input: SiteToolInput) {
    const { assets, hydrated } = useAssetStore.getState();
    if (!hydrated) throw new Error("素材还在加载中，请稍后重试");
    const kind = input.kind === "text" || input.kind === "image" || input.kind === "video" ? input.kind : "all";
    const keyword = String(input.keyword || "")
        .trim()
        .toLowerCase();
    const filtered = assets.filter((asset) => {
        if (kind !== "all" && asset.kind !== kind) return false;
        return !keyword || [asset.title, asset.note, asset.source, ...asset.tags].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
    const { page, pageSize, start, end } = paginate(input, filtered.length, 20);
    return {
        total: filtered.length,
        page,
        pageSize,
        items: filtered
            .slice(start, end)
            .map((asset) => ({
                id: asset.id,
                kind: asset.kind,
                title: asset.title,
                tags: asset.tags,
                source: asset.source,
                note: asset.note,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
                coverUrl: asset.coverUrl || undefined,
                content: asset.kind === "text" ? asset.data.content : undefined,
            })),
    };
}

async function addAsset(input: SiteToolInput) {
    const title = String(input.title || "").trim();
    if (!title) throw new Error("请提供素材标题 title");
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const source = typeof input.source === "string" ? input.source : "Agent";
    const note = typeof input.note === "string" ? input.note : undefined;
    const store = useAssetStore.getState();
    if (input.kind === "text") {
        const content = String(input.content || "").trim();
        if (!content) throw new Error("kind=text 时需要提供 content");
        return { ok: true, id: store.addAsset({ kind: "text", title, coverUrl: "", tags, source, note, data: { content } }), kind: "text" };
    }
    if (input.kind === "image") {
        const imageUrl = String(input.imageUrl || "").trim();
        if (!imageUrl) throw new Error("kind=image 时需要提供 imageUrl");
        let image;
        try {
            image = await uploadImage(imageUrl);
        } catch {
            throw new Error("无法读取该图片地址，请改用 dataURL 或允许跨域访问的链接");
        }
        return {
            ok: true,
            id: store.addAsset({ kind: "image", title, coverUrl: image.url, tags, source, note, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } }),
            kind: "image",
        };
    }
    throw new Error("assets_add 仅支持 kind=text 或 kind=image");
}

function modelOptions(config: AiConfig, capability: ModelCapability) {
    return selectableModelsByCapability(config, capability).map((value) => ({ value, label: modelOptionLabel(config, value) }));
}

function applyModel(config: AiConfig, capability: ModelCapability, input: unknown, apply: (value: string) => void, applied: Record<string, unknown>) {
    if (typeof input !== "string" || !input.trim()) return;
    const requested = input.trim();
    const options = selectableModelsByCapability(config, capability);
    const value = options.find((option) => option === requested) || options.find((option) => modelOptionName(option) === modelOptionName(requested)) || requested;
    apply(value);
    applied.model = value;
}

function applyString(input: unknown, apply: (value: string) => void, key: string, applied: Record<string, unknown>) {
    if (typeof input !== "string" || !input.trim()) return;
    apply(input.trim());
    applied[key] = input.trim();
}

function paginate(input: SiteToolInput, total: number, defaultSize: number) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize)) || defaultSize));
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(maxPage, Math.max(1, Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return { page, pageSize, start, end: start + pageSize };
}
