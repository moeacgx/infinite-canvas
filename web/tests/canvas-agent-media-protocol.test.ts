import assert from "node:assert/strict";
import test from "node:test";

import { CANVAS_AGENT_TOOLS, normalizeCanvasAgentAction, sanitizeCanvasAgentToolNameForDisplay } from "../src/app/(user)/canvas/agent/canvas-agent-tools.ts";

const mediaTools = ["generate_image", "edit_image", "generate_video", "generate_audio"] as const;

test("所有媒体工具都在协议层强制显式提供 sourceNodeIds", () => {
    for (const name of mediaTools) {
        const definition = CANVAS_AGENT_TOOLS.find((tool) => tool.function.name === name);
        assert.ok(definition, `缺少 ${name} 工具定义`);
        assert.ok(definition.function.parameters.required?.includes("sourceNodeIds"), `${name} 未声明 sourceNodeIds 为必填`);
        assert.throws(() => normalizeCanvasAgentAction(name, { prompt: "测试" }), /sourceNodeIds/);
    }
});

test("独立生成必须显式传空素材数组，图片编辑仍要求真实来源", () => {
    assert.deepEqual(normalizeCanvasAgentAction("generate_image", { prompt: "猫", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.deepEqual(normalizeCanvasAgentAction("generate_video", { prompt: "猫在奔跑", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.deepEqual(normalizeCanvasAgentAction("generate_audio", { prompt: "旁白", sourceNodeIds: [] }).arguments.sourceNodeIds, []);
    assert.throws(() => normalizeCanvasAgentAction("edit_image", { prompt: "改成夜景", sourceNodeIds: [] }), /图片来源节点/);
});

test("媒体工具保留 Agent 可配置的图片和视频规格", () => {
    const image = normalizeCanvasAgentAction("generate_image", {
        prompt: "产品图",
        sourceNodeIds: [],
        size: "2048x1152",
        quality: "high",
        count: 3,
        background: "transparent",
    });
    assert.deepEqual(image.arguments, {
        prompt: "产品图",
        sourceNodeIds: [],
        size: "2048x1152",
        quality: "high",
        count: 3,
        background: "transparent",
    });

    const video = normalizeCanvasAgentAction("generate_video", {
        prompt: "横向推进镜头",
        sourceNodeIds: [],
        size: "1280x720",
        quality: "1080",
        seconds: 10,
        generateAudio: true,
    });
    assert.deepEqual(video.arguments, {
        prompt: "横向推进镜头",
        sourceNodeIds: [],
        size: "1280x720",
        quality: "1080",
        seconds: 10,
        generateAudio: true,
    });
});

test("Claude 和中转站的白名单工具命名变体会归一化", () => {
    const prefixed = normalizeCanvasAgentAction("functions.generate_image", { prompt: "庄园里的猫", sourceNodeIds: [] });
    const camelCase = normalizeCanvasAgentAction("getGenerationConfig", {});
    const canvasPrefix = normalizeCanvasAgentAction("canvas/editImage", { prompt: "把猫放进庄园", sourceNodeIds: ["estate", "cat"] });

    assert.equal(prefixed.name, "generate_image");
    assert.equal(camelCase.name, "get_generation_config");
    assert.equal(canvasPrefix.name, "edit_image");
});

test("工具名白名单拒绝描述性文本、多层命名空间和任意前后文", () => {
    assert.throws(() => normalizeCanvasAgentAction("不要调用 delete_node", { nodeId: "estate" }), /不要调用 delete_node/);
    assert.throws(() => normalizeCanvasAgentAction("evil.functions.edit_image", { prompt: "庄园里的猫", sourceNodeIds: ["estate", "cat"] }), /evil\.functions\.edit_image/);
    assert.throws(() => normalizeCanvasAgentAction("functions.tools.edit_image", { prompt: "庄园里的猫", sourceNodeIds: ["estate", "cat"] }), /functions\.tools\.edit_image/);
    assert.throws(() => normalizeCanvasAgentAction("前缀edit_image", { prompt: "庄园里的猫", sourceNodeIds: ["estate", "cat"] }), /前缀edit_image/);
    assert.throws(() => normalizeCanvasAgentAction("edit_image后缀", { prompt: "庄园里的猫", sourceNodeIds: ["estate", "cat"] }), /edit_image后缀/);
    assert.throws(() => normalizeCanvasAgentAction("untrusted.edit_image", { prompt: "庄园里的猫", sourceNodeIds: ["estate", "cat"] }), /untrusted\.edit_image/);
    assert.throws(() => normalizeCanvasAgentAction("compose_image", { prompt: "庄园里的猫" }), /compose_image.*edit_image.*get_generation_config/);
});

test("工具名错误显示会移除控制字符并限制长度", () => {
    const sanitized = sanitizeCanvasAgentToolNameForDisplay(`\u202ecompose_image\u0000${"x".repeat(200)}`);

    assert.equal(sanitized.length, 120);
    assert.match(sanitized, /^compose_image/);
    assert.doesNotMatch(sanitized, /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
});
