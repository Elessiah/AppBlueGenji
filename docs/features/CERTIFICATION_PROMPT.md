# Invitation à certifier Discord et BattleTag (fiche tournoi)

## Ce que ça fait

Au lancement d'un match, chaque équipe présente un ou deux contacts
(`pickLaunchContacts`, `MATCH_LAUNCH.md` § Les contacts présentés) : un joueur
au tag Discord **certifié** ou au BattleTag **vérifié** (compte Battle.net
rattaché). Une équipe où personne n'a rien certifié n'a **aucun contact à
présenter** — un tag Discord non certifié ne sort jamais — et l'adversaire, le
caster comme l'arbitrage restent sans moyen de la joindre.

La fiche d'un tournoi ouvre donc d'office une modale qui invite à certifier :

| Lecteur | Condition | Motif (`reason`) |
| --- | --- | --- |
| Manager (`OWNER` / `MANAGER`, `hasTeamManagementRole`) d'une équipe engagée | il lui manque l'une des deux certifications, **quel que soit le roster** | `MANAGER` |
| Tout autre joueur d'une équipe engagée | l'équipe n'a **aucun** membre certifié (ni Discord ni BattleTag ; Discord seul compte en Marvel Rivals), et il lui en manque une | `TEAM_WITHOUT_CONTACT` |

Rien pour qui a déjà les deux, pour un tournoi terminé (`FINISHED`), en tournoi
individuel, ni pour une équipe non engagée. Le motif `MANAGER` passe devant.

**Marvel Rivals** : le BattleTag (Battle.net) ne sert à rien à ce jeu
(`battletagRelevantFor`, `battletagRelevant` du prompt). Seul le tag Discord est
demandé : un Discord certifié suffit, la modale ne montre que sa pastille et
prend ses variantes « Discord seul » (titre, motif d'équipe, ligne
« identité »).

La modale ne s'ouvre **jamais par-dessus une autre** (`aria-modal` présent :
lancement de match, changements de confidentialité…) — deux pièges à focus se
disputeraient Tab et Échap. Elle attend sa fermeture, guettée par un
observateur du DOM (`watchModalsClosed`, relectures espacées de 250 ms, sans
minuterie de fond : l'économie d'énergie ne la bloque pas) ; la décision pure est `certificationPromptStep`. Décidée,
sa **place est tenue dans le DOM** pendant le chargement de son morceau (le
`loading` de son `dynamic()` rend un `data-modal-pending`) : le centre de
lancement ne s'ouvre pas en même temps qu'elle par accident. Mais elle **cède
sa place** (`data-modal-yields`, `anotherModalOpen(…, { overYielding: true })`,
`lib/shared/dialog-focus.ts`) : l'annonce d'un match qui se lance, urgente,
passe par-dessus, et l'invitation se ferme alors comme sur « Plus tard » (la
modale recouverte ne reprend pas le focus à celle du dessus,
`useDialogBehavior`). Une invitation retirée par le serveur (certification
faite entre-temps) ferme la modale, une fiche figée aussi.

En **Marvel Rivals**, les lignes qui parlent de Blizzard ou de Battle.net
(identité, « ensuite ») prennent leur variante `…DiscordOnly`. Le tableau est
en rôles ARIA (`role="table"`, comme le roster d'équipe) : sous 560 px ses
lignes passent en cartes sans perdre leur sémantique, chaque cellule libellée
par `data-label` (libellé visuel seulement, texte de remplacement vide).

Un membre est certifié par les règles mêmes du lancement
(`hasVerifiedDiscord` / `hasVerifiedBattletag`, `lib/shared/match-launch.ts`).
Une équipe a un contact dès qu'un membre a l'un ou l'autre ; en **Marvel
Rivals**, un Discord certifié seulement (`teamHasContact(members,
battletagRelevant)`) : un BattleTag n'y sert pas à joindre l'équipe.

La modale dit pourquoi elle s'ouvre, où en est le lecteur (pastilles
« Certifié » / « À certifier »), puis un **tableau « Ce que ça fait / Ce que ça
ne fait pas »** — chaque promesse a sa limite en face, sur la même ligne
(identité, matchs, organisation, ensuite). Le bouton principal mène à
**« Applications connectées »** du profil (`/profil#connexions`,
`CERTIFICATION_PROFILE_HREF`), où Discord et Battle.net se rattachent ; le
tag Discord rattaché s'y certifie ensuite d'un clic (`DISCORD_VERIFICATION.md`).

Le tableau ne promet que ce que les règles tiennent : visibilité du tag
(`canViewDiscordTag`), du BattleTag (`canViewBattletag`), portées OAuth
(`OAUTH_PROVIDERS.md` : `identify`, `openid`), conditions d'inscription
(`REGISTRATION_FILTERS.md`). Une règle qui change ces faits relit le tableau
(`messages/*/tournamentDialogs.json`, clé `certification`).

## « Ne plus voir »

- **« Plus tard »** ou fermeture (Échap, voile) : `bg_cert_prompt_closed` = « 1 »
  en **stockage de session** — la modale ne se rouvre pas dans cet onglet ;
- case **« Ne plus voir »** cochée puis fermeture (ou clic sur le bouton du
  profil) : `bg_cert_prompt_off` = « 1 » en **stockage local**, en plus.

Valeurs sans identifiant de personne, jamais transmises au serveur : un
navigateur partagé tait la modale pour tous ses comptes, ce qu'une préférence
d'affichage peut se permettre. Stockage bloqué (navigation privée) : la modale
s'ouvre et se ferme normalement, sans mémoire. Déclarées sur `/rgpd` (FR et EN)
mais **pas** dans `PRIVACY_CHANGES` — même raisonnement que `bg_a11y` : aucune
donnée sur une personne, déposées à la demande du lecteur.

## Câblage

- Règle pure, clés et lecture du stockage : `lib/shared/certification-prompt.ts`
  (`certificationPromptFor`, `teamHasContact`, `battletagRelevantFor`,
  `certificationPromptStep`, `shouldOpenCertificationPrompt`,
  `rememberCertificationPromptClosed`).
- Lecture : `lib/server/tournaments/certification-prompt.ts`
  (`loadCertificationPrompt`, une requête sur le roster en cours), appelée par
  `getTournamentViewerContext` — **porte commune** du flux SSE et de la lecture
  REST de secours — seulement pour une équipe engagée dans un tournoi non clos :
  une requête indexée par connexion du flux (pas par instantané). « Ne plus
  voir » vit dans le navigateur, le serveur l'ignore.
- Champ `TournamentViewerContext.certificationPrompt`, rejoué tel quel d'un
  instantané à l'autre (`live-state.ts`), `null` pour le spectateur sans compte.
- Ouverture une fois par page : `_hooks/useCertificationPrompt.ts` ; modale
  `_components/CertificationPromptDialog.tsx` (chargée à la demande,
  `TournamentDialogFrame`), textes FR/EN `tournamentDialogs.json`.

Tests : `tests/lib/shared/certification-prompt.test.ts`,
`tests/lib/server/certification-prompt.test.ts`,
`tests/tournois/certification-prompt-context.test.ts`,
`tests/tournois/certification-prompt-dialog.test.tsx`.
