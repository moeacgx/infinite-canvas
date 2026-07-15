import assert from "node:assert/strict";
import test from "node:test";

import { createModelChannel, defaultConfig, encodeChannelModel, modelScriptFingerprint, resolveModelRequestConfig, resolveModelScript, withLocalChannels, type ModelChannel } from "@/stores/use-config-store";

test("同名模型按渠道和能力分别解析调用脚本", () => {
    const first = createModelChannel({
        id: "one",
        name: "一",
        models: ["same-model"],
        modelScripts: { "same-model": { image: "return 'one-image'", text: "return 'one-text'" } },
        modelScriptApprovals: { "same-model": { image: modelScriptFingerprint("return 'one-image'"), text: modelScriptFingerprint("return 'one-text'") } },
    });
    const second = createModelChannel({
        id: "two",
        name: "二",
        models: ["same-model"],
        modelScripts: { "same-model": { image: "return 'two-image'" } },
        modelScriptApprovals: { "same-model": { image: modelScriptFingerprint("return 'two-image'") } },
    });
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, [first, second]);

    assert.equal(resolveModelScript(config, encodeChannelModel("one", "same-model"), "image"), "return 'one-image'");
    assert.equal(resolveModelScript(config, encodeChannelModel("one", "same-model"), "text"), "return 'one-text'");
    assert.equal(resolveModelScript(config, encodeChannelModel("two", "same-model"), "image"), "return 'two-image'");
    assert.equal(resolveModelScript({ ...config, channelMode: "newapi" }, encodeChannelModel("one", "same-model"), "image"), "");
    assert.equal(resolveModelScript({ ...config, channelMode: "remote" }, encodeChannelModel("one", "same-model"), "image"), "");
});

test("旧字符串模型与官方对象模型都能无损规范化", () => {
    const legacy = createModelChannel({ id: "legacy", models: ["plain-model"] });
    assert.deepEqual(legacy.models, ["plain-model"]);

    const upstream = createModelChannel({
        id: "upstream",
        models: [{ name: "object-model", capability: "video", script: "return { url: 'https://api.example/video.mp4' }" }],
    } as unknown as Partial<ModelChannel>);
    assert.deepEqual(upstream.models, ["object-model"]);
    assert.equal(upstream.modelScripts?.["object-model"]?.video, "return { url: 'https://api.example/video.mp4' }");
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, [upstream]);
    assert.equal(resolveModelScript(config, encodeChannelModel("upstream", "object-model"), "video"), "");
});

test("模型名包含渠道分隔符时调用脚本不会被截断", () => {
    const model = "vendor::special-model";
    const channel = createModelChannel({
        id: "separator",
        models: [model],
        modelScripts: { [model]: { text: "return 'ok'" } },
        modelScriptApprovals: { [model]: { text: modelScriptFingerprint("return 'ok'") } },
    });
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, [channel]);

    assert.deepEqual(channel.models, [model]);
    assert.equal(resolveModelScript(config, encodeChannelModel("separator", model), "text"), "return 'ok'");
});

test("持久化脚本受模型数与单项长度限制", () => {
    const source = "x".repeat(120_000);
    const channel = createModelChannel({ id: "bounded", models: ["m"], modelScripts: { m: { image: source } } });
    assert.equal(channel.modelScripts?.m?.image?.length, 100_000);

    const entries = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`model-${index}`, { text: `return ${index}` }]));
    const bounded = createModelChannel({ id: "entry-limit", models: Object.keys(entries), modelScripts: entries });
    assert.equal(Object.keys(bounded.modelScripts || {}).length, 256);
});

test("每个本地渠道独立保存网络方式并传给实际请求", () => {
    const direct = createModelChannel({ id: "direct", requestMode: "direct", models: ["m1"] });
    const agent = createModelChannel({ id: "agent", requestMode: "agent", models: ["m2"] });
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, [direct, agent]);
    assert.equal(resolveModelRequestConfig(config, encodeChannelModel("direct", "m1")).requestMode, "direct");
    assert.equal(resolveModelRequestConfig(config, encodeChannelModel("agent", "m2")).requestMode, "agent");
});

test("旧版后端兼容配置迁移为本机 Agent", () => {
    const migrated = createModelChannel({ id: "legacy", requestMode: "proxy" as never, models: ["m"] });
    assert.equal(migrated.requestMode, "agent");
});
