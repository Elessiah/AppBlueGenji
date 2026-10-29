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

La page ne reprend plus la carte du plateau : un **en-tête**, une grille de
**faits clés**, puis deux colonnes de sections (une seule sous 900 px, et
quand l'une est vide). Textes propres à la page : espace de noms `matchPage`
(`messages/{fr,en}/matchPage.json`, chargé à part — `useMatchPageText`), les
anciennes clés `tournament.matchPage.*` restant pour les sections.

1. **En-tête** : ligne de situation, titre « A contre B » et tableau
   d'affichage **dans l'ordre des côtés** (hôte à gauche, `matchPageSides`),
   chaque engagé par `EntrantName` (case vide « BYE » ou « TBD » comme la carte, logo 40 px, nom qui passe à la ligne, logo
   au-dessus du nom sous 560 px) ; score au centre (`matchPageHeaderScore`,
   « FF » sur forfait, « VS » avant tout score ; nom accessible « Score : A x,
   B y »). Dessous : vainqueur, nul ou double forfait, horaire, état de
   diffusion (`pill-live` seulement à l'antenne, « Cast annoncé » sinon), date
   manquante (staff), rediffusion et proposition de score en attente.
2. **Faits clés** (`KeyFacts`, `components/cyber/` — la grille des pages de
   règles `/regles/[slug]`, une seule définition) : « Hôte » (crée la partie),
   « Premier ban » (« Adversaires à venir » tant qu'une case attend ; tus quand
   les deux adversaires sont connus sans hôte désigné), « Arbitre » (pseudo pour un lecteur connecté qui le reçoit
   déjà, `refereeNameOf` ; « Arbitre désigné » sinon) ou « Arbitrage :
   Autogestion » (au staff seul : « Aucune décision »), « Maps » (« Map 1 :
   Ilios · imposée », pool « à choisir parmi … », « · choix du perdant » —
   `matchPageMapFacts`, noms passés par `visibleText`) ou « Première map » sans
   réglage du tour, « Format » (FT3 ; son explication derrière le « i »), « Côtés » (avec un hôte), « Casters » (prêt / attendu dans
   le salon, sauf sans compte) et « Lancement » (`LaunchPhaseBadge`).
3. **Actions** : exactement les gestes de la carte, par le **même modèle**
   (`useMatchCardModel`, `_lib/match-card-model.ts`, partagé avec `MatchRow`) et
   le même pied (`MatchCardActions` : une principale, le reste derrière « Plus
   d'actions »), moins « Page du match » (`MatchPageScope`). Section tue quand
   le lecteur n'a aucun geste.
4. **Résultat** (maps jouées), puis **Maps et bans** : ordre des bans,
   première map réglable par le staff (`PUT /api/admin/matches/[id]/first-map`)
   sans réglage du tour, liste outillée du tour (`MatchRoundMaps`) au staff et
   aux équipes qui choisissent — le public lit les maps dans les faits clés —,
   rappel « triez les joueurs par rôle » d'un match casté.
5. **Arbitrage** (colonne de droite, `matchPageDecision`) : « Arbitre désigné » pour tous — son
   explication derrière le « i » —, son
   pseudo et — en Overwatch seulement — son BattleTag (« À inviter dans la
   partie ») aux seuls lecteurs que sert la lecture des contacts ; ou l'aide-mémoire de l'**autogestion**
   (l'hôte crée la partie, les managers s'invitent, les paramètres, les casters
   — cette étape seulement avec un caster, `selfManagementSteps`) ; à
   l'étape des paramètres, un match **Overwatch** liste en sous-liste
   (`<ul>` imbriquée, `OW_SELF_MANAGEMENT_SETTINGS`) : paramètres compétitifs,
   killcam désactivée, pause lors de la déconnexion d'un joueur (clés
   `matchPage.owSettings.*`, FR et EN) — rien pour Marvel Rivals ; ni le DM de
   lancement ni le bot ne reprennent cette étape ; ou, au
   **staff seul**, « Aucune décision ». Rien sur un match terminé ou une
   exemption. Prendre, rendre ou confier l'arbitrage reste le geste de la carte
   (`MATCH_REFEREE.md`).
6. **Casts** (`matchPageStreams`) : **tous** les streams du match, chacun avec
   son lien et ses casters (co-cast compris, chacun par `PlayerLink` — sans compte, pseudo seul : l'identifiant y est masqué), le
   premier lien des vues compactes en tête — gardé même quand aucun stream
   visible ne le porte, comme sur la carte. Deux liens au même texte prennent
   leur numéro (« YouTube 2 »). Les liens suivent la règle de la carte : tus
   tant que le match n'est pas annoncé casté. Puis les fiches des casters, BattleTag marqué
   « À inviter — obligatoire » (pas sur sa propre fiche) sous « Casters à
   inviter ».

## Hors Overwatch (décision 35, 2026-10-28)

En Marvel Rivals, on ne s'invite pas par BattleTag : la lecture des contacts
n'envoie **pas du tout** le BattleTag (ni `battletagVerified`) des casters ni de
l'arbitre désigné (`withGameBattletag`, `match-launch-info.ts`, jeu lu par
`battletagRelevantFor`) — ni à la page, ni à la modale de lancement, ni à la
fenêtre « Contacts », staff compris. Les fiches n'en dessinent pas la ligne
(`CasterCard`, `RefereeCard`), la page tait les deux consignes « À inviter » et
titre « Contacts des casters » (tag Discord certifié seul). Les contacts des
équipes perdent aussi le leur hors Overwatch (décision 38, `sideContacts`,
`MATCH_LAUNCH.md` § Les contacts présentés).

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
contacts des casters et pour le BattleTag de l'arbitre, comme dans les
fenêtres. La section « Contacts de match » des conditions la nomme depuis
leur version 7 (TERMS v7) : la page ne se déploie qu'avec elle.

## Liens vers la page

- La carte d'un match : « Page du match » est **une action du pied de la carte**
  (`MatchCardActions`, id `matchPage`, `MATCH_CARD_LAYOUT.md`), pas un lien posé
  à part : un vrai lien (`LocaleLink`, ouvrable dans un onglet) au gabarit des
  boutons du pied, nom accessible « Page du match : A contre B ». Elle tient le
  pied (pleine largeur) quand le lecteur n'a aucun geste à faire — le public —,
  et passe derrière « Plus d'actions » après « Contacts » dès qu'il en a un
  (score à saisir, planification…). Absente sous la page elle-même
  (`MatchPageScope`) et sur une exemption. Quand le match a plusieurs streams,
  « +N » après le premier lien (`MatchLiveStrip`).
- La fenêtre de lancement : « Page du match ».
- **Retour à la fiche** : « ← Retour au tournoi », au style du « ← Retour » de
  l'en-tête de la fiche (`composes` de sa feuille de style : une seule définition),
  un vrai lien vers `tournamentMatchHref` — l'ancre `#match-<id>` de la fiche
  (`match-anchor.ts`, `useMatchAnchor`) pose la fiche **sur la carte du match**,
  dans la bonne phase, surlignée et focalisée. Ce n'est pas `router.back()` : la
  fiche se remplit par le flux après son montage, la position d'un retour
  d'historique ne tiendrait pas. Le nom du tournoi, qui faisait le bouton, ouvre
  la ligne de situation sous le titre (« Tournoi · phase · Manche R · Match N »).

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
contacts demandés, « Page du match », « +N », en-tête, faits clés, mêmes
actions que la carte), `tests/tournois/match-page-facts.test.ts`,
`tests/components/key-facts.test.tsx`, `tests/app/spectator-view.test.tsx`
(redirections).
