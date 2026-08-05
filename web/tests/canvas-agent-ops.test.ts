import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/app/(user)/canvas/utils/canvas-agent-ops.ts";
import { deleteCanvasNodes } from "../src/app/(user)/canvas/utils/canvas-node-deletion.ts";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";

const canvasClientSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");

function node(id: string, type = CanvasNodeType.Text): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { status: "idle" } };
}

function snapshot(nodes: CanvasNodeData[], connections: CanvasConnection[] = [], selectedNodeIds: string[] = []): CanvasAgentSnapshot {
    return { projectId: "project", title: "测试", nodes, connections, selectedNodeIds, viewport: { x: 0, y: 0, k: 1 } };
}

test("Agent 不能通过更新补丁改写节点标识或类型", () => {
    const result = applyCanvasAgentOps(snapshot([node("text")]), [{ type: "update_node", id: "text", patch: { id: "changed", type: CanvasNodeType.Group, width: -10, position: { x: Number.NaN, y: 42 } } }]);
    assert.equal(result.nodes[0].id, "text");
    assert.equal(result.nodes[0].type, CanvasNodeType.Text);
    assert.equal(result.nodes[0].width, 48);
    assert.deepEqual(result.nodes[0].position, { x: 0, y: 42 });
});

test("Agent 新建节点会处理重复标识并限制视口范围", () => {
    const result = applyCanvasAgentOps(snapshot([node("same")]), [
        { type: "add_node", id: "same", nodeType: CanvasNodeType.Image, width: 99_999, height: 1 },
        { type: "set_viewport", viewport: { x: Number.POSITIVE_INFINITY, y: -2_000_000, k: 99 } },
    ]);
    assert.equal(new Set(result.nodes.map((item) => item.id)).size, 2);
    assert.equal(result.nodes[1].width, 8192);
    assert.equal(result.nodes[1].height, 48);
    assert.deepEqual(result.viewport, { x: 0, y: -1_000_000, k: 8 });
});

test("Agent 不能连接组、自连接或两个配置节点", () => {
    const nodes = [node("group", CanvasNodeType.Group), node("text"), node("config-a", CanvasNodeType.Config), node("config-b", CanvasNodeType.Config)];
    const result = applyCanvasAgentOps(snapshot(nodes), [
        { type: "connect_nodes", fromNodeId: "group", toNodeId: "text" },
        { type: "connect_nodes", fromNodeId: "text", toNodeId: "text" },
        { type: "connect_nodes", fromNodeId: "config-a", toNodeId: "config-b" },
        { type: "connect_nodes", fromNodeId: "text", toNodeId: "config-a" },
    ]);
    assert.equal(result.connections.length, 1);
    assert.equal(result.connections[0].fromNodeId, "text");
    assert.equal(result.connections[0].toNodeId, "config-a");
});

test("删除组时保留子节点并清理归组关系", () => {
    const child = { ...node("child"), metadata: { status: "idle" as const, groupId: "group" } };
    const result = applyCanvasAgentOps(snapshot([node("group", CanvasNodeType.Group), child]), [{ type: "delete_node", id: "group" }]);
    assert.deepEqual(
        result.nodes.map((item) => item.id),
        ["child"],
    );
    assert.equal(result.nodes[0].metadata?.groupId, undefined);
});

test("删除批次主图后根节点切换到剩余主图并同步资源和尺寸", () => {
    const root: CanvasNodeData = {
        ...node("root", CanvasNodeType.Image),
        width: 320,
        height: 320,
        metadata: {
            isBatchRoot: true,
            batchChildIds: ["child-a", "child-b"],
            primaryImageId: "child-a",
            content: "old-root.png",
            storageKey: "old-root",
            naturalWidth: 1024,
            naturalHeight: 1024,
        },
    };
    const childA: CanvasNodeData = { ...node("child-a", CanvasNodeType.Image), metadata: { batchRootId: "root", content: "a.png", storageKey: "a" } };
    const childB: CanvasNodeData = {
        ...node("child-b", CanvasNodeType.Image),
        width: 480,
        height: 270,
        metadata: { batchRootId: "root", content: "b.png", storageKey: "b", mimeType: "image/webp", bytes: 42, naturalWidth: 1920, naturalHeight: 1080, freeResize: true },
    };
    const connections: CanvasConnection[] = [
        { id: "root-a", fromNodeId: "root", toNodeId: "child-a" },
        { id: "root-b", fromNodeId: "root", toNodeId: "child-b" },
    ];

    const result = deleteCanvasNodes({ nodes: [root, childA, childB], connections }, ["child-a"]);
    const nextRoot = result.nodes.find((item) => item.id === "root")!;

    assert.deepEqual([...result.deletedNodeIds], ["child-a"]);
    assert.deepEqual(nextRoot.metadata?.batchChildIds, ["child-b"]);
    assert.equal(nextRoot.metadata?.primaryImageId, "child-b");
    assert.equal(nextRoot.metadata?.content, "b.png");
    assert.equal(nextRoot.metadata?.storageKey, "b");
    assert.equal(nextRoot.metadata?.mimeType, "image/webp");
    assert.equal(nextRoot.metadata?.bytes, 42);
    assert.equal(nextRoot.metadata?.naturalWidth, 1920);
    assert.equal(nextRoot.metadata?.naturalHeight, 1080);
    assert.equal(nextRoot.metadata?.freeResize, true);
    assert.equal(nextRoot.width, 480);
    assert.equal(nextRoot.height, 270);
    assert.deepEqual(
        result.connections.map((connection) => connection.id),
        ["root-b"],
    );
});

