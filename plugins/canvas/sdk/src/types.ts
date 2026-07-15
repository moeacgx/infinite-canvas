// Infinite Canvas 插件公共契约类型。
//
// 这是插件作者面向的「公开接口」子集,自包含、不依赖宿主 `@/` 内部模块,
// 因此可以被独立构建的插件包直接 import,获得完整的 TS 提示。
//
// 真源:宿主 `web/src/types/canvas-plugin.ts` 及其引用的类型。本文件是它的公开镜像,
// 若宿主契约变更,请同步更新此处(两者结构保持一致即可,无需逐字节相同)。

import type { ComponentType, ReactNode } from "react";

// ---------------------------------------------------------------------------
// 画布基础几何与节点数据
// ---------------------------------------------------------------------------

export type Position = { x: number; y: number };

export type ViewportTransform = { x: number; y: number; k: number };

// 内置节点类型;插件节点建议用 "<pluginId>:<name>"。放开为字符串以便扩展。
export type CanvasBuiltinNodeType = "image" | "text" | "config" | "video" | "audio" | "group";
export type CanvasNodeTypeId = CanvasBuiltinNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

// 节点 metadata 是扁平可选字段袋;插件自定义字段可直接写入(内容惯例放 content)。
export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    // 插件可写入任意自定义字段
    [key: string]: unknown;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

// ---------------------------------------------------------------------------
// 主题 token(用来让插件 UI 跟随画布明暗主题)
// ---------------------------------------------------------------------------

export type CanvasTheme = {
    canvas: {
        background: string;
        dot: string;
        line: string;
        selectionStroke: string;
        selectionFill: string;
    };
    node: {
        label: string;
        fill: string;
        panel: string;
        stroke: string;
        activeStroke: string;
        placeholder: string;
        text: string;
        muted: string;
        faint: string;
    };
    toolbar: {
        panel: string;
        border: string;
        item: string;
        itemHover: string;
        activeBg: string;
        activeText: string;
    };
};

// ---------------------------------------------------------------------------
// 画布指令集(ctx.applyOps):与 AI Agent 同级的画布操作能力
// ---------------------------------------------------------------------------

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: CanvasGenerationMode; prompt?: string };

// ---------------------------------------------------------------------------
// 资源:插件节点作为上游输入被消费时输出什么(接入生成/引用体系)
// ---------------------------------------------------------------------------

export type CanvasResourceKind = "image" | "video" | "audio" | "text";
export type CanvasNodeResource = { kind: CanvasResourceKind; text?: string; url?: string };

// ---------------------------------------------------------------------------
// 节点上下文:每个节点渲染时注入,是插件与画布交互的核心接口
// ---------------------------------------------------------------------------

export type PluginStorage = {
    get: <T = unknown>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
};

export type CanvasNodeContext = {
    // 自身数据
    node: CanvasNodeData;
    theme: CanvasTheme;
    scale: number;
    isSelected: boolean; // 该节点当前是否被选中(用于按需启用 iframe 交互等)
    updateMetadata: (patch: CanvasNodeMetadata) => void;
    updateNode: (patch: Partial<Pick<CanvasNodeData, "title" | "width" | "height">>) => void;
    // 图访问
    getNode: (id: string) => CanvasNodeData | null;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    getUpstream: () => CanvasNodeData[];
    getDownstream: () => CanvasNodeData[];
    // 画布操作(复用 Agent 指令集)
    applyOps: (ops: CanvasAgentOp[]) => void;
    // 节点间/插件间通信
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // 插件私有持久化,按插件 id 命名空间隔离
    storage: PluginStorage;
};

// ---------------------------------------------------------------------------
// 节点定义:内置节点与插件节点统一走这套结构
// ---------------------------------------------------------------------------

export type CanvasNodeToolbarItem = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
};

export type CanvasNodeContentProps = { ctx: CanvasNodeContext };
export type CanvasNodePanelProps = { ctx: CanvasNodeContext; onClose: () => void };

export type CanvasNodeDefinition = {
    type: string; // 建议 "<pluginId>:<name>",全局唯一
    title: string;
    icon: ReactNode; // emoji 字符串或任意 ReactNode
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean; // 默认 true
    hasSourceHandle?: boolean; // 右侧输出连接点,默认 true
    hidePanel?: boolean; // 为 true 时:点击/新建不弹出下方面板(含内置生图面板),纯展示型节点用
    autoOpenPanel?: boolean; // 为 true 时:单击节点自动打开自定义 Panel(默认仅内置节点单击自动打开)
    keepAspectRatio?: (node: CanvasNodeData) => boolean;
    resource?: (node: CanvasNodeData) => CanvasNodeResource | null;
    // 渲染
    Content?: ComponentType<CanvasNodeContentProps>;
    Panel?: ComponentType<CanvasNodePanelProps>; // 节点下方面板
    toolbar?: (ctx: CanvasNodeContext) => CanvasNodeToolbarItem[];
    onDoubleClick?: (ctx: CanvasNodeContext) => boolean; // 返回 true 表示已处理
};

// ---------------------------------------------------------------------------
// 插件运行时与插件包
// ---------------------------------------------------------------------------

// 插件启动时(setup)可访问的应用能力
export type CanvasPluginApp = {
    version: string;
    emit: (event: string, payload?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    // 注入插件样式,返回移除函数;传 key 时同 key 覆盖旧样式
    injectCSS: (css: string, key?: string) => () => void;
};

// 宿主注入的运行时(工厂形式插件的入参),内含宿主 React 实例避免双 React
export type PluginRuntime = CanvasPluginApp & {
    React: typeof import("react");
    jsx: typeof import("react").createElement;
    Fragment: typeof import("react").Fragment;
};

// 插件包(默认导出对象,或返回它的工厂函数)
export type CanvasPlugin = {
    id: string; // 唯一,kebab-case
    name: string;
    version: string;
    description?: string;
    minAppVersion?: string;
    css?: string; // 插件样式,启用时自动注入、卸载/禁用时自动清理
    nodes: CanvasNodeDefinition[];
    setup?: (app: CanvasPluginApp) => void | (() => void);
};

export type CanvasPluginFactory = (runtime: PluginRuntime) => CanvasPlugin;
