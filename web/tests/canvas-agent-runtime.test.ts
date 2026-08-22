import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { createCanvasAgentExecutionBudget, createCanvasAgentState, normalizeCanvasAgentToolCalls, reserveCanvasAgentAction, runCanvasAgent } from "../src/app/(user)/canvas/agent/canvas-agent-runtime.ts";
import type { CanvasAgentContext } from "../src/app/(user)/canvas/agent/canvas-agent-context.ts";
import { parseCanvasAgentJson, userLikelyRequestedCanvasAction, type CanvasAgentAction, type CanvasAgentToolResult } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";
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
    assert.match(String(unknownTool.rejection?.message), /provider_private_tool/);
});

test("JSON 兼容动作缺少 ID 时生成可重放且同批不冲突的稳定 ID", () => {
    const content = JSON.stringify({
        actions: [
            { tool: "generate_image", arguments: { prompt: "同一张图", sourceNodeIds: [] } },
            { tool: "generate_image", arguments: { prompt: "同一张图", sourceNodeIds: [] } },
        ],
        reply: "",
    });
    const first = parseCanvasAgentJson(content).actions;
    const replay = parseCanvasAgentJson(content).actions;
    const shifted = parseCanvasAgentJson(
        JSON.stringify({
            actions: [
                { tool: "get_canvas_summary", arguments: {} },
                { tool: "generate_image", arguments: { prompt: "同一张图", sourceNodeIds: [] } },
            ],
            reply: "",
        }),
    ).actions;

    assert.equal(first[0]?.id, replay[0]?.id);
    assert.equal(first[1]?.id, replay[1]?.id);
    assert.notEqual(first[0]?.id, first[1]?.id);
    assert.equal(first[0]?.id, shifted.find((action) => action.name === "generate_image")?.id);
});

test("兼容 Claude 返回的单动作图片合成 JSON", () => {
    const content = `\`\`\`json
${JSON.stringify(
    {
        action: "generate_image",
        mode: "composite",
        title: "庄园里的小猫",
        inputNodeIds: ["estate-node", "cat-node"],
        prompt: "以庄园全景为底图，把小猫放进庄园",
    },
    null,
    2,
)}
\`\`\`

正在把小猫合成进庄园。`;
    const parsed = parseCanvasAgentJson(content);

    assert.equal(parsed.parsed, true);
    assert.equal(parsed.actionLike, true);
    assert.equal(parsed.actions.length, 1);
    assert.equal(parsed.actions[0]?.name, "generate_image");
    assert.deepEqual(parsed.actions[0]?.arguments, {
        title: "庄园里的小猫",
        prompt: "以庄园全景为底图，把小猫放进庄园",
        sourceNodeIds: ["estate-node", "cat-node"],
    });
    assert.equal(userLikelyRequestedCanvasAction("把小猫放到庄园里面"), true);
});

test("单动作 JSON 兼容 arguments 内的 inputNodeIds", () => {
    const parsed = parseCanvasAgentJson(
        JSON.stringify({
            action: "generate_image",
            arguments: {
                title: "庄园里的小猫",
                inputNodeIds: ["estate-node", "cat-node"],
                prompt: "把小猫合成进庄园",
            },
        }),
    );

    assert.equal(parsed.parsed, true);
    assert.deepEqual(parsed.actions[0]?.arguments, {
        title: "庄园里的小猫",
        prompt: "把小猫合成进庄园",
        sourceNodeIds: ["estate-node", "cat-node"],
    });
});

test("单动作 JSON 仍拒绝未知工具和畸形 actions 字段", () => {
    const unknown = parseCanvasAgentJson(JSON.stringify({ action: "compose_image", prompt: "合成", inputNodeIds: ["estate", "cat"] }));
    const nonMedia = parseCanvasAgentJson(JSON.stringify({ action: "delete_node", nodeId: "estate" }));
    assert.equal(unknown.actionLike, true);
    assert.deepEqual(unknown.actions, []);
    assert.equal(nonMedia.actionLike, true);
    assert.deepEqual(nonMedia.actions, []);
    assert.deepEqual(
        parseCanvasAgentJson(
            JSON.stringify({
                actions: "generate_image",
                action: "generate_image",
                prompt: "不得从畸形 actions 降级执行",
                inputNodeIds: ["estate", "cat"],
            }),
        ).actions,
        [],
    );
});

