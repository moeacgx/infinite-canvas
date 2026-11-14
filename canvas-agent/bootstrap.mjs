#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
const files = ["package.json", "package-lock.json", "index.mjs", "codex.mjs"]
    .map((file) => [file, readFileSync(join(root, file))]);
const digest = createHash("sha256").update(`${process.platform}/${process.arch}/${process.versions.node.split(".")[0]}`);
for (const [file, content] of files) digest.update(file).update(content);
const runtime = join(root, ".runtime", digest.digest("hex"));
const lockKey = process.platform === "win32" ? root.toLowerCase() : root;
const lockHash = createHash("sha256").update(lockKey).digest();
// Windows 管道和 Linux 抽象套接字均不占 TCP 端口，进程退出即释放名称。
const lockAddress = process.platform === "win32"
    ? { path: "\\\\.\\pipe\\canvas-agent-install-" + lockHash.toString("hex") }
    : process.platform === "linux"
        ? { path: "\0canvas-agent-install-" + lockHash.toString("hex") }
        : { host: "127.0.0.1", port: 20000 + lockHash.readUInt32BE(0) % 12000, exclusive: true };

async function acquireLock() {
    const server = createServer((socket) => socket.destroy());
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(lockAddress, resolve);
        });
        return () => new Promise((resolve) => server.close(resolve));
    } catch (error) {
        if (error.code === "EADDRINUSE") return null;
        throw error;
    }
}

function npmCommand() {
    const candidates = [
        process.env.npm_execpath,
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
        join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
        ...(process.env.PATH || "").split(delimiter).flatMap((directory) => {
            const command = join(directory, process.platform === "win32" ? "npm.cmd" : "npm");
            if (!existsSync(command)) return [];
            return process.platform === "win32"
                ? [join(directory, "node_modules/npm/bin/npm-cli.js")]
                : [command];
        }),
    ];
    const cli = candidates.find((candidate) => candidate && existsSync(candidate));
    if (!cli) throw new Error("未找到 npm，请安装包含 npm 的 Node.js 22+ 后重试");
    // Unix 的 npm 可能是版本管理器的 shell shim，应由系统按 shebang 执行。
    return process.platform !== "win32" && !/\.[cm]?js$/.test(cli)
        ? { command: cli, args: [] }
        : { command: process.execPath, args: [cli] };
}

function run(command, args, timeout, message, cwd, stdio = ["ignore", 2, 2]) {
    return new Promise((resolve, reject) => {
        // 直接传参数数组；所有安装与校验日志写入 stderr，不污染 MCP stdout。
        const child = spawn(command, args, {
            cwd, stdio, windowsHide: true, detached: process.platform !== "win32",
        });
        let termination;
        const stop = () => {
            if (termination || !child.pid || child.exitCode !== null) return;
            // 取消或超时时回收整棵安装进程树，避免后台 npm 继续改写插件目录。
            termination = new Promise((done) => {
                if (process.platform === "win32") {
                    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
                    killer.once("error", () => { child.kill(); done(); });
                    killer.once("exit", done);
                } else {
                    try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
                        if (error.code !== "ESRCH") child.kill();
                    }
                    done();
                }
            });
        };
        const timer = setTimeout(stop, timeout);
        process.on("SIGTERM", stop);
        process.on("SIGINT", stop);
        const cleanup = () => {
            clearTimeout(timer);
            process.off("SIGTERM", stop);
            process.off("SIGINT", stop);
        };
        child.once("error", (error) => { cleanup(); reject(error); });
        child.once("exit", async (code, signal) => {
            cleanup();
            await termination;
            if (code === 0 && !termination) resolve();
            else reject(new Error(`${message}（${signal || code}），请检查错误信息后重试`));
        });
    });
}

async function install() {
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Canvas Agent 需要 Node.js 22+");
    const deadline = Date.now() + 150000;
    while (!existsSync(runtime)) {
        const release = await acquireLock();
        if (!release) {
            if (Date.now() >= deadline) throw new Error("等待插件依赖安装超时，请稍后重试");
            await delay(200);
            continue;
        }
        try {
            if (existsSync(runtime)) return;
            mkdirSync(dirname(runtime), { recursive: true });
            const staging = mkdtempSync(join(dirname(runtime), "install-"));
            // 等锁期间源码可能更新，指纹与发布文件必须来自同一份快照。
            for (const [file, content] of files) writeFileSync(join(staging, file), content);
            console.error("正在安装本仓库 Canvas Agent 的锁定依赖…");
            const npm = npmCommand();
            await run(npm.command, [...npm.args, "ci", "--omit=dev", "--no-audit", "--no-fund"], 120000, "插件依赖安装失败", staging);
            // npm 可选依赖下载失败仍可能返回 0，必须确认本平台 Codex 二进制可运行。
            await run(process.execPath, [join(staging, "node_modules/@openai/codex/bin/codex.js"), "--version"], 10000, "Codex 平台程序安装不完整", staging);
            // 仅发布完整目录；中断后仍存活的 npm 只能写入自己的临时目录。
            renameSync(staging, runtime);
            return;
        } finally {
            await release();
        }
    }
}

try {
    await install();
    if (process.argv[2] === "login") {
        await run(process.execPath, [join(runtime, "node_modules/@openai/codex/bin/codex.js"), "login"], 180000, "Codex 登录失败", runtime, "inherit");
    } else {
        await import(pathToFileURL(join(runtime, "index.mjs")).href);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
