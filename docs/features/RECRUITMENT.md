# 📣 Recrutement — Annonces & statut d'importance

## Vue d'ensemble

La page **`/recrutement`** présente les annonces de recrutement du **staff
bénévole de l'association** (arbitres, casters, développeurs, community managers,
graphistes, modérateurs, événementiel, administration…) plutôt que des joueurs.
Les gestionnaires du recrutement (`ADMIN` + `RECRUTEUR`) y gèrent les annonces
(ajout, modification, suppression, réordonnancement) et donnent à chacune un
**statut d'importance** — prioritaire, importante ou facultative — qui décide si
elle apparaît dans la **modale d'arrivée**, dans la **banderole discrète** de
toutes les pages, ou seulement sur la page, sous « Autres recrutements ».

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
| `priority`      | `ENUM('PRIORITY','IMPORTANT','OPTIONAL')` | Statut d'importance (défaut `OPTIONAL`) — voir plus bas |
| `active`        | `TINYINT(1)`                           | Visible publiquement (`0` = brouillon) |
| `display_order` | `INT`                                  | Ordre d'affichage, **à l'intérieur d'un statut** |

> La colonne `domain` remplace l'ancienne colonne `game` (jeu OW/MR/ANY) : une
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
signalé par un toast plutôt que par une page muette. La banderole et la modale
d'arrivée pointent vers ce lien.

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
rangée de pastilles filtre la liste (les deux sections à la fois). Le
réordonnancement admin est désactivé tant qu'un filtre est actif : les flèches
portent sur l'ordre réel, pas sur la vue.

## Statut d'importance (`priority`)

Chaque annonce porte un **statut**, qui décide à lui seul où elle se montre.
La table `RECRUITMENT_PRIORITY_EXPOSURE` (`lib/shared/recruitment.ts`) **est** la
règle — aucun écran ne la redit :

| Statut | Libellé | Pastille « Urgente » | Modale d'arrivée | Banderole | Sur `/recrutement` |
| ------ | ------- | :---: | :---: | :---: | ------------------ |
| `PRIORITY` | Prioritaire | ✅ clignotante | ✅ | ✅ | Liste principale, en tête |
| `IMPORTANT` | Importante | — | — | ✅ | Liste principale, après les prioritaires |
| `OPTIONAL` | Facultative (défaut) | — | — | — | Section à part « Autres recrutements » |

Le statut remplace l'ancien mode de mise en avant (`highlight` : `NONE` /
`BANNER` / `MODAL`), qui ne servait qu'**une** annonce à la fois : on pouvait
cocher « Modale à l'arrivée » sur trois annonces, deux restaient lettre morte, et
c'était l'ordre d'une liste mêlant urgentes et facultatives qui décidait laquelle
passait. Désormais **toutes** les annonces publiées d'un statut obtiennent ce que
leur statut promet, sans condition de rang. Les brouillons (`active = 0`) ne sont
jamais mis en avant, quel que soit leur statut.

### Ordre : jamais de mélange entre statuts

L'ordre d'affichage (`display_order`) ne vaut qu'**à l'intérieur** d'un statut.
`sortRecruitmentAds` (tri stable, pur) range prioritaires, puis importantes, puis
facultatives ; il est appliqué par le service (`listRecruitmentAds`), par la mise
en avant (`selectRecruitmentSpotlight`) et par la page — écrit une fois plutôt
qu'en `ORDER BY`, deux tris auraient fini par diverger.

- **Flèches de réordonnancement** : `canMoveRecruitmentAd` refuse de franchir la
  limite d'un statut. La flèche grisée le dit au survol (« L'ordre se règle parmi
  les annonces « Importante » »). C'est le statut qui fait passer une annonce
  devant une autre, pas une flèche.
- **Serveur** : `PUT /api/recruitment/reorder` relit les statuts en base et
  refuse en **409** (`RECRUITMENT_ORDER_MIXES_PRIORITIES`) un ordre qui ferait
  passer une annonce devant une plus importante (`recruitmentOrderMixesPriorities`)
  — typiquement un statut changé depuis un autre onglet.
