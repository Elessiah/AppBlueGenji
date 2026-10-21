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
| Meneur (`OWNER` / `MANAGER` / `CAPITAINE`, `canDeclareTeamReady` — le capitaine est le premier présenté par `pickLaunchContacts` à vérification égale) d'une équipe engagée | il lui manque l'une des deux certifications, **quel que soit le roster** | `MANAGER` |
| Tout autre membre (joueur, coach) d'une équipe engagée | l'équipe n'a **aucun** membre certifié (ni Discord ni BattleTag ; Discord seul compte en Marvel Rivals), et il lui en manque une | `TEAM_WITHOUT_CONTACT` |

Rien pour qui a déjà les deux, pour un tournoi terminé (`FINISHED`), en tournoi
individuel, ni pour une équipe non engagée. Le motif `MANAGER` passe devant.

**Marvel Rivals** : le BattleTag (Battle.net) ne sert à rien à ce jeu
(`battletagRelevantFor`, `battletagRelevant` du prompt). Seul le tag Discord est
demandé : un Discord certifié suffit, la modale ne montre que sa pastille et
prend ses variantes « Discord seul » (titre, motif d'équipe, cellules du
tableau — `DISCORD_ONLY_CELLS` : identité, matchs, « ensuite »).

La modale ne s'ouvre **jamais par-dessus une autre** (`aria-modal` présent :
lancement de match, changements de confidentialité…) — deux pièges à focus se
disputeraient Tab et Échap. Une modale déjà ouverte à la décision l'**écarte
pour cette page**, sans rien retenir (`useCertificationPrompt`) :
l'attendre la ferait surgir à la fermeture d'une annonce de lancement, au
départ du match, sur le plateau. Elle revient à la prochaine fiche ouverte. Décidée,
sa **place est tenue dans le DOM** pendant le chargement de son morceau (le
`loading` de son `dynamic()` rend un `data-modal-pending`) : le centre de
lancement ne s'ouvre pas en même temps qu'elle par accident. Mais elle **cède
sa place** (prop `yields` de `TournamentDialogFrame` → `data-modal-yields` sur
sa racine, `anotherModalOpen(…, { overYielding: true })`,
`lib/shared/dialog-focus.ts`) : l'annonce d'un match qui se lance, urgente,
passe par-dessus — comme toute autre modale qui s'ouvrirait sur elle ; le guet
(`watchUrgentModalOpened`) réagit sans délai, n'examine que les nœuds ajoutés et
reste armé onglet caché (aucune minuterie) ; un morceau arrivé après l'urgente
ne se monte pas (lecture au montage ; le guet l'efface ensuite). L'invitation s'efface **pour le reste de la page**, sans rien retenir dans le
navigateur (elle n'a peut-être pas été lue — sauf « Ne plus voir » déjà cochée, retenue) : revenue à chaque fermeture d'une
annonce de lancement, elle couvrirait le plateau en plein match. Elle revient
à la prochaine fiche ouverte. La modale
recouverte ne reprend pas le focus à celle du dessus, et lui passe sa propre
cible de retour (`useDialogBehavior`). Une invitation retirée (certification
faite entre-temps, lecture en échec) **ferme** la modale sans rien retenir :
revenue à la lecture suivante, elle repasse par la décision (autre modale
ouverte, « Ne plus voir »). Le client la recoupe avec
l'instantané (`liveCertificationPrompt`) : tournoi clos depuis ou équipe
retirée, plus rien. Une fiche figée la masque aussi.

En **Marvel Rivals**, les lignes qui parlent de Blizzard ou de Battle.net
(identité, matchs, « ensuite ») prennent leur variante `…DiscordOnly`. Le tableau est
en rôles ARIA (`role="table"`, comme le roster d'équipe) : sous 560 px ses
lignes passent en cartes sans perdre leur sémantique, chaque cellule libellée
par `data-label` (libellé visuel seulement, texte de remplacement vide).

Battle.net rattaché **sans** BattleTag enregistré : rien à faire depuis le
profil (rattachement déjà là, BattleTag tapé refusé) — la modale ne lui en
parle pas (variante « Discord seul », `battletagRelevant: false`), mais il ne
fait toujours pas un contact pour l'équipe.

Un membre est certifié par les règles mêmes du lancement
(`hasVerifiedDiscord` / `hasVerifiedBattletag`, `lib/shared/match-launch.ts`).
Une équipe a un contact dès qu'un membre a l'un ou l'autre ; en **Marvel
Rivals**, un Discord certifié seulement (`teamHasContact(members,
battletagRelevant)`) : un BattleTag n'y sert pas à joindre l'équipe.

La modale dit pourquoi elle s'ouvre, où en est le lecteur (pastilles
« Certifié » / « À certifier »), puis un **tableau « Ce que ça fait / Ce que ça
ne fait pas »** — chaque promesse a sa limite en face, sur la même ligne
(identité, matchs, organisation, ensuite). Le bouton principal
(`certificationProfileHref`) ouvre d'emblée le **dialogue de certification**
Discord du profil (`CERTIFY_PROFILE_HREF`, `/profil?certifier=discord`, le lien
de la proposition de la connexion — `DISCORD_CERTIFY_PROMPT.md`) tant que le
tag Discord manque, sinon mène à **« Applications connectées »**
(`/profil#connexions`), où Battle.net se rattache.

Le tableau ne promet que ce que les règles tiennent : visibilité du tag
(`canViewDiscordTag`), du BattleTag (`canViewBattletag`), pastilles de
certification lues par tout joueur connecté même tag masqué (registre),
contacts présentés aux équipes, au caster et aux arbitres (T04), portées OAuth
(`OAUTH_PROVIDERS.md` : `identify`, `openid`), conditions d'inscription
(`REGISTRATION_FILTERS.md`). Une règle qui change ces faits relit le tableau
(`messages/*/tournamentDialogs.json`, clé `certification`).

## « Ne plus voir »

Le « Ne plus voir » donné à la **proposition de certification de la
connexion** (`DISCORD_CERTIFY_PROMPT.md`, `bg_users.discord_certify_prompt_dismissed_at`,
gardé sur le compte) vaut aussi ici, sur tous les appareils, pour l'invitation
faite au **meneur** et **quand Discord est seul à manquer** (un BattleTag à
vérifier n'était pas l'objet de ce refus) — jamais quand l'équipe n'a aucun
contact, meneur compris : lu seulement dans ce cas (`loadCertificationPrompt`), colonne absente
= sans choix. L'inverse n'est pas vrai : la case de cette modale reste une
préférence d'affichage du navigateur.

- **« Plus tard »** ou fermeture (Échap, voile) : `bg_cert_prompt_closed` = « 1 »
  en **stockage de session** — la modale ne se rouvre pas dans cet onglet.
  La case « Ne plus voir », visible, vaut pour **toute** fermeture, Échap et
  voile compris ;
- case **« Ne plus voir »** cochée puis fermeture (ou clic sur le bouton du
  profil) : `bg_cert_prompt_off` = « 1 » en **stockage local**, en plus. Un
  clic qui ouvre le profil dans un nouvel onglet (Ctrl, Cmd, Maj, bouton du
  milieu) ne ferme rien et ne retient rien.

Traitement inscrit au registre (T04, sous-finalité « Inviter … à certifier »).
Valeurs sans identifiant de personne, jamais transmises au serveur : un
navigateur partagé tait la modale pour tous ses comptes, ce qu'une préférence
d'affichage peut se permettre. Stockage bloqué (navigation privée) : la modale
s'ouvre et se ferme normalement, sans mémoire. Déclarées sur `/rgpd` (FR et EN)
mais **pas** dans `PRIVACY_CHANGES` — même raisonnement que `bg_a11y` : aucune
donnée sur une personne, déposées à la demande du lecteur.

## Câblage

- Règle pure, clés et lecture du stockage : `lib/shared/certification-prompt.ts`
  (`certificationPromptFor`, `teamHasContact`, `battletagRelevantFor`,
  `shouldOpenCertificationPrompt`,
  `rememberCertificationPromptClosed`).
- Lecture : `lib/server/tournaments/certification-prompt.ts`
  (`loadCertificationPrompt`, une requête sur le roster en cours — `loadRosters`
  et `toCandidate` du lancement, `match-launch-info.ts` : les certifications se
  lisent comme au lancement ; seule différence voulue, en Marvel Rivals un
  BattleTag vérifié ne compte pas comme contact), appelée par
  `getTournamentViewerContext` — **porte commune** du flux SSE et de la lecture
  REST de secours — seulement pour une équipe engagée dans un tournoi non clos :
  une requête indexée, gardée une minute par lecteur
  (`cachedCertificationPrompt`, `CERTIFICATION_PROMPT_TTL_MS`, mémoire bornée,
  lecture en cours partagée, échec retenu dix secondes, lecture abandonnée après
  trois secondes retenue une minute — tardive mais réussie, elle sert) : le contexte se relit
  à chaque lecture REST (geste, proposition de score, repli du flux). Une
  certification faite entre-temps se voit au plus une minute plus tard. La case
  « Ne plus voir » de la modale vit dans le navigateur ; le serveur ne lit que
  celui de la proposition de la connexion (compte, § « Ne plus voir »). Une
  lecture en échec
  tait l'invitation (`null`, journal pm2) sans faire tomber le contexte.
- Champ `TournamentViewerContext.certificationPrompt`, rejoué tel quel d'un
  instantané à l'autre (`live-state.ts`), `null` pour le spectateur sans compte.
- Ouverture une fois par page — par tournoi, la fiche étant réutilisée d'un
  tournoi à l'autre : `_hooks/useCertificationPrompt.ts` ; modale
  `_components/CertificationPromptDialog.tsx` (chargée à la demande,
  `TournamentDialogFrame`), textes FR/EN `tournamentDialogs.json`.

Tests : `tests/lib/shared/certification-prompt.test.ts`,
`tests/lib/server/certification-prompt.test.ts`,
`tests/tournois/certification-prompt-context.test.ts`,
`tests/tournois/certification-prompt-dialog.test.tsx`,
`tests/tournois/certification-prompt-hook.test.ts` (décision, effacement,
retrait, changement de tournoi), `tests/lib/shared/dialog-focus.test.ts`
(`anotherModalOpen`, `watchUrgentModalOpened`, `handOffRestoreTargets`).
