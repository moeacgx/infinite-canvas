import assert from "node:assert/strict";
import test from "node:test";

import { CanvasSession } from "../dist/canvas-session.js";

test("离开画布后清空服务端画布状态", async () => {
    const session = new CanvasSession();
    session.updateState({ projectId: "canvas-1", title: "测试画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, "client-1");
    assert.equal(session.health().hasCanvas, true);

    session.updateState({ projectId: "", title: "未打开画布" }, "client-1");
    assert.equal(session.health().hasCanvas, false);
    await assert.rejects(session.callTool("canvas_get_state", {}), /当前没有已连接画布/);
});
