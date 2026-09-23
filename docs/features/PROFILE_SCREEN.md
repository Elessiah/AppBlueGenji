# L'écran « Mon profil »

> `app/(secured)/profil/` — registre pur `_lib/profile-sections.ts`, section
> `_components/ProfileSection.tsx`, styles `profil.module.css`, phrases
> partagées `lib/shared/identity-sharing.ts`.

## Le manque

La page empilait **onze blocs dans un seul formulaire**, sans un titre pour dire
où l'on passait d'un sujet à l'autre : pseudo, avatar, BattleTag, tag Marvel, tag
Discord, majorité, visibilité, recrutement, applications connectées, invitations,
statistiques — puis l'export des données et la suppression du compte, au fil du
texte.

Trois défauts, et ils se renforçaient :

1. **Tout avait le même poids.** Un champ d'identité et le bouton qui efface le
   compte se ressemblaient à quelques pixels près. Le second était en bas, après
   tout le reste, sans rien qui le sépare des réglages.
2. **Le texte était trop pâle pour être lu.** Chaque aide de champ s'écrivait en
   `--text-2` à 11 px — sous la taille où ce gris reste confortable —, si bien
   que la page entière portait un voile gris que personne ne lisait. Tout était
   en style **en ligne**, 554 lignes dont une bonne part de mise en forme.
3. **Il fallait tout traverser.** Aucun moyen d'atteindre « Applications
   connectées » ou l'export sans faire défiler les huit blocs qui précèdent.

Et une **information manquait**, précisément celle qui engage le site :
l'exposition d'un tag Discord certifié est énoncée sur `/connexion`, juste avant
la case où l'on tape son pseudo, mais `/profil` — l'écran où l'on revient des
mois plus tard pour corriger ce champ — n'en disait presque rien ; et le fait que
Blizzard **réécrive** le BattleTag à chaque connexion n'était écrit nulle part
qu'un joueur puisse lire.

## Le découpage

Huit sections, nommées **une fois** dans `PROFILE_SECTIONS` : identité, comptes
de jeu, Discord, confidentialité, applications connectées, invitations
(conditionnelle), statistiques, mon compte.

Le registre sert **deux lecteurs** — la navigation d'ancres en tête de page et
les titres des sections. Deux listes auraient dérivé, et la dérive se serait vue
sous la forme d'un lien qui ne mène nulle part : `scrollIntoView` sur une ancre
absente ne fait *rien du tout*, sans erreur et sans déplacement. D'où aussi
`visibleProfileSections`, qui filtre les sections conditionnelles : déclarer
l'invitation dans le JSX laisserait oublier de la retirer de la navigation.

Une section conditionnelle se déclare par son **`requires`**, qui nomme le
compteur de `ProfileSectionAvailability` dont elle dépend, et non par un drapeau
que le filtre doublerait d'un `id !== "invitations"` écrit en dur : la deuxième
section conditionnelle le porterait alors sans aucun effet. La **recherche par
ancre** reste en revanche totale (`PROFILE_SECTION_BY_ID`) : indexer la liste
filtrée rendrait `undefined` sur la section masquée, ce que le typage ne verrait
pas et que `ProfileSection` ferait planter sur `section.id`. C'est la navigation
qu'on veut voir maigrir, pas la recherche.

Le rendu d'une section reste **enveloppé par `ProfileSection` et par lui seul** :
un composant qui se dessinait déjà tout seul (« Applications connectées » portait
son propre `ds-block` et son propre `<h2>`, du temps où il vivait sans section
autour) donne sinon une carte dans une carte et le même titre écrit deux fois.

`ProfileSection` porte l'ancre, le titre et la promesse d'une section, et son
`aria-labelledby` désigne le titre visible plutôt que de le recopier dans un
`aria-label` — deux chaînes finiraient par diverger.

La navigation est faite de **liens d'ancre**, pas d'onglets : rien à mémoriser,
rien à hydrater, et une URL comme `/profil#connexions` fonctionne depuis
n'importe où. `scroll-margin-top` sur la section plutôt qu'un décalage au clic,
pour que l'arrivée par une URL collée tombe au bon endroit elle aussi.

Le saut est **rejoué une fois la section montée**. Le navigateur n'honore le
fragment qu'au chargement du document, c'est-à-dire au moment précis où la page
n'affiche encore que « Chargement du profil… » : il ne trouve aucune ancre et
n'y revient jamais, si bien qu'une URL collée déposait son lecteur en haut de la
page — les liens de la navigation, eux, marchaient, parce qu'on clique forcément
après la réponse. `profileSectionIdFromHash` reconnaît le fragment dans le
registre (un fragment vient du navigateur, il ne désigne un élément qu'une fois
reconnu). L'ancre demandée est lue **une seule fois, au montage**, et le saut ne
se joue qu'une fois : `window.location.hash` garde le dernier lien cliqué et
`data` est remplacé à chaque sauvegarde, si bien que relire le fragment
remonterait le lecteur à la section visitée dix minutes plus tôt au moment où il
enregistre son profil depuis une autre.

