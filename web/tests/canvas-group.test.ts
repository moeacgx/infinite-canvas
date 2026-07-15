import assert from "node:assert/strict";
import test from "node:test";

import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types.ts";
import { findContainingGroupId, findGroupDropTarget, snapNodesIntoGroup } from "../src/app/(user)/canvas/utils/canvas-group.ts";

function node(id: string, type: CanvasNodeType, x: number, y: number, width = 100, height = 100): CanvasNodeData {
    return { id, type, title: id, position: { x, y }, width, height, metadata: { status: "idle" } };
}

test("普通节点中心进入组时识别为投放目标", () => {
    const group = node("group", CanvasNodeType.Group, 0, 0, 500, 400);
    const child = node("child", CanvasNodeType.Image, 80, 90);
    assert.equal(findGroupDropTarget(new Set([child.id]), [group, child])?.id, group.id);
    assert.equal(findGroupDropTarget(new Set([group.id]), [group, child]), null);
});

test("多选拖拽仅在全部节点进入同一组时归组", () => {
    const group = node("group", CanvasNodeType.Group, 0, 0, 500, 400);
    const inside = node("inside", CanvasNodeType.Image, 80, 90);
    const outside = node("outside", CanvasNodeType.Text, 800, 90);
    assert.equal(findGroupDropTarget(new Set([inside.id, outside.id]), [group, inside, outside]), null);
});

test("归组时写入 groupId 并把节点限制在内边距内", () => {
    const group = node("group", CanvasNodeType.Group, 0, 0, 300, 240);
    const child = node("child", CanvasNodeType.Text, -50, -40, 100, 80);
    const result = snapNodesIntoGroup(new Set([child.id]), [group, child], group);
    const snapped = result.find((item) => item.id === child.id)!;
    assert.equal(snapped.metadata?.groupId, group.id);
    assert.ok(snapped.position.x >= 24);
    assert.ok(snapped.position.y >= 24);
});

test("根据节点中心判断拖出后是否仍属于组", () => {
    const group = node("group", CanvasNodeType.Group, 0, 0, 300, 240);
    assert.equal(findContainingGroupId(node("inside", CanvasNodeType.Audio, 30, 40, 80, 60), [group]), group.id);
    assert.equal(findContainingGroupId(node("outside", CanvasNodeType.Audio, 350, 40, 80, 60), [group]), undefined);
});
