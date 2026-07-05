# 📣 Recrutement — Annonces & mise en avant urgente

## Vue d'ensemble

La page **`/recrutement`** présente les annonces des équipes qui recherchent des
joueuses, joueurs, coachs ou managers. Les administrateurs y gèrent les annonces
(ajout, modification, suppression, réordonnancement) et peuvent mettre en avant
une annonce **urgente** sur l'ensemble du site, sous forme de **banderole
discrète** ou de **modale**.

La page est publique (comme `/benevoles`, `/association`) et repose sur
l'en-tête vitrine `PublicHeader`.

## Modèle de données

Table `bg_recruitment_ads` (migration auto dans `lib/server/database.ts`) :

| Colonne         | Type                                   | Rôle |
| --------------- | -------------------------------------- | ---- |
| `title`         | `VARCHAR(140)` **requis**              | Titre de l'annonce |
| `team_name`     | `VARCHAR(120)` nullable                | Équipe qui recrute |
| `game`          | `ENUM('OW2','MR','ANY')`               | Jeu concerné |
| `roles`         | `VARCHAR(200)` nullable                | Postes recherchés (texte libre) |
| `body`          | `TEXT` nullable                        | Description |
| `contact_url`   | `VARCHAR(2048)` nullable               | Lien de candidature (Discord, formulaire…) |
| `highlight`     | `ENUM('NONE','BANNER','MODAL')`        | Mode de mise en avant urgente |
| `active`        | `TINYINT(1)`                           | Visible publiquement (`0` = brouillon) |
| `display_order` | `INT`                                  | Ordre d'affichage (réordonnable) |

## Mise en avant urgente (`highlight`)

- `NONE` — annonce visible uniquement sur `/recrutement`.
- `BANNER` — banderole discrète sticky en haut de **toutes** les pages.
- `MODAL` — fenêtre modale affichée à l'arrivée du visiteur.

Une **seule** annonce est mise en avant à la fois : la première annonce active
dont `highlight <> 'NONE'`, selon `display_order`
(`getHighlightedAd()`). Le composant client `RecruitmentHighlight`, monté dans
le layout racine, récupère cette annonce via `GET /api/recruitment/highlight` et
mémorise sa fermeture par annonce dans `sessionStorage` (elle ne réapparaît pas
avant une nouvelle session, ou tant que l'admin ne change pas l'annonce mise en
avant).

## API

| Méthode & route                    | Accès  | Rôle |
| ---------------------------------- | ------ | ---- |
| `GET /api/recruitment`             | public | Liste les annonces actives (les admins voient aussi les brouillons) |
| `POST /api/recruitment`            | admin  | Crée une annonce |
| `PUT /api/recruitment/[id]`        | admin  | Met à jour une annonce |
| `DELETE /api/recruitment/[id]`     | admin  | Supprime une annonce |
| `PUT /api/recruitment/reorder`     | admin  | Réordonne (`{ ids: number[] }`) |
| `GET /api/recruitment/highlight`   | public | Annonce urgente à mettre en avant (ou `null`) |

Les mutations vérifient la session (`401` si anonyme, `403` si non-admin) et la
validation partagée `validateRecruitmentAdInput` (`lib/shared/recruitment.ts`).

## Navigation

L'en-tête public `PublicHeader` présente désormais un **menu burger**
(`PublicNavMenu`) regroupant tous les liens de navigation, dont une entrée
**Recrutement**. Un **bouton « Recrutement »** dédié est également ajouté dans la
barre d'actions de l'en-tête.

## Fichiers clés

- `lib/shared/recruitment.ts` — types, constantes, validation
- `lib/server/recruitment-service.ts` — accès base (CRUD, reorder, highlight)
- `app/api/recruitment/**` — routes REST
- `app/recrutement/page.tsx` + `RecruitmentSection.tsx` — page publique + gestion admin
- `components/recruitment-highlight.tsx` — banderole / modale site-wide
- `components/cyber/landing/PublicNavMenu.tsx` — menu burger
