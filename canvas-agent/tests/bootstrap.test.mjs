import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
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
    writeFileSync(join(directory, "codex.mjs"), "");
    writeFileSync(join(directory, "npm-cli.mjs"), `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["ci", "--omit=dev", "--no-audit", "--no-fund"]);
const output = (name) => join(process.env.FIXTURE_DIR, name);
appendFileSync(output("installs.txt"), "install\\n");
if (process.env.FIXTURE_INTERRUPT) {
    writeFileSync(output("install-started"), String(process.pid));
    writeFileSync(output("install-directory"), process.cwd());
    setInterval(() => writeFileSync("index.mjs", 'throw new Error("unfinished install");'), 50);
    await new Promise(() => {});
}
console.log("npm stdout");
console.error("npm stderr");
await new Promise(resolve => setTimeout(resolve, 250));
if (process.env.FIXTURE_FAIL) process.exit(1);
mkdirSync("node_modules", { recursive: true });
if (!process.env.FIXTURE_MISSING_BINARY) {
    mkdirSync("node_modules/@openai/codex/bin", { recursive: true });
    writeFileSync("node_modules/@openai/codex/bin/codex.js", 'console.log(JSON.stringify({codexMode:process.argv[2]}));');
}
`);
    const run = (env = {}, mode = "mcp") => exec(process.execPath, [join(directory, "bootstrap.mjs"), mode], {
        cwd: tmpdir(), env: { ...process.env, npm_execpath: join(directory, "npm-cli.mjs"), FIXTURE_DIR: directory, ...env },
        windowsHide: true, timeout: 10000,
    });
    const published = () => existsSync(join(directory, ".runtime"))
        ? readdirSync(join(directory, ".runtime")).filter((name) => /^[a-f0-9]{64}$/.test(name)) : [];
    return { directory, run, published };
}

test("中文空格路径首次安装：npm 日志不污染 MCP 标准输出", { timeout: 15000 }, async (context) => {
    const { directory, run, published } = fixture(context);
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
    assert.equal(published().length, 2);
});

test("并发启动只安装一次，各 MCP 进程均能进入入口", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    const results = await Promise.all([run(), run(), run()]);
    for (const result of results) assert.equal(JSON.parse(result.stdout).ready, true);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
    assert.equal(existsSync(join(directory, ".install-lock")), false);
});

