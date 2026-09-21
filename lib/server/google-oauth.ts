/**
 * Ce que l'`userinfo` de Google rend, et ce que le site en lit.
 *
 * **L'adresse n'y figure plus**, parce qu'elle n'est plus demandee : le scope
 * est `openid profile`, sans `email`. Elle n'avait qu'un usage — rattacher une
 * identite Google neuve a un compte du site sur l'egalite de la chaine —, et ce
 * rattachement a disparu au profit de la section « Applications connectees » du
 * profil, ou le joueur est deja connecte quand il ajoute un fournisseur. Une
 * colonne d'adresses qu'aucun code ne lit n'est plus qu'une surface de fuite.
 */
export type GoogleUserInfo = {
  sub: string;
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

export function getAppBaseUrl(fallback: string): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  return fallback;
}

export function buildGoogleAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireGoogleEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid profile",
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
