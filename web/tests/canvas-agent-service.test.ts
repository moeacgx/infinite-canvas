import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { requestCanvasAgentTurn } from "../src/services/api/canvas-agent.ts";
import { createModelChannel, defaultConfig, encodeChannelModel, modelScriptFingerprint, withLocalChannels } from "../src/stores/use-config-store.ts";

test("画布 Agent 按编码模型选择对应渠道的文本调用脚本", async (context) => {
    const originalWorker = globalThis.Worker;
    let workerRequest: {
        script?: string;
        args?: { baseUrl?: string; model?: string; messages?: Array<{ role?: string; content?: unknown }> };
    } = {};

    class FakeWorker {
        private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

        addEventListener(type: string, listener: (event: MessageEvent) => void) {
            this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }

        postMessage(message: { runId: string; type: string; script?: string; args?: typeof workerRequest.args }) {
            workerRequest = { script: message.script, args: message.args };
            queueMicrotask(() => {
                for (const listener of this.listeners.get("message") || []) {
                    listener({ data: { runId: message.runId, type: "result", result: { content: "完成", toolCalls: [] } } } as MessageEvent);
                }
            });
        }

        terminate() {}
    }

    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    context.after(() => {
        globalThis.Worker = originalWorker;
    });

    const firstScript = "return { content: '错误渠道' }";
    const selectedScript = "return { content: '完成' }";
    const first = createModelChannel({
        id: "first",
        baseUrl: "https://first.example.com",
        apiKey: "first-key",
        models: ["same-model"],
        modelScripts: { "same-model": { text: firstScript } },
        modelScriptApprovals: { "same-model": { text: modelScriptFingerprint(firstScript) } },
    });
    const selected = createModelChannel({
        id: "selected",
        baseUrl: "https://selected.example.com",
        apiKey: "selected-key",
        models: ["same-model"],
        modelScripts: { "same-model": { text: selectedScript } },
        modelScriptApprovals: { "same-model": { text: modelScriptFingerprint(selectedScript) } },
    });
    const selectedModel = encodeChannelModel("selected", "same-model");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            textModel: selectedModel,
            systemPrompt: "渠道系统提示词",
        },
        [first, selected],
    );

    const result = await requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [{ role: "user", content: "生成一段视频" }],
        tools: [],
        allowTools: false,
    });

    assert.equal(result.content, "完成");
    assert.equal(workerRequest.script, selectedScript);
    assert.equal(workerRequest.args?.baseUrl, "https://selected.example.com");
    assert.equal(workerRequest.args?.model, "same-model");
    assert.deepEqual(workerRequest.args?.messages?.[0], {
        role: "system",
        content: "渠道系统提示词\n\n创意 Agent 提示词",
    });
});

test("画布 Agent 的 Gemini 请求只注入一次系统提示词", async (context) => {
    const originalFetch = globalThis.fetch;
    let requestBody: { systemInstruction?: { parts?: Array<{ text?: string }> } } = {};
    globalThis.fetch = async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response('data: {"candidates":[{"content":{"parts":[{"text":"完成"}]}}]}\n\n', {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        });
    };
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    const channel = createModelChannel({
        id: "gemini",
        baseUrl: "https://gemini.example.com",
        apiKey: "gemini-key",
        apiFormat: "gemini",
        requestMode: "direct",
        models: ["gemini-3-pro"],
    });
    const selectedModel = encodeChannelModel("gemini", "gemini-3-pro");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            textModel: selectedModel,
            systemPrompt: "渠道系统提示词",
        },
        [channel],
    );

    const result = await requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [{ role: "user", content: "生成一张图片" }],
        tools: [],
        allowTools: false,
    });

    assert.equal(result.content, "完成");
    assert.equal(requestBody.systemInstruction?.parts?.[0]?.text, "渠道系统提示词\n\n创意 Agent 提示词");
});

