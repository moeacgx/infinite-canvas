import { createPluginStorage, emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { getNodePluginId } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/app/(user)/canvas/types";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";

export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false): CanvasNodeContext {
    return {
        node,
        theme,
        scale,
        isSelected,
        updateMetadata: (patch) => host.updateMetadata(node.id, patch),
        updateNode: (patch) => host.updateNode(node.id, patch),
        getNode: host.getNode,
        getNodes: host.getNodes,
        getConnections: host.getConnections,
        getUpstream: () => host.getUpstream(node.id),
        getDownstream: () => host.getDownstream(node.id),
        applyOps: host.applyOps,
        emit: emitCanvasEvent,
        on: onCanvasEvent,
        ai: host.ai,
        openPanel: () => host.openPanel(node.id),
        closePanel: () => host.closePanel(),
        storage: createPluginStorage(getNodePluginId(node.type)),
    };
}