type ScriptedModelMessage = {
    content?: string | null;
    tool_calls?: Array<{
        id?: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
};

type ScriptedModelResponse = ScriptedModelMessage | { status: number; error: string };

async function runScriptedAgent(input: { userText: string; responses: ScriptedModelResponse[]; executeAction: (action: CanvasAgentAction) => Promise<CanvasAgentToolResult> }) {
    const requestBodies: Array<{ tools?: unknown; tool_choice?: unknown; messages?: Array<{ role?: string; content?: unknown }> }> = [];
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            requestBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            const scriptedResponse = input.responses[Math.min(requestBodies.length - 1, input.responses.length - 1)];
            response.setHeader("content-type", "application/json");
            if ("status" in scriptedResponse) {
                response.statusCode = scriptedResponse.status;
                response.end(JSON.stringify({ error: { message: scriptedResponse.error } }));
                return;
            }
            response.end(JSON.stringify({ choices: [{ message: scriptedResponse }] }));
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

test("Claude 单动作图片合成 JSON 只执行一次且不回显命令", async () => {
    const executed: CanvasAgentAction[] = [];
    const command = `\`\`\`json
${JSON.stringify({ action: "generate_image", mode: "composite", title: "庄园里的小猫", inputNodeIds: ["estate-node", "cat-node"], prompt: "以庄园全景为底图，把小猫放进庄园" }, null, 2)}
\`\`\`

正在把小猫合成进庄园。`;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把小猫放到庄园里面",
        responses: [{ content: command }, { content: "图片合成任务已经提交。" }],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: "result-image", taskId: "image-task", status: "loading" };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(executed.length, 1);
    assert.equal(executed[0]?.name, "generate_image");
    assert.deepEqual(executed[0]?.arguments.sourceNodeIds, ["estate-node", "cat-node"]);
    assert.equal(result.reply, "图片合成任务已经提交。");
    assert.doesNotMatch(result.reply, /generate_image|inputNodeIds/);
});

test("未知单动作 JSON 会重试并明确报错而不是作为成功回复", async () => {
    let executions = 0;
    const invalidCommand = JSON.stringify({ action: "compose_image", inputNodeIds: ["estate", "cat"], prompt: "合成" });
    const { requestBodies, result } = await runScriptedAgent({
        userText: "讨论一下当前构图",
        responses: [{ content: invalidCommand }, { content: invalidCommand }],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(executions, 0);
    assert.match(result.reply, /没有返回可执行的画布工具指令/);
    assert.notEqual(result.reply, invalidCommand);
});

test("\u622a\u56fe\u5f0f\u9876\u5c42 delete_node \u4e0d\u4f1a\u8fdb\u5165\u6267\u884c\u5668", async () => {
    let executions = 0;
    const unsafeCommand = JSON.stringify({ action: "delete_node", nodeId: "estate" });
    const { requestBodies, result } = await runScriptedAgent({
        userText: "\u8ba8\u8bba\u4e00\u4e0b\u5f53\u524d\u6784\u56fe",
        responses: [{ content: unsafeCommand }, { content: unsafeCommand }],
        executeAction: async () => {
            executions += 1;
            return { ok: true, deletedNodeIds: ["estate"] };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(executions, 0);
    assert.match(result.reply, /\u6ca1\u6709\u8fd4\u56de\u53ef\u6267\u884c\u7684\u753b\u5e03\u5de5\u5177\u6307\u4ee4/);
    assert.notEqual(result.reply, unsafeCommand);
});

test("\u7578\u5f62\u5355\u52a8\u4f5c JSON \u4f1a\u660e\u786e\u62a5\u9519\u800c\u4e0d\u4f1a\u4f5c\u4e3a\u6210\u529f\u56de\u590d", async () => {
    let executions = 0;
    const malformedCommand = JSON.stringify({ action: "generate_image", inputNodeIds: "estate", prompt: "compose image" });
    const { requestBodies, result } = await runScriptedAgent({
        userText: "\u8ba8\u8bba\u4e00\u4e0b\u5f53\u524d\u6784\u56fe",
        responses: [{ content: malformedCommand }, { content: malformedCommand }],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(executions, 0);
    assert.match(result.reply, /\u6ca1\u6709\u8fd4\u56de\u53ef\u6267\u884c\u7684\u753b\u5e03\u5de5\u5177\u6307\u4ee4/);
    assert.notEqual(result.reply, malformedCommand);
});

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

test("没有问号的阻塞信息也会作为澄清回复保留", async () => {
    const clarification = "还缺少分镜数量，请补充后我再创建";
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请创建分镜节点",
        responses: [{ content: clarification }],
        executeAction: async () => ({ ok: true }),
    });

    assert.equal(requestBodies.length, 1);
    assert.equal(result.reply, clarification);
});

test("无需补充等否定表达不会阻止画布动作降级执行", async () => {
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请创建一个文本节点",
        responses: [
            { content: "无需补充，我现在创建。" },
            {
                content: JSON.stringify({
                    actions: [{ tool: "create_text_node", arguments: { title: "节点", content: "内容", sourceNodeIds: [] } }],
                    reply: "正在创建",
                }),
            },
            { content: JSON.stringify({ actions: [], reply: "文本节点已经创建。" }) },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: "text-node" };
        },
    });

    assert.equal(requestBodies.length, 3);
    assert.equal(executed.length, 1);
    assert.equal(executed[0]?.name, "create_text_node");
    assert.equal(result.reply, "文本节点已经创建。");
});

test("合法 JSON 空动作会保留前置条件回复而不是误报不兼容", async () => {
    const reply = "当前没有可连接的节点，请先创建至少两个节点";
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请连接画布上的两个节点",
        responses: [{ content: JSON.stringify({ actions: [], reply }) }],
        executeAction: async () => ({ ok: true }),
    });

    assert.equal(requestBodies.length, 1);
    assert.equal(result.reply, reply);
});

test("修改图片请求不接受空动作的完成声明", async () => {
    let executions = 0;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把内容改成上线文档站",
        responses: [{ content: "好的，已经改好了。" }, { content: JSON.stringify({ actions: [], reply: "改好了，图片已经生成。" }) }],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(userLikelyRequestedCanvasAction("把内容改成上线文档站"), true);
    assert.equal(requestBodies.length, 2);
    assert.equal(executions, 0);
    assert.match(result.reply, /没有返回可执行的画布工具指令/);
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

test("原生工具缺少调用 ID 时不同动作仍可按顺序执行", async () => {
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "读取画布后创建一个文本节点",
        responses: [
            {
                content: null,
                tool_calls: [{ type: "function", function: { name: "get_canvas_summary", arguments: "{}" } }],
            },
            {
                content: null,
                tool_calls: [
                    {
                        type: "function",
                        function: {
                            name: "create_text_node",
                            arguments: JSON.stringify({ title: "节点", content: "内容", sourceNodeIds: [] }),
                        },
                    },
                ],
            },
            { content: "文本节点已经创建。" },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return nextAction.name === "get_canvas_summary" ? { ok: true, nodes: [] } : { ok: true, nodeId: "text-node" };
        },
    });

    assert.equal(requestBodies.length, 3);
    assert.deepEqual(
        executed.map((nextAction) => nextAction.name),
        ["get_canvas_summary", "create_text_node"],
    );
    assert.notEqual(executed[0]?.id, executed[1]?.id);
    assert.equal(result.reply, "文本节点已经创建。");
});

test("无副作用读取动作允许在同一轮重复执行", async () => {
    const executed: CanvasAgentAction[] = [];
    const { result } = await runScriptedAgent({
        userText: "创建节点前后都读取一次画布",
        responses: [
            { content: null, tool_calls: [{ type: "function", function: { name: "get_canvas_summary", arguments: "{}" } }] },
            {
                content: null,
                tool_calls: [
                    {
                        type: "function",
                        function: { name: "create_text_node", arguments: JSON.stringify({ title: "节点", content: "内容", sourceNodeIds: [] }) },
                    },
                ],
            },
            { content: null, tool_calls: [{ type: "function", function: { name: "get_canvas_summary", arguments: "{}" } }] },
            { content: "已在创建前后读取画布。" },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return nextAction.name === "create_text_node" ? { ok: true, nodeId: "text-node" } : { ok: true, nodes: [] };
        },
    });

    assert.deepEqual(
        executed.map((nextAction) => nextAction.name),
        ["get_canvas_summary", "create_text_node", "get_canvas_summary"],
    );
    assert.equal(result.reply, "已在创建前后读取画布。");
});

test("供应商更换调用 ID 时相同媒体写操作仍只提交一次", async () => {
    const executed: CanvasAgentAction[] = [];
    const firstArguments = { prompt: " 雨夜城市霓虹 ", sourceNodeIds: [], count: "1", ignored: "field" };
    const secondArguments = { prompt: "雨夜城市霓虹", sourceNodeIds: [], count: 1 };
    const { requestBodies, result } = await runScriptedAgent({
        userText: "生成一张城市夜景图片",
        responses: [
            {
                content: null,
                tool_calls: [{ id: "provider-call-a", type: "function", function: { name: "generate_image", arguments: JSON.stringify(firstArguments) } }],
            },
            {
                content: null,
                tool_calls: [{ id: "provider-call-b", type: "function", function: { name: "generate_image", arguments: JSON.stringify(secondArguments) } }],
            },
            { content: "图片任务已经提交。" },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: "image-node", taskId: "image-task", status: "loading" };
        },
    });

    assert.equal(executed.length, 1);
    assert.match(String(requestBodies[2]?.messages?.at(-1)?.content), /duplicate_action/);
    assert.equal(result.reply, "图片任务已经提交。");
});

