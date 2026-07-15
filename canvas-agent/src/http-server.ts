import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import {
  DEFAULT_PORT,
  VERSION,
  ensureSiteWorkspace,
  loadConfig,
  saveConfig,
  updateSiteWorkspace,
  type CanvasAgentConfig,
} from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import {
  archiveCodexThread,
  interruptCodexTurn,
  listCodexThreads,
  readCodexThread,
  resumeCodexThread,
  runClaudeTurn,
  runCodexTurn,
  startCodexThread,
  summarizeCodexThread,
  verifyCodexThreadWorkspace,
  withAgentPrompt,
} from "./agents.js";
import { handleChannelProxy } from "./channel-proxy.js";
import type { AgentAttachment } from "./types.js";

export function startHttpServer() {
  const config = loadConfig(true);
  const port =
    Number(process.env.PORT) ||
    Number(new URL(config.url).port) ||
    DEFAULT_PORT;
  config.url = `http://127.0.0.1:${port}`;
  saveConfig(config);

  const session = new CanvasSession();
  const emit = (type: string, payload: unknown) =>
    session.emitAll(type, payload);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const url = requestUrl(req, config);
    if (!setCors(req, res, url, config))
      return void res
        .status(403)
        .json({ ok: false, error: "origin not allowed" });
    if (req.method === "OPTIONS") return void res.json({});
    next();
  });
  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...session.health(),
      version: VERSION,
      capabilities: ["channel-proxy"],
    });
  });
  app.get("/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      url: config.url,
      hasToken: true,
      version: VERSION,
      capabilities: ["channel-proxy"],
    });
  });
  app.use((req, res, next) => {
    if (validToken(req, requestUrl(req, config), config.token)) return next();
    res.status(401).json({ ok: false, error: "invalid token" });
  });
  // 渠道转发保留原始请求体，必须放在 JSON 解析器之前；鉴权仍先于大请求体读取。
  app.post("/channel-proxy", route(handleChannelProxy));
  app.use(express.json({ limit: "30mb" }));
  app.get("/events", (req, res) =>
    session.openEvents(requestUrl(req, config), res),
  );
  app.post("/canvas/state", (req, res) => {
    session.updateState(
      req.body,
      String(req.query.clientId || "") || undefined,
    );
    res.json({ ok: true });
  });
  app.post("/canvas/result", (req, res) => {
    session.resolveResult(req.body);
    res.json({ ok: true });
  });
  app.post(
    "/api/tools",
    route(async (req, res) =>
      res.json({
        ok: true,
        result: await session.callTool(req.body?.name, req.body?.input || {}),
      }),
    ),
  );
  app.get("/agent/codex/workspace", (_req, res) => {
    const workspace = ensureSiteWorkspace(config);
    res.json({ ok: true, workspace });
  });
  app.get(
    "/agent/codex/threads",
    route(async (req, res) => {
      const workspace = ensureSiteWorkspace(config);
      const result = await listCodexThreads(emit, {
        cwd: workspace.workspacePath,
        searchTerm: String(req.query.searchTerm || ""),
      });
      res.json({ ok: true, workspace, ...result });
    }),
  );
  app.post(
    "/agent/codex/threads/new",
    route(async (_req, res) => {
      const workspace = ensureSiteWorkspace(config);
      const thread = await startCodexThread(emit, workspace.workspacePath);
      const activeThreadId = String(
        (thread as Record<string, unknown>).id || "",
      );
      updateSiteWorkspace(config, { activeThreadId });
      res.json({
        ok: true,
        workspace: { ...workspace, activeThreadId },
        thread: summarizeCodexThread(thread),
        messages: [],
      });
    }),
  );
  app.get(
    "/agent/codex/threads/:threadId",
    route(async (req, res) => {
      const workspace = ensureSiteWorkspace(config);
      const threadId = routeParam(req.params.threadId);
      res.json({
        ok: true,
        workspace,
        ...(await readCodexThread(emit, threadId, workspace.workspacePath)),
      });
    }),
  );
  app.post(
    "/agent/codex/threads/:threadId/resume",
    route(async (req, res) => {
      const workspace = ensureSiteWorkspace(config);
      const threadId = routeParam(req.params.threadId);
      const result = await resumeCodexThread(
        emit,
        threadId,
        workspace.workspacePath,
      );
      updateSiteWorkspace(config, { activeThreadId: threadId });
      res.json({
        ok: true,
        workspace: { ...workspace, activeThreadId: threadId },
        ...result,
      });
    }),
  );
  app.post(
    "/agent/codex/threads/:threadId/delete",
    route(async (req, res) => {
      const workspace = ensureSiteWorkspace(config);
      const threadId = routeParam(req.params.threadId);
      await archiveCodexThread(emit, threadId, workspace.workspacePath);
      if (workspace.activeThreadId === threadId)
        updateSiteWorkspace(config, { activeThreadId: undefined });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/agent/codex/turn",
    route(async (req, res) => {
      const attachments = Array.isArray(req.body?.attachments)
        ? (req.body.attachments as AgentAttachment[])
        : [];
      const workspace = ensureSiteWorkspace(config);
      let threadId = String(
        req.body?.threadId || workspace.activeThreadId || "",
      );
      if (!threadId) {
        const thread = await startCodexThread(emit, workspace.workspacePath);
        threadId = String((thread as Record<string, unknown>).id || "");
        updateSiteWorkspace(config, { activeThreadId: threadId });
      } else if (threadId !== workspace.activeThreadId) {
        await verifyCodexThreadWorkspace(
          emit,
          threadId,
          workspace.workspacePath,
        );
        updateSiteWorkspace(config, { activeThreadId: threadId });
      }
      void runCodexTurn(
        withAgentPrompt(String(req.body?.prompt || "")),
        emit,
        attachments,
        { threadId, cwd: workspace.workspacePath },
      );
      res.json({ ok: true, threadId });
    }),
  );
  app.post("/agent/codex/interrupt", (_req, res) => {
    const ok = interruptCodexTurn();
    res.json({ ok });
  });
  app.post("/agent/claude/turn", (req, res) => {
    runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
    res.json({ ok: true });
  });
  app.use((_req, res) =>
    res.status(404).json({ ok: false, error: "not found" }),
  );
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) =>
    res.status(500).json({ ok: false, error: error.message }),
  );

  app.listen(port, "127.0.0.1", () => {
    console.log("Infinite Canvas Agent");
    console.log(`Local URL: ${config.url}`);
    console.log(`Connect token: ${config.token}`);
    console.log("Codex MCP is not installed by this command.");
    console.log(
      "Optional MCP add: codex mcp add infinite-canvas -- npm exec --yes --package=https://github.com/moeacgx/infinite-canvas/releases/latest/download/canvas-agent.tgz -- canvas-agent mcp",
    );
    console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
  });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) =>
    void handler(req, res).catch(next);
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
  return new URL(req.originalUrl || req.url || "/", config.url);
}

