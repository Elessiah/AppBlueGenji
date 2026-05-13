# Diagnostic — OAuth Google redirige vers localhost en production

## Symptôme
Après connexion Google sur le domaine public, le navigateur se retrouve sur `http://localhost:3000/...` au lieu de `https://<domaine-prod>/...`. Le `.env` semble correct, le client Google Cloud est configuré.

## Cause racine (déjà corrigée côté code dans cette branche)
Dans `app/api/auth/google/callback/route.ts` et `app/api/auth/google/start/route.ts`, les redirects utilisaient `new URL(path, req.url)`. Derrière un reverse-proxy qui ne forwarde pas `X-Forwarded-Host` / `X-Forwarded-Proto`, `req.url` reflète l'URL interne (`http://localhost:3000`). La 302 retournée pointait donc vers localhost — Google de son côté avait bien redirigé vers le bon `GOOGLE_REDIRECT_URI`, c'est la **réponse post-callback** de l'app qui était fautive.

Fix : helper `getAppBaseUrl()` dans `lib/server/google-oauth.ts` qui privilégie `APP_URL`. Toutes les redirections OAuth utilisent désormais cette base.

## Checklist de diagnostic à exécuter en prod

### 1. Vérifier les variables d'environnement effectivement chargées par le process Node
```bash
# Depuis le serveur de prod, sur le process Next.js en cours :
ps aux | grep next
cat /proc/<PID>/environ | tr '\0' '\n' | grep -E '^(APP_URL|GOOGLE_|NODE_ENV|DEV_AUTH_USER_ID)='
```
Attendu :
- `NODE_ENV=production`
- `APP_URL=https://<domaine>` (sans slash final)
- `GOOGLE_REDIRECT_URI=https://<domaine>/api/auth/google/callback`
- `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` présents
- `DEV_AUTH_USER_ID` **absent ou vide**

Si `APP_URL` est absent du process mais présent dans `.env`, le service n'a pas été redémarré après modification, ou le `.env` lu n'est pas celui chargé (pm2 / systemd / Docker peut surcharger).

### 2. Tester la chaîne OAuth manuellement
```bash
# A. Récupérer la 302 de /start (sans cookie de session)
curl -is "https://<domaine>/api/auth/google/start" | grep -i '^location:'
# Doit pointer vers https://accounts.google.com/o/oauth2/v2/auth?...
# avec redirect_uri=https://<domaine>/api/auth/google/callback (URL-encodé)

# B. Simuler une erreur de state pour observer la base d'URL utilisée par le callback
curl -is "https://<domaine>/api/auth/google/callback?code=x&state=y" | grep -i '^location:'
# Avec le fix : https://<domaine>/connexion?error=state
# Sans le fix : http://localhost:3000/connexion?error=state  <-- bug reproduit
```

### 3. Vérifier les headers forwardés par le reverse-proxy
Ajouter temporairement un log dans le callback ou utiliser un endpoint debug :
```bash
curl -is "https://<domaine>/api/_debug/headers"   # si exposé
```
Headers attendus côté Next.js :
- `host: <domaine>`
- `x-forwarded-proto: https`
- `x-forwarded-host: <domaine>`

Nginx exemple correct :
```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### 4. Vérifier la configuration Google Cloud Console
- Type client : "Web application"
- Authorized JavaScript origins : `https://<domaine>` (pas `http://`, pas de `/` final)
- Authorized redirect URIs : `https://<domaine>/api/auth/google/callback` (à l'identique de `GOOGLE_REDIRECT_URI`)
- Pas de variante `www.` oubliée si le site est servi avec/sans `www`.

### 5. Vérifier les cookies
Si la session est créée mais l'utilisateur est immédiatement délogué après redirect :
- `secure: true` est activé par `NODE_ENV=production` (cf. `lib/server/auth.ts:46`) — donc le cookie n'est posé qu'en HTTPS. Vérifier que le navigateur reçoit bien `Set-Cookie` avec `Secure` et que tout le trafic est en HTTPS.
- `sameSite: lax` : OK pour Google (redirection GET top-level).
- Le cookie `bg_google_oauth` (state) a `maxAge: 600s` — si l'utilisateur met >10 min entre /start et /callback, échec avec `?error=state`.

## Variables d'environnement requises (récap)
Voir `.env.production.example` — créé dans cette branche.

Variables critiques :
- `NODE_ENV=production`
- `APP_URL=https://<domaine>` ← **la variable qui était manquante ou non-effective**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `DB_*`
- Optionnel : `BOT_INTERNAL_URL`, `BOT_INTERNAL_TOKEN`

## Si le bug persiste après le fix
1. Confirmer que la branche corrigée est bien déployée : `git log --oneline -5` doit montrer les commits qui modifient `app/api/auth/google/*` et `lib/server/google-oauth.ts`.
2. `npm run build` rejoué après tout changement de `.env` (Next.js peut inliner des valeurs au build).
3. Vider le cache `.next/` puis rebuild si déploiement incrémental.
4. Vérifier qu'aucun proxy intermédiaire (CloudFlare, etc.) ne réécrit le `Location` header.
5. Inspecter `Response Headers` dans l'onglet Network du navigateur sur la requête `/api/auth/google/callback?code=...` : le `Location` retourné doit commencer par `https://<domaine>`. Si ce n'est pas le cas, c'est l'app qui répond mal — relire `APP_URL` côté process.

## Fichiers clés à inspecter
- `lib/server/google-oauth.ts` — helpers `getGoogleRedirectUri()`, `getAppBaseUrl()`
- `app/api/auth/google/start/route.ts` — entrée OAuth
- `app/api/auth/google/callback/route.ts` — sortie OAuth, lieu du bug d'origine
- `lib/server/auth.ts` — cookies de session/OAuth, flag `secure`
