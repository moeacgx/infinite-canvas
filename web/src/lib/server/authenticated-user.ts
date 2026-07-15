const AUTH_TIMEOUT_MS = 10_000;

export async function hasAuthenticatedUser(request: Request) {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
    try {
        const apiBaseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: authorization }, redirect: "manual", signal: controller.signal });
        if (!response.ok) return false;
        const payload = (await response.json()) as { code?: number; data?: { role?: string } | null };
        return payload.code === 0 && Boolean(payload.data?.role && payload.data.role !== "guest");
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}
