import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
function fixture(context) {
    const directory = mkdtempSync(join(tmpdir(), "画布 plugin "));
    context.after(() => {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        rmSync(directory, { recursive: true, force: true });
    });
    copyFileSync(new URL("../bootstrap.mjs", import.meta.url), join(directory, "bootstrap.mjs"));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "bootstrap-fixture", type: "module" }));
    writeFileSync(join(directory, "package-lock.json"), "{}");
    writeFileSync(join(directory, "index.mjs"), 'console.log(JSON.stringify({ mode: process.argv[2], ready: true }));');
    writeFileSync(join(directory, "npm-cli.mjs"), `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["ci", "--omit=dev", "--no-audit", "--no-fund"]);
appendFileSync("installs.txt", "install\\n");
console.log("npm stdout");
console.error("npm stderr");
await new Promise(resolve => setTimeout(resolve, 250));
if (process.env.FIXTURE_FAIL) process.exit(1);
mkdirSync("node_modules", { recursive: true });
if (!process.env.FIXTURE_MISSING_BINARY) {
    mkdirSync("node_modules/@openai/codex/bin", { recursive: true });
    writeFileSync("node_modules/@openai/codex/bin/codex.js", 'console.log("codex test version");');
}
`);
    const run = (env = {}) => exec(process.execPath, [join(directory, "bootstrap.mjs"), "mcp"], {
        cwd: tmpdir(), env: { ...process.env, npm_execpath: join(directory, "npm-cli.mjs"), ...env },
        windowsHide: true, timeout: 10000,
    });
    return { directory, run };
}

test("中文空格路径首次安装：npm 日志不污染 MCP 标准输出", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    const result = await run();
    assert.deepEqual(JSON.parse(result.stdout), { mode: "mcp", ready: true });
    assert.match(result.stderr, /npm stdout/);
    assert.match(result.stderr, /npm stderr/);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
    await run();
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
    writeFileSync(join(directory, "package-lock.json"), '{"changed":true}');
    await run();
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\ninstall\n");
});

test("并发启动只安装一次，各 MCP 进程均能进入入口", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    const results = await Promise.all([run(), run(), run()]);
    for (const result of results) assert.equal(JSON.parse(result.stdout).ready, true);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
    assert.equal(existsSync(join(directory, ".install-lock")), false);
});

test("安装失败不运行入口、不写成功标记，并允许重试", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    await assert.rejects(run({ FIXTURE_FAIL: "1" }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /插件依赖安装失败/);
        return true;
    });
    assert.equal(existsSync(join(directory, ".install-lock")), false);
    assert.equal(existsSync(join(directory, "node_modules", ".canvas-agent-ready")), false);
    assert.equal(JSON.parse((await run()).stdout).ready, true);
});

test("npm 成功但 Codex 平台包缺失时不标记成功，后续可重试", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    await assert.rejects(run({ FIXTURE_MISSING_BINARY: "1" }), (error) => {
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /Codex 平台程序安装不完整/);
        return true;
    });
    assert.equal(existsSync(join(directory, "node_modules", ".canvas-agent-ready")), false);
    assert.equal(JSON.parse((await run()).stdout).ready, true);
});

test("插件市场与启动入口独立，锁文件包含全部 Codex 平台包", () => {
    const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
    const marketplace = read("../../.agents/plugins/marketplace.json");
    const plugin = read("../.codex-plugin/plugin.json");
    const mcp = read("../.mcp.json").mcpServers["infinite-canvas"];
    const pkg = read("../package.json");
    const lock = read("../package-lock.json");
    assert.equal(marketplace.name, "infinite-canvas-moe");
    assert.equal(plugin.repository, "https://github.com/moeacgx/infinite-canvas");
    assert.equal(pkg.name, "@moeacgx/canvas-agent");
    assert.equal(pkg.private, true);
    assert.equal(plugin.version, pkg.version);
    assert.equal(lock.version, pkg.version);
    assert.equal(mcp.command, "node");
    assert.equal(mcp.cwd, ".");
    assert.deepEqual(mcp.args, ["bootstrap.mjs", "mcp"]);
    for (const platform of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]) {
        assert.ok(lock.packages[`node_modules/@openai/codex-${platform}`]);
    }
});