- **Changer de statut** fait passer l'annonce **en fin de son nouveau groupe** :
  `updateRecruitmentAd` lui donne alors le plus grand rang d'affichage, et
  `placeRecruitmentAd` rejoue la même règle côté client. Garder son rang la ferait
  atterrir au hasard de son ancienne position. Le formulaire l'annonce dès que le
  statut choisi diffère de l'enregistré.

### Modale d'arrivée : une seule, qui se feuillette

Plusieurs prioritaires se partagent **une** modale, avec « ← Précédente »,
« Suivante → » et un compteur (« 1 / 3 », annoncé « Annonce 1 sur 3 »). Empiler
une modale par annonce serait insupportable ; la modale ne tourne pas d'elle-même
(un texte qui change pendant qu'on le lit est un texte qu'on ne lit pas).

Elle s'ouvre sur la **première prioritaire jamais vue** (`recruitmentModalStart`) :
un visiteur qui revient pour une troisième prioritaire tombe sur celle-ci, sans
relire les deux autres. **Seules les pages réellement affichées** comptent pour
vues : fermée sur la page 1 de 3, la modale revient à l'arrivée suivante sur la
page 2 — c'est le « tour à tour » des prioritaires. Compter toutes les pages dès
l'ouverture taisait pour sept jours celles que le visiteur n'avait jamais
feuilletées. Une fois toutes vues, elle se tait sept jours. Elle se tait sur `/recrutement` et tant qu'un choix de
confidentialité est dû (`PrivacyChangesModal`).

### Banderole : les annonces défilent

La banderole porte prioritaires puis importantes, **une à la fois**, la suivante
toutes les `RECRUITMENT_BANNER_ROTATION_MS` (7 s). Une prioritaire y garde sa
pastille « Urgente », une importante porte le mot « Recrutement ». Commandes :
précédente, position, suivante, pause (WCAG 2.2.2), fermeture.

Le défilement s'arrête de lui-même au **survol** et au **focus** (on ne retire pas
une annonce de sous le pointeur ni sous le clavier), et dès que le **régime de
charge** coupe les animations décoratives (`useClientPower().decorativeMotion` :
page sans focus, machine à la peine, joueur en match, mouvement réduit) — le
bouton pause disparaît alors, rien ne défilant. Les changements automatiques ne
sont pas lus aux lecteurs d'écran (`aria-live="off"` pendant la rotation) ; un
changement demandé l'est (`polite`).

