# Certification du tag Discord proposée à la connexion

> `lib/shared/discord-certify-prompt.ts` (pur) · `lib/server/users/discord-certify-prompt.ts` ·
> `POST /api/profile/discord/certify-prompt` · `components/discord/DiscordCertifyPrompt.tsx` ·
> `app/(secured)/profil/useCertifyRequest.ts`

Demande du 2026-10-21 : dès l'inscription et à chaque connexion, une fenêtre
**propose** la certification du tag Discord, avec ses effets en un tableau, et
un bouton « Ne plus voir ». Portée élargie le même jour aux connexions Blizzard.

## Une proposition, pas un consentement arraché

La certification reste un geste spécifique (RGPD, art. 4.11 et 7.4 —
`DISCORD_VERIFICATION.md`) : la fenêtre ne coche rien, se connecter ne certifie
toujours rien, et « Plus tard » / « Ne plus voir » ne coûtent rien. Seul le clic
sur « Certifier mon tag » certifie, par la route existante.

## Qui la voit, et quand

| Condition | Où elle est tenue |
| --- | --- |
| Session ouverte par **Discord** (bouton OAuth, code en message privé) ou **Blizzard** — pas Google ni One Tap | `CERTIFY_PROMPT_DOORS` ; `createSession` pose `bg_user_sessions.certify_prompt_due = 1` |
| Une fois par connexion | la première réponse lève la marque (`markDiscordCertifyPromptSeen`) |
| Compte vivant, tag **non certifié**, pas de « Ne plus voir » | `loadDiscordCertifyPrompt`, une requête, toutes conditions dans le `WHERE` |
| Après la confidentialité et les conditions, jamais par-dessus | `certifyPromptOpen` (`lib/shared/global-modals.ts`) ; la fenêtre suit `PRIVACY_CHANGES_ANSWERED_EVENT` et `TERMS_ACCEPTED_EVENT` (émis par `TermsAcceptanceModal`) et s'ouvre sans rechargement |
| Pas sur `/connexion`, `/conditions-utilisation`, `/rgpd`, `/mentions-legales`, `/accessibilite`, pages légales du bot | `certifyPromptSilencedOn` |
| Fait taire la modale d'arrivée du recrutement | `recruitmentModalSilenced({ certifyPromptDue })` — ordre : confidentialité → conditions → certification → recrutement |

**Montée par la mise en page racine**, comme `TermsAcceptanceModal`, et non par
l'espace connecté : c'est la seule qui rend la **première page après la
connexion**, quelle que soit la destination (`redirectTo` peut être une page
publique ; la connexion par code fait `router.refresh()`, qui la relit). Les
pages légales et la connexion la taisent. La marque se lit **avec la session**
(`getCurrentUser`, colonne `s.certify_prompt_due`) : aucune requête de plus tant
qu'elle est à `0`.

Le contournement de développement (`DEV_AUTH_USER_ID`) n'a pas de session : la
fenêtre ne s'y montre pas. Pour la voir en local, se connecter vraiment par
Discord ou Blizzard (ou poser la marque à la main sur sa ligne de session).

## Deux parcours

`certifyPromptFor` décide du bouton principal :

- **`ONE_CLICK`** — mêmes conditions que `certifyLinkedDiscordTag` (Discord
  rattaché, pseudo nommé par Discord, certifiable). La fenêtre montre le tag et
  appelle `POST /api/profile/discord { handle }` : succès → `showSuccess` +
  `router.refresh()` ; refus → `showError` (les quatre codes d'état changé
  renvoient vers « Mon profil »).
- **`DIALOG`** — tout autre compte non certifié, le plus souvent une connexion
  Blizzard sans Discord. Le bouton (« Certifier mon tag → ») clôt la
  proposition pour la session et mène à `/profil?certifier=discord` (ou, déjà
  sur `/profil`, émet `CERTIFY_DIALOG_EVENT`) : `useCertifyRequest` ouvre
  **le** `DiscordVerificationDialog` une fois l'état Discord lu — code en
  message privé, ou passage par Discord pour un compte rattaché sans pseudo
  nommé. Rien du dialogue n'est recopié ; le paramètre est retiré de l'adresse.

Le BattleTag n'y figure pas : il est vérifié par Battle.net au rattachement
(`OAUTH_PROVIDERS.md`), sans geste à proposer.

## Réponses

| Geste | Effet |
| --- | --- |
| « Certifier mon tag » | certifie (`ONE_CLICK`) ou mène au dialogue (`DIALOG`, la proposition est close pour la session) |
| « Plus tard », Échap, clic sur le voile | `POST … { action: "LATER" }` — fermée tout de suite ; un échec d'écriture la fait seulement revenir au prochain chargement |
| « Ne plus voir » | `POST … { action: "NEVER" }` — `bg_users.discord_certify_prompt_dismissed_at` (date du premier choix, `COALESCE`) puis la session ; succès en toast, échec en toast et fenêtre gardée |

Route : 401 sans session, 400 `INVALID_ACTION`, 409 `ACCOUNT_DELETED` (compte
supprimé entre-temps), 503 `CERTIFY_PROMPT_UNAVAILABLE` (colonne absente), 500
`CERTIFY_PROMPT_FAILED`. Provenance vérifiée par le middleware. Aucune réponse
ne certifie. Il n'existe pas de geste pour réafficher la fenêtre : la
certification reste offerte dans « Mon profil », que la fenêtre nomme.

## Le tableau

« Ce que change la certification », sans / avec, tiré de `canViewDiscordTag`,
`canSeeDiscordVerification` et de la portée `certified` des messages de match
(`lib/server/notify.ts`) : toi (toujours), administrateurs (toujours), arbitres
(tournoi en cours ou à venir), ton match (dès que les adversaires sont connus,
caster le temps du match), autres joueurs (case « Tag Discord »), visiteurs
(jamais), pastille sur la fiche (joueurs connectés), messages privés de match
(sauf opposition). Sans certification : personne d'autre que toi. Puis une
ligne : retirer son tag ou changer de pseudo Discord retire la certification.
Textes `shell.certifyPrompt` (FR et EN) ; le détail complet reste dans le
dialogue (`DISCORD_VERIFICATION_EXPOSURE`, qui nomme aussi l'arbitre d'un match
que le joueur caste). Tableau natif (`th` `scope`), trois colonnes serrées sous
480 px, boutons empilés.

## Données

`bg_users.discord_certify_prompt_dismissed_at` : exporté
(`discordCertifyPromptDismissedAt`), remis à `NULL` à l'anonymisation.
`bg_user_sessions.certify_prompt_due` : part avec la session. Déclaré :
`PRIVACY_CHANGES` `2026-10-proposition-certification-discord` (FR et EN),
registre T01, ligne du tableau des données de `/rgpd` (`rgpd-policy.ts`, FR et EN).
Les deux colonnes sont tolérées absentes (`ALTER` échoué) : session écrite sans
la marque, fenêtre muette, export et anonymisation intacts.