test("画布 Agent 保留并在下一轮 Gemini 工具调用中回传 thoughtSignature", async (context) => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Array<{
        contents?: Array<{
            role?: string;
            parts?: Array<{
                functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
                thoughtSignature?: string;
            }>;
        }>;
    }> = [];
    globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return new Response('data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call-1","name":"generate_image","args":{"prompt":"一只猫"}},"thoughtSignature":"gemini-signature"}]}}]}\n\n', {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        });
    };
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    const channel = createModelChannel({
        id: "gemini-signature",
        baseUrl: "https://gemini.example.com",
        apiKey: "gemini-key",
        apiFormat: "gemini",
        requestMode: "direct",
        models: ["gemini-3-pro"],
    });
    const selectedModel = encodeChannelModel("gemini-signature", "gemini-3-pro");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local", textModel: selectedModel }, [channel]);
    const tools = [
        {
            type: "function" as const,
            function: {
                name: "generate_image",
                description: "生成图片",
                parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
            },
        },
    ];

    const firstTurn = await requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [{ role: "user", content: "生成一张猫的图片" }],
        tools,
        allowTools: true,
    });

    assert.deepEqual(firstTurn.toolCalls, [
        {
            id: "call-1",
            name: "generate_image",
            arguments: { prompt: "一只猫" },
            thoughtSignature: "gemini-signature",
        },
    ]);

    await requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [
            { role: "user", content: "生成一张猫的图片" },
            { role: "assistant", toolCalls: firstTurn.toolCalls },
            { role: "tool", toolCallId: "call-1", name: "generate_image", content: '{"ok":true}' },
        ],
        tools,
        allowTools: true,
    });

    const assistantContent = requestBodies[1]?.contents?.find((content) => content.role === "model");
    assert.deepEqual(assistantContent?.parts?.[0], {
        functionCall: { id: "call-1", name: "generate_image", args: { prompt: "一只猫" } },
        thoughtSignature: "gemini-signature",
    });
});

test("画布 Agent 不向模型插件传递 Gemini thoughtSignature", async (context) => {
    const originalWorker = globalThis.Worker;
    let pluginMessages: Array<Record<string, unknown>> = [];

    class FakeWorker {
        private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

        addEventListener(type: string, listener: (event: MessageEvent) => void) {
            this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }

        postMessage(message: { runId: string; args?: { messages?: Array<Record<string, unknown>> } }) {
            pluginMessages = message.args?.messages || [];
            queueMicrotask(() => {
                for (const listener of this.listeners.get("message") || []) {
                    listener({ data: { runId: message.runId, type: "result", result: { content: "完成", toolCalls: [] } } } as MessageEvent);
                }
            });
        }

        terminate() {}
    }

    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    context.after(() => {
        globalThis.Worker = originalWorker;
    });

    const script = "return { content: '完成' }";
    const channel = createModelChannel({
        id: "plugin-signature",
        baseUrl: "https://plugin.example.com",
        apiKey: "plugin-key",
        apiFormat: "gemini",
        models: ["plugin-model"],
        modelScripts: { "plugin-model": { text: script } },
        modelScriptApprovals: { "plugin-model": { text: modelScriptFingerprint(script) } },
    });
    const selectedModel = encodeChannelModel("plugin-signature", "plugin-model");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local", textModel: selectedModel }, [channel]);

    await requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [
            {
                role: "assistant",
                toolCalls: [{ id: "call-1", name: "generate_image", arguments: { prompt: "一只猫" }, thoughtSignature: "gemini-signature" }],
            },
        ],
        tools: [],
        allowTools: false,
    });

    const toolCall = (pluginMessages[1]?.tool_calls as Array<Record<string, unknown>> | undefined)?.[0];
    assert.equal(toolCall?.thoughtSignature, undefined);
});

