const AUTH_TIMEOUT_MS = 10_000;

export type AuthenticatedUser = { id: string; role: string };

export async function readAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
    try {
        const apiBaseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
        const response = await fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: authorization }, redirect: "manual", signal: controller.signal });
        if (!response.ok) return null;
        const payload = (await response.json()) as { code?: number; data?: { id?: string; role?: string } | null };
        if (payload.code !== 0 || !payload.data?.id || !payload.data.role || payload.data.role === "guest") return null;
        return { id: payload.data.id, role: payload.data.role };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function hasAuthenticatedUser(request: Request) {
    return Boolean(await readAuthenticatedUser(request));
}
