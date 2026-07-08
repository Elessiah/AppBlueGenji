# 📣 Recrutement — Annonces & mise en avant urgente

## Vue d'ensemble

La page **`/recrutement`** présente les annonces de recrutement du **staff
bénévole de l'association** (arbitres, casters, développeurs, community managers,
graphistes, modérateurs, événementiel, administration…) plutôt que des joueurs.
Les gestionnaires du recrutement (`ADMIN` + `RECRUTEUR`) y gèrent les annonces
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
| `team_name`     | `VARCHAR(120)` nullable                | Référent / contact (pôle, personne) |
| `domain`        | `ENUM(ARBITRAGE, CASTING, DEV, COMMUNICATION, DESIGN, MODERATION, EVENEMENTIEL, ADMIN, AUTRE)` | Pôle de bénévolat visé (défaut `AUTRE`) |
| `roles`         | `VARCHAR(200)` nullable                | Missions / profil recherché (texte libre) |
| `body`          | `TEXT` nullable                        | Description |
| `contact_url`   | `VARCHAR(2048)` nullable               | Lien de candidature — idéalement un ticket SpiceWorks (bouton « Postuler → ») |
| `contact_discord` | `VARCHAR(120)` nullable              | Contact Discord : pseudo (copiable) ou lien d'invitation |
| `contact_discord_id` | `VARCHAR(32)` nullable            | ID Discord (snowflake) pour le deep-link « Ouvrir » |
| `contact_preferred` | `ENUM('AUTO','DISCORD','LINK')`   | Canal mis en avant (stylé en primaire) |
| `highlight`     | `ENUM('NONE','BANNER','MODAL')`        | Mode de mise en avant urgente |
| `active`        | `TINYINT(1)`                           | Visible publiquement (`0` = brouillon) |
| `display_order` | `INT`                                  | Ordre d'affichage (réordonnable) |

> La colonne `domain` remplace l'ancienne colonne `game` (jeu OW2/MR/ANY) : une
> migration renomme et reconvertit automatiquement la colonne, les anciennes
> valeurs étant ramenées à `AUTRE`.

## Tags de contact

Chaque annonce expose deux canaux de contact, sous la description (tags cliquables
avec icône) et dans le pied de carte :

- **Lien de candidature** (`contact_url`) — bouton « Postuler → ». Destiné en
  premier lieu à un **lien vers un ticket SpiceWorks** (ou tout formulaire /
  invitation). Le canal email a été abandonné au profit de ce lien.
- **Discord** (`contact_discord`) — si la valeur est un pseudo, le tag copie le
  pseudo dans le presse-papiers (toast de confirmation) ; si c'est une URL
  (`https://…` ou `discord.gg/…`), il devient un lien « Rejoindre ».
- **Ouvrir Discord** (`contact_discord_id`) — quand un ID Discord (snowflake) est
  connu, un tag supplémentaire ouvre la conversation directe
  (`discord.com/users/<id>`). L'ID n'est retenu que tant que le pseudo associé
  n'est pas remplacé (garde-fou côté client + validation).

**Canal préféré** (`contact_preferred`, défaut `AUTO`) : le recruteur peut mettre
un canal en avant (`DISCORD`, `LINK`) ; le tag correspondant est stylé en primaire
(bleu glacier). `AUTO` = aucun canal privilégié.

**Auto-complétion** : à la création d'une annonce, le formulaire pré-remplit le
Discord à partir du profil du recruteur connecté (`discord_pseudo`, `discord_id`
via `getRecruiterContactDefaults()`), **sans bloquer l'édition** — le recruteur
peut modifier ou vider le champ. En édition d'une annonce existante, aucun
pré-remplissage : on affiche les valeurs enregistrées.

> **Abandon de l'email.** Un canal email avait été envisagé mais retiré : exposé
> en clair par l'API publique `GET /api/recruitment`, il n'offrait aucune vraie
> protection anti-scraping, et pré-remplir l'email de connexion du recruteur
> risquait de publier une adresse personnelle. Le contact passe désormais par le
> lien de candidature (ticket SpiceWorks) et Discord.

## Mise en avant urgente (`highlight`)

- `NONE` — annonce visible uniquement sur `/recrutement`.
- `BANNER` — banderole discrète sticky en haut de **toutes** les pages.
- `MODAL` — fenêtre modale affichée à l'arrivée du visiteur.

Une **seule** annonce est mise en avant à la fois : la première annonce active
dont `highlight <> 'NONE'`, selon `display_order`
(`getHighlightedAd()`). Le composant client `RecruitmentHighlight`, monté dans
le layout racine, récupère cette annonce via `GET /api/recruitment/highlight`.

La mémorisation de l'affichage dépend du mode :

- `BANNER` — la fermeture est mémorisée par annonce dans `sessionStorage` : la
  banderole ne réapparaît pas avant une nouvelle session (ou tant que l'admin ne
  change pas l'annonce mise en avant).
- `MODAL` — plus intrusive, elle n'apparaît qu'**une fois par semaine et par
  utilisateur** : à son affichage, un horodatage est enregistré par annonce dans
  `localStorage` (`bg_recr_highlight_seen_<id>`) et elle reste masquée tant que
  moins de `RECRUITMENT_MODAL_INTERVAL_MS` (7 jours) se sont écoulés. L'horodatage
  est posé dès l'affichage (pas seulement à la fermeture), donc la modale « compte »
  comme vue même si l'utilisateur quitte la page sans la fermer. La décision est
  isolée dans le helper pur `shouldShowRecruitmentModal(seenAt, now)`
  (`lib/shared/recruitment.ts`), testé unitairement. Changer l'annonce mise en
  avant repart sur une clé neuve : une nouvelle annonce urgente peut donc
  réapparaître aussitôt.

L'endpoint `/api/recruitment/highlight` renvoie une réponse publique identique
pour tous les visiteurs : elle est mise en cache
(`Cache-Control: public, max-age=60, stale-while-revalidate=300`) pour éviter une
requête DB à chaque chargement de page. Un changement admin est répercuté en
~1 min au plus.

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
