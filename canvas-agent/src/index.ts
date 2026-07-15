#!/usr/bin/env node
import { startHttpServer } from "./http-server.js";
import { startMcpServer } from "./mcp-server.js";
import { VERSION } from "./config.js";

const command = process.argv[2];
if (command === "--version" || command === "-v") console.log(VERSION);
else if (command === "--help" || command === "-h")
  console.log("canvas-agent [mcp] [--version]");
else if (command === "mcp") await startMcpServer();
else startHttpServer();
