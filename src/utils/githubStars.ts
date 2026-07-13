// GitHub star fetcher with localStorage cache.
//
// Reads `stargazers_count` from api.github.com (no auth -> 60 req/h/IP, which
// is plenty since the skills list has only a handful of GitHub repos and we
// cache for 7 days). CSP is null in tauri.conf.json, so the webview can hit
// api.github.com directly - no capability change needed.
//
// On 404 / 403 (rate limit / private) / network error we serve the last cached
// value if any, so a transient failure never blanks out a previously-shown star.

const CACHE_KEY = 'skills:stars:v1';
const TTL_MS = 7 * 24 * 3600 * 1000; // 7 days - star counts barely move day-to-day

interface StarCacheEntry {
  stars: number;
  fetchedAt: number;
  name?: string;
  description?: string;
}
type StarCache = Record<string, StarCacheEntry>;

const loadCache = (): StarCache => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as StarCache) : {};
  } catch {
    return {};
  }
};

const saveCache = (cache: StarCache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota */
  }
};

const repoKey = (owner: string, repo: string) => `${owner}/${repo}`;

// Only canonical repo URLs: https://github.com/{owner}/{repo}.
// Excludes *.github.io (Pages sites), bare user profiles (only 1 path segment),
// gists, and non-github hosts. Subpaths (/tree/main, /issues, ...) are stripped
// to the first two segments.
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    let raw = url.trim();
    if (!raw) return null;
    // Tolerate a missing protocol (user types "github.com/owner/repo")
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const u = new URL(raw);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

// Returns the star count, or null when unknown (never throws). Serves stale
// cache on failure so a rate-limited or offline request keeps the last value.
export async function fetchGithubStars(
  owner: string,
  repo: string,
  force = false
): Promise<number | null> {
  const key = repoKey(owner, repo);
  const cache = loadCache();
  const hit = cache[key];
  if (!force && hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return hit.stars;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return hit?.stars ?? null;
    const json = await res.json();
    const stars = typeof json?.stargazers_count === 'number' ? json.stargazers_count : null;
    if (stars !== null) {
      cache[key] = {
        stars,
        fetchedAt: Date.now(),
        name: typeof json?.name === 'string' ? json.name : undefined,
        description: typeof json?.description === 'string' ? json.description : undefined,
      };
      saveCache(cache);
    }
    return stars;
  } catch {
    return hit?.stars ?? null;
  }
}

// Fetch repo metadata (name + description + stars) for the "拉取信息" button in
// the Add-Skill modal. Not cached - the user explicitly asked for fresh info.
// Returns null on any failure (non-GitHub URL, 404, rate limit, network) so the
// caller can silently no-op per product decision (no error UI, no toast).
export async function fetchGithubRepoInfo(
  owner: string,
  repo: string
): Promise<{ name: string; description: string; stars: number } | null> {
  const key = repoKey(owner, repo);
  // Fall back to the star cache (which may hold name/description from a prior
  // fetchGithubStars call) when the API is rate-limited (403) or unreachable.
  const fromCache = (): { name: string; description: string; stars: number } | null => {
    const cached = loadCache()[key];
    return cached
      ? {
          name: cached.name ?? repo,
          description: cached.description ?? '',
          stars: cached.stars,
        }
      : null;
  };
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return fromCache();
    const json = await res.json();
    const stars = typeof json?.stargazers_count === 'number' ? json.stargazers_count : null;
    if (stars === null) return fromCache();
    const name = typeof json?.name === 'string' ? json.name : repo;
    const description = typeof json?.description === 'string' ? json.description : '';
    const cache = loadCache();
    cache[key] = { stars, fetchedAt: Date.now(), name, description };
    saveCache(cache);
    return { name, description, stars };
  } catch {
    return fromCache();
  }
}

// Compact star count formatting: 999 -> "999", 13900 -> "13.9k", 1000 -> "1k".
export const formatStars = (n: number): string => {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}k`;
  return `${k.toFixed(1).replace(/\.0$/, '')}k`;
};
