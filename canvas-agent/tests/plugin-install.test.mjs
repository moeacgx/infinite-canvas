import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("真实 Codex 安装独立插件，干净缓存自动安装依赖并完成 MCP 握手", { timeout: 60000 }, async (context) => {
    const directory = mkdtempSync(join(tmpdir(), "画布 plugin-install "));
    const home = join(directory, "home");
    const market = join(directory, "market");
    const source = fileURLToPath(new URL("..", import.meta.url));
    const exec = promisify(execFile);
    mkdirSync(home);
    mkdirSync(join(market, ".agents/plugins"), { recursive: true });
    cpSync(new URL("../../.agents/plugins/marketplace.json", import.meta.url), join(market, ".agents/plugins/marketplace.json"));
    cpSync(source, join(market, "canvas-agent"), {
        recursive: true,
        filter: (path) => !path.split(sep).some((part) => ["node_modules", "tests", ".install-lock"].includes(part)),
    });
    const env = { ...process.env, CODEX_HOME: home, HOME: home, USERPROFILE: home };
    // 仅使用临时 Codex 配置，不改动用户已安装插件或账号。
    const codex = async (...args) => {
        const result = await exec(process.execPath, [join(source, "node_modules/@openai/codex/bin/codex.js"), ...args, "--json"], {
            env, cwd: directory, windowsHide: true, timeout: 20000,
        });
        return JSON.parse(result.stdout);
    };
    const client = new Client({ name: "canvas-install-test", version: "1.0" });
    let transport;
    context.after(async () => {
        await transport?.close();
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    assert.equal((await codex("plugin", "marketplace", "add", market)).marketplaceName, "infinite-canvas-moe");
    const installed = await codex("plugin", "add", "canvas-agent@infinite-canvas-moe");
    assert.equal(installed.pluginId, "canvas-agent@infinite-canvas-moe");
    const root = installed.installedPath;
    assert.equal(existsSync(join(root, "node_modules")), false);
    const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers["infinite-canvas"];
    transport = new StdioClientTransport({
        command: process.execPath, args: mcp.args, cwd: join(root, mcp.cwd),
        env, stderr: "pipe",
    });
    const originalClose = transport.close.bind(transport);
    let closing;
    // SDK 的初始化失败也会自行 close，必须在 transport 层统一等待清理完成。
    transport.close = () => closing ||= (async () => {
        if (process.platform === "win32" && transport.pid) {
            await exec("taskkill", ["/pid", String(transport.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => {});
        }
        await originalClose();
    })();
    let installLog = "";
    transport.stderr.on("data", (chunk) => { installLog = (installLog + chunk).slice(-6000); });
    const onAbort = () => { void transport.close(); };
    context.signal.addEventListener("abort", onAbort, { once: true });
    context.after(() => context.signal.removeEventListener("abort", onAbort));
    try {
        await client.connect(transport, { timeout: 40000 });
    } catch (error) {
        error.message += "\n插件安装日志：\n" + installLog;
        throw error;
    }
    assert.equal(client.getServerVersion().version, installed.version);
    assert.deepEqual((await client.listTools()).tools, []);
    assert.equal(existsSync(join(root, "node_modules/.canvas-agent-ready")), true);
    assert.equal(existsSync(join(root, "node_modules/@tigerowo/canvas-agent")), false);
    assert.equal(existsSync(join(home, ".infinite-canvas")), false);
});
