# Conditions d'utilisation v9 — texte en attente

Les conditions **v8 sont figées** (`TERMS_VERSION = 8`, `lib/shared/terms-of-use.ts`
et `terms-of-use-en.ts`) : ni ce lot (MATCH-REFEREE-FINISH) ni aucun autre n'y
touche avant la v9. Ce document garde le **texte exact (FR + EN)** à y reprendre,
pour que le lot qui avance `TERMS_VERSION` (ERASURE-D2, qui regroupe aussi
l'effacement) l'applique tel quel, avec sa fixture (`tests/fixtures/legal-fr/`),
son entrée `PRIVACY_CHANGES` (`asksTermsAcceptance`) et la nouvelle acceptation
(`TERMS_OF_USE.md`). Rien ici n'avance `TERMS_VERSION`.

Marque **« décision requise »** : ce que le dépôt ne tranche pas et que
l'utilisateur doit arrêter avant d'écrire. Les trois décisions de ce lot sont
**prises** (utilisateur, 2026-11-03) : T1 (§ 1.3), T2 (§ 2), T3 (§ 1.6).

## 1. Section « Contacts de match » (`id: "contacts-de-match"`)

Sources : ERREUR « conditions v8, Contacts de match » (MATCH-PAGE-CONNECT) ; ERREUR
« BattleTag, tous jeux » (décision 41 b) ; MATCH-REFEREE-FINISH, R2.

### 1.1 Paragraphe 2 (arbitre désigné) — conditions d'arbitrage

Remplacer la parenthèse « (permission d'arbitrage, tag Discord certifié et
BattleTag tiré d'un compte Battle.net rattaché — un BattleTag tapé à la main n'y
suffit pas) » par :

- FR : « (permission d'arbitrage et tag Discord certifié ; pour un match Overwatch,
  aussi un BattleTag tiré d'un compte Battle.net rattaché — un BattleTag tapé à la
  main n'y suffit pas) ».
- EN : "(refereeing permission and certified Discord tag; for an Overwatch match,
  also a BattleTag taken from a linked Battle.net account — a hand-typed BattleTag
  is not enough)".

Casters : la v8 ne demande nulle part un compte Battle.net pour s'inscrire comme
caster (relu le 2026-11-03 : Battle.net n'y figure qu'aux comptes, au retrait d'un
BattleTag et au paragraphe 2 ci-dessus) — rien à reprendre pour eux.

### 1.2 BattleTag borné à Overwatch

Dans les paragraphes 1 à 3, chaque mention du BattleTag « même masqué » se lit
« dans un tournoi Overwatch » : aucun BattleTag n'est présenté en Marvel Rivals
(`withGameBattletag`, décision 35).

- FR (paragraphe 1) : « … **tag Discord** certifié, **BattleTag** — dans un
  tournoi Overwatch seulement —, **même masqué**, et **rôle d'équipe** … ».
- EN (paragraph 1): "… certified **Discord tag**, **BattleTag** — in an Overwatch
  tournament only —, **even when hidden**, and **team role** …".
- FR (paragraphe 2) : « … son **pseudo** et, dans un tournoi Overwatch seulement,
  son **BattleTag**, **même masqué** … ».
- EN (paragraph 2): "… their **username** and, in an Overwatch tournament only,
  their **BattleTag**, **even when hidden** …".

### 1.3 Tag Discord de l'arbitre désigné et contacts des équipes sur la page du match

La v8 dit « jamais son tag Discord à ce titre » et que la page « ne reprend
jamais les contacts des équipes ». Depuis MATCH-PAGE-CONNECT (#531), la page du
match et la fenêtre « Contacts » montrent, aux seules **parties du match**
(membres des deux équipes, casters, arbitre désigné), les contacts des deux équipes
et le **tag Discord certifié** de l'arbitre désigné, aux mêmes moments que son
BattleTag ; jamais aux arbitres sans rôle sur le match, ni dans la fenêtre de
lancement.

- FR (paragraphe 2, remplace « — jamais son tag Discord à ce titre — ») :
  « — et son **tag Discord certifié**, aux seules parties du match (membres de ses
  deux équipes, ses casters), aux mêmes moments —, » (sans date : le partage court
  depuis le 4 novembre 2026, #531, et ne dépend pas de l'acceptation de la v9).
- EN: "— and their **certified Discord tag**, to the parties to the match alone
  (members of both its teams, its casters), at the same times —".
- FR (paragraphe 3, remplace « — jamais les contacts des équipes — ») :
  « et les contacts des deux équipes, aux seules parties du match, aux mêmes
  moments que la fenêtre « Contacts » ; elle reprend aussi les contacts des
  casters et le pseudo de l'arbitre désigné (son BattleTag dans un tournoi
  Overwatch) ».
- EN: "and both teams' contacts, to the parties to the match alone, at the same
  times as the "Contacts" window; it also repeats the casters' contacts and the
  assigned referee's username (their BattleTag in an Overwatch tournament)".

**Décision prise (T1, 2026-11-03)** : la base du tag Discord de l'arbitre est le
**fonctionnement minimum nécessaire** du service — FR « strictement nécessaire à son
fonctionnement minimum », EN "strictly necessary for its minimum functioning" —,
soit l'exécution du service, et non plus l'intérêt légitime posé depuis #531 —
pour un arbitre qui a accepté la v7 ou une suivante, comme le reste de sa
présentation (avant : intérêt légitime, même droit d'opposition) ; une fois la v7
acceptée, ce tag n'a plus d'opposition propre (avant cette acceptation, le « Droit
d'opposition » le compte dans la présentation de l'arbitre). Elle
ne dépend pas de l'acceptation de la v9 : `/rgpd` (FR + EN), le registre (T04,
`frEn`) et le tableau de `/rgpd` (`REFEREE_DISCORD_SCOPE`, base « Exécution du
contrat », et `REFEREE_DISCORD_BEFORE_V7_SCOPE`, « Intérêt légitime ») le disent depuis ce lot, avec l'entrée `PRIVACY_CHANGES`
`2026-11-tag-discord-arbitre-execution-du-service` (5 novembre 2026, `LIVE_STAFF`) ;
l'opposition à l'arbitrage, retenue, en retire toujours l'arbitre. **Jusqu'à la v9**,
la v8 (« jamais son tag Discord à ce titre ») contredit ce partage, en place
depuis #531 : le lot v9 doit suivre sans tarder (ERREUR « conditions v8, Contacts
de match »). Le texte v9
ci-dessus suffit ; si le lot v9 veut nommer la base dans les conditions :
- FR (paragraphe 2, après « aux mêmes moments ») : « ce partage étant
  strictement nécessaire au fonctionnement minimum du service ».
- EN: "this sharing being strictly necessary for the minimum functioning of the
  service".

### 1.4 Fenêtre de lancement

La v8 laisse lire que les arbitres voient la fenêtre de lancement. Elle ne s'ouvre
qu'aux deux équipes, aux casters et à l'arbitre désigné (`readViewerLaunches`).

- FR (paragraphe 3, après « ne s'ouvre qu'aux deux équipes, aux casters et à
  l'arbitre désigné ») : « — les autres arbitres ne lisent ces contacts que dans la
  fenêtre « Contacts » — ».
- EN: "— the other referees read these contacts in the "Contacts" window only —".

### 1.5 Lien vers l'opposition

Le passage « auquel il peut s'opposer comme le dit la politique de confidentialité »
n'a pour lien que `/rgpd#donnees-collectees`. Ajouter à `links` de la section :

- FR : `{ href: "/rgpd#arbitre-designe", label: "Politique de confidentialité — arbitre désigné d'un match" }`
- EN : `{ href: "/rgpd#arbitre-designe", label: "Privacy policy — assigned referee of a match" }`

### 1.6 Paragraphe 3 réécrit pour la v9 (fenêtre de lancement — T3)

**Décision prise (T3, 2026-11-03)** : le paragraphe 3 de la v8 est réécrit en
entier ; ce texte **remplace** les fragments du paragraphe 3 des § 1.3 et § 1.4
(seul le texte ci-dessous est à reprendre). Il suit le code : `readViewerLaunches`
(fenêtre de lancement aux deux équipes, aux casters et à l'arbitre désigné),
`refereeDiscordTag` / `ctx.refereeDiscord` (tag de l'arbitre jamais dans la
fenêtre de lancement), `withGameBattletag` (aucun BattleTag hors Overwatch).

- FR : « Ce partage passe par trois écrans. La fenêtre « Contacts » du match.
  Sa **fenêtre de lancement**, qui la reprend au départ du match et ne s'ouvre
  qu'aux deux équipes, aux casters et à l'arbitre désigné — les autres arbitres
  ne lisent ces contacts que dans la fenêtre « Contacts » — et qui ne montre
  jamais le tag Discord de l'arbitre désigné, sauf s'il caste aussi le match
  (règle des casters). Et la **page du match**, qui reprend, aux mêmes personnes
  et aux mêmes moments que la fenêtre « Contacts », les contacts des casters et
  le pseudo de l'arbitre désigné (son BattleTag dans un tournoi Overwatch) et,
  aux seules parties du match (membres de ses deux équipes, ses casters, son
  arbitre désigné), les contacts des deux équipes et le tag Discord certifié de
  l'arbitre désigné. Un BattleTag masqué n'est lisible nulle part ailleurs sur le
  site, pour personne — arbitres et administrateurs compris. » — la suite du
  paragraphe v8 (« Le jeu, lui, affiche les identifiants de jeu… » jusqu'à « Un
  tag Discord non certifié n'est jamais communiqué. ») est reprise telle quelle.
- EN: "This sharing goes through three screens. The match's "Contacts" window.
  Its **launch window**, which repeats it at the start of the match and only
  opens for both teams, the casters and the assigned referee — the other
  referees read these contacts in the "Contacts" window only — and which never
  shows the assigned referee's Discord tag, unless they also cast the match (the
  casters' rule). And the **match page**, which repeats, to the same people and
  at the same times as the "Contacts" window, the casters' contacts and the
  assigned referee's username (their BattleTag in an Overwatch tournament) and,
  to the parties to the match alone (members of both its teams, its casters, its
  assigned referee), both teams' contacts and the assigned referee's certified
  Discord tag. A hidden BattleTag cannot be read anywhere else on the site, by
  anyone — referees and administrators included." — the rest of the v8
  paragraph ("The game, for its part, shows…" to "An uncertified Discord tag is
  never shared.") is kept as is.

## 2. Invitations d'équipe (conditions du bot, article 01)

Source : ERREUR « article 01 des conditions du bot » (revue juridique #544,
TEAM-INVITE-NOTIFY) — `lib/shared/bot-legal-content.ts`, `TERMS_OF_SERVICE`, section
`01` (celle qui liste ce que le Bot remet en message privé). L'article 01 de v8 ne
cite pas les invitations, reprises et propriétés d'équipe remises en message privé
(la politique du bot, elle, les cite déjà).

Phrase actuelle (FR) : « … avis envoyé à un caster dont l'inscription est retirée
par un autre que lui — ces messages de match aux seuls comptes dont le tag Discord
est certifié sur le site —, alertes d'arbitrage, avis de modération, demandes
d'adhésion à une équipe et informations sur les données. »

À écrire (FR) : « … alertes d'arbitrage, avis de modération, demandes d'adhésion à
une équipe, invitations d'une équipe, reprises d'une équipe fantôme que le staff
propose et propriétés d'équipe transférées (qui ne nomment que l'équipe) et
informations sur les données. »

À écrire (EN, texte « figé » repris du dépôt du bot — `BOT_LEGAL_PAGES.md`) :
"… referee alerts, moderation notices, team join requests, team invitations,
takeovers of a ghost team offered by the staff and team ownership transfers (which
only name the team) and data-protection notices."

Le texte anglais des documents du bot se retouche **d'abord dans le dépôt du bot**
(`LegalTerms`, régénéré par `scripts/generate-legal-terms.py`, PR à part), puis se
reporte ici : voir `BOT_LEGAL_PAGES.md`, « Texte légal anglais figé ».

**Décision prise (T2, 2026-11-03)** : l'avis de reprise dit « Un admin vous propose
de reprendre l'équipe [{nom de l'équipe}]({lien}) » / "An admin offers you to take
over the team [{team name}]({link})" — aucune personne n'est nommée, seul le rôle
(« un admin ») et l'équipe. Le message privé (`formatTeamInviteNotice`, nom par
`discordInline`, lien masqué vers « Mon profil ») et le push (`ghostTeamClaim`,
FR + EN) le disent depuis ce lot. La précision des conditions s'écrit donc
« (qui ne nomment que l'équipe — une reprise cite « un admin », sans nommer
personne) » / "(which only name the team — a takeover mentions "an admin",
naming no one)".

## 3. Marche à suivre pour la v9

1. Reprendre les passages ci-dessus dans `terms-of-use.ts` / `terms-of-use-en.ts`
   (décisions toutes prises le 2026-11-03), régénérer la fixture des conditions.
2. Avancer `TERMS_VERSION` et `TERMS_LAST_UPDATED` ; entrée `PRIVACY_CHANGES`
   (`asksTermsAcceptance: true`, FR + `privacy-changes-en.ts`) qui annonce la v9.
3. Article 01 du bot : PR dans le dépôt du bot d'abord (texte anglais figé).
4. Retirer d'`ERREUR.txt` les entrées que ce lot règle (contacts de match,
   BattleTag tous jeux, lien `/rgpd#arbitre-designe`, fenêtre de lancement,
   article 01 du bot).