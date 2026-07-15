import assert from "node:assert/strict";
import test from "node:test";

import { createPinnedLookup, isBlockedIpAddress } from "../src/lib/server/webdav-proxy-security.ts";

test("阻断 IPv4 私网、环回、链路本地和保留地址", () => {
    ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.2", "172.16.0.1", "192.168.1.1", "198.18.0.1", "192.0.2.1", "224.0.0.1"].forEach((address) => {
        assert.equal(isBlockedIpAddress(address), true, address);
    });
});

test("允许公网 IPv4", () => {
    ["1.1.1.1", "8.8.8.8", "93.184.216.34"].forEach((address) => {
        assert.equal(isBlockedIpAddress(address), false, address);
    });
});

test("固定 DNS 查询同时兼容单地址和 all 地址模式", async () => {
    const lookup = createPinnedLookup([
        { address: "8.8.8.8", family: 4 },
        { address: "2001:4860:4860::8888", family: 6 },
    ]) as unknown as (hostname: string, options: { family?: number; all?: boolean }, callback: (...args: unknown[]) => void) => void;
    const single = await new Promise<unknown[]>((resolve) => lookup("example.com", { family: 4 }, (...args) => resolve(args)));
    assert.deepEqual(single, [null, "8.8.8.8", 4]);
    const all = await new Promise<unknown[]>((resolve) => lookup("example.com", { all: true }, (...args) => resolve(args)));
    assert.deepEqual(all, [
        null,
        [
            { address: "8.8.8.8", family: 4 },
            { address: "2001:4860:4860::8888", family: 6 },
        ],
    ]);
});

test("阻断 IPv6 本地与保留地址，只允许全球单播", () => {
    ["::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1"].forEach((address) => {
        assert.equal(isBlockedIpAddress(address), true, address);
    });
    assert.equal(isBlockedIpAddress("2606:4700:4700::1111"), false);
});
