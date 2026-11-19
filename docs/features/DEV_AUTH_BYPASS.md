# Dev Auth Bypass

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

## Preview / dev auth bypass

Pour vérifier les pages protégées (`/tournois`, `/equipes`, `/joueurs`, `/profil`, etc.) sans passer par Google OAuth ni le code Discord, définir `DEV_AUTH_USER_ID=<id>` dans `.env` (par exemple `321` pour le user admin). La fonction `getCurrentUser()` dans `lib/server/auth.ts` retournera ce user **uniquement si `NODE_ENV === "development"`** (c.-à-d. `next dev`), en court-circuitant le cookie de session — toutes les routes API et le `app/(secured)/layout.tsx` s'authentifient automatiquement. **Redémarre le dev server après modification de `.env`** pour que Next.js prenne en compte la nouvelle valeur. Désactiver = supprimer/vider la var. La garde-fou est double et en **liste blanche** (`NODE_ENV === "development"` ET ID entier valide) : le bypass est donc inactif en prod, en `test`, en `staging`, ou si `NODE_ENV` n'est pas défini. Ne JAMAIS définir cette var en prod.

**Vue joueur sous le contournement** (`ADMIN_ROLE_IMPERSONATION.md`) : sans session, la bascule écrit une ligne dédiée de `bg_user_sessions`, de clé `dev-auth-bypass:<id>` (`devBypassSessionKey`) — jamais une empreinte SHA-256, donc inatteignable par un cookie —, qui porte l'échéance et les rôles incarnés et que le retour supprime. `getCurrentUser()` la relit avec l'utilisateur de développement. Elle compte, en développement, parmi les « autres sessions » de `/profil`.
