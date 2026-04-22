export type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

function requireGoogleEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function getGoogleRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("Missing GOOGLE_REDIRECT_URI or APP_URL");
  }
  return `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireGoogleEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid profile email",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function fetchGoogleUser(code: string): Promise<GoogleUserInfo> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: requireGoogleEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireGoogleEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  if (!tokenResponse.ok) {
    throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");
  }

  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
    },
    cache: "no-store",
  });

  if (!userResponse.ok) {
    throw new Error("GOOGLE_USERINFO_FAILED");
  }

  const userJson = (await userResponse.json()) as GoogleUserInfo;
  if (!userJson.sub) {
    throw new Error("GOOGLE_USERINFO_INVALID");
  }

  return userJson;
}