export function setCors(
  req: Request,
  res: Response,
  url: URL,
  config: CanvasAgentConfig,
) {
  const rawOrigin = req.headers.origin;
  const origin = rawOrigin ? normalizedWebOrigin(rawOrigin) : "";
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type,x-canvas-agent-token,x-channel-target,x-channel-method,x-channel-headers",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "cache-control,content-disposition,content-length,content-type,etag,last-modified,x-channel-proxy,x-request-id",
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  // MCP/CLI 是本机非浏览器调用，不携带 Origin；浏览器的 null Origin 不允许配对。
  if (!rawOrigin) return true;
  if (!origin) return false;
  if (
    req.method === "OPTIONS" ||
    url.pathname === "/health" ||
    url.pathname === "/config"
  )
    return true;
  const allowedOrigins = (config.origins || [])
    .map(normalizedWebOrigin)
    .filter(Boolean)
    .slice(-32);
  if (validToken(req, url, config.token) && !allowedOrigins.includes(origin)) {
    allowedOrigins.push(origin);
    config.origins = allowedOrigins.slice(-32);
    saveConfig(config);
  }
  return allowedOrigins.includes(origin);
}

function normalizedWebOrigin(rawOrigin: string) {
  if (rawOrigin === "null") return "";
  try {
    const url = new URL(rawOrigin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === rawOrigin
      ? url.origin
      : "";
  } catch {
    return "";
  }
}

export function validToken(req: Request, url: URL, token: string) {
  const header = req.headers["x-canvas-agent-token"];
  return (
    url.searchParams.get("token") === token ||
    header === token ||
    (Array.isArray(header) && header.includes(token))
  );
}
