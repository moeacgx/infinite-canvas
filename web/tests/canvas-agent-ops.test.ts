import assert from "node:assert/strict";
import test from "node:test";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/app/(user)/canvas/utils/canvas-agent-ops.ts";
import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";

function node(id: string, type = CanvasNodeType.Text): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { status: "idle" } };
}

function snapshot(nodes: CanvasNodeData[]): CanvasAgentSnapshot {
    return { projectId: "project", title: "测试", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

test("Agent 不能通过更新补丁改写节点标识或类型", () => {
    const result = applyCanvasAgentOps(snapshot([node("text")]), [
        { type: "update_node", id: "text", patch: { id: "changed", type: CanvasNodeType.Group, width: -10, position: { x: Number.NaN, y: 42 } } },
    ]);
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
    assert.deepEqual(result.nodes.map((item) => item.id), ["child"]);
    assert.equal(result.nodes[0].metadata?.groupId, undefined);
});
