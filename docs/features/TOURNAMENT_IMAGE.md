# Illustration ou logo d'un tournoi

Un tournoi peut porter **une** image — une illustration ou un logo. Elle est
**facultative** : un tournoi sans image garde exactement l'apparence qu'il avait
avant cette fonctionnalité, sans case vide ni repli inventé.

## Accepter toutes les dimensions, cadrer au rendu

Le problème posé : une bannière 21:9, un visuel carré et un logo en portrait
doivent tous pouvoir servir, et chaque écran n'a pas les mêmes proportions (le
bandeau de la fiche est très large, celui d'une carte l'est moins, un logo tient
dans un carré). Un gabarit fixe à l'envoi aurait rogné l'un ou bordé l'autre.

D'où la règle : **rien n'est recadré à l'envoi**. Le gabarit `tournament-image`
(`lib/server/image-upload.ts`) ne fait que **réduire** une image dont un côté
dépasse 1600 px, proportions gardées, et n'agrandit jamais ; la transparence
d'un logo survit (WebP avec couche alpha). Les refus sont ceux de tout
téléversement du site : PNG, JPEG ou WebP, 5 Mo, 8000 px par côté, pas
d'animation.

Le cadrage se décide **au rendu**, selon deux modes (`bg_tournaments.image_fit`) :

| Mode | Libellé | Rendu | Cadrage |
|---|---|---|---|
| `COVER` | Illustration | Bandeau qui remplit son cadre | `object-position` sur le **point focal** |
| `CONTAIN` | Logo | Pastille à côté du nom, image entière | aucun — un logo rogné n'est plus un logo |

Le **point focal** (`image_focus_x`, `image_focus_y`, en pourcentages, 50/50 par
défaut) est le point de l'image qui doit rester visible quel que soit le cadre :
c'est ce qui permet de « centrer » une image sans la recadrer, et c'est ce qui
permet à la **même** image de servir le bandeau large de la fiche et celui,
plus étroit, d'une carte. Il est conservé en mode logo (il n'y sert à rien) pour
que repasser en illustration retrouve le cadrage choisi.

La règle est écrite une fois dans `lib/shared/tournament-image.ts` (module pur) :
lecture tolérante d'une ligne (`parseTournamentImage`), lecture stricte d'une
saisie (`checkTournamentImageSettings`), cadrage (`imageObjectPosition`,
`focusFromPoint`, `focusFromKey`), placement (`tournamentImageSlot` : un
bandeau pour une illustration, une pastille pour un logo), et la seule requête
qu'appelle un brouillon (`planTournamentImageChange`).

## Où l'image apparaît

Sobrement, pour que la carte reste d'abord une fiche à lire :

- **Cartes de `/tournois`** : une illustration devient un bandeau bas (112 px)
  en tête de carte, fondu dans le fond ; un logo, une pastille de 40 px à droite
  de la ligne « jeu ◆ format ». Les cartes d'une rangée gardent la même hauteur.
  Les **deux premiers bandeaux** dans l'ordre d'affichage sont chargés en
  priorité (`priorityBannerIds`) : en haut de liste, un bandeau est l'élément le
  plus grand de l'écran, donc le LCP ; les autres restent paresseux.
- **Fiche du tournoi** : l'illustration occupe un bandeau d'affiche entre la
  barre d'outils et le nom ; le logo, une pastille de 88 px (64 px sur mobile) à
  gauche du nom.
- **Accueil** (tableau des tournois) : même logique sur la carte mise en avant
  et sur les cartes suivantes.

Toujours `alt=""` : l'image est posée à côté du nom du tournoi, qu'une
alternative ne ferait que répéter. Toujours passée par `next/image`
(redimensionnement, WebP, cache) — jamais `unoptimized`.

## Sécurité : une image du site vient du site

Comme les logos d'équipe et les avatars (`localUploadUrl`, `lib/shared/uploads.ts`),
la garantie est posée **à la sortie** : `mapCard` lit la colonne par
`parseTournamentImage`, qui rend `null` pour toute URL qui n'est pas un fichier
téléversé chez nous. Une URL étrangère glissée par un chemin oublié ne s'affiche
donc jamais — la carte se montre simplement sans image.

## Écriture

`/api/admin/tournaments/[id]/image`, permission **`tournaments`** (arbitre,
admin) — comme la chaîne officielle, l'image habille l'annonce et engage
l'organisation ; le cast et le community manager n'y ont pas droit.

| Méthode | Corps | Effet |
|---|---|---|
| `POST` | multipart : `file`, et facultativement `fit`, `focusX`, `focusY` | pose ou remplace l'image |
| `PATCH` | JSON `{ fit, focusX, focusY }` — **les trois exigés** | change le cadrage seul |
| `DELETE` | — | retire l'image (idempotent) |