test("删除批次根或全部子图会清理整个批次及关联连线", () => {
    const root: CanvasNodeData = { ...node("root", CanvasNodeType.Image), metadata: { isBatchRoot: true, batchChildIds: ["child-a", "child-b"], primaryImageId: "child-a" } };
    const childA: CanvasNodeData = { ...node("child-a", CanvasNodeType.Image), metadata: { batchRootId: "root" } };
    const childB: CanvasNodeData = { ...node("child-b", CanvasNodeType.Image), metadata: { batchRootId: "root" } };
    const reverseOnlyChild: CanvasNodeData = { ...node("reverse-only", CanvasNodeType.Image), metadata: { batchRootId: "root" } };
    const source = node("source");
    const tail = node("tail");
    const connections: CanvasConnection[] = [
        { id: "source-root", fromNodeId: "source", toNodeId: "root" },
        { id: "root-a", fromNodeId: "root", toNodeId: "child-a" },
        { id: "root-b", fromNodeId: "root", toNodeId: "child-b" },
        { id: "tail-safe", fromNodeId: "source", toNodeId: "tail" },
    ];

    const byRoot = deleteCanvasNodes({ nodes: [source, root, childA, childB, reverseOnlyChild, tail], connections }, ["root"]);
    assert.deepEqual(
        byRoot.nodes.map((item) => item.id),
        ["source", "tail"],
    );
    assert.deepEqual(
        byRoot.connections.map((connection) => connection.id),
        ["tail-safe"],
    );
    assert.deepEqual(new Set(byRoot.deletedNodeIds), new Set(["root", "child-a", "child-b", "reverse-only"]));

    const byChildren = applyCanvasAgentOps(snapshot([source, root, childA, childB, tail], connections, ["source", "child-a"]), [{ type: "delete_node", ids: ["child-a", "child-b"] }]);
    assert.deepEqual(
        byChildren.nodes.map((item) => item.id),
        ["source", "tail"],
    );
    assert.deepEqual(
        byChildren.connections.map((connection) => connection.id),
        ["tail-safe"],
    );
    assert.deepEqual(byChildren.selectedNodeIds, []);
});

test("删除不存在的节点不会误删异常批次或清空选择", () => {
    const orphanRoot: CanvasNodeData = { ...node("orphan-root", CanvasNodeType.Image), metadata: { isBatchRoot: true, batchChildIds: ["missing-child"] } };
    const result = applyCanvasAgentOps(snapshot([orphanRoot, node("selected")], [], ["selected"]), [{ type: "delete_node", id: "missing-node" }]);

    assert.deepEqual(
        result.nodes.map((item) => item.id),
        ["orphan-root", "selected"],
    );
    assert.deepEqual(result.selectedNodeIds, ["selected"]);
});

test("创意 Agent 与旧 Agent 共用页面删除入口并清理全部节点浮层", () => {
    assert.match(canvasClientSource, /const deletedNodeIds = deleteNodes\(new Set\(\[nodeId\]\)\)/);
    assert.match(canvasClientSource, /const deletion = deleteCanvasNodesFromState\(\{ nodes: nodesRef\.current, connections: connectionsRef\.current \}, ids\)/);

    const uiCleanupBlock = canvasClientSource.match(/const clearDeletedNodeUiState = useCallback\([\s\S]*?\n\s*const agentSnapshot/)?.[0] || "";
    for (const setter of [
        "setHoveredNodeId",
        "setToolbarNodeId",
        "setDialogNodeId",
        "setEditingNodeId",
        "setInfoNodeId",
        "setCropNodeId",
        "setMaskEditNodeId",
        "setSplitNodeId",
        "setUpscaleNodeId",
        "setSuperResolveNodeId",
        "setAngleNodeId",
        "setPreviewNodeId",
        "setRunningNodeId",
        "setContextMenu",
    ]) {
        assert.match(uiCleanupBlock, new RegExp(`${setter}\\(`), `${setter} 未纳入删除清理`);
    }
    assert.match(uiCleanupBlock, /generationRequestsRef\.current/);
    assert.match(uiCleanupBlock, /controller\.abort\(\)/);
    assert.match(uiCleanupBlock, /status === NODE_STATUS_LOADING/);
});

test("Agent 可创建已注册的插件节点且保留插件默认数据", () => {
    registerNodeDefinitions([{ type: "test-plugin:note", title: "插件便签", icon: "P", defaultSize: { width: 280, height: 180 }, defaultMetadata: { content: "默认内容", pluginColor: "yellow" } }], "test-plugin");
    try {
        const result = applyCanvasAgentOps(snapshot([]), [{ type: "add_node", nodeType: "test-plugin:note", position: { x: 10, y: 20 } }]);
        assert.equal(result.nodes[0].type, "test-plugin:note");
        assert.equal(result.nodes[0].title, "插件便签");
        assert.equal(result.nodes[0].width, 280);
        assert.equal(result.nodes[0].metadata?.pluginColor, "yellow");
    } finally {
        unregisterPluginNodes("test-plugin");
    }
});
