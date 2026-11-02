# Page du match — infos de connexion

Demande de l'utilisateur (2026-11-02) : sur la page d'un match
(`MATCH_PAGE.md`), **uniquement pour ses joueurs, ses casters et son
arbitre**, les infos de connexion ; sous le BattleTag de l'arbitre,
« À ajouter en ami » au lieu de « À inviter dans la partie » ; et le tag
Discord de l'arbitre.

## Qui lit quoi

| Lecteur | Infos de connexion | Tag Discord de l'arbitre |
|---|---|---|
| Joueur d'une des deux engagées (`TEAM1` / `TEAM2`) | oui, dès que les deux adversaires sont connus | oui |
| Caster inscrit (`CASTER`) | oui, le temps du match | oui |
| Arbitre désigné (`MATCH_REFEREE`) | oui | sa propre fiche ne le reprend pas (`null`) |
| Arbitre sans rôle sur le match (`REFEREE`, permission `tournaments`) | non — il garde la fenêtre « Contacts » | non : champ **absent** de la réponse |
| Autre membre, visiteur sans compte, fiche figée | non (aucune lecture demandée) | non |

Les moments sont ceux de la fenêtre « Contacts » (`MATCH_LAUNCH.md`,
`exposesMatchContacts`) : rien de neuf n'est collecté.

## Infos de connexion

Section « Infos de connexion » / « Connection info » (`matchPage.sections.connection`,
FR et EN), en tête de la colonne de droite : les fiches des deux engagées
(`SideCard` de `LaunchContactCards.tsx` — nom cliquable, badge d'hôte, contacts
avec « Copier »), **hôte en tête**. Rendue par `ConnectionSection`
(`MatchPage.tsx`) quand la lecture du match a répondu et que le lecteur en est
une **partie** : `connectionReader` (`lib/shared/match-launch.ts`) —
`viewer.role !== "REFEREE"`, ou `isReferee` / `isCaster`.

## Tag Discord de l'arbitre

`LaunchReferee.discordTag`, posé par `buildLaunchReferee`
(`match-launch-info.ts`) sous le drapeau `refereeDiscord` du contexte :
lecture d'**un** match (`loadViewerMatchContacts`, `GET /api/matches/[id]/contacts`)
**et** rôle de partie (`party.role !== "REFEREE"`). La modale de lancement
(`listViewerMatchLaunches`) ne l'envoie pas, et le champ y est absent. Il suit
la fenêtre des contacts (`ctx.exposes`), comme le BattleTag, et passe par
`visibleDiscordTag` (`sharesMatchLobby`) — seul un tag certifié sort.
`RefereeCard` dessine la ligne « Discord » avec « Copier » quand le champ est
présent : sur la page du match comme dans la fenêtre « Contacts », qui lit la
même route.

## Les deux portes

Rien de cela n'entre dans `TournamentSnapshot` ni dans
`TournamentViewerContext` : la page le lit par la route REST propre au lecteur
(`useMatchContacts`), que la fiche soit servie par le flux SSE ou par sa
relecture de secours ; la décision de demander la lecture
(`launchStripControls().showContacts`) lit le contexte du lecteur, livré par
les deux portes.

## Légal

Le tag Discord de l'arbitre est un nouveau lecteur : les conditions v8
(« Contacts de match ») disent « jamais son tag Discord » et « jamais les
contacts des équipes » sur la page — base retenue : **intérêt légitime**
(que les parties puissent joindre leur arbitre), opposition par le formulaire
de signalement, même effet que l'opposition à sa présentation ; les contacts
des équipes restent sur le contrat (mêmes destinataires, mêmes moments que la
fenêtre « Contacts »). Déclaré : `PRIVACY_CHANGES`
`2026-11-page-du-match-infos-de-connexion` (FR + EN), `/rgpd`
(#arbitre-designe, tableau par `rgpd-policy.ts` : `REFEREE_DISCORD_SCOPE`,
`MATCH_CONTACTS_SCOPE`, `BATTLETAG_MATCH_SCOPE`), registre T01 et T04. La
retouche des conditions attend leur prochaine version (`ERREUR.txt`).

## Tests

`tests/lib/server/match-launch-info.test.ts` (« tag Discord de l'arbitre »),
`tests/lib/shared/match-launch.test.ts` (`connectionReader`),
`tests/tournois/launch-option-ui.test.tsx` (`RefereeCard`),
`tests/tournois/match-page-render.test.tsx` (« infos de connexion »).
