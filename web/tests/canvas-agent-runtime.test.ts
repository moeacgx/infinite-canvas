import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasAgentExecutionBudget, normalizeCanvasAgentToolCalls, reserveCanvasAgentAction } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import type { CanvasAgentAction } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";

function action(name: CanvasAgentAction["name"], args: Record<string, unknown> = {}): CanvasAgentAction {
    return { id: `${name}-${Math.random()}`, name, arguments: args };
}

test("Agent 单轮最多提交 6 个媒体任务", () => {
    const budget = createCanvasAgentExecutionBudget();
    for (let index = 0; index < 6; index += 1) assert.equal(reserveCanvasAgentAction(budget, action("generate_video")), null);
    const rejected = reserveCanvasAgentAction(budget, action("generate_audio"));
    assert.equal(rejected?.code, "turn_budget_exceeded");
    assert.equal(budget.mediaActions, 6);
});

test("Agent 单轮图片总输出最多 12 张且拒绝请求不会占用预算", () => {
    const budget = createCanvasAgentExecutionBudget();
    assert.equal(reserveCanvasAgentAction(budget, action("generate_image", { count: 12 })), null);
    const rejected = reserveCanvasAgentAction(budget, action("edit_image", { count: 1 }));
    assert.equal(rejected?.code, "turn_budget_exceeded");
    assert.match(String(rejected?.message), /12 张/);
    assert.deepEqual(budget, { writeActions: 1, mediaActions: 1, imageOutputs: 12 });
});

test("Agent 单轮画布写操作最多 24 次", () => {
    const budget = createCanvasAgentExecutionBudget();
    for (let index = 0; index < 24; index += 1) assert.equal(reserveCanvasAgentAction(budget, action("create_text_node")), null);
    assert.equal(reserveCanvasAgentAction(budget, action("update_node"))?.code, "turn_budget_exceeded");
    assert.equal(reserveCanvasAgentAction(budget, action("get_canvas_summary")), null);
});

test("畸形原生工具调用会返回结构化错误而不是终止 Agent", () => {
    const [missingPrompt, unknownTool] = normalizeCanvasAgentToolCalls([
        { id: "missing-prompt", name: "generate_video", arguments: {} },
        { id: "unknown", name: "provider_private_tool", arguments: { value: true } },
    ]);

    assert.equal(missingPrompt.action, undefined);
    assert.equal(missingPrompt.rejection?.code, "invalid_tool_call");
    assert.match(String(missingPrompt.rejection?.message), /prompt/);
    assert.equal(unknownTool.action, undefined);
    assert.equal(unknownTool.rejection?.code, "invalid_tool_call");
});
