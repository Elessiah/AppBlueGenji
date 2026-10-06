# Textes éditables de la vitrine

Titres, slogans et descriptions de l'accueil, de la page association et de
l'en-tête du classement sont modifiables en place par le staff `showcase` (ADMIN + Community Manager), sans
passer par le code.

## Registre

Tout part de `lib/shared/site-copy.ts` : une entrée par texte, avec sa clé, la
page concernée, un libellé d'administration, la **valeur d'origine** (celle qui
était écrite en dur) et une longueur maximale.

Ajouter un texte éditable = ajouter une entrée au registre, puis envelopper le
rendu :

```tsx
<EditableCopy copyKey="home.hero.lede" value={copy["home.hero.lede"]} canEdit={isAdmin}>
  <p className={styles.lede}>{copy["home.hero.lede"]}</p>
</EditableCopy>
```

Pour un visiteur, `EditableCopy` rend ses enfants **tels quels** — aucun
wrapper, aucune classe en plus. Le crayon n'existe que pour un éditeur.
À la fermeture de l'éditeur (enregistrer, rétablir, annuler), le focus revient
au crayon ; crayon et éditeur sont `position: relative` pour passer au-dessus
des calques décoratifs absolus d'un en-tête (trame, aurore).

## Stockage

Table clé/valeur `bg_settings`, une ligne par texte modifié, préfixée `copy_`
(`siteCopySettingKey`). Une clé absente **ou vide** retombe sur la valeur
d'origine : un texte ne peut donc pas disparaître de la page, et
« Rétablir l'original » se contente de supprimer la ligne.

Base injoignable → `getSiteCopy()` renvoie les défauts, la page reste peuplée.

## API

| Verbe | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/site-copy` | public (les textes sont affichés à tous) |
| `PATCH` | `/api/site-copy` `{ key, value }` | `showcase` |
| `DELETE` | `/api/site-copy?key=…` | `showcase` |

Erreurs : `UNKNOWN_COPY_KEY` (404), `COPY_EMPTY` / `COPY_TOO_LONG` (400).
Un texte vide est refusé — vider un titre casserait la page sans retour arrière
possible autrement qu'en le retapant.

## Textes couverts

**Accueil** — surtitre / titre / accroche du hero, titre et description de la
section association, surtitre / slogan / description de l'appel final (dans ses
**deux** variantes : visiteur et membre connecté — un éditeur étant toujours
connecté, sans quoi il ne pourrait jamais modifier la version visiteur).

**Association** — surtitre et titre du hero, accroche du manifeste, accroche
de la section « Adhérer ».

**Classement** (`/classement`, depuis le 2026-10-06) — titre
(`ranking.hero.title`, multiligne, 160 car.) et sous-titre
(`ranking.hero.lede`, 400 car.) de l'en-tête. Les métadonnées de la page
restent figées, comme pour l'accueil et l'association (`RANKING_PAGE.md`).

Les textes éditables ne sont pas des données personnelles : rien à déclarer
au registre des traitements ni à `PRIVACY_CHANGES`.

**Langues** : français seulement à ce jour. Le lot 2 de l'i18n rend **toutes**
les clés du registre bilingues (`copy_<clé>__en`, anglais obligatoire, D9) et
rattrape l'anglais de celles déjà saisies — classement compris
(`I18N_MIGRATION_PLAN.md`).

Les titres multilignes se saisissent avec de vrais retours à la ligne ; le rendu
les convertit en `<br />`, la dernière ligne portant l'accent de couleur.

## Tests

- `tests/lib/shared/site-copy.test.ts` — registre et validation.
- `tests/lib/server/site-copy-service.test.ts` — défauts, upsert, réinitialisation,
  résilience à une base injoignable.
- `tests/app/api/site-copy.test.ts` — permissions et codes d'erreur.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Textes éditables de la vitrine** : titres, slogans et descriptions de `/` et `/association` sortent du JSX via le registre `lib/shared/site-copy.ts` (clé → libellé + valeur d'origine), sont stockés dans `bg_settings` (préfixe `copy_`) et s'éditent en place avec `<EditableCopy>` pour la permission `showcase`. Une clé absente ou vide retombe sur la valeur d'origine. Voir `docs/features/EDITABLE_SITE_COPY.md`.
