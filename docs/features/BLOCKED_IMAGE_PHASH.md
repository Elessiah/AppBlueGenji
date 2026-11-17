# Empreinte perceptuelle des avatars bloqués (D17)

Un avatar que la modération **supprime** est bloqué au téléversement
(`ACCOUNT_DELETION.md` § E6, `lib/server/blocked-images.ts`). Jusqu'à EF-72,
seul son SHA-256 l'était : un cadre décalé de quelques pixels, un autre format
source, un réencodage ou une mise à jour de sharp produisaient d'autres octets
et passaient. Chaque image bloquée garde désormais, **à côté** du SHA-256, une
empreinte perceptuelle (`phash`).

## Calcul (`lib/server/image-phash.ts`)

pHash DCT, 64 bits, calculé avec sharp (déjà dans le dépôt, aucune
dépendance) : image aplatie sur un gris moyen, ramenée à 32 × 32 en niveaux de
gris, **contraste étiré** (2e et 98e centiles ramenés à 0 et 255 : une copie
assombrie, éclaircie ou délavée garde l'allure de l'originale) ; DCT, bloc
9 × 9 des basses fréquences dont on garde les **64 coefficients de plus basse
fréquence hors composante continue** (la luminosité moyenne dépasserait
toujours la médiane : gardée, elle poserait le même bit sur toutes les
empreintes) ; chaque bit dit si son coefficient dépasse leur médiane. Écrite
en décimal (forme d'un `BIGINT UNSIGNED`), sans littéral `BigInt` (cible
ES2017).

- **Image trop simple** : pas d'empreinte (`null`) — à 32 × 32, deux images
  différentes de ce genre tombent à quelques bits l'une de l'autre, et un
  avatar bloqué en refuserait d'innocents. Une telle image n'est bloquée que
  par ses octets. Quatre critères, tous relatifs à l'image (aucun ne dépend de
  son contraste) :
  - **presque unie** : moins de `MIN_TONAL_RANGE` (16) niveaux de gris entre
    ses 2e et 98e centiles (cycle 3 : à 8, un léger vignetage ou un bruit de
    compression d'un avatar presque noir, étirés jusqu'à 255, faisaient
    l'empreinte) ;
  - **surtout faite d'un fond uni** : au moins `MAX_BACKGROUND_SHARE` (50 %)
    des pixels dans un même ton (± 6 niveaux après étirement) — pseudo ou
    initiale sur un aplat (deux pseudos courts au même endroit tombaient à
    0 bit), emblème au milieu d'un logo sur fond transparent, silhouette sur
    fond uni ;
  - **symétrique** — reflet gauche-droite, haut-bas ou sur l'une des deux
    diagonales, ou demi-tour (cycle 3 : moulinet, yin-yang, logo en S) : écart
    à son image par cette symétrie sous `MIN_MIRROR_ASYMMETRY` (0,1) de l'écart
    à la moyenne — identicon, motif centré (la symétrie annule ou apparie la
    moitié des coefficients, dont les bits ne disent plus que le bruit
    d'arrondi, le même d'une image à l'autre) ;
  - **dégradé** : au moins `MAX_LOW_FREQUENCY_SHARE` (90 %) de la variance
    dans les cinq plus basses fréquences.
  Revue EF-72 : le cycle 1 avait d'abord compté les coefficients écartés de la
  médiane d'au moins 0,5 niveau (seuil absolu) ; le cycle 2 a mesuré que
  des pseudos différents gardaient une empreinte et se confondaient, tandis
  que la plupart des photos réelles et toute copie assombrie la perdaient —
  d'où ces critères. Jeu de mesure (279 images : 30 scènes, 20 images
  « photo » à spectre en 1/f, 120 avatars texte, 21 dégradés, 16 pixel art,
  16 identicons, 16 emblèmes, 10 silhouettes, 30 images réelles du dépôt) :
  scènes, « photos » et pixel art ont une empreinte (une scène sur trente
  exceptée), comme 13 des 30 images réelles — toutes les photos et
  illustrations ; les icônes, logos et captures à fond uni n'en ont pas — ;
  aucun avatar texte, dégradé, identicon, emblème ni silhouette sur fond uni
  n'en a.
- **Limite connue** (revue EF-72 cycle 3, choix assumé du cycle 2) : un avatar
  bloqué fait surtout d'un fond uni (symbole ou mot sur un aplat) n'est bloqué
  que par ses octets — réencodé ou recadré d'un pixel, il passe ; de même une
  image détaillée bloquée, collée sur un grand aplat (plus de la moitié des
  pixels) ou rendue symétrique. Ces images ne se distinguent pas d'avatars
  innocents de même genre à 32 × 32 ; la retouche est délibérée, comme un cadre
  très décalé, et la modération la rattrape sur signalement.
- **Profondeur** : une image 16 bits (PNG) est lue en 8 bits (`raw({ depth:
  "uchar" })`) — même empreinte, à quelques bits près, que sa copie 8 bits.
- **Seuil** `PHASH_MATCH_DISTANCE = 10` bits sur 64. Mesuré sur ce jeu (images
  passées par le gabarit avatar) : autre format source, réencodage,
  redimensionnement ≤ 6 ; copie assombrie ou délavée ≤ 8 (une copie très
  éclaircie, deux fois sur quatre-vingts, au-delà) ; cadre décalé de 2,5 % de
  la source ≤ 12 (presque toujours sous 10) ; décalé de 5 % : jusqu'à 18 (un
  peu plus d'une fois sur deux sous 10) ; images différentes qui ont une
  empreinte ≥ 14 (une paire sur cent sous 22). Une image à la limite d'un
  critère peut perdre son empreinte une fois retouchée : elle passe alors. Un
  faux refus coûte plus à un joueur de bonne foi qu'un contournement par un
  cadre très décalé, que la modération rattrape sur signalement.

## Stockage

- `bg_blocked_image_hashes.phash BIGINT UNSIGNED NULL` — à côté du SHA-256
  (clé de la ligne). Toute pose (`blockRemovedImageFiles`,
  `blockImageHashesSafely`, `blockImageHashOn`) écrit les deux ; une ligne déjà
  posée sans `phash` le reçoit (`phash = COALESCE(phash, VALUES(phash))`), une
  ligne qui en a un le garde.
- `bg_logo_quarantines.image_phash BIGINT UNSIGNED NULL` — relevé avec
  `image_sha256` sur la décision de suppression (`deleteUserAvatarForReport`,
  `purgeQuarantinedLogo`) : un blocage posé **après coup** (issue maintenue,
  `pinAccountBlockedHashesOn`, `pinClosedQuarantineHashesOn`) le reprend, le
  fichier étant parti. Relu en texte (`CAST(… AS CHAR)`) : un `BIGINT` rendu en
  nombre JavaScript perdrait ses derniers chiffres.
- **Aucun remplissage** : les lignes bloquées avant EF-72 n'ont que leur
  SHA-256 — le fichier est parti, rien ne se recalcule.
- La levée d'un blocage (contestation acceptée, `unblockImageHashOn`) retire la
  ligne entière, `phash` compris. Une **autre** image bloquée d'allure voisine
  continue de refuser l'image rétablie : elle a elle-même été supprimée par la
  modération.

## Contrôle au téléversement (`isBlockedImage`)

`isBlockedImage(processed, original?)` : SHA-256 de l'image traitée et du
fichier brut, et empreinte perceptuelle de l'image **traitée** (celle qui serait
servie, comparable à celle des avatars bloqués). Deux requêtes au plus :

