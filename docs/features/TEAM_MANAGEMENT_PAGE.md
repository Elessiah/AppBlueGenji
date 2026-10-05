# Fiche d'équipe en mode gestion

`/equipes/[id]` vue par qui gère l'équipe (`OWNER`, `MANAGER`, staff `tournaments`
sur une fantôme). Cette page a été auditée puis reprise : ce document dit ce qui
était faux, ce qui a changé, et les règles à garder en tête en y touchant.

## Organisation

De haut en bas :

1. **En-tête** (`TeamHeader`) — identité et chiffres clés, rien d'autre. Le
   formulaire des paramètres y vivait : pour un gérant, le haut de la fiche était
   un formulaire et le roster commençait sous la ligne de flottaison.
2. **Adhésion** (`MembershipActions`) — rejoindre / décliner / retirer sa
   demande / quitter, et les demandes reçues (vue gestion).
3. **Membres** (`MembersSection`) — roster, formulaire d'invitation, invitations
   en attente.
4. **Paramètres** (`TeamSettings`) — identité, logo, zone sensible.
5. Statistiques, puis **historique des tournois** (`TeamHistory`).

Styles dans `team.module.css` (et `TeamHeader.module.css`) : plus aucun style en
ligne dans ces composants.

## Modales : portail, focus, Échap