Refus : `INVALID_TOURNAMENT_ID`, `FILE_MISSING`, `INVALID_IMAGE_FIT`,
`INVALID_IMAGE_FOCUS` et les refus d'image (`IMAGE_TOO_LARGE`…) en **400** ;
`TOURNAMENT_NOT_FOUND` en **404** ; `TOURNAMENT_IMAGE_MISSING` en **409** (un
recadrage envoyé sur une image retirée entre-temps). Une erreur inattendue
répond un code générique en 500 et se journalise — son message peut nommer un
chemin du serveur.

Au `PATCH`, un champ absent n'est pas un défaut : il recentrerait l'image en
silence. Les trois sont donc exigés **et typés** (une chaîne, deux nombres) —
`null`, `""` ou `"10"` sont refusés, la lecture partagée les tenant pour le
défaut. Au `POST`, si — un fichier seul doit suffire, et les champs d'un
formulaire multipart arrivent en chaînes.

Les limites du fichier (5 Mo, PNG/JPEG/WebP) sont écrites une fois dans
`lib/shared/uploads.ts` et lues par le serveur comme par le sélecteur, qui
refuse un fichier avant de l'envoyer.

**Aucune garde d'état** : l'image est décorative, elle n'entre dans aucune
règle du moteur. Habiller une archive ou poser le logo d'un tournoi en cours
est légitime.

Trois règles dans `lib/server/tournaments/image.ts` :

1. la conversion (sharp) a lieu **avant** la transaction — c'est le seul temps
   long, il ne tient jamais le verrou de `bg_tournaments` ;
2. l'ancienne image est relue **sous verrou** (`SELECT … FOR UPDATE`, première
   instruction) : deux envois simultanés s'ordonnent, et chacun efface le
   fichier que l'autre avait posé ;
3. un fichier n'est effacé **qu'après le commit** (un `unlink` ne se défait
   pas) ; si l'écriture échoue, c'est le fichier **neuf** qui est repris. Un
   ménage raté se journalise sans faire échouer une écriture déjà acquise.

Toute écriture passe par `publishUpdatedEvent` : caches vidés, instantané
rediffusé par le flux SSE — la fiche ouverte se met à jour seule.

La **suppression d'un tournoi** efface aussi son fichier, après le commit ; elle
relève l'image **sous le même verrou** (`FOR UPDATE`), sans quoi un envoi
concurrent pouvait poser un fichier entre sa lecture et le `DELETE` — fichier
que plus aucune ligne ne désignerait.

## Interface

Deux portes, un seul sélecteur (`app/(secured)/tournois/_components/TournamentImagePicker.tsx`) :

- **À la création** (section « Image » du formulaire) : l'image part une fois
  le tournoi créé, puisqu'elle se range sous son identifiant. Son échec ne
  défait pas la création — le tournoi existe, un message le dit, et l'image
  s'ajoute ensuite depuis la fiche.
- **Depuis la fiche** (bouton « Ajouter une image » / « Image », staff
  `tournaments`), **dans tous les états** : le formulaire d'édition se ferme au
  coup d'envoi, pas l'image.

Le sélecteur est contrôlé et ne fait qu'un brouillon (`_lib/image-picker.ts`) ;
rien ne part avant « Enregistrer ». Trois gestes : **choisir** un fichier (un
mode est proposé d'après ses proportions — nettement plus large que haut :
illustration ; sinon : logo), **dire ce que c'est**, et pour une illustration
**désigner le point focal** — clic ou glisser sur l'image entière, ou au
clavier (flèches, Maj ×5, Origine pour recentrer). Deux aperçus montrent le
résultat aux proportions réelles du site (bandeau de la fiche, carte de la
liste), si bien qu'on voit ce que le cadre coupe.

Trois précautions dans le sélecteur et la modale :

- deux fichiers choisis coup sur coup se résolvent dans le désordre (la lecture
  des dimensions est asynchrone) : seul le **dernier choix** écrit le brouillon ;
- tant que l'aperçu local d'un nouveau fichier n'existe pas, rien n'est affiché
  — jamais l'image enregistrée (retirée, peut-être) sous les réglages du
  nouveau fichier ;
- l'image enregistrée peut changer **sous la modale** (flux SSE, geste d'un
  autre membre du staff) : un brouillon intact la suit (`resyncImageDraft`),
  sans quoi ses réglages périmés formeraient un recadrage appliqué sans que
  personne ait rien touché ; un brouillon entamé est gardé, avec un bandeau qui
  dit le désaccord.

## Jeu de test

`npm run seed` pose une image sur cinq tournois (`image` dans
`lib/server/seed-cases.ts`), les deux modes et les quatre états, dont un point
focal décentré. Le seed **écrit un fichier par tournoi** (`seed-<id>.webp`) : un
fichier partagé disparaîtrait de tous les tournois dès qu'on remplace l'image de
l'un d'eux. Les fichiers `seed-*` d'une exécution précédente sont effacés au
passage.