```sql
-- 1. exact, par la clé primaire (jamais de balayage)
SELECT 1 FROM bg_blocked_image_hashes WHERE sha256 IN (?, ?) LIMIT 1
-- 2. seulement à défaut : les empreintes perceptuelles posées, bornées
SELECT CAST(phash AS CHAR) AS phash FROM bg_blocked_image_hashes
 WHERE phash IS NOT NULL ORDER BY created_at DESC, sha256 LIMIT 2000
```

Une ligne à la première requête refuse, sans balayage ni décodage. Sinon, et
seulement si une empreinte perceptuelle est posée, l'image traitée est décodée
une fois de plus pour la sienne, comparée en mémoire (`phashComparator` : la
référence lue une fois, comptage de bits sans chaîne) : chaque téléversement ne
paie pas ce décodage tant que la liste n'a que des lignes d'avant D17. Aucun
index ne sert une distance de Hamming : la lecture est un balayage, bornée par
`MAX_COMPARED_PHASHES` (2 000 lignes, les plus récentes d'abord, `sha256`
départageant un même jour ; la liste ne grandit qu'avec les suppressions de la
modération, quelques dizaines de lignes). Le décodage est celui du WebP déjà encodé (256 à 512 px) : décoder
les pixels d'avant l'encodage donnerait une empreinte un peu autre que celle
des fichiers servis, qui est ce qu'on compare. `imagePerceptualHashResult`
réduit à 32 × 32 **avant** d'aplatir la transparence et refuse (`limitInputPixels`,
2 048 × 2 048) une grande image. Une ligne sans
`phash` ne compte que par son SHA-256. Le refus reste le code `IMAGE_BLOCKED`,
comme avant ; il vaut pour un avatar comme pour un logo d'équipe (un emblème
sur fond transparent n'a pas d'empreinte, voir plus haut).

Toute empreinte **écrite** en paramètre passe par
`CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)` : en requête préparée, MySQL 8 lit
`CAST(? AS UNSIGNED)` d'une chaîne comme un entier signé et plafonne tout
au-delà de 2^63 − 1 (mesuré : `18446744073709551615` devenait
`9223372036854775807`). MariaDB 11.8 accepte la même chaîne de casts.

