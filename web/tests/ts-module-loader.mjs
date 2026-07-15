// Node 原生类型剥离不会读取 tsconfig 的 paths，也不会为 ESM 自动补 .ts 扩展。
// 测试通过这个轻量解析器复用 Next 项目的 @/ 别名和无扩展导入约定。
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(webRoot, "src");
const candidates = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.mts", "/index.js", "/index.mjs"];

async function resolveFile(basePath) {
    for (const suffix of candidates) {
        const candidate = `${basePath}${suffix}`;
        try {
            if ((await stat(candidate)).isFile()) return pathToFileURL(candidate).href;
        } catch {
            // 继续尝试下一个扩展名。
        }
    }
    return null;
}

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
        const url = await resolveFile(path.join(sourceRoot, specifier.slice(2)));
        if (url) return { url, shortCircuit: true };
    }

    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const basePath = fileURLToPath(new URL(specifier, context.parentURL));
        const url = await resolveFile(basePath);
        if (url) return { url, shortCircuit: true };
    }

    return nextResolve(specifier, context);
}
