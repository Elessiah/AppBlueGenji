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
gris ; DCT, bloc 9 × 9 des basses fréquences dont on garde les **64
coefficients de plus basse fréquence hors composante continue** (la
luminosité moyenne dépasserait toujours la médiane : gardée, elle poserait le
même bit sur toutes les empreintes) ; chaque bit dit si son coefficient
dépasse leur médiane. Écrite en décimal (forme d'un `BIGINT UNSIGNED`), sans
littéral `BigInt` (cible ES2017).

- **Image trop simple** : pas d'empreinte (`null`) quand moins de
  `MIN_SIGNIFICANT_COEFFICIENTS` (40) coefficients sur 64 s'écartent de la
  médiane de plus de `MIN_COEFFICIENT_DEVIATION` (0,5 niveau de gris). Les
  autres bits ne disent que le bruit d'arrondi, **le même d'une image à
  l'autre** : un aplat, un dégradé, une image dont le contraste n'est que de
  couleur, et surtout **tout motif centré et symétrique** (disque, losange,
  anneau, initiale dans un cercle, emblème au milieu d'un logo d'équipe sur
  fond transparent, silhouette de face) — la symétrie annule la moitié des
  coefficients ou plus. Avant la revue EF-72, deux emblèmes différents
  tombaient à 6 bits l'un de l'autre : un emblème bloqué en aurait refusé
  d'innocents. Une telle image n'est bloquée que par ses octets. Mesuré : un
  motif symétrique a 14 à 39 coefficients marqués, une silhouette de face 33,
  une scène ordinaire 25 à 53 (49 scènes sur 60 en ont une empreinte).
- **Seuil** `PHASH_MATCH_DISTANCE = 10` bits sur 64. Mesuré sur des images de
  synthèse passées par le gabarit avatar (`tests/lib/server/image-phash.test.ts`,
  60 scènes à la revue) : autre format source, réencodage, redimensionnement
  ≤ 2 ; cadre décalé de 2,5 % de la source ≤ 12 (presque toujours sous 10) ;
  décalé de 5 % : 2 à 18 (trois fois sur quatre sous 10) ; images différentes
  qui ont une empreinte ≥ 20 (moitié des paires au-delà de 32). Une image à la
  limite peut perdre son empreinte une fois retouchée : elle passe alors.
  Un faux refus coûte plus à un joueur de bonne foi qu'un contournement par
  un cadre très décalé, que la modération rattrape sur signalement.

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
servie, comparable à celle des avatars bloqués). Une seule requête rend la
correspondance exacte et les empreintes perceptuelles posées :

```sql
SELECT sha256 IN (?, ?) AS exact, CAST(phash AS CHAR) AS phash FROM bg_blocked_image_hashes
 WHERE sha256 IN (?, ?) OR phash IS NOT NULL
```

Une ligne `exact` refuse. Sinon, et seulement si une empreinte perceptuelle est
posée, l'image traitée est décodée une fois de plus pour la sienne, comparée en
mémoire (`phashDistance`) : chaque téléversement ne paie pas ce décodage tant
que la liste n'a que des lignes d'avant D17. La liste ne grandit qu'avec les
suppressions de la modération (quelques dizaines de lignes). Une ligne sans
`phash` ne compte que par son SHA-256. Le refus reste le code `IMAGE_BLOCKED`,
comme avant ; il vaut pour un avatar comme pour un logo d'équipe (un emblème
centré sur fond transparent n'a pas d'empreinte, voir plus haut).

Toute empreinte **écrite** en paramètre passe par
`CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)` : en requête préparée, MySQL 8 lit
`CAST(? AS UNSIGNED)` d'une chaîne comme un entier signé et plafonne tout
au-delà de 2^63 − 1 (mesuré : `18446744073709551615` devenait
`9223372036854775807`). MariaDB 11.8 accepte la même chaîne de casts.

## Relevé hors verrou

Le décodage d'une image (dizaines de millisecondes, davantage sur le Raspberry
de production) ne tient pas les verrous d'une décision : `deleteUserAvatarForReport`
et `purgeQuarantinedLogo` relèvent les empreintes du fichier **avant** leur
transaction (`prepareAvatarFingerprint`, `prepareQuarantinedAvatarFingerprint`,
lecture non verrouillée) ; sous le verrou, `readImageFingerprint(chemin, préparée)`
ne refait que la lecture et le SHA-256, et reprend l'empreinte perceptuelle
préparée si les octets n'ont pas changé. Toute préparation en échec rend
`null` : l'empreinte se calcule alors sous le verrou, comme avant.

## RGPD

L'empreinte perceptuelle est une donnée gardée de plus sur une image effacée :
même durée, mêmes lieux et même absence de lien avec un compte que le SHA-256.
Registre (T01, T11), `/rgpd` (FR et EN) et changement de confidentialité
`2026-11-empreinte-perceptuelle-avatar` (FR et EN).
