const MAX_HEADER_ENVELOPE_LENGTH = 32 * 1024;
const BLOCKED_HEADERS = new Set([
    "connection",
    "content-length",
    "cookie",
    "forwarded",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "via",
]);
const BLOCKED_PORTS = new Set([21, 22, 23, 25, 53, 110, 135, 137, 138, 139, 143, 389, 445, 465, 587, 993, 995, 1433, 1521, 2049, 2375, 2376, 3306, 5432, 6379, 9200, 11211, 27017]);

export function decodeChannelHeaders(rawValue: string | null) {
    if (!rawValue) return new Headers();
    if (rawValue.length > MAX_HEADER_ENVELOPE_LENGTH) throw new Error("渠道请求头过大");
    let value: unknown;
    try {
        value = JSON.parse(decodeURIComponent(rawValue));
    } catch {
        throw new Error("渠道请求头格式无效");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("渠道请求头格式无效");
    const headers = new Headers();
    for (const [rawName, rawHeaderValue] of Object.entries(value)) {
        const name = rawName.trim().toLowerCase();
        if (!name || BLOCKED_HEADERS.has(name) || name.startsWith("x-forwarded-") || name.startsWith("sec-") || name.startsWith("proxy-")) continue;
        if (typeof rawHeaderValue !== "string" || rawHeaderValue.length > 8192) throw new Error("渠道请求头包含无效值");
        headers.set(name, rawHeaderValue);
    }
    return headers;
}

export function assertAllowedChannelPort(url: URL) {
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("渠道目标端口无效");
    if ((port < 1024 && port !== 80 && port !== 443) || BLOCKED_PORTS.has(port)) throw new Error("渠道目标端口不允许转发");
}