test("失败动作修正参数后可复用调用 ID", async () => {
    const executedSeconds: unknown[] = [];
    const action = (seconds: number) => ({ id: "video-action", tool: "generate_video", arguments: { prompt: "雨夜城市", sourceNodeIds: [], seconds } });
    const { result } = await runScriptedAgent({
        userText: "生成一个 5 秒视频",
        responses: [
            { content: "我来生成。" },
            { content: JSON.stringify({ actions: [action(15)], reply: "正在提交" }) },
            { content: JSON.stringify({ actions: [action(5)], reply: "已修正时长" }) },
            { content: JSON.stringify({ actions: [], reply: "5 秒视频任务已经提交。" }) },
        ],
        executeAction: async (nextAction) => {
            executedSeconds.push(nextAction.arguments.seconds);
            return executedSeconds.length === 1 ? { ok: false, code: "unsupported_duration", message: "仅支持 5 秒" } : { ok: true, nodeId: "video-node", taskId: "video-task" };
        },
    });

    assert.deepEqual(executedSeconds, [15, 5]);
    assert.equal(result.reply, "5 秒视频任务已经提交。");
});

test("同一批两个完全相同的媒体动作都允许执行", async () => {
    const mediaAction = { tool: "generate_image", arguments: { prompt: "同一构图", sourceNodeIds: [] } };
    const executed: CanvasAgentAction[] = [];
    const { result } = await runScriptedAgent({
        userText: "生成两张内容相同的图片",
        responses: [{ content: "我来生成两张。" }, { content: JSON.stringify({ actions: [mediaAction, mediaAction], reply: "正在生成" }) }, { content: JSON.stringify({ actions: [], reply: "两张图片任务已经提交。" }) }],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: `image-${executed.length}`, taskId: `task-${executed.length}` };
        },
    });

    assert.equal(executed.length, 2);
    assert.notEqual(executed[0]?.id, executed[1]?.id);
    assert.equal(result.reply, "两张图片任务已经提交。");
});