test("首次安装强制中断后，同一插件目录可并发重试且只重新安装一次", { timeout: 20000 }, async (context) => {
    const { directory, run } = fixture(context);
    const child = spawn(process.execPath, [join(directory, "bootstrap.mjs"), "mcp"], {
        cwd: directory, env: { ...process.env, npm_execpath: join(directory, "npm-cli.mjs"), FIXTURE_DIR: directory, FIXTURE_INTERRUPT: "1" },
        stdio: "ignore", windowsHide: true,
    });
    const exited = once(child, "exit");
    let npmPid;
    const stop = async () => {
        if (child.exitCode === null && child.signalCode === null) {
            if (process.platform === "win32") await exec("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
            else child.kill("SIGKILL");
        }
        await exited;
        if (npmPid) {
            try { process.kill(npmPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
    };
    try {
        const deadline = Date.now() + 5000;
        while (!existsSync(join(directory, "install-started"))) {
            assert.ok(Date.now() < deadline, "模拟安装没有开始");
            await delay(20);
        }
        npmPid = Number(readFileSync(join(directory, "install-started"), "utf8"));
    } finally {
        await stop();
    }
    // 保留中断现场，不删除插件目录或锁文件。
    const results = await Promise.all([run(), run(), run()]);
    for (const result of results) assert.equal(JSON.parse(result.stdout).ready, true);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\ninstall\n");
});

test("中断目录仍被后台进程写入时，重试不会被未完成安装污染", { timeout: 20000 }, async (context) => {
    const { directory, run, published } = fixture(context);
    const child = spawn(process.execPath, [join(directory, "bootstrap.mjs"), "mcp"], {
        cwd: directory, env: { ...process.env, npm_execpath: join(directory, "npm-cli.mjs"), FIXTURE_DIR: directory, FIXTURE_INTERRUPT: "1" },
        stdio: "ignore", windowsHide: true,
    });
    const exited = once(child, "exit");
    let npmPid;
    let writer;
    let writerExited;
    try {
        const deadline = Date.now() + 5000;
        while (!existsSync(join(directory, "install-started"))) {
            assert.ok(Date.now() < deadline, "模拟安装没有开始");
            await delay(20);
        }
        npmPid = Number(readFileSync(join(directory, "install-started"), "utf8"));
        // 独立进程模拟仍存活的安装写入者，避免测试环境的进程树回收消除这一边界。
        const staging = readFileSync(join(directory, "install-directory"), "utf8");
        writer = spawn(process.execPath, ["--input-type=module", "-e", 'import {writeFileSync} from "node:fs"; setInterval(() => writeFileSync("index.mjs", \'throw new Error("unfinished install");\'), 20);'], {
            cwd: staging, stdio: "ignore", windowsHide: true,
        });
        writerExited = once(writer, "exit");
        child.kill("SIGKILL");
        await exited;
        process.kill(writer.pid, 0);
        assert.equal(JSON.parse((await run()).stdout).ready, true);
        await delay(150);
        process.kill(writer.pid, 0);
        assert.equal(JSON.parse((await run()).stdout).ready, true);
        assert.equal(published().length, 1);
        assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\ninstall\n");
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
        if (writer) {
            writer.kill("SIGKILL");
            await writerExited;
        }
        if (npmPid) {
            try { process.kill(npmPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                try { process.kill(npmPid, 0); } catch { break; }
                await delay(20);
            }
        }
    }
});

test("旧版失效文件锁不会阻塞新启动", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    writeFileSync(join(directory, ".install-lock"), "99999999");
    assert.equal(JSON.parse((await run()).stdout).ready, true);
});

test("登录命令使用已发布运行目录中的 Codex，不启动画布服务", { timeout: 15000 }, async (context) => {
    const { directory, run } = fixture(context);
    assert.deepEqual(JSON.parse((await run({}, "login")).stdout), { codexMode: "login" });
    assert.equal(JSON.parse((await run()).stdout).ready, true);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
});

test("读取源码后文件发生变化，发布内容与运行目录指纹仍保持一致", { timeout: 15000 }, async (context) => {
    const { directory, run, published } = fixture(context);
    const original = readFileSync(join(directory, "index.mjs"), "utf8");
    const preload = join(directory, "change-source.mjs");
    writeFileSync(preload, `
import fs from "node:fs";
import {join} from "node:path";
import {syncBuiltinESMExports} from "node:module";
const source = join(fs.realpathSync(process.env.FIXTURE_DIR), "index.mjs");
const read = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
    const result = read(file, ...args);
    if (String(file) === source) fs.writeFileSync(source, 'console.log(JSON.stringify({ready:"changed"}));');
    return result;
};
syncBuiltinESMExports();
`);
    const result = await exec(process.execPath, ["--import", pathToFileURL(preload).href, join(directory, "bootstrap.mjs"), "mcp"], {
        cwd: directory, env: { ...process.env, npm_execpath: join(directory, "npm-cli.mjs"), FIXTURE_DIR: directory },
        windowsHide: true, timeout: 10000,
    });
    assert.equal(JSON.parse(result.stdout).ready, true);
    assert.match(readFileSync(join(directory, "index.mjs"), "utf8"), /changed/);
    writeFileSync(join(directory, "index.mjs"), original);
    assert.equal(JSON.parse((await run()).stdout).ready, true);
    assert.equal(published().length, 1);
    assert.equal(readFileSync(join(directory, "installs.txt"), "utf8"), "install\n");
});

test("安装失败不运行入口、不发布运行目录，并允许重试", { timeout: 15000 }, async (context) => {
    const { directory, run, published } = fixture(context);
    await assert.rejects(run({ FIXTURE_FAIL: "1" }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /插件依赖安装失败/);
        return true;
    });
    assert.equal(existsSync(join(directory, ".install-lock")), false);
    assert.deepEqual(published(), []);
    assert.equal(JSON.parse((await run()).stdout).ready, true);
});

test("npm 成功但 Codex 平台包缺失时不发布运行目录，后续可重试", { timeout: 15000 }, async (context) => {
    const { directory, run, published } = fixture(context);
    await assert.rejects(run({ FIXTURE_MISSING_BINARY: "1" }), (error) => {
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /Codex 平台程序安装不完整/);
        return true;
    });
    assert.deepEqual(published(), []);
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
