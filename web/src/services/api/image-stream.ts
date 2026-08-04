type JsonRecord = Record<string, unknown>;

const MAX_STREAM_CHARACTERS = 256 * 1024 * 1024;
const MAX_EVENT_CHARACTERS = 32 * 1024 * 1024;
const MAX_EVENT_COUNT = 4096;

export function isEventStreamResponse(response: Response) {
    return response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
}

export async function parseImagesApiStream(response: Response) {
    const completedImageItems = new Map<string, JsonRecord>();
    const unkeyedCompletedImageItems: JsonRecord[] = [];
    const partialImageItems = new Map<string, JsonRecord>();
    let resultPayload: JsonRecord | null = null;
    await readJsonServerSentEvents(response, (event) => {
        const object = stringValue(event.object);
        if (object === "image.generation.result" || object === "image.edit.result") resultPayload = event;
        if (!hasImageValue(event)) return;
        const type = stringValue(event.type);
        const key = numberOrStringValue(event.image_index) || numberOrStringValue(event.output_index) || stringValue(event.item_id);
        if (type.endsWith(".completed")) {
            if (key) completedImageItems.set(key, event);
            else unkeyedCompletedImageItems.push(event);
            return;
        }
        partialImageItems.set(key || "default", event);
    });
    const completed = [...completedImageItems.values(), ...unkeyedCompletedImageItems];
    return { resultPayload, imageItems: completed.length ? completed : Array.from(partialImageItems.values()) };
}

export function parseResponsesImageData(payload: unknown, mime = "image/png") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) return [];
    return uniqueStrings(
        output
            .filter((item): item is JsonRecord => isRecord(item) && item.type === "image_generation_call")
            .flatMap((item) => collectImageStrings(item))
            .map((value) => normalizeBase64Image(value, mime)),
    );
}

export async function parseResponsesApiStream(response: Response, mime = "image/png") {
    let completedPayload: JsonRecord | null = null;
    const outputItems = new Map<string, JsonRecord>();
    const partialImages = new Map<string, string>();

    await readJsonServerSentEvents(response, (event) => {
        if (isRecord(event.response)) {
            if (isRecord(event.response.error) && stringValue(event.response.error.message)) throw new Error(stringValue(event.response.error.message));
            if (Array.isArray(event.response.output)) completedPayload = event.response;
        }

        if (isRecord(event.item) && event.item.type === "image_generation_call") {
            const key = stringValue(event.item.id) || numberOrStringValue(event.output_index) || `item-${outputItems.size}`;
            outputItems.set(key, event.item);
        }

        const type = stringValue(event.type);
        if (!type.includes("image_generation_call")) return;
        const partial = stringValue(event.partial_image_b64);
        if (partial) {
            const key = numberOrStringValue(event.output_index) || stringValue(event.item_id) || "0";
            partialImages.set(key, partial);
        }
        if (collectImageStrings(event).length) {
            const key = numberOrStringValue(event.output_index) || stringValue(event.item_id) || `event-${outputItems.size}`;
            outputItems.set(key, event);
        }
    });

    const completed = parseResponsesImageData(completedPayload, mime);
    if (completed.length) return completed;
    const output = parseResponsesImageData({ output: Array.from(outputItems.values()).map((item) => (item.type === "image_generation_call" ? item : { ...item, type: "image_generation_call" })) }, mime);
    if (output.length) return output;
    return Array.from(partialImages.values()).map((value) => normalizeBase64Image(value, mime));
}

async function readJsonServerSentEvents(response: Response, onEvent: (event: JsonRecord) => void) {
    if (!response.body) throw new Error("接口未返回可读取的流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let separatorSearchStart = 0;
    let totalCharacters = 0;
    let eventCount = 0;

    const processBlock = (block: string) => {
        if (block.length > MAX_EVENT_CHARACTERS) throw new Error("单个图片流事件超过大小限制");
        const event = parseServerSentEventBlock(block);
        if (!event) return;
        eventCount += 1;
        if (eventCount > MAX_EVENT_COUNT) throw new Error("图片流事件数量超过限制");
        const error = isRecord(event.error) ? stringValue(event.error.message) : stringValue(event.error);
        if (error) throw new Error(error);
        onEvent(event);
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            totalCharacters += chunk.length;
            if (totalCharacters > MAX_STREAM_CHARACTERS) throw new Error("图片流响应超过大小限制");
            buffer += chunk;
            let separator = findEventSeparator(buffer, separatorSearchStart);
            while (separator) {
                processBlock(buffer.slice(0, separator.index));
                buffer = buffer.slice(separator.index + separator.length);
                separatorSearchStart = 0;
                separator = findEventSeparator(buffer, separatorSearchStart);
            }
            separatorSearchStart = Math.max(0, buffer.length - 3);
            if (buffer.length > MAX_EVENT_CHARACTERS) throw new Error("单个图片流事件超过大小限制");
        }
        buffer += decoder.decode();
        if (buffer.trim()) processBlock(buffer);
    } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
}

function findEventSeparator(buffer: string, start: number) {
    const lfIndex = buffer.indexOf("\n\n", start);
    const crlfIndex = buffer.indexOf("\r\n\r\n", start);
    if (lfIndex < 0 && crlfIndex < 0) return null;
    if (lfIndex < 0) return { index: crlfIndex, length: 4 };
    if (crlfIndex < 0 || lfIndex < crlfIndex) return { index: lfIndex, length: 2 };
    return { index: crlfIndex, length: 4 };
}

function parseServerSentEventBlock(block: string): JsonRecord | null {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return null;
    const parsed = JSON.parse(data) as unknown;
    if (!isRecord(parsed)) throw new Error("流式事件不是 JSON 对象");
    return parsed;
}

function collectImageStrings(value: unknown, depth = 0): string[] {
    if (depth > 5 || value == null) return [];
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) return value.flatMap((item) => collectImageStrings(item, depth + 1));
    if (!isRecord(value)) return [];
    return ["result", "b64_json", "base64", "image", "image_data", "data", "url", "image_url"].flatMap((key) => collectImageStrings(value[key], depth + 1));
}

function normalizeBase64Image(value: string, mime: string) {
    return value.startsWith("data:") || /^https?:\/\//i.test(value) ? value : `data:${mime};base64,${value}`;
}

function hasImageValue(record: JsonRecord) {
    return Boolean(stringValue(record.b64_json) || stringValue(record.url));
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function numberOrStringValue(value: unknown) {
    return typeof value === "number" || typeof value === "string" ? String(value) : "";
}
