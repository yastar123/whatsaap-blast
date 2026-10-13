const ACCESS_KEY = "wa-campaign.access-token";
const REFRESH_KEY = "wa-campaign.refresh-token";

type TokenPair = { accessToken: string; refreshToken: string };

function decodeExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function saveAuthTokens(tokens: TokenPair): void {
  window.sessionStorage.setItem(ACCESS_KEY, tokens.accessToken);
  window.sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearAuthTokens(): void {
  window.sessionStorage.removeItem(ACCESS_KEY);
  window.sessionStorage.removeItem(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  let accessToken = window.sessionStorage.getItem(ACCESS_KEY);
  const refreshToken = window.sessionStorage.getItem(REFRESH_KEY);
  const expiresAt = accessToken ? decodeExpiry(accessToken) : null;
  if (accessToken && expiresAt && expiresAt > Date.now() + 30_000) {
    return accessToken;
  }
  if (!refreshToken) return accessToken;

  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      clearAuthTokens();
      return null;
    }
    const refreshed = (await response.json()) as TokenPair;
    saveAuthTokens(refreshed);
    accessToken = refreshed.accessToken;
    return accessToken;
  } catch {
    return accessToken;
  }
}
