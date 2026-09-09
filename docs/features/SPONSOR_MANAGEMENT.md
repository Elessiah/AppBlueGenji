# 🤝 Gestion des Partenaires (page d'accueil)

## Vue d'ensemble

La section **« Partenaires et soutiens »** (SECTION 04) de la page d'accueil `/`
est éditable par les **administrateurs** : ajout, modification et suppression de
partenaires, avec la même mécanique que la [gestion du bureau](BUREAU_MANAGEMENT.md).

- **Visiteurs / non-admins** : vitrine en lecture seule, limitée à **6 logos**.
- **Admins** : voient et gèrent **l'ensemble** des partenaires (au-delà de 6),
  via un bouton « + Ajouter » et des actions Modifier / Supprimer sur chaque case.

La page `/partenaires` (regroupement par palier) consomme la même source de
données et reflète donc automatiquement les changements.

## Modèle de données

La table `bg_sponsors` existait déjà (name, slug, tier, logo_url, website_url,
description, display_order, active). Aucune migration nouvelle. Tant que la table
est vide ou la base injoignable, `listSponsors()` renvoie un **fallback**
(`FALLBACK_SPONSORS`, `id` négatifs ⇒ **non modifiables** dans l'UI).

## Logique partagée — `lib/shared/sponsors.ts`

Importable côté client et serveur :

- `Sponsor`, `SponsorInput`, `SponsorTier` (`GOLD | SILVER | BRONZE | PARTNER`),
  `SPONSOR_TIERS`, `SPONSOR_TIER_LABELS`.
- `FALLBACK_SPONSORS` — vitrine de secours partagée.
- `slugifySponsor(name)` — slug URL-safe (accents retirés, minuscules).
- `validateSponsorInput(input)` — nom requis (≤ 120 car.), palier validé (défaut
  `PARTNER`), logo/site/description optionnels (ramenés à `null` si vides),
  `active` défaut `true`.

Le service `lib/server/sponsors-service.ts` réexporte ces symboles et ajoute le
CRUD. À la création, le slug est dérivé du nom puis rendu **unique**
(`ensureUniqueSlug`, suffixe `-2`, `-3`…). À la mise à jour, le slug reste stable.

## API

| Méthode & route                       | Auth   | Effet                       |
| ------------------------------------- | ------ | --------------------------- |
| `GET /api/landing/sponsors`           | public | Liste les partenaires       |
| `POST /api/landing/sponsors`          | admin  | Crée un partenaire (201)    |
| `PUT /api/landing/sponsors/[id]`      | admin  | Modifie un partenaire       |
| `DELETE /api/landing/sponsors/[id]`   | admin  | Supprime un partenaire      |

Codes d'erreur : `UNAUTHORIZED` (401), `FORBIDDEN` (403), `INVALID_ID` /
`INVALID_BODY` / `NAME_REQUIRED` / `NAME_TOO_LONG` / `INVALID_TIER` (400),
`SPONSOR_NOT_FOUND` (404).

## Interface

`components/cyber/landing/SponsorsGrid.tsx` est devenu un composant client
(« island ») rendu par la page serveur `app/page.tsx`, qui lui transmet la liste
et le flag `isAdmin` (`getCurrentUser()`). Pour les admins :

- bouton **« + Ajouter »** dans l'en-tête → modale ;
- chaque case expose **« Modifier »** et **« Supprimer »** en superposition (sans
  déclencher le lien du logo) ;
- la modale propose nom, palier (select), site web, URL de logo et description ;
- fermeture à `Échap`, focus initial sur le champ Nom, boutons désactivés
  pendant les requêtes ;
- tous les retours passent par les **toasts** bottom-left (`useToast()`).

### Logos externes

Une URL de logo saisie librement par le staff **n'est jamais mise telle quelle
dans le `src`**. Elle passe par un relais borné par la base
(`/api/landing/sponsors/<id>/logo`), si bien que l'image devient une image du
site : `next/image` la redimensionne, la convertit en WebP et la met en cache,
et la page n'appelle plus aucun serveur tiers. C'est ce qui a fait remonter la
note « Bonnes pratiques » de l'accueil de 78 à 100 — voir
[SPONSOR_LOGO_PROXY.md](SPONSOR_LOGO_PROXY.md), qui détaille les refus du relais
(https seulement, hôtes internes écartés, redirections revalidées, SVG exclu).

Ce choix remplace celui de la première version (`<img>` brut pour éviter une
allowlist `images.remotePatterns`) : l'allowlist est bien évitée, mais parce que
l'image est devenue locale, pas parce qu'on renonce à l'optimiser.

## Tests

- `tests/lib/shared/sponsors.test.ts` — slug, validation, paliers.
- `tests/lib/server/sponsors-service.test.ts` — CRUD, unicité du slug, fallback.
- `tests/app/api/landing/sponsors-admin.test.ts` — gardes d'auth, validation,
  codes HTTP.
