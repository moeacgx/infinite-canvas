export type ImageQualityValue = "auto" | "high" | "medium" | "low";
export type ImageSizeOption = {
    value: string;
    label: string;
    width: number;
    height: number;
    icon: "square" | "landscape" | "portrait" | "auto";
};

type ImageSizeLimit = {
    maxEdge?: number;
    maxShortEdge?: number;
    maxPixels?: number;
    sizeStep?: number;
};

type ImageModelCapability = ImageSizeLimit & {
    qualities?: ImageQualityValue[];
    transparentBackground?: boolean;
    hint: string;
};

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const ENTERPRISE_IMAGE_QUALITIES: ImageQualityValue[] = ["auto", "high", "medium", "low"];

const GPT_IMAGE_1_ENTERPRISE_MAX_EDGE = 1536;
const GPT_IMAGE_2_ENTERPRISE_MAX_EDGE = 3840;
const GPT_IMAGE_2_ENTERPRISE_MAX_SHORT_EDGE = 2160;
const BANANA_IMAGE_MAX_EDGE = 4096;
const BANANA_IMAGE_CAPABILITY: ImageModelCapability = {
    maxEdge: BANANA_IMAGE_MAX_EDGE,
    maxShortEdge: BANANA_IMAGE_MAX_EDGE,
    maxPixels: BANANA_IMAGE_MAX_EDGE * BANANA_IMAGE_MAX_EDGE,
    sizeStep: 1,
    hint: "Banana 图片模型支持 4096×4096 以内的自定义尺寸。",
};

const IMAGE_MODEL_CAPABILITIES: Record<string, ImageModelCapability> = {
    "gpt-image-1-enterprise": {
        maxEdge: GPT_IMAGE_1_ENTERPRISE_MAX_EDGE,
        qualities: ENTERPRISE_IMAGE_QUALITIES,
        hint: "gpt-image-1-enterprise 支持最长边不超过 1536px 的自定义尺寸，宽高需为 16 的倍数；质量档位 auto、low、medium、high。",
    },
    "gpt-image-1.5-enterprise": {
        maxEdge: GPT_IMAGE_1_ENTERPRISE_MAX_EDGE,
        qualities: ENTERPRISE_IMAGE_QUALITIES,
        hint: "gpt-image-1.5-enterprise 支持最长边不超过 1536px 的自定义尺寸，宽高需为 16 的倍数；质量档位 auto、low、medium、high。",
    },
    "gpt-image-2-enterprise": {
        maxEdge: GPT_IMAGE_2_ENTERPRISE_MAX_EDGE,
        qualities: ENTERPRISE_IMAGE_QUALITIES,
        maxShortEdge: GPT_IMAGE_2_ENTERPRISE_MAX_SHORT_EDGE,
        maxPixels: IMAGE_MAX_PIXELS,
        hint: "gpt-image-2-enterprise 支持 3840×2160 以内的自定义尺寸（长边不超过 3840px，短边不超过 2160px），宽高需为 16 的倍数；质量档位 auto、low、medium、high。",
    },
    "gpt-image-2-4k": {
        maxEdge: GPT_IMAGE_2_ENTERPRISE_MAX_EDGE,
        maxShortEdge: GPT_IMAGE_2_ENTERPRISE_MAX_SHORT_EDGE,
        maxPixels: IMAGE_MAX_PIXELS,
        qualities: ENTERPRISE_IMAGE_QUALITIES,
        hint: "gpt-image-2-4K 支持 3840×2160 以内的自定义尺寸（长边不超过 3840px，短边不超过 2160px），宽高需为 16 的倍数；质量档位 auto、low、medium、high。",
    },
};

export const imageQualityOptions: Array<{ value: ImageQualityValue; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];

export const imageSizeOptions: ImageSizeOption[] = [
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1024, height: 768, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 768, height: 1024, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1920, height: 1080, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1080, height: 1920, icon: "portrait" },
    { value: "21:9", label: "21:9", width: 1568, height: 672, icon: "landscape" },
    { value: "1024x1024", label: "1:1 1024", width: 1024, height: 1024, icon: "square" },
    { value: "1024x1536", label: "2:3 1536", width: 1024, height: 1536, icon: "portrait" },
    { value: "1536x1024", label: "3:2 1536", width: 1536, height: 1024, icon: "landscape" },
    { value: "2048x2048", label: "1:1(2k)", width: 2048, height: 2048, icon: "square" },
    { value: "2048x1152", label: "16:9(2k)", width: 2048, height: 1152, icon: "landscape" },
    { value: "1152x2048", label: "9:16(2k)", width: 1152, height: 2048, icon: "portrait" },
    { value: "2560x1440", label: "16:9(2.5k)", width: 2560, height: 1440, icon: "landscape" },
    { value: "1440x2560", label: "9:16(2.5k)", width: 1440, height: 2560, icon: "portrait" },
    { value: "3136x1344", label: "21:9(2k)", width: 3136, height: 1344, icon: "landscape" },
    { value: "3840x2160", label: "16:9(4k)", width: 3840, height: 2160, icon: "landscape" },
    { value: "2160x3840", label: "9:16(4k)", width: 2160, height: 3840, icon: "portrait" },
    { value: "3808x1632", label: "21:9(4k)", width: 3808, height: 1632, icon: "landscape" },
    { value: "4096x4096", label: "1:1(4k)", width: 4096, height: 4096, icon: "square" },
];

