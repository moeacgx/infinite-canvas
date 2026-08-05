import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "../types";

export type CanvasNodeDeletionResult = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    deletedNodeIds: Set<string>;
};

export function deleteCanvasNodes(state: { nodes: CanvasNodeData[]; connections: CanvasConnection[] }, requestedNodeIds: Iterable<string>): CanvasNodeDeletionResult {
    const requestedIds = new Set(requestedNodeIds);
    if (!requestedIds.size) return { ...state, deletedNodeIds: new Set() };

    const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
    const deletedNodeIds = new Set([...requestedIds].filter((id) => nodeById.has(id)));
    if (!deletedNodeIds.size) return { ...state, deletedNodeIds };
    let changed = true;

    // 批次关系可能来自根节点列表或子节点反向引用，两边都纳入删除闭包。
    while (changed) {
        changed = false;
        state.nodes.forEach((node) => {
            if (deletedNodeIds.has(node.id)) {
                node.metadata?.batchChildIds?.forEach((childId) => {
                    if (!nodeById.has(childId) || deletedNodeIds.has(childId)) return;
                    deletedNodeIds.add(childId);
                    changed = true;
                });
            }
            if (node.metadata?.batchRootId && deletedNodeIds.has(node.metadata.batchRootId) && !deletedNodeIds.has(node.id)) {
                deletedNodeIds.add(node.id);
                changed = true;
            }
        });

        state.nodes.forEach((node) => {
            const childIds = node.metadata?.isBatchRoot ? node.metadata.batchChildIds : undefined;
            if (!childIds?.length || deletedNodeIds.has(node.id)) return;
            if (!childIds.some((childId) => deletedNodeIds.has(childId))) return;
            const hasRemainingChild = childIds.some((childId) => nodeById.has(childId) && !deletedNodeIds.has(childId));
            if (hasRemainingChild) return;
            deletedNodeIds.add(node.id);
            changed = true;
        });
    }

    const remainingNodes = state.nodes.filter((node) => !deletedNodeIds.has(node.id));
    const remainingById = new Map(remainingNodes.map((node) => [node.id, node]));
    const nodes = remainingNodes.map((node) => {
        let nextNode = node;
        if (node.metadata?.groupId && deletedNodeIds.has(node.metadata.groupId)) {
            nextNode = { ...node, metadata: { ...node.metadata, groupId: undefined } };
        }

        const previousChildIds = nextNode.metadata?.isBatchRoot ? nextNode.metadata.batchChildIds : undefined;
        if (!previousChildIds) return nextNode;
        const batchChildIds = previousChildIds.filter((childId) => remainingById.has(childId));
        if (batchChildIds.length === previousChildIds.length) return nextNode;

        const primaryImageId = batchChildIds.includes(nextNode.metadata?.primaryImageId || "") ? nextNode.metadata?.primaryImageId : batchChildIds[0];
        const primaryNode = primaryImageId ? remainingById.get(primaryImageId) : undefined;
        if (!primaryNode) return { ...nextNode, metadata: { ...nextNode.metadata, batchChildIds, primaryImageId } };

        return {
            ...nextNode,
            width: primaryNode.width,
            height: primaryNode.height,
            metadata: {
                ...nextNode.metadata,
                batchChildIds,
                primaryImageId,
                ...primaryResourceMetadata(primaryNode.metadata),
            },
        };
    });

    return {
        nodes,
        connections: state.connections.filter((connection) => !deletedNodeIds.has(connection.fromNodeId) && !deletedNodeIds.has(connection.toNodeId)),
        deletedNodeIds,
    };
}

function primaryResourceMetadata(metadata?: CanvasNodeMetadata): Pick<CanvasNodeMetadata, "content" | "storageKey" | "mimeType" | "bytes" | "naturalWidth" | "naturalHeight" | "freeResize"> {
    return {
        content: metadata?.content,
        storageKey: metadata?.storageKey,
        mimeType: metadata?.mimeType,
        bytes: metadata?.bytes,
        naturalWidth: metadata?.naturalWidth,
        naturalHeight: metadata?.naturalHeight,
        freeResize: metadata?.freeResize,
    };
}
