#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(fileURLToPath(import.meta.url));
const lock = join(root, ".install-lock");
const marker = join(root, "node_modules", ".canvas-agent-ready");
const fingerprint = createHash("sha256").update(readFileSync(join(root, "package.json")))
    .update(readFileSync(join(root, "package-lock.json"))).update(`${process.platform}/${process.arch}/${process.versions.node.split(".")[0]}`).digest("hex");
const ready = () => {
    try { return readFileSync(marker, "utf8") === fingerprint; } catch { return false; }
};

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

function run(command, args, timeout, message) {
    return new Promise((resolve, reject) => {
        // 直接传参数数组；所有安装与校验日志写入 stderr，不污染 MCP stdout。
        const child = spawn(command, args, {
            cwd: root, stdio: ["ignore", 2, 2], windowsHide: true, detached: process.platform !== "win32",
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
            else reject(new Error(`${message}（${signal || code}），请检查 npm 网络后重试`));
        });
    });
}

async function install() {
    if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Canvas Agent 需要 Node.js 22+");
    const deadline = Date.now() + 150000;
    while (!ready()) {
        try {
            writeFileSync(lock, String(process.pid), { flag: "wx" });
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            if (Date.now() >= deadline) throw new Error("等待插件依赖安装超时。若安装进程已退出，请移除插件目录中的 .install-lock 后重试");
            await delay(200);
            continue;
        }
        try {
            if (ready()) return;
            console.error("正在安装本仓库 Canvas Agent 的锁定依赖…");
            const npm = npmCommand();
            await run(npm.command, [...npm.args, "ci", "--omit=dev", "--no-audit", "--no-fund"], 120000, "插件依赖安装失败");
            // npm 可选依赖下载失败仍可能返回 0，必须确认本平台 Codex 二进制可运行。
            await run(process.execPath, [join(root, "node_modules/@openai/codex/bin/codex.js"), "--version"], 10000, "Codex 平台程序安装不完整");
            writeFileSync(marker, fingerprint);
            return;
        } finally {
            unlinkSync(lock);
        }
    }
}

try {
    await install();
    await import(pathToFileURL(join(root, "index.mjs")).href);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
