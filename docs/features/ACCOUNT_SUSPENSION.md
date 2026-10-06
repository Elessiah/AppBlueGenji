# Suspension d'un compte

Les conditions d'utilisation annonçaient la suspension d'un compte sans que le
site ait ni outil, ni procédure, ni exposé des motifs pour la prononcer. Elle
est désormais une décision de modération à part entière.

## Qui, et sur quoi

- **Permission `moderation`** (`can(user, "moderation")`), depuis le bandeau
  « MODÉRATION » de la fiche d'un joueur (`PlayerModerationBar`).
- `POST /api/admin/users/[id]/suspension` avec
  `{ reason, ground, durationDays }` :
  - `reason` — les **faits retenus**, 10 à 500 caractères, envoyés tels quels au
    joueur (le formulaire rappelle de ne nommer aucun autre joueur) ;
  - `ground` — la clause des conditions : `BEHAVIOR` (« Comportement »),
    `CONTENT` (« Contenus publiés par les utilisateurs »), `ACCOUNT` (« Compte ») ;
  - `durationDays` — 1 à 365, ou `null` pour une durée **indéterminée**. Un champ
    absent est refusé (`SUSPENSION_DURATION_REQUIRED`) : la sanction la plus
    lourde se choisit, elle ne se déduit pas d'un oubli.
- `DELETE /api/admin/users/[id]/suspension` lève la suspension en cours.
- Refus : `CANNOT_SUSPEND_SELF`, `CANNOT_SUSPEND_ADMIN` (la modération ne peut
  pas fermer le site à ceux qui peuvent la corriger), `ACCOUNT_ALREADY_SUSPENDED`,
  `NO_ACTIVE_SUSPENSION` (409), `USER_NOT_FOUND` (404).

## Effets

- Le prononcé écrit la suspension et **efface toutes les sessions** du compte
  dans une seule transaction, ouverte par le verrou de la ligne du compte.
- Les portes refusent **avant d'écrire** : `assertIdentityNotSuspended`
  retrouve le compte par son identité (`google_sub`, `discord_id`,
  `blizzard_sub`) avant `createOrGetOAuthUser` et `createOrGetDiscordUser`,
  sans quoi une connexion refusée réécrivait le BattleTag, recertifiait un tag
  Discord retiré ou importait un avatar sur le compte suspendu.
- `createSession` — point de passage des quatre portes d'entrée — refuse toute
  ouverture tant que la suspension court (`AccountSuspendedError`) : dernier mot
  pour une suspension prononcée entre les deux contrôles.
- `getCurrentUser` écarte en plus la session d'un compte suspendu : c'est lui qui
  tranche la course d'une connexion ouverte pendant le prononcé, le contrôle de
  `createSession` ne donnant que le refus lisible.
- La règle « la suspension court » est écrite deux fois, en pur
  (`isSuspensionActive`) et en SQL (`activeSuspensionSql`), et testée des deux
  côtés.

## Exposé des motifs (DSA, art. 17)

Décision et durée, faits retenus, absence de traitement automatisé, clause
invoquée avec son lien, puis les recours : **réexamen par l'association**, puis
**le juge compétent**.

- **Message privé Discord** (et push, sujet `MODERATION`) par `notifyUsers`,
  si le compte y est joignable.
- **À chaque connexion refusée**, pour tous les comptes — c'est le seul canal
  qui joigne un compte sans Discord, et le lecteur vient de prouver en être le
  titulaire : dans le corps de la réponse du code Discord
  (`{ error: "ACCOUNT_SUSPENDED", suspension }`), et au retour OAuth dans un
  cookie `httpOnly` de dix minutes (`bg_suspension_notice`, chemin `/` —
  la page vit aussi sous `/en/connexion` ; c'est le middleware qui borne sa
  lecture à la page de connexion, comparée sans préfixe de langue,
  `I18N.md`). **Jamais dans l'URL** : l'exposé porte un motif, que
  l'historique et les journaux des relais n'ont pas à garder. La page le rend
  dans `SuspensionNoticeDialog` — en anglais sous `/en/connexion` depuis le lot 6, faits retenus
  annoncés `lang="fr"` (`I18N.md` § Connexion). Le middleware le remet à la page par un
  en-tête de requête (`x-bg-suspension-notice`, toujours retiré s'il vient du
  client) et efface le cookie dans la réponse de cette même page — pas par le
  cookie : Next fusionne dans la requête vue par la page (`cookies()` comme
  `headers()`) les cookies que le middleware pose, la page lirait la valeur
  vide de l'effacement (constaté sur `next dev`) : **lu une fois**, il ne rouvre pas la décision à
  qui rouvrirait le lien depuis l'historique d'un ordinateur partagé. Lu sur un **document**
  seulement (`Sec-Fetch-Dest`) : un préchargement de la page ne le consomme pas.
