# 🙌 Gestion des Bénévoles (page `/benevoles`)

## Vue d'ensemble

La page `/benevoles` présente les bénévoles de l'association **groupés par
catégorie dynamique** (Développeur, Arbitre, Caster…). Elle est éditable par les
**administrateurs uniquement** ; les visiteurs voient une vitrine en lecture
seule.

- **Visiteurs / non-admins** : liste en lecture seule.
- **Admins** : bouton « + Ajouter », actions Modifier / Supprimer sur chaque
  carte, **import de photo** et **réordonnancement des catégories**.

Tant que la table est vide ou la base injoignable, `listBenevoles()` renvoie un
tableau vide (dégradation silencieuse).

## Modèle de données — `bg_benevoles`

Colonnes : `first_name`, `pseudo` (optionnel), `last_name`, `category`,
`photo_url` (optionnel), `joined_at`, `display_order` (ordre au sein d'une
catégorie) et **`category_order`** (ordre d'affichage des catégories entre
elles). La colonne `category_order` est ajoutée via une migration `ALTER TABLE`
idempotente pour les bases existantes.

Tri d'affichage : `category_order ASC, category ASC, display_order ASC, id ASC`.
À la création / mise à jour d'un bénévole, `category_order` est aligné sur la
catégorie visée (place conservée si elle existe déjà, ou ajoutée en fin de liste
si c'est un nouveau nom).

## Photo — import de fichier ou URL

Deux façons de renseigner la photo d'un bénévole :

1. **Import de fichier** — `POST /api/benevoles/photo` (multipart, admin). Le
   fichier est normalisé par `processAndStoreImage(..., "benevole-photo", …)` en
   **WebP 256×256** (recadrage « cover »), stocké sous `public/uploads/benevoles/`
   et servi via `/api/uploads/benevoles/…`. Formats acceptés : PNG / JPEG / WebP,
   5 Mo max.
2. **URL externe** — collée directement dans le champ (≤ 500 caractères).

À la mise à jour ou la suppression d'un bénévole, l'ancien fichier local est
supprimé en best-effort (`deleteStoredImage`) ; les URLs externes sont ignorées.

## Réordonnancement des catégories

Chaque en-tête de catégorie (côté admin) porte des flèches ↑/↓. Le déplacement
est **optimiste** côté client (rollback en cas d'échec) et persisté via
`PUT /api/benevoles/reorder` avec `{ categories: string[] }` — la liste ordonnée
des noms de catégories. `reorderBenevoleCategories` réécrit `category_order` de
toutes les lignes de chaque catégorie dans une transaction atomique.

## Logique partagée — `lib/shared/benevoles.ts`

Importable côté client et serveur :

- `Benevole`, `BenevoleInput`, `validateBenevoleInput(input)`.
- `groupByCategory(benevoles)`, `formatDisplayName(b)`, `formatJoinedAt(iso)`.
- `validateCategoryReorder(raw)` — refuse une liste vide, une entrée non-string /
  vide, ou un doublon (après trim).

## API

| Méthode & route                 | Accès | Rôle                                             |
| ------------------------------- | ----- | ------------------------------------------------ |
| `GET /api/benevoles`            | Public | Liste publique                                  |
| `POST /api/benevoles`           | Admin  | Créer un bénévole                               |
| `PUT /api/benevoles/[id]`       | Admin  | Modifier (nettoyage de l'ancienne photo locale) |
| `DELETE /api/benevoles/[id]`    | Admin  | Supprimer (nettoyage de la photo locale)        |
| `POST /api/benevoles/photo`     | Admin  | Importer une photo (multipart)                  |
| `PUT /api/benevoles/reorder`    | Admin  | Réordonner les catégories                       |

Toutes les routes d'écriture exigent `getCurrentUser()` **et** `isAdmin`
(`401` si anonyme, `403` sinon).
