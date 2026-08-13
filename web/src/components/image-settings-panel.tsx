"use client";

import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

import { hasImageModelSizeList, imageModelCapabilityHint, imageQualityOptions, imageSizeLabel, imageSizeOptions, imageSizeUnsupportedReason, isImageQualitySupported, isImageSizeSupported } from "@/lib/image-model-capabilities";

const DIMENSION_STEP = 16;

const aspectOptions = imageSizeOptions;
const qualityOptions = imageQualityOptions;


type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    model?: string;
    showTitle?: boolean;
    showCount?: boolean;
    showSize?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, model: modelOverride, showTitle = true, showSize = true, showCount = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const model = modelOverride || config.imageModel || config.model;
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedAspect = aspectOptions.find((item) => item.value === activeSize) || aspectOptions.find((item) => imageSizeLabel(activeSize) === item.label);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);
    const capabilityHint = imageModelCapabilityHint(model);
    const fixedSizeOptionsOnly = hasImageModelSizeList(model);
    const selectAspect = (value: string) => {
        const option = aspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.value || "auto");
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => {
                            const disabled = !isImageQualitySupported(model, item.value);
                            return (
                                <OptionPill key={item.value} selected={quality === item.value} disabled={disabled} title={disabled ? `${model} 不支持质量 ${item.value}` : undefined} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                </div>
                {showSize ? (
                    <>
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between gap-3">
                                <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                        16倍数对齐
                                    </span>
                                    <span title={fixedSizeOptionsOnly ? "当前模型只支持固定尺寸列表" : "输入完成后自动向上补成 16 的倍数"} onMouseDown={(event) => event.stopPropagation()}>
                                        <Switch size="small" checked={snapDimensionToStep} disabled={fixedSizeOptionsOnly} onChange={setSnapDimensionToStep} />
                                    </span>
                                </div>
                            </div>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto" || fixedSizeOptionsOnly} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto" || fixedSizeOptionsOnly} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            <SettingTitle color={theme.node.muted}>尺寸预设</SettingTitle>
                            <div className="grid grid-cols-4 gap-2.5">
                                {aspectOptions.map((item) => {
                                    const disabled = !isImageSizeSupported(model, item.value, quality);
                                    const reason = disabled ? imageSizeUnsupportedReason(model, item.value, quality) : "";
                                    return (
                                        <button
                                            key={item.value}
                                            type="button"
                                            disabled={disabled}
                                            title={reason || undefined}
                                            className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:opacity-35"
                                            style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onClick={() => !disabled && selectAspect(item.value)}
                                        >
                                            <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                            <span>{item.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {capabilityHint ? (
                                <div className="text-xs leading-5" style={{ color: theme.node.muted, opacity: 0.78 }}>
                                    {capabilityHint}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            开启后生成无背景的透明图像(仅部分模型可用)
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                    </span>
                </div>
                {showCount ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                        <div className="grid grid-cols-4 gap-2.5">
                            {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {value} 张
                                </OptionPill>
                            ))}
                            <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export { imageSizeLabel };

export function imageQualityLabel(value: string) {
    return imageQualityOptions.find((item) => item.value === value)?.label || value;
}

export function imageFormatLabel(format: string) {
    const labels: Record<string, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP" };
    return labels[format] || format;
}

function OptionPill({ selected, disabled, title, theme, onClick, children }: { selected: boolean; disabled?: boolean; title?: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={title}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => !disabled && onClick()}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