test("JSON 降级多轮重放同一媒体动作时只提交一次", async () => {
    const mediaAction = {
        tool: "generate_image",
        arguments: { prompt: "雨夜城市霓虹", sourceNodeIds: [] },
    };
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "生成一张城市夜景图片",
        responses: [
            { content: "好的，我来生成。" },
            { content: JSON.stringify({ actions: [{ tool: "get_canvas_summary", arguments: {} }, mediaAction], reply: "正在生成" }) },
            { content: JSON.stringify({ actions: [mediaAction, mediaAction], reply: "继续生成" }) },
            { content: JSON.stringify({ actions: [], reply: "图片任务已经提交。" }) },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return nextAction.name === "get_canvas_summary" ? { ok: true, nodes: [] } : { ok: true, nodeId: "image-node", taskId: "image-task", status: "loading" };
        },
    });

    assert.equal(requestBodies.length, 4);
    assert.deepEqual(
        executed.map((nextAction) => nextAction.name),
        ["get_canvas_summary", "generate_image"],
    );
    assert.match(String(requestBodies[3]?.messages?.at(-1)?.content), /duplicate_action/);
    assert.equal(result.reply, "图片任务已经提交。");
});

test("原生工具名不兼容时自动切到 JSON 协议重试", async () => {
    const executed: CanvasAgentAction[] = [];
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把小猫合成进庄园图片",
        responses: [
            {
                content: null,
                tool_calls: [{ id: "invalid-compose", type: "function", function: { name: "compose_image", arguments: JSON.stringify({ prompt: "把小猫放进庄园", sourceNodeIds: ["estate", "cat"] }) } }],
            },
            { content: JSON.stringify({ actions: [{ id: "edit-image", tool: "edit_image", arguments: { prompt: "把小猫放进庄园", sourceNodeIds: ["estate", "cat"] } }], reply: "正在合成" }) },
            { content: JSON.stringify({ actions: [], reply: "图片合成任务已经提交。" }) },
        ],
        executeAction: async (nextAction) => {
            executed.push(nextAction);
            return { ok: true, nodeId: "image-node", taskId: "image-task", status: "loading" };
        },
    });

    assert.equal(requestBodies[0]?.tool_choice, "auto");
    assert.equal(requestBodies[1]?.tools, undefined);
    assert.match(String(requestBodies[1]?.messages?.at(-1)?.content), /compose_image/);
    assert.deepEqual(
        executed.map((nextAction) => nextAction.name),
        ["edit_image"],
    );
    assert.equal(result.reply, "图片合成任务已经提交。");
});

