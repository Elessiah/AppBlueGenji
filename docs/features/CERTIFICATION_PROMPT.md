# Invitation à certifier Discord et BattleTag (fiche tournoi)

## Ce que ça fait

Au lancement d'un match, chaque équipe présente un ou deux contacts
(`pickLaunchContacts`, `MATCH_LAUNCH.md` § Les contacts présentés) : un joueur
au tag Discord **certifié** ou au BattleTag **vérifié** (compte Battle.net
rattaché). Une équipe où personne n'a rien certifié n'a **aucun contact
vérifié** : le premier par rôle est présenté avec son seul BattleTag, non
vérifié (même masqué) — un tag Discord non certifié ne sort jamais — et
l'adversaire, le caster comme l'arbitrage restent sans moyen sûr de la joindre.
La modale le dit ainsi (« aucun contact vérifié », en Marvel Rivals « personne à
présenter sur Discord »), jamais « aucun contact ».

La fiche d'un tournoi ouvre donc d'office une modale qui invite à certifier :

| Lecteur | Condition | Motif (`reason`) |
| --- | --- | --- |
| Meneur (`OWNER` / `MANAGER` / `CAPITAINE`, `canDeclareTeamReady` — le capitaine est le premier présenté par `pickLaunchContacts` à vérification égale) d'une équipe engagée | il lui manque l'une des deux certifications, **quel que soit le roster** | `MANAGER` |
| Tout autre membre (joueur, coach) d'une équipe engagée | l'équipe n'a **aucun** membre certifié (ni Discord ni BattleTag ; Discord seul compte en Marvel Rivals), et il lui en manque une | `TEAM_WITHOUT_CONTACT` |

Rien pour qui a déjà les deux, pour un tournoi terminé (`FINISHED`), en tournoi
individuel, ni pour une équipe non engagée. Le motif `MANAGER` passe devant ;
le prompt porte aussi `teamHasContact`, et un meneur dont l'équipe n'a aucun
contact lit un chapeau qui le dit (`leadManagerNoContact`, variante « Discord
seul ») — le fait le plus urgent : l'adversaire et l'arbitrage ne peuvent pas
la joindre.

Les pastilles d'état (« Où tu en es », `role="list"` gardé sous WebKit malgré
`list-style: none`) : « Certifié » en `pill-success`, « À certifier » en
`pill-info` — une étape refusable, pas un avertissement (décision 17).

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
en rôles ARIA (`role="table"`, comme le roster d'équipe) : quand **le tableau**
fait 575 px ou moins (requête de conteneur `certification-table` : la modale
pleine en offre 594, 577 sous une barre de défilement ; une modale rétrécie
garderait sinon trois colonnes étroites) ses lignes passent en cartes sans perdre leur sémantique, chaque
cellule libellée par `data-label` (libellé visuel seulement, texte de
remplacement vide). En tableau, l'en-tête « Sujet » s'affiche, et la première
et la dernière colonne n'ont pas de retrait extérieur : le tableau s'aligne sur
le chapeau et le pied. Le cadre (`TournamentDialogFrame`) prend le focus à
l'ouverture : anneau bleu au clavier seulement (`:focus-visible`).

Battle.net rattaché **sans** BattleTag venu de lui : rien à faire depuis le
profil (rattachement déjà là, un BattleTag tapé n'y est jamais vérifié,
`BATTLETAG_ORIGIN.md`) — la modale ne lui en
parle pas (variante « Discord seul », `battletagRelevant: false`), mais il ne
fait toujours pas un contact pour l'équipe.

Un membre est certifié par les règles mêmes du lancement
(`hasVerifiedDiscord` / `hasVerifiedBattletag`, `lib/shared/match-launch.ts`).
Une équipe a un contact dès qu'un membre a l'un ou l'autre ; en **Marvel
Rivals**, un Discord certifié seulement (`teamHasContact(members,
battletagRelevant)`) : un BattleTag n'y sert pas à joindre l'équipe.

Son titre ne nomme que ce qui manque (Discord, BattleTag, ou les deux).
La modale dit pourquoi elle s'ouvre, où en est le lecteur (pastilles
« Certifié » / « À certifier »), puis un **tableau « Ce que ça fait / Ce que ça
ne fait pas »** — chaque promesse a sa limite en face, sur la même ligne
(identité, matchs, messages du bot, organisation, ensuite). Le bouton principal
(`certificationProfileHref`) ouvre d'emblée le **dialogue de certification**
Discord du profil (`CERTIFY_PROFILE_HREF`, `/profil?certifier=discord`, le lien
de la proposition de la connexion — `DISCORD_CERTIFY_PROMPT.md`) tant que le
tag Discord manque, sinon mène à **« Applications connectées »**
(`/profil#connexions`), où Battle.net se rattache.

