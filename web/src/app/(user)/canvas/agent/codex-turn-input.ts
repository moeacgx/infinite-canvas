import type { CanvasAgentContent } from "../types";

type CodexInput = { type: "text"; text: string } | { type: "image"; url: string };

export async function prepareCodexTurnInput(content: CanvasAgentContent, signal: AbortSignal): Promise<CodexInput[]> {
    signal.throwIfAborted();
    if (typeof content === "string") return [{ type: "text", text: content }];
    const imageCount = content.filter((item) => item.type === "image_url").length;
    // 为文本和协议字段留出空间；只处理发送副本，不修改引用和原图。
    const imageLimit = Math.min(2 * 1024 * 1024, Math.floor(16 * 1024 * 1024 / Math.max(1, imageCount)));
    const input: CodexInput[] = [];
    for (const item of content) {
        signal.throwIfAborted();
        if (item.type === "text") {
            input.push(item);
            continue;
        }
        let url = item.image_url.url;
        if (url.startsWith("data:") && new Blob([url]).size > imageLimit) {
            const blob = await fetch(url, { signal }).then((response) => response.blob());
            signal.throwIfAborted();
            const bitmap = await createImageBitmap(blob);
            try {
                signal.throwIfAborted();
                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                if (!context) throw new Error("无法处理 Codex 参考图，请压缩图片后重试");
                let scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
                do {
                    signal.throwIfAborted();
                    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                    url = canvas.toDataURL("image/webp", 0.85);
                    if (url === "data:,") throw new Error("无法处理 Codex 参考图，请压缩图片后重试");
                    if (new Blob([url]).size <= imageLimit) break;
                    if (canvas.width === 1 && canvas.height === 1) throw new Error("Codex 参考图过多，请减少图片后重试");
                    scale *= 0.5;
                } while (true);
            } finally {
                bitmap.close();
            }
        }
        input.push({ type: "image", url });
    }
    signal.throwIfAborted();
    return input;
}
