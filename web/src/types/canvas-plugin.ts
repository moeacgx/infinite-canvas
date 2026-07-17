import type { ComponentType, ReactNode } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasAgentOp } from "@/app/(user)/canvas/utils/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/app/(user)/canvas/types";

export type CanvasNodeResource = { kind: "text" | "image" | "video" | "audio"; text?: string; url?: string };

// --- AI 生成能力(生图/生视频/生文本),由宿主注入,复用宿主模型/密钥配置 ---
export type GenerateOptions = { signal?: AbortSignal; references?: string[]; model?: string };
export type GenerateImageOptions = GenerateOptions & { count?: number; size?: string };
export type GenerateImageResult = { images: string[] };
export type GenerateVideoOptions = GenerateOptions & { size?: string; seconds?: string };
export type GenerateVideoResult = { url: string; mimeType: string; width?: number; height?: number; durationMs?: number };
export type GenerateTextOptions = { signal?: AbortSignal; model?: string; system?: string; onDelta?: (text: string) => void };
export type GenerateTextResult = { text: string };
export type PluginModelCapability = "image" | "video" | "text" | "audio";
export type ModelOption = { value: string; label: string };

export type CanvasPluginAi = {
    generateImage: (prompt: string, options?: GenerateImageOptions) => Promise<GenerateImageResult>;
    generateVideo: (prompt: string, options?: GenerateVideoOptions) => Promise<GenerateVideoResult>;
    generateText: (prompt: string, options?: GenerateTextOptions) => Promise<GenerateTextResult>;
    listModels: (capability?: PluginModelCapability) => ModelOption[];
    defaultModel: (capability: PluginModelCapability) => string;
};

// 节点自带的工具栏按钮(追加到 hover 工具栏尾部)
export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export type PluginStorage = {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

export type CanvasNodeContext = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean;
    updateMetadata: (patch: CanvasNodeMetadata) => void;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: () => CanvasNodeData[];
    getDownstream: () => CanvasNodeData[];
    applyOps: (ops: CanvasAgentOp[]) => void;
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    ai: CanvasPluginAi;
    openPanel: () => void;
    closePanel: () => void;
    storage: PluginStorage;
};

export type CanvasPluginHost = {
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: (nodeId: string) => CanvasNodeData[];
    getDownstream: (nodeId: string) => CanvasNodeData[];
    updateNode: (nodeId: string, patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    updateMetadata: (nodeId: string, patch: CanvasNodeMetadata) => void;
    applyOps: (ops: CanvasAgentOp[]) => void;
    // AI 生成能力,复用画布页面当前的模型/密钥配置
    ai: CanvasPluginAi;
    // 打开/关闭指定节点下方的自定义 Panel
    openPanel: (nodeId: string) => void;
    closePanel: () => void;
};

// 复用宿主内置生成面板的配置(见 SDK CanvasBuiltinPanelConfig)
export type CanvasBuiltinPanelConfig = {
    mode: "image" | "video" | "text" | "audio";
    promptPrefix?: string;
    writeBackToSelf?: boolean;
};

export type CanvasNodeDefinition = {
    type: string;
    title: string;
    icon: ReactNode;
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean; // 默认 true
    hasSourceHandle?: boolean; // 右侧输出连接点,默认 true
    hidePanel?: boolean; // 为 true 时:点击/新建不弹出下方面板(含内置生图面板),纯展示型节点用
    transparentBackground?: boolean; // 为 true 时:节点卡片背景与边框透明,内容直接融入画布(如 SVG/矢量图)
    autoOpenPanel?: boolean; // 为 true 时:单击节点自动打开自定义 Panel(默认仅内置节点单击自动打开)
    useBuiltinPanel?: CanvasBuiltinPanelConfig; // 复用宿主内置生成面板(与自定义 Panel 二选一)
    // 为 true 时:宿主自动提供「交互 ⇄ 移动」工具条开关,并按 metadata.interactive 控制内容层指针事件
    interactionToggle?: boolean;
    // 配合 interactionToggle:返回 true 表示内容强制可交互(如编辑态),忽略 interactive 并隐藏开关
    forceInteractive?: (node: CanvasNodeData) => boolean;
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    resource?: (node: CanvasNodeData) => CanvasNodeResource | null;
    Content?: ComponentType<{ ctx: CanvasNodeContext }>;
    Panel?: ComponentType<{ ctx: CanvasNodeContext; onClose: () => void }>;
    toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean;
};

export type CanvasPluginApp = {
    version: string;
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    injectCSS: (css: string, key?: string) => () => void;
};

export type CanvasPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    minAppVersion?: string;
    css?: string;
    nodes: CanvasNodeDefinition[];
    setup?: (app: CanvasPluginApp) => void | (() => void);
};
