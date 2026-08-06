import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { createCanvasAgentExecutionBudget, createCanvasAgentState, normalizeCanvasAgentToolCalls, reserveCanvasAgentAction, runCanvasAgent } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import type { CanvasAgentContext } from "../src/app/(user)/canvas/agent/canvas-agent-context.ts";
import type { CanvasAgentAction, CanvasAgentToolResult } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";
import type { CanvasAgentState } from "../src/app/(user)/canvas/types.ts";
import { createModelChannel, defaultConfig, encodeChannelModel, withLocalChannels, type AiConfig } from "../src/stores/use-config-store.ts";

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

type ScriptedModelMessage = {
    content?: string | null;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
};

async function runScriptedAgent(input: { userText: string; responses: ScriptedModelMessage[]; executeAction: (action: CanvasAgentAction) => Promise<CanvasAgentToolResult> }) {
    const requestBodies: Array<{ tools?: unknown; tool_choice?: unknown; messages?: Array<{ role?: string; content?: unknown }> }> = [];
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            requestBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            const message = input.responses[Math.min(requestBodies.length - 1, input.responses.length - 1)];
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ choices: [{ message }] }));
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const channel = createModelChannel({
            id: "canvas-agent-runtime",
            baseUrl: `http://127.0.0.1:${address.port}`,
            apiKey: "runtime-test-key",
            requestMode: "direct",
            models: ["runtime-text-model"],
        });
        const selectedModel = encodeChannelModel(channel.id, "runtime-text-model");
        const config = withLocalChannels({ ...defaultConfig, channelMode: "local", textModel: selectedModel }, [channel]);
        const initialState = createCanvasAgentState();
        const result = await runCanvasAgent({
            config,
            initialState,
            protocolMessages: [],
            userText: input.userText,
            references: [],
            getContext: (state) => emptyAgentContext(config, state),
            executeAction: input.executeAction,
        });
        return { requestBodies, result };
    } finally {
        server.close();
        await once(server, "close");
    }
}

function emptyAgentContext(config: AiConfig, state: CanvasAgentState): CanvasAgentContext {
    return {
        project: { id: "runtime-test", title: "运行时测试", nodeCount: 0, connectionCount: 0 },
        agentState: state,
        selectedNodeIds: [],
        nodes: [],
        connections: [],
        generation: {
            channelMode: config.channelMode,
            textModel: config.textModel || config.model,
            imageModel: config.imageModel || config.model,
            videoModel: config.videoModel || config.model,
            audioModel: config.audioModel,
            imageChannelId: config.imageChannelId,
            videoChannelId: config.videoChannelId,
            imageApiMode: config.apiMode,
            imageQuality: config.quality,
            imageSize: config.size,
            videoQuality: config.vquality,
            videoSize: "1280x720",
            imageCount: config.canvasImageCount || config.count,
            imageBackground: config.background,
            videoSeconds: config.videoSeconds,
            videoGenerateAudio: config.videoGenerateAudio,
            videoMode: config.videoMode,
            videoWatermark: config.videoWatermark,
            audioVoice: config.audioVoice,
            audioFormat: config.audioFormat,
        },
        tasks: [],
    };
}

test("渠道返回 200 但忽略工具时自动降级 JSON 并创建多个节点与连线", async () => {
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请创建两个文本节点并连接起来",
        responses: [
            { content: "好的，我来创建并连接。" },
            {
                content: JSON.stringify({
                    actions: [
                        { id: "create-a", tool: "create_text_node", arguments: { title: "节点 A", content: "内容 A", sourceNodeIds: [] } },
                        { id: "create-b", tool: "create_text_node", arguments: { title: "节点 B", content: "内容 B", sourceNodeIds: [] } },
                    ],
                    reply: "已创建两个节点",
                }),
            },
            {
                content: JSON.stringify({
                    actions: [{ id: "connect-ab", tool: "create_connection", arguments: { fromNodeId: "node-a", toNodeId: "node-b" } }],
                    reply: "正在连接节点",
                }),
            },
            { content: JSON.stringify({ actions: [], reply: "两个节点已经创建并连接。" }) },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            if (nextAction.id === "create-a") return { ok: true, nodeId: "node-a" };
            if (nextAction.id === "create-b") return { ok: true, nodeId: "node-b" };
            return { ok: true, connectionId: "connection-ab" };
        },
    });

    assert.equal(requestBodies.length, 4);
    assert.ok(requestBodies[0]?.tools);
    assert.equal(requestBodies[0]?.tool_choice, "auto");
    for (const body of requestBodies.slice(1)) {
        assert.equal(body.tools, undefined);
        assert.equal(body.tool_choice, undefined);
    }
    assert.match(String(requestBodies[2]?.messages?.at(-1)?.content), /node-a/);
    assert.match(String(requestBodies[2]?.messages?.at(-1)?.content), /node-b/);
    assert.deepEqual(
        executed.map((nextAction) => nextAction.name),
        ["create_text_node", "create_text_node", "create_connection"],
    );
    assert.deepEqual(executed[2]?.arguments, { fromNodeId: "node-a", toNodeId: "node-b" });
    assert.equal(result.reply, "两个节点已经创建并连接。");
});

test("模型返回澄清问题时不会强制切换 JSON 模式", async () => {
    let executions = 0;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请创建分镜节点",
        responses: [{ content: "你希望创建几个分镜节点？" }],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 1);
    assert.equal(executions, 0);
    assert.equal(result.reply, "你希望创建几个分镜节点？");
});

test("兼容 JSON 仍无动作时只重试一次并返回明确错误", async () => {
    let executions = 0;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请创建一个文本节点",
        responses: [{ content: "好的，我来创建。" }, { content: "节点已经准备好了。" }],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies[0]?.tools);
    assert.equal(requestBodies[1]?.tools, undefined);
    assert.equal(executions, 0);
    assert.match(result.reply, /没有返回可执行的画布工具指令/);
});

test("已提交媒体工具后普通文本收尾不会触发降级或重复生成", async () => {
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "生成一张城市夜景图片",
        responses: [
            {
                content: null,
                tool_calls: [
                    {
                        id: "generate-image",
                        type: "function",
                        function: {
                            name: "generate_image",
                            arguments: JSON.stringify({ prompt: "雨夜城市霓虹", sourceNodeIds: [] }),
                        },
                    },
                ],
            },
            { content: "图片任务已经提交，请稍后查看结果。" },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: "image-node", taskId: "image-task", status: "loading" };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(
        requestBodies.every((body) => Boolean(body.tools)),
        true,
    );
    assert.equal(executed.length, 1);
    assert.equal(executed[0]?.name, "generate_image");
    assert.equal(result.reply, "图片任务已经提交，请稍后查看结果。");
});
