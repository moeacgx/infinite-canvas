# Canvas Agent

由 `moeacgx/infinite-canvas` 独立分发的 Codex 插件和本地 Agent。网页对话与插件 MCP 使用本仓库同一套服务，画布工具沿用网页现有实现。

## 安装插件

本机需要 Node.js 22+（含 npm）和支持插件的 Codex。在 Codex 所在电脑执行：

```sh
codex plugin marketplace add https://github.com/moeacgx/infinite-canvas.git
codex plugin add canvas-agent@infinite-canvas-moe
```

新建 Codex 对话，说“帮我打开并连接到 Infinite Canvas”，并沿用当前画布地址。插件首次运行自动安装锁定依赖，由连接 Skill 启动本仓库 Agent 并传入连接信息，无需另外克隆源码、手动安装依赖或手动启动服务。浏览器的本地网络权限提示由用户允许。

市场定义 `.agents/plugins/marketplace.json` 指向本仓库 `canvas-agent` 目录。MCP 以插件目录为工作目录执行 `node bootstrap.mjs mcp`，服务和连接命令也使用同一入口。更新通过本仓库插件市场获取，不下载上游 Canvas Agent npm 包；本仓库无需另行发布 npm 包。`@openai/codex` 等第三方依赖由 `package-lock.json` 锁定。

## 从旧插件切换

已安装上游插件时，先执行：

```sh
codex plugin remove canvas-agent@infinite-canvas
```

若曾手动添加旧 MCP，再执行 `codex mcp remove infinite-canvas`。停止之前运行的旧 Agent，然后安装上方本仓库插件并新建对话。移除插件不会自动停止已启动的后台服务；默认端口被占用时应先确认旧服务来源，不终止未知进程。

本仓库使用独立配置目录 `~/.infinite-canvas-moe/`，不会读取上游连接配置；首次生成新的 Token，重新通过插件打开画布即可自动更新网页连接信息。移除本仓库插件使用 `codex plugin remove canvas-agent@infinite-canvas-moe`。

## 可选：源码启动与直接注册 MCP

已有本仓库源码时，在仓库根目录执行：

```sh
node canvas-agent/bootstrap.mjs
```

首次自动安装依赖并生成 Token，保存在当前用户的 `~/.infinite-canvas-moe/codex-agent.json`。终端显示 `Local URL` 和 `Connect token`，默认地址为 `http://127.0.0.1:3210`；连接期间保持服务运行。网页与 Agent 必须在同一台电脑，无需创建 `.env`。

直接注册 MCP 与安装插件二选一（路径替换为本仓库真实绝对路径）：

```sh
codex mcp add infinite-canvas -- node "<仓库绝对路径>/canvas-agent/bootstrap.mjs" mcp
```

直接注册 MCP 不包含自动打开 Skill，需要先启动服务并连接画布。移除使用 `codex mcp remove infinite-canvas`。

## 本机配置与范围

`node canvas-agent/bootstrap.mjs config` 输出 `{url, token, origins}`；首次尚未启动时提示先启动服务。HTTP `GET /config` 只提供地址、是否设置 Token，以及 `distribution`、`version`，不返回 Token。连接 Skill 核对服务来源与插件版本后才复用服务。

`node canvas-agent/bootstrap.mjs open "<原画布URL>" <浏览器> [浏览器参数...]` 自动带入凭据并打开原浏览器。支持 `chrome`、`edge`、`firefox`、`brave`、`default`，必须保持原浏览器与配置文件；画布路由为 `/canvas/[id]`。Token 只写入 URL fragment，不要分享 Token 或完整连接链接。

`CANVAS_AGENT_TOKEN`、`CANVAS_AGENT_PORT`、`CANVAS_AGENT_ORIGINS` 可选覆盖 Token、端口和预置来源；通常无需设置。Codex 未登录时，依赖就绪后执行 `node canvas-agent/node_modules/@openai/codex/bin/codex.js login`；不读取或复制账号凭据。

外部 MCP 默认操作唯一已连接的画布；多个画布连接时，通过 `CANVAS_AGENT_CLIENT_ID` 明确目标。默认权限为 `workspace-write` 与 `on-request`，模型工作目录为独立的 `~/.infinite-canvas-moe/workspace`，与 Agent 程序隔离。服务不改写 Codex 全局配置。

依赖安装有进程锁，MCP 和连接命令同时启动也只安装一次。安装日志写入 stderr，不污染 MCP 协议；下载失败可以重试。若安装进程被强制结束后留下 `.install-lock`，确认没有安装进程运行后移除该锁再重试。

## 回归测试

在 `canvas-agent` 目录运行：

```sh
node --experimental-test-module-mocks --test --test-timeout=60000 tests/bootstrap.test.mjs tests/bridge.test.mjs tests/plugin-install.test.mjs
```

服务测试使用模拟 Codex；安装测试使用真实 Codex CLI 与临时配置，验证依赖下载和 MCP 握手，不读取本机账号或调用付费模型。CI 在 Windows 与 Linux 验证安装与服务链路。