`scroll-margin-top` vaut la hauteur d'`ArenaNav` (52 px de pastille + 2 × 14 px
de rembourrage) **plus** une respiration : la barre est `position: sticky`, si
bien qu'une marge plus courte rangeait le titre visé derrière elle — le seul
élément de la page qu'on ne voyait pas était celui qu'on venait chercher.

## La sauvegarde

Le formulaire couvre quatre sections — identité, comptes de jeu, Discord,
confidentialité — pour **un seul** bouton. Posé au fond de la dernière, il était
hors de vue de qui arrive par une ancre, et la navigation de cette page invite
précisément à sauter au milieu : on modifie son BattleTag dans « Comptes de jeu »
sans rien voir qui l'enregistre. Le pied appartient donc au `<form>` et non à sa
dernière section, et se colle au bas de la fenêtre.

Un bouton par section aurait été l'autre réponse, mais il en faudrait alors
plusieurs pour un seul `PATCH` — quatre contrôles qui font la même chose, et un
doute sur ce qui est enregistré quand on en clique un.

La barre porte **sa propre surface** (arrondie, bordée, floutée) et non la
couleur de la page : les cartes défilent dessous, `.ds-block` est translucide et
bien plus clair que `--bg-0`, et un dégradé vers le fond de la page les barrait
d'un trait — la carte semblait coupée net au-dessus du bouton.

Une sauvegarde **réaligne le champ Discord** sur ce qu'elle vient d'enregistrer :
il est en lecture seule dès que le compte est rattaché et c'est le seul endroit
où le tag s'affiche, si bien qu'un tag réécrit ailleurs entre le chargement et la
sauvegarde laissait la pastille et la phrase du verrou annoncer le tag frais à
côté d'un champ resté sur celui du montage.

Le `.btn` global n'a **aucun** état désactivé : « Changer l'avatar » pendant un
envoi, « Retirer mon tag » pendant un retrait et « Supprimer mon compte » pendant
l'effacement gardaient le survol, le soulèvement, le reflet et `cursor: pointer`
tout en refusant le clic. La feuille de la page le pose, en `:global(.btn)` —
CSS Modules hacherait un `.btn` local et la règle ne s'appliquerait à rien.

## Les messages d'erreur

Chaque geste de la page lève un **code** et le traduit dans son `catch`, jamais
au `throw` : c'est là qu'arrivent aussi les échecs qui n'en portent pas — le
`TypeError` d'une coupure réseau, le `SyntaxError` d'une réponse HTML —, dont le
message anglais partait sinon tel quel dans la notification. Quatre chemins
toastaient d'ailleurs le code brut du serveur (`INVITATION_RESPOND_FAILED`,
`AVATAR_UPLOAD_FAILED`, `IMAGE_TOO_LARGE`…), et la sauvegarde avalait la seule
phrase juste d'un compte supprimé entre-temps : elle repassait la traduction
d'`ACCOUNT_DELETED` dans le registre, qui ne la reconnaissait pas et répondait
« La sauvegarde a échoué ».

Une fonction par geste dans `profile-errors.ts`, parce que c'est le **repli**
qui change d'un geste à l'autre — « La sauvegarde a échoué » est faux pour un
avatar comme pour une invitation — alors que les codes nommés (session expirée,
compte supprimé) se disent partout pareil :

| Geste | Traduction | Consulte d'abord |
| --- | --- | --- |
| Sauvegarde, retrait du tag | `profileErrorMessage` | — |
| Lecture de la page | `profileLoadErrorMessage` | — |
| Envoi d'un avatar | `avatarUploadErrorMessage` | `imageUploadErrorMessage` |
| Retrait de l'avatar | `avatarDeleteErrorMessage` | — |
| Réponse à une invitation | `invitationResponseErrorMessage` | `membershipErrorMessage` (registre des équipes) |
| Suppression du compte | `accountDeletionErrorMessage` | — |

Les refus d'image vivent dans `lib/shared/image-upload-errors.ts`, partagé avec
le logo d'équipe : ils naissent tous de `processAndStoreImage`, et ce que le
joueur doit changer à son fichier ne dépend pas de l'écran. `precheckImageUpload`
dit **laquelle** des deux conditions manque avant l'envoi (« trop lourde ou
format non supporté » laissait deviner). Les invitations, elles, appartiennent
au domaine des équipes, qui a déjà son registre : on l'emprunte plutôt que de le
recopier.

