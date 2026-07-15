import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

export type PublicChannelTarget = {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

const MAX_HEADER_ENVELOPE_LENGTH = 32 * 1024;
const blockedHostSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
];
const blockedHeaders = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-canvas-agent-token",
]);
const blockedPorts = new Set([
  21, 22, 23, 25, 53, 110, 135, 137, 138, 139, 143, 389, 445, 465, 587, 993,
  995, 1433, 1521, 2049, 2375, 2376, 3306, 5432, 6379, 9200, 11211, 27017,
]);

export async function resolvePublicChannelTarget(
  rawTarget: string,
): Promise<PublicChannelTarget> {
  let url: URL;
  try {
    url = new URL(rawTarget);
  } catch {
    throw new Error("渠道目标地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("渠道目标仅支持 HTTP 或 HTTPS");
  if (url.username || url.password)
    throw new Error("渠道目标地址不能包含用户名或密码");
  if (url.hash) throw new Error("渠道目标地址不能包含片段标识");

  assertAllowedChannelPort(url);
  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  )
    throw new Error("渠道目标不能指向本机或内网主机");

  const family = isIP(hostname);
  const resolved = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : (await lookup(hostname, { all: true, verbatim: true })).map((item) => ({
        address: item.address,
        family: item.family as 4 | 6,
      }));
  if (
    !resolved.length ||
    resolved.some((item) => isBlockedIpAddress(item.address))
  )
    throw new Error("渠道目标解析到了本机、内网或保留地址");

  const addresses = Array.from(
    new Map(
      resolved.map((item) => [`${item.family}:${item.address}`, item]),
    ).values(),
  );
  return { url, addresses };
}

export function decodeChannelHeaders(rawValue: string | undefined) {
  if (!rawValue) return new Map<string, string>();
  if (rawValue.length > MAX_HEADER_ENVELOPE_LENGTH)
    throw new Error("渠道请求头过大");
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(rawValue));
  } catch {
    throw new Error("渠道请求头格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("渠道请求头格式无效");

  const headers = new Map<string, string>();
  for (const [rawName, rawHeaderValue] of Object.entries(value)) {
    const name = rawName.trim().toLowerCase();
    if (
      !name ||
      blockedHeaders.has(name) ||
      name.startsWith("x-channel-") ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("sec-") ||
      name.startsWith("proxy-")
    )
      continue;
    if (typeof rawHeaderValue !== "string" || rawHeaderValue.length > 8192)
      throw new Error("渠道请求头包含无效值");
    headers.set(name, rawHeaderValue);
  }
  return headers;
}

export function createPinnedLookup(
  addresses: PublicChannelTarget["addresses"],
): LookupFunction {
  return ((_hostname, options, callback) => {
    const requestedFamily =
      typeof options === "number" ? options : options?.family;
    const candidates = addresses.filter(
      (item) => !requestedFamily || item.family === requestedFamily,
    );
    if (!candidates.length) {
      callback(new Error("渠道目标地址不可用"), "", 4);
      return;
    }
    const finish = callback as (...args: unknown[]) => void;
    if (typeof options !== "number" && options?.all) {
      finish(null, candidates);
      return;
    }
    finish(null, candidates[0].address, candidates[0].family);
  }) as LookupFunction;
}

export function isBlockedIpAddress(rawAddress: string) {
  const address = stripIpv6Brackets(rawAddress.split("%")[0]).toLowerCase();
  if (isIP(address) === 4) return isBlockedIpv4(address);
  if (isIP(address) !== 6) return true;

  const mappedIpv4 = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4);
  const value = ipv6ToBigInt(address);
  if (value === null) return true;

  // 仅允许全球单播 IPv6，并排除文档网段与 ORCHID 等保留范围。
  if (!inIpv6Cidr(value, ipv6ToBigInt("2000::")!, 3)) return true;
  return (
    inIpv6Cidr(value, ipv6ToBigInt("2001:db8::")!, 32) ||
    inIpv6Cidr(value, ipv6ToBigInt("2001::")!, 32) ||
    inIpv6Cidr(value, ipv6ToBigInt("2001:10::")!, 28) ||
    inIpv6Cidr(value, ipv6ToBigInt("2001:20::")!, 28) ||
    inIpv6Cidr(value, ipv6ToBigInt("2002::")!, 16)
  );
}

function assertAllowedChannelPort(url: URL) {
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("渠道目标端口无效");
  if ((port < 1024 && port !== 80 && port !== 443) || blockedPorts.has(port))
    throw new Error("渠道目标端口不允许转发");
}

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6ToBigInt(address: string) {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = expandIpv6Tokens(halves[0]);
  const right = expandIpv6Tokens(halves[1] || "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const tokens = [
    ...left,
    ...Array.from({ length: missing }, () => 0),
    ...right,
  ];
  if (tokens.length !== 8) return null;
  return tokens.reduce(
    (value, token) => (value << BigInt(16)) | BigInt(token),
    BigInt(0),
  );
}

function expandIpv6Tokens(part: string) {
  if (!part) return [];
  const rawTokens = part.split(":");
  const tokens: number[] = [];
  for (const token of rawTokens) {
    if (token.includes(".")) {
      const ipv4 = token.split(".").map(Number);
      if (
        ipv4.length !== 4 ||
        ipv4.some(
          (value) => !Number.isInteger(value) || value < 0 || value > 255,
        )
      )
        return null;
      tokens.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
    tokens.push(Number.parseInt(token, 16));
  }
  return tokens;
}

function inIpv6Cidr(value: bigint, base: bigint, prefix: number) {
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

function stripIpv6Brackets(value: string) {
  return value.replace(/^\[|\]$/g, "");
}
