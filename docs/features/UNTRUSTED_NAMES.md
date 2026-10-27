# Noms et textes saisis : visibles à l'écriture, inertes sur Discord

Deux défauts venaient d'une même source : un nom saisi (pseudo, nom d'équipe)
était recopié tel quel, là où il est **lu** (rosters, feuilles de match) et là où
il est **interprété** (Discord).

## 1. Caractères invisibles — `lib/shared/visible-text.ts`

`visibleText(raw)` rend la forme affichable d'un nom :

- normalisation **NFKC** (pleine chasse, lettres mathématiques → forme courante) ;
- **contrôles** (`\p{Cc}`, sauts de ligne compris) → espace ;
- **caractères de format** (`\p{Cf}` : espaces de largeur nulle, commandes de
  direction U+202E / U+2066–2069, césure conditionnelle, BOM…) retirés ;
- **remplissages hangul** (U+115F, U+1160, U+3164, U+FFA0), lettres sans dessin, retirés ;
- espaces réduits à un seul, bordures retirées.

Seule exception, le liant sans chasse (U+200D) **entre deux pictogrammes**, qui
compose un emoji (famille, drapeau arc-en-ciel).

Appelée par `normalizePseudo` (écriture du profil, création de compte OAuth,
**et** recherche par pseudo — une saisie piégée désigne le compte qu'elle imite,
jamais un sosie), par `checkTeamName` (création, renommage, équipes
fantômes, formulaires) et par `validateTournamentInput` (nom d'un tournoi, à la
création comme à l'édition — il s'affiche sur l'accueil sans compte). La saisie
est **nettoyée, pas refusée** : un pseudo naît aussi d'une connexion OAuth, où
un refus empêcherait de se connecter. Un nom réduit à rien par le nettoyage
retombe sur les refus existants (`PSEUDO_EMPTY`, `INVALID_TEAM_NAME`,
`MISSING_NAME`).

`withoutInvisibles(raw)` en est la moitié sans normalisation (ni NFKC ni
réduction des espaces) : pour une saisie du staff dont la typographie est le
propos — les chiffres de l'association (`validateAboutStatInput`, valeur et
titre, français et anglais), où NFKC réécrirait « 4 200 € » à espace fine ou
« m² ». Une valeur faite seulement d'invisibles y est vide : refusée en
français, absente en anglais.

### Noms déjà en base

Les noms enregistrés avant le nettoyage à l'écriture sont **réécrits une fois**
au démarrage (`cleanStoredNames`, `lib/server/database/data-migrations.ts`) :
`bg_teams.name`, `bg_users.pseudo`, `bg_tournaments.name`. La passe lit les
noms et compare en JavaScript (la syntaxe des classes Unicode diffère entre
MySQL et MariaDB), et ne trouve plus rien à écrire une fois les noms propres.
Elle laisse tel quel un nom qui ne garderait rien, ou que la base refuse : un
sosie dont la forme propre est déjà prise (`UNIQUE`), une forme NFKC trop
longue pour la colonne. Le journal (`pm2 logs`) ne compte que des lignes,
jamais un nom.

Ces restes expliquent que les filtres de sortie demeurent :

- l'accueil (`lib/server/landing-service.ts`, `shownEntrantName`) passe par
  `visibleText` les noms d'engagés du bandeau et de la carte « en cours »
  (match mis en avant et carrousel), et le **nom du tournoi** du bandeau
  (résultat, inscriptions, vainqueur), de la carte et du bouton « Regarder le
  live » ;
- le classement (`loadTeamRanking`) rend la forme affichable — c'est elle que
  départage `compareRankedTeams` à égalité ; vide, le leaderboard et
  `/classement` reçoivent `null` et posent un repli **traduit** (« Équipe #id » /
  « Team #id », `leaderboard.teamFallback`, `board.teamFallback`) ;
- `getUserActiveTeam` (menu du compte : indication et nom accessible ; vide,
  l'entrée se nomme « Mon équipe ») ;
- `EntrantName` (tout écran de tournoi, spectateur compris, et le dialogue de
  programmation d'un match), nom et initiale de repli.

## 2. Mentions et balisage Discord — `lib/shared/discord-text.ts`

Tout fragment saisi par un utilisateur qui part vers le bot passe par l'une de
deux fonctions :

- `discordInline(value)` — fragment de phrase (nom d'équipe, de tournoi, motif
  de pénalité) : d'abord `visibleText` (un nom ancien ou un nom de tournoi peut
  encore porter U+202E ou un invisible), puis une ligne, balisage échappé (`\ * _ ~ `` ` `` | [ ] ( ) < > # -`),
  `@` suivi d'un espace de largeur nulle (`@everyone`, `@here` ne notifient plus),
  `<` échappé (les mentions `<@…>`, `<@&…>`, `<#…>` ne sont plus reconnues),
  adresse nue désamorcée (espace de largeur nulle dans `://` et après un point
  suivi d'une lettre ou d'un chiffre : une équipe `https://faux-site.gg` ne
  devient ni lien cliquable ni aperçu) ;
- `discordQuote(value)` — texte libre sur plusieurs lignes (signalement d'un
  problème) : mêmes neutralisations (`visibleText` ligne à ligne) sauf les
  adresses, qui restent cliquables (une capture citée en preuve), chaque ligne **citée** (`> `) pour qu'aucune
  ne se fasse passer pour une ligne rédigée par le site.

Points d'application : `entrantLabel` (toutes les lignes de journal, alertes
arbitre, rappels de match qui nomment une équipe), en-têtes de tournoi de
`bot-logs` et `referee-alerts`, rappels de match, signalement d'un problème,
avis de demande d'adhésion, messages de quarantaine des logos (shared et
server), retrait d'un logo par la modération, alerte de signalement.

**Règle pour un rédacteur futur** : un texte venu d'un utilisateur n'entre dans
un message Discord que par `discordInline` ou `discordQuote`. Les balises posées
par le site lui-même (`**…**`, liens) restent actives.

Côté bot, `allowedMentions: { parse: [] }` par défaut reste une défense en
profondeur à poser dans le dépôt `blueGenjiBot` : le site neutralise tout ce
qu'il rédige, mais pas ce que d'autres modules du bot pourraient relayer.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Noms saisis et textes vers Discord** (`lib/shared/visible-text.ts` + `lib/shared/discord-text.ts`, purs) : pseudos et noms d'équipe passent par `visibleText` (NFKC, invisibles et commandes de direction retirés, une seule ligne) — via `normalizePseudo` et `checkTeamName`, recherche par pseudo comprise, si bien qu'un sosie à espace de largeur nulle désigne l'original. **Règle pour tout rédacteur Discord futur** : un texte venu d'un utilisateur n'entre dans un message que par `discordInline` (fragment : balisage échappé, `@` et `<@…>` désamorcés, une ligne) ou `discordQuote` (texte libre, cité ligne à ligne) ; `entrantLabel` le fait déjà pour les noms d'engagés. Voir `docs/features/UNTRUSTED_NAMES.md`.
