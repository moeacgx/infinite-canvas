import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseChangelog } from "@/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const releases = parseChangelog(localChangelog);

    return {
        output: "standalone",
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        typescript: {
            ignoreBuildErrors: true,
        },
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
        async headers() {
            return [
                {
                    source: "/model-script-worker.js",
                    headers: [
                        { key: "Content-Security-Policy", value: "default-src 'none'; connect-src 'none'; script-src 'unsafe-eval'; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" },
                        { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
                        { key: "X-Content-Type-Options", value: "nosniff" },
                        { key: "Cache-Control", value: "no-store" },
                    ],
                },
            ];
        },
    };
}