Le tableau ne promet que ce que les règles tiennent : visibilité du tag
(`canViewDiscordTag` — case « Tag Discord » cochée avant la certification
comprise), du BattleTag (`canViewBattletag`), pastilles de
certification lues par tout joueur connecté même tag masqué (registre),
contacts présentés aux deux équipes, au caster, aux arbitres et administrateurs
du site dès que les deux adversaires sont connus (T04, bouton « Contacts ») —
le BattleTag d'un contact, vérifié ou non, sort même masqué, **en Overwatch
seulement** (hors Overwatch, le lancement ne l'envoie pas, décision 38 : la
variante « Discord seul » n'en parle plus), la certification ne faisant que
passer devant —,
messages privés du bot (match : tag certifié, coupables ; adhésion,
modération, données : Discord rattaché, ce que fait la certification par code),
rattachement (le compte rattaché pour certifier devient un moyen de connexion ;
Battle.net remplace le BattleTag et le verrouille), portées OAuth
(`OAUTH_PROVIDERS.md` : `identify`, `openid`), retrait (retirer son tag
Discord retire sa certification ; le code en message privé rattache Discord, qui
se détache à part ; détacher Battle.net retire la vérification, le BattleTag
reste), chapeau sans promesse d'être contact (« tu peux être présenté », dès que
les adversaires sont connus, au caster le temps du match), conditions d'inscription
(`REGISTRATION_FILTERS.md`). Une règle qui change ces faits relit le tableau
(`messages/*/tournamentDialogs.json`, clé `certification`).

## « Ne plus voir »

Le « Ne plus voir » donné à la **proposition de certification de la
connexion** (`DISCORD_CERTIFY_PROMPT.md`, `bg_users.discord_certify_prompt_dismissed_at`,
gardé sur le compte) vaut aussi ici, sur tous les appareils, pour l'invitation
faite au **meneur** et **quand Discord est seul à manquer** (un BattleTag à
vérifier n'était pas l'objet de ce refus ; un BattleTag inactionnable, absent de
la variante « Discord seul », ne compte pas) — jamais quand l'équipe n'a aucun
contact, meneur compris : lu seulement dans ce cas (`loadCertificationPrompt`), colonne absente
= sans choix. L'inverse n'est pas vrai : la case de cette modale ne tait que
cette modale.

