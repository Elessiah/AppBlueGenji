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

## Deux langues (lot 2 de l'i18n, D9)

Chaque entrée du registre porte **deux** valeurs d'origine : `defaultValue`
(français) et `defaultValueEn` (anglais, rédigé au lot 2 d'après le glossaire
d'`I18N.md`). Cela vaut pour **toutes** les clés, celles de l'association et du
classement comprises, bien que ces deux pages ne soient pas encore ouvertes sous
`/en` (lots 4 et 5).

**L'éditeur est bilingue** : le crayon ouvre le français et l'anglais côte à
côte (`lang="fr"` / `lang="en"` sur les champs, empilés sur un écran étroit).
L'anglais est **obligatoire** : sans lui, l'éditeur refuse avant l'envoi et le
serveur refuse de même (`COPY_EN_EMPTY`) ; le refus passe en notification
**et** est rattaché au champ anglais (`useFieldErrors` : `aria-invalid`,
phrase en `aria-describedby`, focus ramené). Table « code → champ » :
`SITE_COPY_FIELD_ERRORS` ; phrases : `SITE_COPY_ERROR_MESSAGES` (staff, en
français — l'administration n'est pas traduite, D4 ; sous `/en`, l'éditeur porte
`lang="fr"`).

Les textes de l'éditeur ne voyagent que pour le staff : la page pose
`SiteCopyEditorProvider` avec `getSiteCopyEditor()` (accueil : `copyBundle.editor`)
si `can(user, "showcase")`, `null` sinon.

### Rattrapage de l'existant (« action requise en production »)

Le contenu déjà en base n'a pas d'anglais. Règle (`resolveSiteCopy`), qui
garantit qu'**aucun français n'est servi sous `/en`** :

| Français | Anglais enregistré | Servi sous `/en` | Éditeur |
| --- | --- | --- | --- |
| d'origine | non | anglais d'origine | anglais d'origine pré-rempli |
| d'origine ou édité | oui | anglais enregistré | anglais enregistré |
| **édité** (avant le lot 2) | non | anglais d'origine (faute de mieux) | champ anglais **vide**, crayon marqué **EN** (ambre, avertissement), aide sous le champ |

Le troisième cas forme la **liste de rattrapage** (`SiteCopyBundle.missingEn`) :
la page anglaise y montre un anglais juste mais qui peut ne plus dire ce que dit
le français édité. Rien n'est écrit en base à la place du staff — aucun texte
de production n'est connu du code.

**Action requise en production** après déploiement : un porteur de `showcase`
parcourt l'accueil, la page association et `/classement` ; chaque crayon marqué
**EN** s'ouvre, on y saisit l'anglais du texte français affiché à gauche, on
enregistre. Quand plus aucun crayon n'est marqué, le rattrapage est fini.

### Contenus du staff de la page association (lot 5b)

Bureau, chiffres et cartes « À propos », description d'un partenaire, catégories
de bénévoles et annonces de recrutement ont leur anglais dans une colonne
`<colonne>_en` (`lib/shared/staff-translation.ts`), **obligatoire à la saisie**
(`BilingualField`, même contrat que cet éditeur). Les lignes écrites avant le
lot 5b n'en ont pas : **sous `/en`, elles ne sont pas rendues** — jamais de
français sur une page anglaise —, et leur bouton « Modifier » porte la marque
**EN** (« (EN à rédiger) » pour un lecteur d'écran).

**Action requise en production** après déploiement, sur les pages **françaises**
(où tout le contenu reste visible) :

- `/association` et l'accueil (`showcase`) : chaque membre du bureau, chiffre et
  carte « À propos » marqué **EN**, et chaque partenaire marqué **EN** (sa
  description attend son anglais) ;
- `/benevoles` (`showcase`) : chaque catégorie marquée **EN** — traduire **un**
  de ses bénévoles suffit, l'anglais vaut pour toute la catégorie ;
- `/recrutement` (`recruitment`) : chaque annonce marquée **EN** (titre, et
  missions / description si elles sont saisies) — sans quoi elle manque aussi à
  la banderole et à la modale de la page anglaise.

Quand plus aucun bouton n'est marqué, les pages anglaises montrent tout.

## Stockage

Table clé/valeur `bg_settings`, une ligne par texte modifié **et par langue** :
`copy_<clé>` pour le français (inchangée — aucune migration de données),
`copy_<clé>__en` pour l'anglais (`siteCopySettingKey(key, locale)` ; clé la plus
longue : 36 caractères, colonne `VARCHAR(80)`, aucun changement de schéma). Une
clé absente **ou vide** retombe sur la valeur d'origine de sa langue : un texte
ne peut donc pas disparaître de la page. Un enregistrement écrit les deux lignes
dans **une** instruction ; « Rétablir l'original » supprime les deux, après une confirmation (`ConfirmActionDialog`, en français sous `/en`) qui le dit.
Un français réécrit sous un anglais laissé intact fait paraître, sous le champ anglais, « Le français a changé, pas l’anglais » (`isSiteCopyEnStale`) : rien n’est refusé, une coquille corrigée ne change pas le sens.

Base injoignable → `getSiteCopy()` / `getSiteCopyBundle()` renvoient les
défauts, la page reste peuplée.

## API

| Verbe | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/site-copy` → `{ copy, copyEn }` | public (les textes sont affichés à tous) |
| `PATCH` | `/api/site-copy` `{ key, value, valueEn }` | `showcase` |
| `DELETE` | `/api/site-copy?key=…` (les deux langues) | `showcase` |

Erreurs : `UNKNOWN_COPY_KEY` (404), `COPY_EMPTY` / `COPY_TOO_LONG` (400, champ
français), `COPY_EN_EMPTY` / `COPY_EN_TOO_LONG` (400, champ anglais). Un texte
vide est refusé — vider un titre casserait la page sans retour arrière possible
autrement qu'en le retapant.

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
au registre des traitements ni à `PRIVACY_CHANGES`. Les colonnes anglaises du
lot 5b non plus : un rôle, une catégorie, un titre traduits ne disent rien de
plus sur une personne que leur français (les noms ne se traduisent pas).

**Langues** : toutes les clés sont bilingues depuis le lot 2 (§ Deux langues).
Seul l'accueil est servi sous `/en` ; l'association et le classement le seront
aux lots 5 et 4, leur anglais étant déjà saisissable.

Les titres multilignes se saisissent avec de vrais retours à la ligne ; le rendu
les convertit en `<br />`, la dernière ligne portant l'accent de couleur.

## Tests

- `tests/lib/shared/site-copy.test.ts` — registre, validation bilingue, règle de
  rattrapage (`resolveSiteCopy`), longueur des clés de stockage.
- `tests/lib/server/site-copy-service.test.ts` — défauts des deux langues, upsert
  des deux lignes, refus sans anglais, réinitialisation, base injoignable.
- `tests/app/api/site-copy.test.ts` — permissions et codes d'erreur (`COPY_EN_EMPTY`).
- `tests/components/editable-copy-bilingual.test.tsx` — éditeur FR/EN, refus
  rattaché au champ anglais, marque **EN** du rattrapage.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Textes éditables de la vitrine** : titres, slogans et descriptions de `/` et `/association` sortent du JSX via le registre `lib/shared/site-copy.ts` (clé → libellé + valeur d'origine), sont stockés dans `bg_settings` (préfixe `copy_`) et s'éditent en place avec `<EditableCopy>` pour la permission `showcase`. Une clé absente ou vide retombe sur la valeur d'origine. Voir `docs/features/EDITABLE_SITE_COPY.md`.