Côté serveur, les deux routes d'écriture ne laissent plus sortir qu'une **liste
fermée** de codes : `PATCH /api/profile` rendait le message de n'importe quelle
exception (`raw.replace is not a function` sur un `{"pseudo": 123}`, le message
MySQL d'un pseudo trop long), `POST /api/profile/avatar` celui d'un décodage raté.
Le reste part au journal et le client reçoit le code générique. Le pseudo, enfin,
est validé avant d'être lu : `INVALID_PSEUDO` (pas une chaîne), `PSEUDO_EMPTY`
(que des espaces — la normalisation l'écrivait vide) et `PSEUDO_TOO_LONG` (au-delà
des 40 caractères de la colonne, comptés comme MySQL les compte, `lib/shared/pseudo.ts`).

## La zone de danger

« Mon compte » est la dernière section et **ne ressemble à aucune autre** :
bordure et titre en rouge, boutons groupés. Exporter ses données, se déconnecter
et effacer son compte ne sont pas des réglages, et les présenter comme tels
revenait à cacher le plus lourd des trois au milieu des autres.

## Le contraste

Les aides de champ passent de `--text-2` / 11 px à **`--text-1` / 12 px**, avec
une interligne de 1,65 et une largeur bornée à 68 caractères. `--text-2` est
réservé à ce qui est vraiment secondaire (le format accepté d'une image, par
exemple). Les styles quittent le JSX pour `profil.module.css`, qui porte la
hiérarchie : titre de section > libellé de champ > aide.

## Ce que le site dit de vos identifiants

`lib/shared/identity-sharing.ts` porte les phrases qui **engagent le site**, et
les deux écrans qui les affichent y puisent :

| Constante | Ce qu'elle promet |
| --- | --- |
| `DISCORD_TAG_AUDIENCE` | Qui lit un tag certifié : les administrateurs toujours, l'arbitrage pendant un tournoi, **jamais personne d'autre**. |
| `DISCORD_TAG_UNVERIFIED_AUDIENCE` | Ce qu'un tag non certifié vaut : rien, pour personne — et l'organisation ne peut pas joindre le joueur. |
| `DISCORD_CERTIFICATION_UNDO` | Le seul geste qui défait la certification (il n'existe aucune route de décertification) — **le retrait du tag**, et non sa modification : un tag certifié appartient à un compte rattaché, dont le champ est en lecture seule. |
| `BLIZZARD_BATTLETAG_NOTICE` | Blizzard renseigne le BattleTag et **remplace** la saisie à chaque connexion. |
| `GAME_TAG_NOTICE` | Les identifiants de jeu servent à s'ajouter entre joueurs, jamais à des statistiques. |

Le module n'expose que des **chaînes**, jamais d'assembleur : l'**entrée en
matière** diffère selon l'écran (« Te connecter par Discord *certifie ce tag* »
à la connexion, la phrase du verrou sur le profil) et aucun des deux ne peut
passer par une fonction commune — la connexion met du `<strong>` dans la sienne,
que rien qui rende une chaîne ne porte. Chaque écran compose donc son entrée en
matière puis **concatène les constantes**, qui restent la seule rédaction de la
promesse.

Sur `/profil`, le cas « certifié » est énoncé par la **phrase du verrou**
(`discordTagLockNotice`, `lib/shared/discord-tag-lock.ts`), qui dit en plus le
rattachement : un tag certifié appartient toujours à un compte rattaché
(`writeVerifiedTag` écrit `discord_id`, et détacher Discord décertifie), donc le
champ est toujours verrouillé — une branche « certifié, non verrouillé »
n'aurait jamais été rendue. Cette phrase **compose** `DISCORD_TAG_AUDIENCE` (et
`DISCORD_TAG_UNVERIFIED_AUDIENCE` pour le cas non certifié) au lieu de recopier
l'exposition : c'était la seule que `/profil` affichait au tag certifié, et un
ajustement de la constante l'aurait laissée promettre un autre public.

Le test de `/connexion` porte désormais sur ces constantes **et** sur le fait que
la page les emploie : c'est strictement plus fort que l'ancienne lecture
littérale de la source, où deux écrans pouvaient promettre deux choses
différentes sans que rien ne le signale.

## Voir aussi

- `docs/features/DISCORD_VERIFICATION.md` — ce que la certification expose, et à
  qui.
- `docs/features/OAUTH_PROVIDERS.md` — les trois portes d'entrée, et pourquoi le
  rattachement se fait depuis cet écran.
