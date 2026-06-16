# 🏛️ Gestion du Bureau (page Association)

## Vue d'ensemble

La section **« Bureau »** (SECTION 05) de la page `/association` est désormais
dynamique : les membres sont stockés en base et **les administrateurs** peuvent
les **ajouter, modifier et supprimer** directement depuis la page, sans
déploiement. Les cartes se réorganisent automatiquement sur plusieurs rangées
selon le nombre de membres.

Pour les visiteurs non-admins (et anonymes), la section reste en lecture seule.

## Modèle de données

Table `bg_bureau_members` (migration auto dans `lib/server/database.ts`) :

| Colonne         | Type          | Notes                                   |
| --------------- | ------------- | --------------------------------------- |
| `id`            | BIGINT PK     | Auto-increment                          |
| `name`          | VARCHAR(120)  | Nom complet du membre                   |
| `role`          | VARCHAR(120)  | Ex. « Président », « Trésorier »         |
| `initials`      | VARCHAR(4)    | Sigle affiché (max 4 car., majuscules)  |
| `color`         | VARCHAR(40)   | Couleur du sigle (CSS `rgb(...)`)        |
| `display_order` | INT           | Ordre d'affichage (tri croissant)       |
| `created_at`    | DATETIME      | Auto                                    |
| `updated_at`    | DATETIME      | Auto                                    |

Tant que la table est vide (ou en cas de base injoignable),
`listBureauMembers()` renvoie un **bureau de secours** (`FALLBACK_BUREAU`) afin
que la page reste toujours peuplée. Les membres de secours ont un `id` négatif
et **ne sont pas modifiables** dans l'interface. `npm run seed` insère les 4
membres réels du bureau.

## Initiales & couleurs aléatoires

Logique partagée dans `lib/shared/bureau.ts` (importable côté client et serveur) :

- `computeInitials(name)` — dérive les initiales : première lettre des deux (à
  trois) premiers mots, ou les deux premières lettres si nom en un seul mot.
  Toujours en majuscules. Les initiales saisies manuellement priment.
- `randomBureauColor()` — tire une couleur dans `BUREAU_COLORS`, une palette
  « cyber » curatée (bleu glacier, ambre, orange, violet, vert, rose…). Une
  nouvelle couleur est tirée à chaque ouverture du formulaire d'ajout ; un
  bouton **« Couleur aléatoire »** permet de re-tirer.
- `validateBureauInput(input)` — valide/normalise nom + rôle (requis, ≤ 120
  car.) et dérive initiales/couleur si absentes.

## API

| Méthode & route                         | Auth   | Effet                          |
| --------------------------------------- | ------ | ------------------------------ |
| `GET /api/association/bureau`           | public | Liste les membres              |
| `POST /api/association/bureau`          | admin  | Crée un membre (201)           |
| `PUT /api/association/bureau/[id]`      | admin  | Modifie un membre              |
| `DELETE /api/association/bureau/[id]`   | admin  | Supprime un membre             |

Codes d'erreur : `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_ID` /
`INVALID_BODY` / `NAME_REQUIRED` / `ROLE_REQUIRED` / `NAME_TOO_LONG` /
`ROLE_TOO_LONG` (400), `BUREAU_MEMBER_NOT_FOUND` (404).

## Interface

`app/association/BureauSection.tsx` est un composant client (« island ») rendu
par la page serveur `app/association/page.tsx`, qui lui transmet la liste
initiale et le flag `isAdmin`. Pour les admins :

- un bouton **« + Ajouter »** dans l'en-tête de section ouvre une modale ;
- chaque carte expose **« Modifier »** et **« Supprimer »** ;
- la modale affiche un **aperçu en direct** du sigle (initiales + couleur) ;
- tous les retours (succès/erreur) passent par les **toasts** bottom-left
  (`useToast()`), jamais en inline.

## Tests

- `tests/lib/shared/bureau.test.ts` — initiales, couleur, validation.
- `tests/lib/server/bureau-service.test.ts` — CRUD + fallback (DB mockée).
- `tests/app/api/association/bureau.test.ts` — gardes d'auth, validation, codes
  HTTP des routes.
