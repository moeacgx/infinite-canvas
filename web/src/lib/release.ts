export type ReleaseInfo = {
    version: string;
    date: string;
    items: { type: string; content: string }[];
};

export function parseChangelog(content: string): ReleaseInfo[] {
    return content
        .split(/^## /m)
        .slice(1)
        .map((block) => {
            const [title = "", ...lines] = block.trim().split("\n");
            const [, version = title.trim(), date = ""] = title.match(/^(.+?)(?:\s+-\s+(.+))?$/) || [];
            return {
                version: version.trim(),
                date: date.trim(),
                items: lines
                    .map((line) => line.trim().match(/^\+\s+\[(.+?)\]\s+(.+)$/))
                    .filter((match): match is RegExpMatchArray => Boolean(match))
                    .map((match) => ({ type: match[1], content: match[2] })),
            };
        })
        .filter((release) => release.items.length);
}

export function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, previousIndex) => part === current[previousIndex]));
}

export function displayedLatestVersion(remoteVersion: string, currentVersion: string) {
    const normalized = remoteVersion.trim();
    return isNewerVersion(normalized, currentVersion) ? normalized : currentVersion;
}

export function mergeReleases(remote: ReleaseInfo[], local: ReleaseInfo[]) {
    const seen = new Set<string>();
    return [...local, ...remote].filter((release) => {
        if (seen.has(release.version)) return false;
        seen.add(release.version);
        return true;
    });
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}