test("画布 Agent 降级 JSON 模式时把工具历史转换为普通文本", async () => {
    const requestBodies: Array<{
        tools?: unknown;
        tool_choice?: unknown;
        messages?: Array<Record<string, unknown>>;
    }> = [];
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            requestBodies.push(body);
            response.setHeader("content-type", "application/json");
            if (body.tools) {
                response.statusCode = 400;
                response.end(JSON.stringify({ error: { message: "tools are not supported" } }));
                return;
            }
            response.end(JSON.stringify({ choices: [{ message: { content: '{"reply":"完成","actions":[]}' } }] }));
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const channel = createModelChannel({
            id: "json-fallback",
            baseUrl: `http://127.0.0.1:${address.port}`,
            apiKey: "fallback-key",
            requestMode: "direct",
            models: ["fallback-model"],
        });
        const selectedModel = encodeChannelModel("json-fallback", "fallback-model");
        const config = withLocalChannels({ ...defaultConfig, channelMode: "local", textModel: selectedModel }, [channel]);
        const tools = [
            {
                type: "function" as const,
                function: {
                    name: "generate_image",
                    description: "生成图片",
                    parameters: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
                },
            },
        ];
        const messages = [
            { role: "user" as const, content: "生成一张猫的图片" },
            {
                role: "assistant" as const,
                content: "我来生成图片",
                toolCalls: [{ id: "call-1", name: "generate_image", arguments: { prompt: "一只猫" }, thoughtSignature: "gemini-signature" }],
            },
            { role: "tool" as const, toolCallId: "call-1", name: "generate_image", content: '{"ok":true,"nodeId":"image-1"}' },
        ];

        const result = await requestCanvasAgentTurn({
            config,
            systemPrompt: "创意 Agent 提示词",
            messages,
            tools,
            allowTools: true,
        });
        await requestCanvasAgentTurn({
            config,
            systemPrompt: "创意 Agent 提示词",
            messages,
            tools,
            allowTools: false,
        });

        assert.equal(result.usedJsonFallback, true);
        assert.equal(requestBodies.length, 3);
        assert.ok(requestBodies[0]?.tools);
        for (const fallbackBody of requestBodies.slice(1)) {
            assert.equal(fallbackBody.tools, undefined);
            assert.equal(fallbackBody.tool_choice, undefined);
            assert.deepEqual(
                fallbackBody.messages?.map((message) => message.role),
                ["system", "user", "assistant", "user"],
            );
            assert.equal(
                fallbackBody.messages?.some((message) => "tool_calls" in message),
                false,
            );
            assert.match(String(fallbackBody.messages?.[2]?.content), /工具调用：generate_image/);
            assert.match(String(fallbackBody.messages?.[2]?.content), /一只猫/);
            assert.match(String(fallbackBody.messages?.[3]?.content), /工具执行结果：generate_image/);
            assert.match(String(fallbackBody.messages?.[3]?.content), /image-1/);
        }
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("停止画布 Agent 时保留 AbortError 语义", async (context) => {
    const originalWorker = globalThis.Worker;
    let terminated = false;

    class HangingWorker {
        addEventListener() {}
        postMessage() {}
        terminate() {
            terminated = true;
        }
    }

    globalThis.Worker = HangingWorker as unknown as typeof Worker;
    context.after(() => {
        globalThis.Worker = originalWorker;
    });

    const script = "return { content: '不会返回' }";
    const channel = createModelChannel({
        id: "abort",
        baseUrl: "https://abort.example.com",
        apiKey: "abort-key",
        models: ["abort-model"],
        modelScripts: { "abort-model": { text: script } },
        modelScriptApprovals: { "abort-model": { text: modelScriptFingerprint(script) } },
    });
    const selectedModel = encodeChannelModel("abort", "abort-model");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local", textModel: selectedModel }, [channel]);
    const controller = new AbortController();
    const request = requestCanvasAgentTurn({
        config,
        systemPrompt: "创意 Agent 提示词",
        messages: [{ role: "user", content: "停止测试" }],
        tools: [],
        allowTools: false,
        signal: controller.signal,
    });

    controller.abort();
    await assert.rejects(request, (error: unknown) => error instanceof Error && error.name === "AbortError");
    assert.equal(terminated, true);
});
