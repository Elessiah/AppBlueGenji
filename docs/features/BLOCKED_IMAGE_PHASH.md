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
gris ; DCT, bloc 8 × 8 des basses fréquences ; chaque bit dit si son
coefficient dépasse la médiane des 63 coefficients hors composante continue.
Écrite en décimal (forme d'un `BIGINT UNSIGNED`), sans littéral `BigInt`
(cible ES2017).

- **Image presque unie** (énergie moyenne des coefficients sous
  `MIN_AC_ENERGY`) : pas d'empreinte (`null`). Toutes les images unies se
  ressembleraient — un aplat bloqué refuserait tous les autres. Même chose pour
  une image dont le contraste n'est **que de couleur** (teintes de même
  luminance) : elle n'est bloquée que par ses octets.
- **Seuil** `PHASH_MATCH_DISTANCE = 10` bits sur 64. Mesuré sur des images de
  synthèse passées par le gabarit avatar (`tests/lib/server/image-phash.test.ts`) :
  autre format source, réencodage, redimensionnement ≤ 2 ; cadre décalé de
  2,5 % de la source ≤ 8 ; décalé de 5 % : 2 à 20 (le plus souvent sous 10) ;
  images différentes ≥ 18 (moitié des paires au-delà de 30), silhouettes de
  même disposition ≥ 22. Un faux refus coûte plus à un joueur de bonne foi
  qu'un contournement par un cadre très décalé, que la modération rattrape sur
  signalement.

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
servie, comparable à celle des avatars bloqués). Une seule requête :

```sql
SELECT 1 FROM bg_blocked_image_hashes
 WHERE sha256 IN (?, ?) OR (phash IS NOT NULL AND BIT_COUNT(phash ^ CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)) <= ?) LIMIT 1
```

Comparaison en SQL plutôt qu'en mémoire : la liste ne grandit qu'avec les
suppressions de la modération (quelques dizaines de lignes), son parcours
complet coûte moins qu'un aller-retour, aucune empreinte ne quitte la base.
`BIT_COUNT` et `^` sur `BIGINT UNSIGNED` existent sous MySQL 8 et MariaDB 11.8.
Toute empreinte liée en paramètre passe par
`CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)` : en requête préparée, MySQL 8 lit
`CAST(? AS UNSIGNED)` d'une chaîne comme un entier signé et plafonne tout
au-delà de 2^63 − 1 (mesuré : `18446744073709551615` devenait
`9223372036854775807`).
Le refus reste le code `IMAGE_BLOCKED`, comme avant.

## RGPD

L'empreinte perceptuelle est une donnée gardée de plus sur une image effacée :
même durée, mêmes lieux et même absence de lien avec un compte que le SHA-256.
Registre (T01, T11), `/rgpd` (FR et EN) et changement de confidentialité
`2026-11-empreinte-perceptuelle-avatar` (FR et EN).
