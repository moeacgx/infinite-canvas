import { create } from "zustand";

import { CanvasNodeType } from "../../app/(user)/canvas/types";
import type { CanvasNodeDefinition } from "@/types/canvas-plugin";

const definitions = new Map<string, CanvasNodeDefinition>();
const ownerByType = new Map<string, string>();

export const useNodeRegistryVersion = create<{ version: number }>(() => ({ version: 0 }));

function bumpRegistryVersion() {
    useNodeRegistryVersion.setState((state) => ({ version: state.version + 1 }));
}

export function registerNodeDefinitions(definitionsToRegister: CanvasNodeDefinition[], pluginId = "builtin") {
    definitionsToRegister.forEach((definition) => {
        const owner = ownerByType.get(definition.type);
        if (owner && owner !== pluginId) throw new Error(`节点类型已由 ${owner} 注册：${definition.type}`);
        definitions.set(definition.type, definition);
        ownerByType.set(definition.type, pluginId);
    });
    bumpRegistryVersion();
}

export function unregisterPluginNodes(pluginId: string) {
    for (const [type, owner] of ownerByType) {
        if (owner !== pluginId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
    }
    bumpRegistryVersion();
}

export function getNodeDefinition(type: string) {
    return definitions.get(type);
}

export function getNodePluginId(type: string) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return Array.from(definitions.values());
}

export function isRegisteredNodeType(type: string) {
    return definitions.has(type);
}

export function isKnownNodeType(type: string) {
    return isBuiltinNodeType(type) || definitions.has(type);
}

export function getRegisteredNodeSpec(type: string) {
    const definition = definitions.get(type);
    if (!definition) return null;
    return { width: definition.defaultSize.width, height: definition.defaultSize.height, title: definition.title, metadata: definition.defaultMetadata };
}

export function isBuiltinNodeType(type: string) {
    return (Object.values(CanvasNodeType) as string[]).includes(type);
}
