# Recadrage manuel des images importées

Tous les imports d'image du site passent par la même modale de recadrage :
avatar (`/profil`), logo d'équipe (création et fiche), photo de bénévole, logo
et bandeau de partenaire, image de tournoi (création et fiche).

## Pourquoi

Le serveur passait chaque fichier dans un gabarit fixe (`lib/server/image-upload.ts`).
Pour les gabarits qui **recadrent** (`cover`), la zone gardée était toujours le
**centre** : un visage en haut d'une photo en portrait perdait le front, un
bandeau 3:1 tiré d'une photo carrée gardait la bande du milieu, quelle qu'elle
soit. Le joueur choisit désormais ce qu'il garde.

## Principe : des coordonnées, pas des pixels réencodés

Le navigateur n'envoie **pas** une image découpée par un `<canvas>` : il envoie
le fichier d'origine **et** un rectangle (champ multipart `crop`, JSON
`{ x, y, width, height }` en fractions de 0 à 1). C'est `sharp` qui découpe.

- le serveur garde son unique chaîne de contrôle (format lu dans les octets,
  dimensions, animation) ;
- l'image n'est pas compressée deux fois ;
- un `<canvas>` réencode en PNG sur Safari (pas d'encodeur WebP), ce qui ferait
  dépasser la limite de 5 Mo à un fichier qui la respectait.

Les fractions portent sur l'image **orientée** : le navigateur affiche une
photo de téléphone redressée selon son EXIF, et `sharp` est ouvert avec
`autoOrient: true`. Effet de bord voulu : une photo de téléphone ne ressort plus
couchée, qu'elle soit recadrée ou non (la sortie WebP ne garde pas l'EXIF).

Côté serveur, le découpage (`extract`) passe **avant** le gabarit (`resize`) :
le gabarit s'applique à la zone choisie.

## Proportions du cadre

| Gabarit | Cadre | Repère rond |
|---|---|---|
| `avatar` | carré | oui |
| `benevole-photo` | carré | oui |
| `sponsor-banner` | 3:1 | non |
| `team-logo` | libre | non |
| `sponsor-logo` | libre | non |
| `tournament-image` | libre | non |

Imposées là où le gabarit recadre — un cadre libre y serait rogné une seconde
fois, au centre, et le joueur ne verrait pas ce qu'il obtient. Libres là où le
gabarit contient ou réduit.

## Le cadre proposé est celui d'avant

À l'ouverture, le cadre est **ce que le serveur appliquait seul**
(`defaultCropBox`) : image entière pour un cadre libre, plus grand rectangle
centré aux bonnes proportions sinon. Valider sans toucher produit le fichier
d'avant l'outil. Un cadre couvrant l'image entière n'est pas envoyé
(`cropToSend` → `null`) : le serveur suit alors son chemin d'origine.

## Modules

- `lib/shared/image-crop.ts` (pur) : registre des gabarits et de leurs
  proportions, géométrie (déplacement, redimensionnement par un coin, mise à
  l'échelle, clavier), lecture du champ (`parseImageCropField` — refus
  `IMAGE_CROP_INVALID` en 400, jamais de repli silencieux sur l'image entière)
  et conversion en pixels entiers (`cropRectToRegion`, arrondi vers
  l'extérieur).
- `components/ui/image-crop-dialog.tsx` : la modale (`ImageCropDialog`), le hook
  `useImageCropper()` qui en fait une étape `await`-able d'un envoi,
  `appendCroppedImage` (fichier + champ `crop`) et `useCroppedPreviewUrl`
  (aperçu local de la zone gardée, pour les écrans qui montrent l'image avant
  l'envoi — il n'est jamais envoyé).
- Routes : les six points d'envoi lisent le champ avant tout traitement et le
  passent à `processAndStoreImage`.

## Gestes

- **Souris / doigt** : glisser le cadre pour le déplacer, tirer un coin pour le
  redimensionner (le coin opposé reste en place). Pointer Events et
  `touch-action: none`.
- **Clavier** : le cadre prend le focus une fois l'image chargée ; flèches pour
  le déplacer (1 % de l'image, 10 % avec Maj), `+` / `-` pour l'agrandir ou le
  réduire, Origine pour revenir au cadre proposé.
- **Boutons** : réduire, agrandir, réinitialiser.
- Un aperçu montre la forme exacte du résultat (rond pour un avatar).
- Une image déjà choisie mais pas encore envoyée (logo d'équipe, image de
  tournoi) se **recadre** de nouveau sans la resélectionner ; la garantie des
  droits d'un logo n'est pas redemandée — elle porte sur le fichier.

La modale suit les règles de `MODAL_DIALOGS.md` (portail, `useDialogBehavior`,
`useBackdropDismiss`) et s'ouvre au-dessus des modales de la vitrine
(`z-index` 1150, au-dessus de `LandingDialog`).

## Hors champ

Une image **déjà enregistrée** ne se recadre pas : le serveur ne garde que la
version traitée. Il faut la réimporter.
