import type { ComponentType, ReactNode } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasAgentOp } from "@/app/(user)/canvas/utils/canvas-agent-ops";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/app/(user)/canvas/types";

export type CanvasNodeResource = { kind: "text" | "image" | "video" | "audio"; text?: string; url?: string };

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
};

export type CanvasNodeDefinition = {
    type: string;
    title: string;
    icon: ReactNode;
    description?: string;
    defaultSize: { width: number; height: number };
    defaultMetadata?: CanvasNodeMetadata;
    minimapColor?: string;
    showInCreateMenu?: boolean;
    hasSourceHandle?: boolean;
    hidePanel?: boolean;
    autoOpenPanel?: boolean;
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