- **« Plus tard »** (le bouton dit **« Fermer »** une fois la case cochée : le
  refus est alors définitif) ou fermeture (Échap, voile) : `bg_cert_prompt_closed` = « 1 »
  en **stockage de session** — la modale ne se rouvre pas dans cet onglet.
  La case « Ne plus voir », visible, vaut pour **toute** fermeture, Échap et
  voile compris ; son seul état vit dans `useCertificationPrompt` (la modale
  l'affiche), pour valoir aussi quand elle s'efface devant une urgente ;
- case **« Ne plus voir »** cochée puis fermeture (ou clic sur le bouton du
  profil) : gardée **sur le compte** (EF-04, décision 16) —
  `POST /api/profile/certification-prompt` pose
  `bg_users.certification_prompt_dismissed_at` (date du premier choix, rejoué
  sans rien écrire) ; la modale ne s'ouvre plus pour ce compte, sur aucun
  tournoi ni appareil, et jamais pour un autre compte du même navigateur.
  L'envoi part en `keepalive` (survit à la navigation vers le profil) ; un
  échec est muet (la modale se rouvrira, rien n'est perdu). Le corps porte le
  compte à qui la modale a été montrée (`{ userId }`, retenu à l'ouverture) :
  une session changée depuis (autre compte connecté dans un autre onglet)
  répond 409 `CERTIFY_PROMPT_OTHER_ACCOUNT` sans rien écrire — ce refus-là est
  notifié (`showError`, `tournamentErrors.codes`, FR et EN) —, un corps sans
  compte lisible 400 `INVALID_ACTION`. Plafonné par compte
  (`CERTIFICATION_PROMPT_OFF_RULE`, dix par heure, 429). L'invitation gardée
  en mémoire pour ce compte est oubliée (`forgetCertificationPromptsOf`) au
  premier choix seulement : rejoué, il ne parcourt pas la mémoire. Aucun
  geste ne la réaffiche : la certification reste offerte dans « Mon profil ».
  Un clic qui ouvre le profil dans un nouvel onglet (Ctrl, Cmd, Maj, bouton du
  milieu) ne ferme rien et ne retient rien.

L'ancienne clé `bg_cert_prompt_off` (stockage local, sans identifiant) n'est
plus posée ; elle est effacée à l'ouverture d'une fiche tournoi
(`LEGACY_CERTIFICATION_PROMPT_OFF_KEY`). Traitement inscrit au registre (T04,
sous-finalité « Inviter … à certifier » : catégorie et durée — jusqu'à la
suppression du compte, effacé à l'anonymisation `anonymizeAccount`), exporté
(`certificationPromptDismissedAt`, `RGPD_DATA_RIGHTS.md`), déclaré sur `/rgpd`
(FR et EN) et dans `PRIVACY_CHANGES`
(`2026-10-ne-plus-voir-invitation-certification-sur-le-compte`). Stockage de
session bloqué (navigation privée) : « Plus tard » ne se retient pas dans
l'onglet.

## Câblage

- Règle pure, clés et lecture du stockage : `lib/shared/certification-prompt.ts`
  (`certificationPromptFor`, `teamHasContact`, `battletagRelevantFor`,
  `shouldOpenCertificationPrompt`,
  `rememberCertificationPromptClosed`, `CERTIFICATION_PROMPT_OFF_PATH`).
- Lecture : `lib/server/tournaments/certification-prompt.ts`
  (`loadCertificationPrompt`, une requête sur le roster en cours — `loadRosters`
  et `toCandidate` du lancement, `match-launch-info.ts` : les certifications se
  lisent comme au lancement ; en Marvel Rivals un BattleTag vérifié ne compte
  pas comme contact, au lancement non plus — `sideContacts`, décision 38), appelée par
  `getTournamentViewerContext` — **porte commune** du flux SSE et de la lecture
  REST de secours — seulement pour une équipe engagée dans un tournoi non clos :
  une requête indexée, gardée une minute par lecteur
  (`certification-prompt-cache.ts` : `cachedCertificationPrompt`,
  `CERTIFICATION_PROMPT_TTL_MS`, mémoire bornée à `CERTIFICATION_PROMPT_CACHE_MAX`
  entrées en vol et retenues comprises — au-delà, `null` servi sans lecture —,
  lecture en cours partagée, échec retenu dix secondes, lecture abandonnée après
  trois secondes retenue une minute — tardive mais réussie, elle sert —, lecture
  coincée plus de dix minutes oubliée) : le contexte se relit à chaque lecture
  REST (geste, proposition de score, repli du flux). La requête lit les colonnes
  brutes (pseudo, identifiant Battle.net, origine du BattleTag) en mémoire du
  serveur seulement, et n'en tire que des drapeaux (vérifié ou non, contact
  présent) — jamais un pseudo ne sort — calculés par les règles du lancement
  (`hasVerifiedDiscord`, `hasVerifiedBattletag`, `battletagFromBlizzard`), pas
  réécrits en SQL. Une
  certification (code Discord, un clic, rattachement OAuth) oublie sur-le-champ
  les invitations retenues pour ce compte **et pour toute son équipe active**
  (`forgetCertificationPromptsAround` : « équipe sans contact » et invitation
  du meneur changent pour les coéquipiers) ; un « Ne plus voir » oublie celles
  du compte (`forgetCertificationPromptsOf`, clé préfixée `userId:`) ; une
  arrivée dans l'équipe (invitation ou demande acceptée) oublie celles de
  l'équipe. Une lecture déjà en cours au moment de l'oubli n'en sert pas
  l'issue, d'avant le geste : ceux qui l'attendaient reçoivent une relecture
  partie après lui (`successor` du slot `forgotten`) — une issue tardive
  d'une lecture abandonnée, oubliée, reste inconnue au flux (aucune trame).
  Une certification perdue (tag Discord changé, rattachement retiré) n'oublie
  rien chez les coéquipiers. Sinon le changement se voit au plus
  une minute plus tard. Les deux « Ne plus voir » (cette modale, la
  proposition de la connexion) sont lus sur le compte, par un seul SELECT
  (repli colonne par colonne si l'une manque). Une lecture en échec
  tait l'invitation (`null`, journal pm2) sans faire tomber le contexte.
- **Flux SSE** : l'invitation n'y est pas attendue (base lente : elle ne
  retarde pas l'ouverture). Connue en mémoire (`peekCertificationPrompt`), elle
  part avec le contexte ; sinon le contexte part sans elle — la connexion
  porte `certificationPromptPending`, si bien qu'une reconnexion garde
  l'invitation déjà posée au lieu de lire ce `null` comme un retrait — et son
  issue **finale** suit par une trame `certificationPrompt`, `null` compris —
  mais aucune trame si l'issue reste inconnue (mémoire pleine, lecture en
  échec ou jamais revenue : `undefined`), le client gardant l'invitation déjà
  posée
  (`onLateCertificationPrompt`, `finalCertificationPrompt` : la réponse tardive
  d'une lecture abandonnée après trois secondes compte, attendue au plus une
  minute ; `viewerPatchFrameBytes`), posée par `applyLiveMessage` sur le
  contexte du même tournoi. La lecture REST de secours l'attend. La place de flux est prise
  **avant** toute lecture : une boucle au-delà du plafond ne coûte aucune
  requête. Quitter une équipe, en être retiré, la dissoudre, y changer de rôle
  ou en transférer la propriété ferme les flux des comptes touchés sans
  révoquer leur session (`refreshTeamViewers`, `reconnectUserStreams` en
  motif `RECONNECT` : la route ne répond pas 401, même à un flux en cours
  d'ouverture, qui se ferme simplement), **sur les seuls tournois concernés**
  (`teamStreamTournamentIds` : engagée, ou pas encore commencé), en un seul
  passage sur le registre pour tous les membres d'une dissolution ; les
  invitations de l'équipe sont oubliées (`forgetCertificationPromptsOfTeam`).
  Le client se reconnecte et relit son contexte. Mémoire pleine : une lecture abandonnée qui pend encore n'est
  jamais chassée ; oubliée, elle reste une garde et sa réponse tardive est
  écartée.
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
retrait, changement de tournoi, envoi du « Ne plus voir »),
`tests/app/api/profile/certification-prompt-route.test.ts`,
`tests/app/api/tournaments/stream.test.ts` (trame tardive, place prise d'abord),
`tests/tournois/live-state.test.ts`, `tests/lib/server/sse-gzip.test.ts`, `tests/lib/shared/dialog-focus.test.ts`
(`anotherModalOpen`, `watchUrgentModalOpened`, `handOffRestoreTargets`).
