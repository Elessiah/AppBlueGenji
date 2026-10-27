# Page d'un match

`/tournois/[id]/matchs/[matchId]` (espace connecté) et
`/suivre/tournois/[id]/matchs/[matchId]` (sans compte), en français et sous
`/en`. `[matchId]` est `bg_matches.id`. C'est la page **détaillée** d'un match,
pour tout le monde : ce que le public lit, plus ce que seuls ses lecteurs
autorisés lisent. Elle est pensée comme la future maison des compositions
d'équipe et du pool de maps : des sections, sans emplacement vide.

## Accès : les mêmes portes que la fiche

- **404** quand le match n'appartient pas à ce tournoi, ou que le tournoi n'est
  pas visible pour le lecteur (non publié hors staff : `getVisibleTournamentCard`,
  la règle de la fiche) — `lib/server/match-page.ts` (`matchPageExists`, une
  lecture par clé primaire). Une base injoignable n'est pas un 404 : la page
  s'affiche et dit son erreur, comme la fiche.
- **Sans session**, la page connectée renvoie vers la page sans compte (côté
  serveur dans `app/(secured)/layout.tsx`, côté client dans `AuthGate` pour une
  carte venue d'un préchargement) ; un membre connecté sur la page sans compte
  est renvoyé vers celle de son espace (`app/suivre/tournois/[id]/layout.tsx`).
  Requête et langue suivent. Les chemins se lisent par
  `matchPageIdsFromMemberPath` / `matchPageIdsFromSpectatorPath`
  (`lib/shared/match-page.ts`, chiffres seuls).
- **Encart d'un lien partagé** : celui du tournoi, titre précédé de la place du
  match (`matchPositionText` : « Manche R · Match N », précédé du tableau hors
  du tableau principal — « Tableau perdants · … »), adresse canonique sur la page
  du match ; la page sans compte reste `noindex`. Même place sous le titre de la
  page. Une session illisible (base injoignable) n'est pas un 404.

La page est rendue **dans la fiche** (`TournamentSheet`, prop `matchId`) : même
flux temps réel (`useTournamentLive`, ou la relecture publique sans compte),
mêmes fenêtres (score, arbitrage, direct, signalement…), mêmes droits du
lecteur, même témoin du flux (`LiveIndicator`, à côté du retour à la fiche).
Le champ « Première map » garde la carte enregistrée jusqu'à ce que le plateau
relu la porte (`firstMapFieldFollows`). Son composant (`MatchPage.tsx`) est chargé à la demande. Un match
retiré depuis (retour en arrière) affiche « Match introuvable » et ramène à la
fiche.

## Ce qu'elle montre

1. **Le match** : la carte du plateau (`MatchRow`), tous ses gestes compris.
   Sous la page, la carte tait ses liens vers la page elle-même (« Voir le
   match », « +N » des streams) — contexte `MatchPageScope`.
2. **La partie** : les deux côtés, **hôte à gauche** (« Hôte : crée la partie »),
   l'autre à droite (`matchPageSides`) ; la première map — le staff (permission
   `tournaments`) la règle en ligne, même route que la fenêtre d'arbitrage
   (`PUT /api/admin/matches/[id]/first-map`) — et le premier ban (l'équipe qui
   n'héberge pas). Match casté : le rappel « triez les joueurs par rôle ».
3. **Arbitrage** (`matchPageDecision`) : « Arbitre désigné » pour tous — son
   explication derrière le « i » —, son
   pseudo et son BattleTag (« À inviter dans la partie ») aux seuls lecteurs
   que sert la lecture des contacts ; ou l'aide-mémoire de l'**autogestion**
   (l'hôte crée la partie, les managers s'invitent, les paramètres, les casters
   — cette étape seulement avec un caster, `selfManagementSteps`) ; ou, au
   **staff seul**, « Aucune décision ». Rien sur un match terminé ou une
   exemption. Prendre, rendre ou confier l'arbitrage reste le geste de la carte
   (`MATCH_REFEREE.md`).
4. **Casts** (`matchPageStreams`) : **tous** les streams du match, chacun avec
   son lien et ses casters (co-cast compris, chacun par `PlayerLink` — sans compte, pseudo seul : l'identifiant y est masqué), le
   premier lien des vues compactes en tête — gardé même quand aucun stream
   visible ne le porte, comme sur la carte. Deux liens au même texte prennent
   leur numéro (« YouTube 2 »). Les liens suivent la règle de la carte : tus
   tant que le match n'est pas annoncé casté. Puis les fiches des casters, BattleTag marqué
   « À inviter — obligatoire » (pas sur sa propre fiche).

## Données : aucune nouvelle

Les BattleTags de l'arbitre et des casters viennent de la **même lecture** que
la fenêtre « Contacts » (`GET /api/matches/[id]/contacts`, hook partagé
`useMatchContacts`), demandée aux mêmes lecteurs que le bouton de la carte
(`launchStripControls` : `showContacts` / `showOpen`) — jamais sans compte, ni
sur une fiche figée. Le serveur décide seul de ce qu'il rend
(`AUTHORIZATION_RULES.md`). Les contacts des deux équipes ne sont pas repris :
ils restent dans la fenêtre « Contacts ». Le registre et `/rgpd` nomment la page
parmi les lieux où ces contacts paraissent, avec leur base
(registre T01, T04 ; tableau de `/rgpd` par `rgpd-policy.ts`) : contrat pour les
contacts des casters, intérêt légitime pour le BattleTag de l'arbitre, comme dans
les fenêtres. La section « Contacts de match » des conditions (version 6) ne
nomme que les deux fenêtres : la page ne se déploie qu'avec la version 7.

## Liens vers la page

- La carte d'un match : « Voir le match » (tu sur une exemption) et, quand le
  match a plusieurs streams, « +N » après le premier lien (`MatchLiveStrip`).
- La fenêtre de lancement : « Voir le match ».
- L'ancre `#match-<id>` de la fiche reste valable (retour de la page).

## Texte des liens de diffusion

Un lien de stream porte le **nom de la chaîne** (`streamChannelName`,
`lib/shared/live-streams.ts`) : premier segment du chemin chez Twitch et Kick
(2 à 25 signes `A-Z a-z 0-9 _ -`, hors pages du site : `videos`, `directory`…),
poignée `@nom` chez YouTube ; sinon le nom de la plateforme. Passé par
`visibleText`, abrégé d'une ellipse, entier dans `title` et dans le nom
accessible, qui commence par lui (WCAG 2.5.3). Même règle sur la carte du
direct de l'accueil (`LiveCard` : « Regarder bluegenji »). Le bouton du héros
(« Regarder en direct ») et la chaîne officielle d'un tournoi gardent leur
libellé : ce sont des appels à l'action, pas des liens de match.

## Tests

`tests/lib/shared/match-page.test.ts`, `tests/lib/shared/stream-channel-name.test.ts`,
`tests/app/match-page-route.test.ts` (404, tournoi non publié, base en panne,
encart, `/en`), `tests/tournois/match-page-render.test.tsx` (matrice arbitre /
autogestion / sans décision × public / membre / joueur / staff / caster, streams,
contacts demandés, « Voir le match », « +N »), `tests/app/spectator-view.test.tsx`
(redirections).
