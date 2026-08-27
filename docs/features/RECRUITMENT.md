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
| `body`          | `TEXT` nullable                        | Description (jusqu'à 6 000 signes) |
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

## Aperçu de la description et lecture en grand

Les annonces réelles font plusieurs milliers de signes (missions détaillées,
outils, modalités de candidature). Affichées en entier, elles étiraient leur
carte et déséquilibraient toute la grille. La carte n'en montre donc qu'un
**aperçu** :

- `buildRecruitmentPreview(body, max = 240)` (`lib/shared/recruitment.ts`, pure)
  aplatit les blancs, coupe **sur une frontière de mot** et suffixe « … ». Un mot
  plus long que la moitié de la limite (URL) est tranché net plutôt que de
  réduire l'aperçu à quelques signes. La fonction renvoie aussi `truncated`, qui
  décide de l'affichage du lien « Lire l'annonce complète → ».
- Le titre de la carte **est un bouton** : il ouvre la même modale de lecture.
- `AdDetailModal` (`app/recrutement/AdDetailModal.tsx`) affiche l'annonce en
  grand : en-tête et actions fixes, **seule la description défile**, dans une
  `<ScrollArea>` étiquetée.

**Mise en forme de la description.** Le texte est saisi en brut dans un
`<textarea>` ; `formatRecruitmentBody()` (pure, testée) en dérive des blocs
affichés par `components/recruitment/RecruitmentBody.tsx`. Rien n'est interprété
comme du Markdown, seules trois conventions déjà utilisées par les annonces le
sont :

| Saisie | Rendu |
| ------ | ----- |
| Ligne courte (≤ 80 signes) finissant par `:` | Intertitre (mono, bleu glacier) |
| Ligne commençant par `-`, `–`, `—`, `•` ou `*` | Puce (les lignes vides entre puces ne coupent pas la liste) |
| Reste | Paragraphe (sauts de ligne conservés) |

> Le `line-clamp` de la carte est un simple garde-fou d'affichage : il doit
> rester **au-dessus** de ce que l'aperçu occupe réellement (240 signes ≈ 7
> lignes dans la carte la plus étroite). Réglé plus bas, il tranche du texte que
> `buildRecruitmentPreview` avait jugé complet — et fait disparaître l'ellipse
> elle-même — sans qu'aucun lien « lire la suite » ne s'affiche.

**Lien profond.** Chaque carte porte l'ancre `annonce-<id>`
(`recruitmentAdAnchor`). Charger `/recrutement#annonce-12` ouvre directement
l'annonce en grand (`parseRecruitmentAdAnchor`, qui refuse tout fragment forgé) ;
ouvrir une annonce met l'URL à jour en `replaceState`, la fermer la nettoie. Le
fragment fait foi **dans les deux sens** : s'il cesse de désigner une annonce, la
lecture se referme. Un lien partagé vers une annonce supprimée ou dépubliée est
signalé par un toast plutôt que par une page muette. La banderole et la modale de
mise en avant pointent vers ce lien.

**Comportement modal.** Les trois modales de la fonctionnalité (lecture,
formulaire de gestion, mise en avant) partagent
`useDialogBehavior` (`lib/shared/hooks/useDialogBehavior.ts`) : fermeture par
`Échap`, piège à focus, défilement de l'arrière-plan gelé, focus rendu au
déclencheur à la fermeture.

Elles peuvent se **superposer** (la mise en avant urgente par-dessus une annonce
ouverte en lecture), ce qui impose de les arbitrer globalement plutôt que couche
par couche. C'est le rôle de `createDialogStack` (`lib/shared/dialog-stack.ts`,
pure et testée) :

- le verrou de défilement est posé à l'entrée de la **première** couche et levé à
  la sortie de la **dernière**. Une restauration couche par couche dépendrait de
  l'ordre de démontage — React nettoie dans l'ordre de l'arbre, pas dans l'ordre
  d'ouverture — et pouvait laisser `overflow: hidden` en place, page bloquée ;
