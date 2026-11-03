# Conditions d'utilisation v9 — texte en attente

Les conditions **v8 sont figées** (`TERMS_VERSION = 8`, `lib/shared/terms-of-use.ts`
et `terms-of-use-en.ts`) : ni ce lot (MATCH-REFEREE-FINISH) ni aucun autre n'y
touche avant la v9. Ce document garde le **texte exact (FR + EN)** à y reprendre,
pour que le lot qui avance `TERMS_VERSION` (ERASURE-D2, qui regroupe aussi
l'effacement) l'applique tel quel, avec sa fixture (`tests/fixtures/legal-fr/`),
son entrée `PRIVACY_CHANGES` (`asksTermsAcceptance`) et la nouvelle acceptation
(`TERMS_OF_USE.md`). Rien ici n'avance `TERMS_VERSION`.

Marque **« décision requise »** : ce que le dépôt ne tranche pas et que
l'utilisateur doit arrêter avant d'écrire.

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

Même condition pour les casters : tout passage des conditions qui demande un compte
Battle.net rattaché pour s'inscrire comme caster se borne de la même façon aux
matchs Overwatch (la section sur la diffusion est à relire à ce moment).

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
  « — et, depuis la version 9, son **tag Discord certifié**, aux seules parties du
  match (membres de ses deux équipes, ses casters), aux mêmes moments —, ».
- EN: "— and, since version 9, their **certified Discord tag**, to the parties to
  the match alone (members of both its teams, its casters), at the same times —".
- FR (paragraphe 3, remplace « — jamais les contacts des équipes — ») :
  « et les contacts des deux équipes, aux seules parties du match, aux mêmes
  moments que la fenêtre « Contacts » ; elle reprend aussi les contacts des
  casters et le pseudo de l'arbitre désigné (son BattleTag dans un tournoi
  Overwatch) ».
- EN: "and both teams' contacts, to the parties to the match alone, at the same
  times as the "Contacts" window; it also repeats the casters' contacts and the
  assigned referee's username (their BattleTag in an Overwatch tournament)".

**Décision requise** : la base du tag Discord de l'arbitre. `/rgpd` et le registre
(T04) la posent sur l'**intérêt légitime** depuis #531 ; la piste de l'ERREUR est de
la « basculer sur le contrat » dès que les conditions v9 le prévoient. Garder
l'intérêt légitime (le texte ci-dessus suffit) ou passer au contrat (`/rgpd` et T04
suivent, entrée `PRIVACY_CHANGES` en conséquence) : à trancher par l'utilisateur.

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

**Décision requise** : la précision « (qui ne nomment que l'équipe) » — la politique
du bot dit « le nom de l'équipe seul, jamais qui propose » alors que l'avis de
reprise cite le staff (ERREUR #544, `GHOST_CLAIM`) : arrêter si les conditions
disent « le staff seul est cité » ou « aucune personne n'est nommée ».

## 3. Marche à suivre pour la v9

1. Reprendre les passages ci-dessus dans `terms-of-use.ts` / `terms-of-use-en.ts`
   (une fois les décisions prises), régénérer la fixture des conditions.
2. Avancer `TERMS_VERSION` et `TERMS_LAST_UPDATED` ; entrée `PRIVACY_CHANGES`
   (`asksTermsAcceptance: true`, FR + `privacy-changes-en.ts`) qui annonce la v9.
3. Article 01 du bot : PR dans le dépôt du bot d'abord (texte anglais figé).
4. Retirer d'`ERREUR.txt` les entrées que ce lot règle (contacts de match,
   BattleTag tous jeux, lien `/rgpd#arbitre-designe`, fenêtre de lancement,
   article 01 du bot).