export function imageModelCapabilityHint(model: string) {
    return imageModelCapability(model)?.hint || "";
}

export function normalizeImageQuality(quality: string | undefined) {
    const value = (quality || "").trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

export function normalizeImageBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

export function resolveImageRequestSize(quality: string | undefined, size: string | undefined, limit?: ImageSizeLimit) {
    const value = (size || "").trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateGenericImageSize(dimensions.width, dimensions.height, limit);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveRatioSize(quality, value, limit);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

export function resolveImageModelRequestSize(model: string, quality: string | undefined, size: string | undefined) {
    return resolveImageRequestSize(quality, size, imageModelCapability(model));
}

export function validateImageConfigParameters(config: { model?: string; imageModel?: string; quality?: string; size?: string; background?: string }, model = imageConfigModel(config)) {
    let size: string | undefined;
    const quality = normalizeImageQuality(config.quality);
    try {
        size = resolveImageModelRequestSize(model, quality, config.size || "auto");
    } catch (error) {
        return error instanceof Error ? error.message : "图像尺寸不支持";
    }
    return validateImageModelParameters(model, { size: size || "auto", quality: (quality || "auto") as ImageQualityValue, background: normalizeImageBackground(config.background) });
}

export function validateImageModelParameters(model: string, params: { size?: string; quality?: ImageQualityValue | string; background?: string }) {
    const capability = imageModelCapability(model);
    if (!capability) return "";
    const modelName = imageModelName(model);
    const size = params.size || "auto";
    const dimensions = size === "auto" ? null : parseImageDimensions(size);
    if (dimensions && capability.maxEdge && Math.max(dimensions.width, dimensions.height) > capability.maxEdge) return `${modelName} 图像尺寸最长边不能超过 ${capability.maxEdge}px，请调整尺寸。`;
    const quality = (params.quality || "auto") as ImageQualityValue;
    if (capability.qualities && !capability.qualities.includes(quality)) return `${modelName} 不支持质量档位 ${quality}，请选择 ${capability.qualities.join("、")}，或切换模型。`;
    if (params.background === "transparent" && capability.transparentBackground === false) return `${modelName} 不支持透明背景，请关闭透明背景或切换模型。`;
    return "";
}

export function isImageSizeSupported(model: string, size: string, quality: string | undefined) {
    const normalizedQuality = normalizeImageQuality(quality);
    try {
        const requestSize = resolveImageModelRequestSize(model, normalizedQuality, size);
        return !validateImageModelParameters(model, { size: requestSize || "auto", quality: (normalizedQuality || "auto") as ImageQualityValue });
    } catch {
        return false;
    }
}

export function imageSizeUnsupportedReason(model: string, size: string, quality: string | undefined) {
    const normalizedQuality = normalizeImageQuality(quality);
    try {
        const requestSize = resolveImageModelRequestSize(model, normalizedQuality, size);
        return validateImageModelParameters(model, { size: requestSize || "auto", quality: (normalizedQuality || "auto") as ImageQualityValue });
    } catch (error) {
        return error instanceof Error ? error.message : "图像尺寸不支持";
    }
}

export function isImageQualitySupported(model: string, quality: string) {
    const capability = imageModelCapability(model);
    if (!capability?.qualities) return true;
    return capability.qualities.includes((normalizeImageQuality(quality) || "auto") as ImageQualityValue);
}

export function imageSizeLabel(size: string) {
    return imageSizeOptions.find((item) => item.value === size)?.label || size;
}

export function supportedImageSizeOptions(model: string, quality: string | undefined) {
    return imageSizeOptions.filter((item) => isImageSizeSupported(model, item.value, quality));
}
function imageModelCapability(model: string) {
    const normalized = normalizeImageModelName(model);
    return IMAGE_MODEL_CAPABILITIES[normalized] || (isBananaImageModelName(normalized) ? BANANA_IMAGE_CAPABILITY : undefined);
}

function imageConfigModel(config: { model?: string; imageModel?: string }) {
    return config.model || config.imageModel || "";
}

function imageModelName(model: string) {
    const value = model.trim();
    const separatorIndex = value.indexOf("::");
    return separatorIndex >= 0 ? value.slice(separatorIndex + 2) : value;
}

function normalizeImageModelName(model: string) {
    return imageModelName(model).toLowerCase();
}

function isBananaImageModelName(model: string) {
    return model.includes("banana") || model.includes("gemini-3.1-flash-image") || model.includes("gemini-3-pro-image");
}

function resolveRatioSize(quality: string | undefined, ratio: string, limit?: ImageSizeLimit): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const exactSize = resolveExactRatioSize(parsedRatio.width, parsedRatio.height, basePixels, limit);
    if (exactSize) return exactSize;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateGenericImageSize(width, height, limit);
    return `${width}x${height}`;
}

function resolveExactRatioSize(widthRatio: number, heightRatio: number, basePixels?: number, limit?: ImageSizeLimit) {
    const reduced = reduceImageRatio(widthRatio, heightRatio);
    if (Math.max(reduced.width, reduced.height) > 32) return undefined;

    const ratioPixels = reduced.width * reduced.height;
    const desiredUnit = basePixels ? Math.sqrt((basePixels * basePixels) / ratioPixels) : DEFAULT_IMAGE_SHORT_SIDE / Math.min(reduced.width, reduced.height);
    const minimumUnit = Math.ceil(Math.sqrt(IMAGE_MIN_PIXELS / ratioPixels) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const maxPixels = limit?.maxPixels || IMAGE_MAX_PIXELS;
    const maximumUnitByPixels = Math.floor(Math.sqrt(maxPixels / ratioPixels) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const maximumEdge = limit?.maxEdge || IMAGE_MAX_EDGE;
    const maximumUnitByEdge = Math.floor(maximumEdge / Math.max(reduced.width, reduced.height) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    const maximumShortEdge = limit?.maxShortEdge;
    const maximumUnitByShortEdge = maximumShortEdge ? Math.floor(maximumShortEdge / Math.min(reduced.width, reduced.height) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP : maximumUnitByEdge;
    const maximumUnit = Math.min(maximumUnitByPixels, maximumUnitByEdge, maximumUnitByShortEdge);
    if (minimumUnit > maximumUnit || maximumUnit < IMAGE_SIZE_STEP) return undefined;

    const unit = Math.min(maximumUnit, Math.max(minimumUnit, Math.round(desiredUnit / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP));
    const width = reduced.width * unit;
    const height = reduced.height * unit;
    validateGenericImageSize(width, height, limit);
    return `${width}x${height}`;
}

function reduceImageRatio(width: number, height: number) {
    let scale = 1;
    while (scale < 1000 && (!Number.isInteger(width * scale) || !Number.isInteger(height * scale))) scale *= 10;
    let scaledWidth = Math.round(width * scale);
    let scaledHeight = Math.round(height * scale);
    const divisor = greatestCommonDivisor(scaledWidth, scaledHeight);
    scaledWidth /= divisor;
    scaledHeight /= divisor;
    return { width: scaledWidth, height: scaledHeight };
}

function reduceImageRatioObject(value: { width: number; height: number }) {
    return reduceImageRatio(value.width, value.height);
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }
    return a || 1;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateGenericImageSize(width: number, height: number, limit?: ImageSizeLimit) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    const sizeStep = limit?.sizeStep || IMAGE_SIZE_STEP;
    if (sizeStep > 1 && (width % sizeStep !== 0 || height % sizeStep !== 0)) throw new Error(`图像尺寸的宽高必须是 ${sizeStep} 的倍数，请调整尺寸`);
    const maxEdge = limit?.maxEdge || IMAGE_MAX_EDGE;
    if (Math.max(width, height) > maxEdge) throw new Error(`图像尺寸最长边不能超过 ${maxEdge}px，请调整尺寸`);
    if (limit?.maxShortEdge && Math.min(width, height) > limit.maxShortEdge) throw new Error(`图像尺寸短边不能超过 ${limit.maxShortEdge}px，请调整尺寸`);
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    const maxPixels = limit?.maxPixels || IMAGE_MAX_PIXELS;
    if (pixels < IMAGE_MIN_PIXELS || pixels > maxPixels) throw new Error(`图像总像素需在 655360 到 ${maxPixels} 之间，请调整尺寸`);
}