test("JSON 降级后仍返回未知原生工具时立即终止兼容重试", async () => {
    let executions = 0;
    const incompatibleToolCall = {
        content: null,
        tool_calls: [
            {
                id: "invalid-compose",
                type: "function" as const,
                function: {
                    name: "compose_image",
                    arguments: JSON.stringify({ prompt: "把小猫放进庄园", sourceNodeIds: ["estate", "cat"] }),
                },
            },
        ],
    };
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把小猫合成进庄园图片",
        responses: [incompatibleToolCall, incompatibleToolCall],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies[0]?.tools);
    assert.equal(requestBodies[1]?.tools, undefined);
    assert.equal(executions, 0);
    assert.match(result.reply, /兼容 JSON 模式/);
    assert.match(result.reply, /compose_image/);
    assert.doesNotMatch(result.reply, /安全操作步数上限/);
});

test("普通文本触发 JSON 降级后返回未知原生工具时立即终止", async () => {
    let executions = 0;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "请生成一张小猫图片",
        responses: [
            { content: "好的，我来生成。" },
            {
                content: null,
                tool_calls: [{ id: "invalid-compose", type: "function", function: { name: "compose_image", arguments: "{}" } }],
            },
        ],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies[0]?.tools);
    assert.equal(requestBodies[1]?.tools, undefined);
    assert.equal(executions, 0);
    assert.match(result.reply, /兼容 JSON 模式/);
    assert.match(result.reply, /compose_image/);
    assert.doesNotMatch(result.reply, /安全操作步数上限/);
});

test("请求层因 400 自动降级后返回未知原生工具时立即终止", async () => {
    let executions = 0;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把小猫合成进庄园图片",
        responses: [
            { status: 400, error: "tools are not supported" },
            {
                content: null,
                tool_calls: [{ id: "invalid-compose", type: "function", function: { name: "compose_image", arguments: "{}" } }],
            },
        ],
        executeAction: async () => {
            executions += 1;
            return { ok: true };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.ok(requestBodies[0]?.tools);
    assert.equal(requestBodies[1]?.tools, undefined);
    assert.equal(executions, 0);
    assert.match(result.reply, /兼容 JSON 模式/);
    assert.match(result.reply, /compose_image/);
    assert.doesNotMatch(result.reply, /安全操作步数上限/);
});

test("JSON 降级混合未知工具与合法媒体工具时整轮终止", async () => {
    let executions = 0;
    const unsafeName = `\u202ecompose_image\u0000${"x".repeat(200)}`;
    const { requestBodies, result } = await runScriptedAgent({
        userText: "把小猫合成进庄园图片",
        responses: [
            {
                content: null,
                tool_calls: [{ id: "invalid-compose-first", type: "function", function: { name: "compose_image", arguments: "{}" } }],
            },
            {
                content: null,
                tool_calls: [
                    { id: "invalid-compose-second", type: "function", function: { name: unsafeName, arguments: "{}" } },
                    {
                        id: "valid-edit-image",
                        type: "function",
                        function: { name: "edit_image", arguments: JSON.stringify({ prompt: "把小猫放进庄园", sourceNodeIds: ["estate", "cat"] }) },
                    },
                ],
            },
        ],
        executeAction: async () => {
            executions += 1;
            return { ok: true, nodeId: "unexpected-image", taskId: "unexpected-task" };
        },
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(executions, 0);
    assert.match(result.reply, /兼容 JSON 模式/);
    assert.match(result.reply, /compose_image/);
    assert.ok(result.reply.length < 600);
    assert.doesNotMatch(result.reply, /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
});