## Sécurité (revue EF-72 sécurité 1)

- **Formats décodés** : `imagePerceptualHashResult` lit l'en-tête
  (`metadata()`) et ne décode qu'un WebP, un PNG ou un JPEG (ce qu'accepte le
  téléversement) — jamais un SVG ni un PDF, même déposé à la main sous un
  chemin d'avatar. `failOn: "error"` : un fichier tronqué ou corrompu n'est pas
  empreint (pixels de remplissage), `limitInputPixels` borne la taille (bombe
  de décompression). Une image animée : sa première image seulement.
- **Échec de décodage = ouvert** (empreinte nulle, SHA-256 seul). Au
  téléversement, l'image décodée est le WebP de 256 à 512 px que le gabarit
  vient d'écrire : un téléverseur ne peut pas la rendre indécodable ni trop
  grande, seul un incident passager (mémoire) l'empêche — refuser alors un
  innocent coûterait plus cher. Consigné (pm2, sans empreinte ni chemin :
  `[images] empreinte perceptuelle non calculée au téléversement`).
- **Blocages par les seuls octets consignés** : à la pose d'un blocage, une
  image trop simple ou non décodée est notée (pm2, `[moderation] … bloquée(s)
  par leurs octets seulement`, compte seul, sans empreinte ni chemin) : la
  modération sait qu'une copie retouchée repasserait (texte ou symbole sur un
  aplat : limite connue, voir plus haut).
- **Borne de 2 000 et faux refus** : chaque empreinte comparée ajoute une
  chance qu'une image innocente tombe à 10 bits d'elle ; aucune paire d'images
  différentes du jeu de mesure n'est descendue sous 14 bits, 2 000
  comparaisons gardent ce risque négligeable (20 000 ne le garantiraient
  plus). Atteinte, la borne est consignée (`[images] 2000 empreintes
  perceptuelles comparées`) : les plus anciennes ne comptent plus que par leur
  SHA-256 — contournement accepté, visible, et la borne se revoit.
- **Écriture** : toute empreinte écrite passe par `storablePhash` (entier non
  signé de 64 bits en décimal, sinon `null`) — une valeur relue abîmée ne fait
  pas échouer la décision qui pose le blocage. `VALUES()` (et non l'alias
  `AS new`) : seule forme connue de MariaDB.
- **Décodages en série** : `blockRemovedImageFiles` lit ses fichiers un à un
  (un effacement de compte en emporte plusieurs ; des décodages simultanés
  pèseraient sur la mémoire du Raspberry).
- **Journal de pose à la main** : en cas d'échec d'insertion, l'empreinte
  perceptuelle est consignée avec le SHA-256 — le fichier part juste après,
  elle ne se recalculerait plus ; elle ne désigne pas plus un compte que lui.
- **Canal auxiliaire** : le refus dit déjà « bloquée » (`IMAGE_BLOCKED`, code
  seul) ; la durée de la réponse n'en apprend pas davantage.

## Relevé hors verrou

Le décodage d'une image (dizaines de millisecondes, davantage sur le Raspberry
de production) ne tient pas les verrous d'une décision : `deleteUserAvatarForReport`
et `purgeQuarantinedLogo` relèvent les empreintes du fichier **avant** leur
transaction (`prepareAvatarFingerprint`, `prepareQuarantinedAvatarFingerprint`,
lecture non verrouillée) ; sous le verrou, `readImageFingerprint(chemin, préparée)`
ne refait que la lecture et le SHA-256, et reprend l'empreinte perceptuelle
préparée si les octets n'ont pas changé **et** qu'elle existe ou que l'image
s'est bien décodée (image trop simple : `imagePerceptualHashResult` dit
`decoded`, retenu par `readImageFingerprint`) — absente faute de décodage, elle
peut venir d'un échec passager, et le fichier effacé ensuite ne permettrait
plus de la calculer : elle est recalculée sous le verrou. Toute
préparation en échec rend `null` : l'empreinte se calcule alors sous le
verrou, comme avant. La purge ne prépare rien pour une ligne déjà close, ni,
d'office, avant l'échéance ; elle prépare sur le pool, **avant** d'emprunter
sa connexion (le décodage ne la garde pas inactive). `purgeDueQuarantines`
tourne en tâche de fond (`void`, hors réponse) : son arriéré se purge une
ligne après l'autre, sans borne par passage (une borne ferait mourir de faim
les lignes contestées, qui restent en tête).

## RGPD

L'empreinte perceptuelle est une donnée gardée de plus sur une image effacée :
même durée, mêmes lieux et même absence de lien avec un compte que le SHA-256.
Registre (T01, T11), `/rgpd` (FR et EN) et changement de confidentialité
`2026-11-empreinte-perceptuelle-avatar` (FR et EN).