- seule la couche du dessus (`isTop`) traite `Échap`. Les écouteurs vivent tous
  sur `window`, où `stopPropagation()` ne coupe pas les voisins attachés au même
  nœud : sans cet arbitrage, une seule touche fermait aussi la mise en avant
  urgente — et grillait sa fenêtre d'anti-répétition de 7 jours.

**Filtre par pôle.** Au-delà de 3 annonces couvrant au moins deux pôles, une
rangée de pastilles filtre la liste. Le réordonnancement admin est désactivé tant
qu'un filtre est actif : les flèches portent sur l'ordre réel, pas sur la vue.

## Mise en avant urgente (`highlight`)

- `NONE` — annonce visible uniquement sur `/recrutement`.
- `BANNER` — banderole discrète sticky en haut de **toutes** les pages.
- `MODAL` — fenêtre modale affichée à l'arrivée du visiteur.

### Plusieurs annonces urgentes ?

Une **seule** annonce est mise en avant à la fois : la première annonce active
dont `highlight <> 'NONE'`, selon `display_order`. `getHighlightedAd()` ne refait
pas ce choix — sa requête remonte les candidates dans l'ordre d'affichage et
délègue l'arbitrage à `selectHighlightedAd()`, **la même fonction pure** que les
badges de gestion : les deux ne peuvent donc pas désigner des annonces
différentes. Le composant client `RecruitmentHighlight`, monté dans le layout
racine, récupère le résultat via `GET /api/recruitment/highlight`.

Marquer trois annonces « Modale à l'arrivée » n'empile donc pas trois modales :
la plus haute gagne, les autres **attendent leur tour**. Le mode ne joue aucun
rôle dans l'arbitrage — une `BANNER` placée au-dessus d'une `MODAL` prend la
place et la modale ne s'affiche pas. Remonter une annonce dans la liste suffit à
la faire passer devant.

Rien ne le montrait côté gestion : on pouvait cocher « Modale à l'arrivée » sur
trois annonces et croire les trois affichées. `resolveHighlightStates(ads)`
(pure, testée) rend maintenant l'état réel de chaque annonce, affiché en badge
sur les cartes pour le staff :

| État | Badge | Signification |
| ---- | ----- | ------------- |
| `LIVE` | « Modale en ligne » | C'est elle qui est servie au site |
| `QUEUED` | « Modale en attente » | Une annonce plus haute occupe la place |
| `DRAFT` | « Modale (brouillon) » | Annonce inactive : jamais mise en avant |
| `NONE` | *(aucun badge)* | L'annonce ne demande pas de mise en avant |

Le formulaire avertit en plus, à la volée, quand la mise en avant choisie est
déjà occupée par une autre annonce.

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
- `components/recruitment-highlight.tsx` — banderole / modale site-wide (aperçu + lien profond)
- `app/recrutement/AdDetailModal.tsx` — lecture d'une annonce en grand
- `components/recruitment/RecruitmentBody.tsx` — rendu des blocs de description
- `components/recruitment/ContactTags.tsx` — tags de contact partagés carte / modale
- `lib/shared/hooks/useDialogBehavior.ts` — Échap, piège à focus, verrou de défilement
- `lib/shared/dialog-stack.ts` — pile des modales ouvertes (verrou global, arbitrage d'`Échap`)
- `components/cyber/landing/PublicNavMenu.tsx` — menu burger

## Jeu de test

`npm run seed` crée cinq annonces `Test - *` couvrant la matrice :
deux longues descriptions (aperçu tronqué + modale de lecture), une description
courte (affichée en entier, sans lien « lire la suite »), trois mises en avant
concurrentes — une `LIVE`, une `QUEUED`, une banderole `QUEUED` — et un
brouillon urgent (`DRAFT`). Les pôles couverts font apparaître le filtre.