`_components/TeamDialog.tsx` est le cadre unique des modales de la page (rôles,
transfert, attribution d'une fantôme, confirmations).

- **Le voile défile, pas le panneau** : `margin: auto` centre la modale quand
  elle tient et la colle en haut quand elle déborde ; une liste de suggestions
  qu'elle porte n'est jamais rognée à son bord.
- **Échap revient d'abord au contrôle qui a quelque chose d'ouvert** : l'écouteur
  de `useDialogBehavior` est posé en capture sur `window` et passait avant le
  champ ; il ignore désormais Échap quand la cible porte `aria-expanded="true"`
  (liste de suggestions ouverte). Le premier Échap ferme la liste, le second la
  modale.
- **Portail vers `document.body`.** Les modales étaient rendues dans la page, donc
  dans `<section class="fade-in">`. L'animation `fade-in-up … both` laisse un
  `transform` posé une fois terminée, et un élément transformé devient la
  référence de ses descendants en `position: fixed` : `inset: 0` couvrait la
  section entière (2 456 px mesurés sur une équipe d'un joueur) au lieu de
  l'écran. La modale se centrait au milieu de la **page**, souvent sous le bord
  de l'écran, et le voile laissait la navigation claire. Même raison pour
  laquelle les dialogues de la fiche de tournoi passent déjà par `createPortal`.
- **`useDialogBehavior`** porte le focus initial, le piège de tabulation, Échap et
  le retour du focus. L'ancien écouteur `onKeyDown` était posé sur le voile, que
  rien ne focalisait : Échap ne fermait rien. Le hook est ouvert **une fois le
  portail monté** (`open: mounted`), sans quoi le focus initial chercherait sa
  cible dans un conteneur absent.
- Une modale ne se ferme **que sur un succès** : chaque geste rend un booléen.
  `useMemberManagement` avalait l'erreur après l'avoir signalée, si bien que la
  modale des rôles se refermait sur un refus et que le formulaire d'invitation se
  vidait sur un pseudo mal tapé.
- Les gestes destructeurs passent par `ConfirmActionDialog` (`components/ui/`) : exclure un membre (qui
  partait sans question), quitter l'équipe, dissoudre (qui exige désormais de
  **recopier le nom**, comme la suppression d'un tournoi). La dissolution
  efface aussi le **fichier** du logo, après le commit (`softDeleteTeam` →
  `deleteUnreferencedUpload`) : vider `logo_url` le laissait servi publiquement,
  en cache d'un an. Un logo partagé avec une autre équipe, ou masqué par la
  modération, reste en place.

## Rôles

`lib/shared/team-role-display.ts` (pur) : libellés français, ordre d'affichage,
familles (`owner` / `management` / `game`), tri du roster (propriétaire, puis
gestion, puis pseudo).

- Affichés en **pastilles** (`RolePills`) : chaque rôle a sa teinte néon
  (`teamRoleTone` → `data-tone` : tank bleu, DPS rose, soutien vert d'eau,
  capitaine cyan, coach et manager violet, propriétaire rose avec halo), la même
  sur les cartes de `/joueurs` ; la famille se dit **aussi** par un pictogramme
  (★ propriétaire, ⚙ gestion) — la couleur ne porte jamais seule le sens. Toute
  la section équipes (annuaire, fiche, statistiques) est en violet néon, plus
  en orange (`DESIGN_SYSTEM.md` § Palette « néon froid »).
- Choisis par `RolePicker`, en deux groupes : « Rôles de jeu » et « Gestion de
  l'équipe ». `MANAGER` se cochait comme `TANK`, alors qu'il donne la main sur
  l'équipe ; son effet est écrit sous lui. `OWNER` ne se coche jamais.
- La modale des rôles désactive « Enregistrer » tant que rien n'a changé ou que
  la sélection est vide, et prévient avant qu'un manager ne se retire à lui-même
  le rôle qui lui donne la main.

## Invitations

- **Les rôles choisis à l'invitation sont enfin posés.** Le formulaire les
  demandait, la route les jetait (`body as { pseudo }`) et le joueur arrivait
  toujours en DPS. Ils voyagent désormais avec l'invitation
  (`bg_team_invitations.roles_json`) et sont posés à l'arrivée, quel que soit le
  chemin (le joueur accepte, ou l'invitation croise une demande déjà en
  attente). `inviteRolesFromBody` distingue *absent* (défaut DPS, pour les
  appelants qui ignorent le champ) de *malformé* (refus `MISSING_ROLE`).
- **Invitations en attente** listées sous le formulaire, avec « Retirer »
  (`DELETE /api/invitations/[id]`, `cancelInvitation`). Réinviter après une erreur
  de pseudo ne rendait que `ALREADY_INVITED`, sans moyen de voir ni d'annuler.
- Côté joueur : **« Décliner »** une invitation reçue, **« Retirer ma demande »**
  (même route : une invitation est l'acte de l'équipe, une demande celui du
  joueur).
- `PlayerPseudoCombobox` : motif `combobox` de l'ARIA (flèches, Entrée, Échap),
  joueurs sans équipe seulement, comptes supprimés et déjà invités écartés. Les
  joueurs ne sont chargés qu'au montage du champ — la page téléchargeait
  l'annuaire entier pour **tout** visiteur. Sert aussi l'attribution d'une
  fantôme, qui demandait un « pseudo exact » tapé à l'aveugle.
- La liste d'autocomplétion était coupée par `.ds-block { overflow: hidden }` (six
  entrées sur huit invisibles) : le bloc du roster porte `overflowBlock`, qui
  lève la coupe, retire le reflet qui déborderait, et passe le bloc au-dessus de
  ses voisins (au survol il se translate, donc forme un contexte d'empilement).

### Acceptation atomique

`acceptIntoTeam` fait entrer un joueur en **une transaction**, pour les trois
chemins d'acceptation. Ils lisaient `PENDING`, relisaient « a-t-il une équipe ? »,
inséraient puis marquaient l'invitation, en quatre instructions sur le pool :
deux acceptations simultanées passaient toutes deux. Verrou sur la ligne du
**joueur** en première instruction (celui de la suppression de compte et de
l'entrée solo), puis relecture de l'**équipe** sous verrou partagé (une
dissolution concurrente rattacherait sinon le joueur à une équipe morte :
`TEAM_DELETED`), puis réservation de l'invitation par un `UPDATE … WHERE status =
'PENDING'` relu sur `affectedRows`. L'ordre équipe → invitation est celui de
`softDeleteTeam` : l'inverser ouvrirait un interblocage avec elle. Un état changé
pendant l'arrivée (`JOIN_CONFLICTS` : invitation tranchée, équipe dissoute,
compte supprimé — `PLAYER_ACCOUNT_DELETED`) sort en **409** sur toutes les routes
qui y mènent. Demandes et invitations en attente se lisent d'un seul appel
(`listTeamPendingInvitations`, un contrôle de droits, une requête).

## Paramètres

- Le partage est celui du serveur : **nom, sigle, description, transfert,
  dissolution** au propriétaire ; **logo** à toute la gestion. Le formulaire
  complet s'affichait à un manager, dont chaque enregistrement finissait en
  `FORBIDDEN` : il voit désormais le logo et une phrase.
- « Enregistrer » n'est actif que si quelque chose a changé et que la saisie est
  valide ; « Annuler les modifications » apparaît dès qu'il y a une modification.
- **Le renommage est validé** (`lib/shared/team-name.ts`, partagé avec la
  création) : 3 à 60 caractères comptés en points de code, comme MySQL. Un nom
  vide s'enregistrait, un nom trop long ou déjà pris partait en erreur MySQL
  brute. `assertTeamNameAvailable` donne le refus lisible,
  `isTeamNameConflict` traduit la course (`TEAM_NAME_ALREADY_USED`, 409).
- **Transfert** : le texte dit ce que l'ancien propriétaire garde (ses autres
  rôles, DPS à défaut) et s'il garde la main (seulement s'il est aussi manager).
  Un compte **supprimé** n'est plus proposé et le serveur le refuse
  (`MEMBER_ACCOUNT_DELETED`, 409) : l'anonymisation ne détache pas de l'équipe, et
  lui confier la propriété rendait l'équipe définitivement ingouvernable.

## Erreurs

Tout refus passe par `app/(secured)/equipes/_lib/team-errors.ts`
(`teamErrorMessage`, et `membershipErrorMessage` pour les gestes que le joueur fait
pour lui-même — seul `USER_ALREADY_IN_TEAM` y change de sujet). La gestion
affichait encore les codes bruts (`ALREADY_INVITED`, `CANNOT_KICK_OWNER`,
`MISSING_ROLE`, `FORBIDDEN`, `TEAM_NOT_FOUND`…). `_lib/team-api.ts` convertit en
code une réponse non JSON et une coupure réseau (`NETWORK_ERROR`), qui sortaient
en « Unexpected token '<' » ou « Failed to fetch ».

## Rechargement silencieux

`useResourceLoader` expose `revalidate` : relecture en arrière-plan qui garde les
données affichées et ignore un échec passager. Chaque lecture est numérotée, et
seule la dernière lancée s'applique : deux gestes rapprochés ne peuvent plus voir
la réponse ancienne écraser la récente. Un lien d'entrée solo ne fait plus
clignoter « introuvable » pendant sa redirection vers le profil. `refresh` repassait la page
entière en « Chargement… » après chaque geste — saisie, défilement et modale
démontés puis remontés.

## Divers

- `TeamDetailResponse.viewerUserId` : la page relisait `/api/profile` pour savoir
  qui lit, et affichait d'ici là « Exclure » sur la propre ligne du gérant.
- Historique : état en français (`STATE_META`), « 3 V – 1 D », place « 1er / 2e »,
  phrase quand il est vide.
- Mobile : l'en-tête de colonnes disparaît et chaque cellule porte son libellé.
- Visiteur : pas de colonne « Actions » remplie de tirets, pas de phrase de
  description inventée (« Historique compétitif et gestion du roster »).
- `Coche` : la coche est décorative (`aria-hidden`), sans quoi le lecteur d'écran
  annonçait « ✓ DPS ».

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Fiche d'équipe en mode gestion** (`app/(secured)/equipes/[id]/` : `team.module.css`, cadre de modale `_components/TeamDialog.tsx`, registre pur `lib/shared/team-role-display.ts`, bornes du nom `lib/shared/team-name.ts`, erreurs `app/(secured)/equipes/_lib/team-errors.ts`) : les modales de la page sont **portées dans `document.body`** — rendues dans `<section class="fade-in">`, elles héritaient du `transform` que l'animation laisse posé, qui fait de la section la référence des `position: fixed` : la modale se centrait au milieu de la **page**, sous le bord de l'écran. `useDialogBehavior` (ouvert une fois le portail monté) tient focus, Échap et piège de tabulation ; une modale ne se ferme que sur un **succès** (chaque geste rend un booléen). Les rôles s'affichent en pastilles françaises et se choisissent en deux groupes, jeu et gestion. **Les rôles d'invitation sont posés** (`bg_team_invitations.roles_json`) : la route les jetait et le joueur arrivait toujours DPS. L'acceptation est **atomique** (`acceptIntoTeam` : verrou de la ligne du joueur, équipe relue sous verrou partagé puis invitation réservée sur `PENDING` — l'ordre de `softDeleteTeam`, sans quoi elles s'interbloqueraient), les invitations envoyées se listent et se retirent (`DELETE /api/invitations/[id]` — gestion pour une invitation, auteur pour une demande). Le renommage est **validé** comme la création (3 à 60 caractères, unicité traduite), le formulaire d'identité n'est montré qu'au propriétaire (un manager n'a que le logo), et le transfert refuse un compte **supprimé** (`MEMBER_ACCOUNT_DELETED`). `useResourceLoader.revalidate` relit sans repasser la page en « Chargement… ». Voir `docs/features/TEAM_MANAGEMENT_PAGE.md`.