- Le journal du staff sur Discord ne porte ni le pseudo du joueur ni le motif ;
  l'auteur est nommé dans pm2 (`publishStaffAction`).

## Contester

Le compte ne peut plus se connecter, donc ni la page d'un signalement ni la
catégorie « Contestation » (qui exige une session) ne lui sont ouvertes. La voie
est le formulaire « Signaler un problème », catégorie « Autre », sans
connexion, en citant la référence `S-<id>` et un moyen de répondre.

## Conservation

Table `bg_account_suspensions`. Tant que la suspension court, puis
**six mois** après sa levée ou son échéance (délai de contestation de l'art. 20
du DSA), avant effacement par la purge qu'entraîne `createSession`. Effacée
avec le compte (clé étrangère) et à son anonymisation ; présente dans l'export
de ses données, sans son auteur. Registre : fiche T11 ; annonce :
`PRIVACY_CHANGES` `2026-10-suspension-comptes`.

## Retrait d'une image hors signalement

`DELETE /api/admin/teams/[id]/logo` et `DELETE /api/admin/users/[id]/avatar`
exigent désormais un motif (`{ reason }`, mêmes bornes,
`validateModerationReason`), repris comme faits retenus dans le message à
l'équipe ou au joueur à la place de « constat de la modération ».

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Suspension d'un compte** (`lib/shared/account-suspension.ts` pur + `lib/server/account-suspensions.ts` + `POST`/`DELETE /api/admin/users/[id]/suspension`, bandeau `PlayerModerationBar` de `/joueurs/[id]`) : la permission `moderation` suspend un compte sur un **motif** (faits retenus, 10 à 500 caractères), une **clause** des conditions (`ACCOUNT` / `BEHAVIOR` / `CONTENT`) et une **durée** choisie (1 à 365 jours, ou `durationDays: null` = indéterminée — un champ absent est refusé) ; ni son propre compte, ni un administrateur, ni un compte supprimé, une seule suspension en cours. Le prononcé efface **toutes les sessions** du compte dans sa transaction (verrou de la ligne en première instruction) ; `createSession` refuse ensuite toute ouverture (`AccountSuspendedError`, donc les quatre portes) et `getCurrentUser` écarte un compte suspendu — c'est lui qui tranche la course d'une connexion ouverte pendant le prononcé. L'exposé des motifs (DSA art. 17) part en message privé et en push (`notifyUsers`, sujet `MODERATION`) et, pour tous les comptes, **à chaque connexion refusée** : dans le corps de la réponse du code Discord, dans un cookie `httpOnly` de dix minutes (`bg_suspension_notice`, chemin `/`) au retour OAuth, effacé par le middleware dès que `/connexion` (ou `/en/connexion`) l'a lu — **jamais dans l'URL**, il porte un motif —, rendu par `SuspensionNoticeDialog`. Les portes refusent **avant d'écrire** (`assertIdentityNotSuspended`, avant `createOrGet*User`) : une connexion refusée ne recertifie ni ne réécrit rien. Contestation sans compte : « Signaler un problème », catégorie « Autre », en citant la référence `S-<id>` ; puis le juge. Journal du staff sans pseudo ni motif. Conservation : tant qu'elle court, puis six mois après sa fin (purge entraînée par `createSession`) ; effacée avec le compte ou à son anonymisation, exportée sans son auteur. Le retrait d'une image hors signalement exige lui aussi un motif (`validateModerationReason`). Voir `docs/features/ACCOUNT_SUSPENSION.md`.
