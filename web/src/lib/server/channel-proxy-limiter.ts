type Usage = {
    requestWindowStartedAt: number;
    byteWindowStartedAt: number;
    requests: number;
    bytes: number;
    active: number;
};

export type ChannelProxyLease = {
    addBytes: (size: number) => boolean;
    release: () => void;
};

export class ChannelProxyLimiter {
    private readonly usage = new Map<string, Usage>();
    private readonly options: { maxActive: number; maxRequestsPerMinute: number; maxBytesPerHour: number };
    private readonly now: () => number;

    constructor(
        options = { maxActive: 4, maxRequestsPerMinute: 120, maxBytesPerHour: 1024 * 1024 * 1024 },
        now: () => number = Date.now,
    ) {
        this.options = options;
        this.now = now;
    }

    acquire(userId: string): { lease?: ChannelProxyLease; error?: string } {
        const usage = this.currentUsage(userId);
        if (usage.active >= this.options.maxActive) return { error: "当前账号的渠道转发并发请求过多" };
        if (usage.requests >= this.options.maxRequestsPerMinute) return { error: "当前账号的渠道转发请求过于频繁" };
        if (usage.bytes >= this.options.maxBytesPerHour) return { error: "当前账号本小时的渠道转发流量已达上限" };
        usage.active += 1;
        usage.requests += 1;
        let released = false;
        return {
            lease: {
                addBytes: (size) => {
                    usage.bytes += Math.max(0, size);
                    return usage.bytes <= this.options.maxBytesPerHour;
                },
                release: () => {
                    if (released) return;
                    released = true;
                    usage.active = Math.max(0, usage.active - 1);
                },
            },
        };
    }

    private currentUsage(userId: string) {
        const now = this.now();
        let usage = this.usage.get(userId);
        if (!usage) {
            usage = { requestWindowStartedAt: now, byteWindowStartedAt: now, requests: 0, bytes: 0, active: 0 };
            this.usage.set(userId, usage);
        }
        if (now - usage.requestWindowStartedAt >= 60_000) {
            usage.requestWindowStartedAt = now;
            usage.requests = 0;
        }
        if (now - usage.byteWindowStartedAt >= 3_600_000) {
            usage.byteWindowStartedAt = now;
            usage.bytes = 0;
        }
        return usage;
    }
}