La banderole est tenue sur **une ligne à hauteur fixe** (deux rangées fixes sous
640 px : l'annonce, puis les commandes) : les annonces n'ayant pas la même
longueur, une banderole qui changerait de hauteur à chaque rotation ferait sauter
toute la page sous elle. Ce qui dépasse s'efface en « … ».

### Rendu serveur et cookies

La mise en page racine résout la mise en avant (`getRecruitmentSpotlight`, cache
à vol unique de 60 s, listes vides si la base ne répond pas) **et** la décision
d'affichage, puis les passe en props : modale et banderole sont dans le HTML
initial (voir l'historique du LCP dans `components/recruitment-highlight.tsx`).

| Cookie | Durée | Posé quand | Valeur |
| ------ | ----- | ---------- | ------ |
| `bg_recr_modal` | 7 jours | une page de la modale est **affichée** (même sans être fermée) | identifiants des prioritaires réellement affichées, `12.15.3` |
| `bg_recr_banner` | la visite | la banderole est **fermée** | identifiants des annonces qu'elle portait |

`parseRecruitmentSeen` ignore tout ce qui n'est pas un entier positif (une valeur
forgée ne tait que ce qu'elle nomme exactement) et lit encore l'ancienne forme à
un seul identifiant. `recruitmentDismissed` ne tait la banderole que si **toutes**
ses annonces figurent au cookie : une annonce qui s'ajoute à la mise en avant la
fait reparaître aussitôt. Aucun identifiant de personne (voir `/rgpd`).

### Migration

La colonne `highlight` a été reportée puis retirée au démarrage
(`lib/server/database.ts`) : `MODAL` → `PRIORITY`, `BANNER` → `IMPORTANT`, `NONE`
→ `OPTIONAL` (le défaut). Le report **consomme sa source** dans la même
instruction (`highlight = 'NONE'` après lecture) : si le `DROP` qui suit échouait,
le report rejoué au démarrage suivant ne trouverait plus rien et ne pourrait pas
écraser un statut choisi depuis. Le `DROP` n'est tenté que si le report a réussi
ou que la source est déjà partie.

## API

| Méthode & route                    | Accès  | Rôle |
| ---------------------------------- | ------ | ---- |
| `GET /api/recruitment`             | public | Liste les annonces actives (les admins voient aussi les brouillons) |
| `POST /api/recruitment`            | admin  | Crée une annonce |
| `PUT /api/recruitment/[id]`        | admin  | Met à jour une annonce |
| `DELETE /api/recruitment/[id]`     | admin  | Supprime une annonce |
| `PUT /api/recruitment/reorder`     | admin  | Réordonne (`{ ids: number[] }`) — `409 RECRUITMENT_ORDER_MIXES_PRIORITIES` si l'ordre mêle les statuts |
| `GET /api/recruitment/highlight`   | public | Mise en avant : `{ modal, banner }` (listes d'annonces) |

Les mutations vérifient la session (`401` si anonyme, `403` si non-admin) et la
validation partagée `validateRecruitmentAdInput` (`lib/shared/recruitment.ts`,
`INVALID_PRIORITY` sur un statut inconnu — anciennes valeurs `MODAL` / `BANNER`
comprises : un client resté sur l'ancien formulaire est refusé, pas rabattu en
silence sur « facultative »).

`GET /api/recruitment/highlight` est publique et mise en cache
(`Cache-Control: public, max-age=60, stale-while-revalidate=300`) ; le premier
rendu ne passe plus par elle, la mise en page racine lisant le service
directement.

## Navigation

L'en-tête public `PublicHeader` présente désormais un **menu burger**
(`PublicNavMenu`) regroupant tous les liens de navigation, dont une entrée
**Recrutement**. Un **bouton « Recrutement »** dédié est également ajouté dans la
barre d'actions de l'en-tête.

## Fichiers clés

- `lib/shared/recruitment.ts` — types, constantes, validation, statuts (tri, groupes, mise en avant, cookies)
- `lib/server/recruitment-service.ts` — accès base (CRUD, reorder, mise en avant)
- `app/api/recruitment/**` — routes REST
- `app/recrutement/page.tsx` + `RecruitmentSection.tsx` — page publique + gestion admin
- `components/recruitment-highlight.tsx` — banderole tournante / modale feuilletable site-wide (aperçu + lien profond)
- `components/recruitment/UrgentPill.tsx` — pastille clignotante « Urgente » (`.pill-urgent` dans `app/globals.css`)
- `app/recrutement/AdDetailModal.tsx` — lecture d'une annonce en grand
- `components/recruitment/RecruitmentBody.tsx` — rendu des blocs de description
- `components/recruitment/ContactTags.tsx` — tags de contact partagés carte / modale
- `lib/shared/hooks/useDialogBehavior.ts` — Échap, piège à focus, verrou de défilement
- `lib/shared/dialog-stack.ts` — pile des modales ouvertes (verrou global, arbitrage d'`Échap`)
- `components/cyber/landing/PublicNavMenu.tsx` — menu burger

## Jeu de test

`npm run seed` crée cinq annonces `Test - *` couvrant la matrice :
deux longues descriptions (aperçu tronqué + modale de lecture), une description
courte (affichée en entier, sans lien « lire la suite »), les trois statuts —
deux prioritaires (modale à deux pages, banderole qui défile), une importante,
une facultative **placée en tête de l'ordre brut** (le tri par statut doit la
ranger malgré tout sous « Autres recrutements ») — et un brouillon prioritaire,
jamais mis en avant. Les pôles couverts font apparaître le filtre.
