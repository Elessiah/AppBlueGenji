# En-tête de la fiche tournoi

`/tournois/[id]` — `_components/TournamentHeader.tsx` (rendu) + `_lib/header-meta.ts` (pur).

## Le problème

L'en-tête alignait **huit pastilles bleues identiques** sur une seule ligne :

```
[À JOUR] [OW] [TERMINÉ] [DOUBLE ÉLIM.] [BLUEGENJI SURVIE] [FT3] [0/24] [⚙ ADMIN]
```

Trois défauts, qui s'aggravent à chaque fonctionnalité ajoutée :

1. **Aucune hiérarchie.** Le témoin de connexion au flux (« À jour »), l'état du
   tournoi, son format et le rôle du lecteur portaient exactement le même
   habillage. Rien ne disait lequel parlait du tournoi et lequel parlait de la
   page.
2. **Aucun intitulé.** « FT3 » et « 0/24 » ne se lisent que si on connaît déjà la
   notation. Une valeur nue n'est lisible que par qui n'en a pas besoin.
3. **Un doublon fautif.** Deux pastilles disaient le format : un `switch` écrit à
   la main, sans cas `BG_SURVIE` ni `SURVIVAL` à jour, et `FORMAT_LABELS`. Un
   tournoi BlueGenji Survie s'annonçait donc « Double élim. » **à côté** de son
   vrai mode. La liste des pastilles ne pouvait que grossir : les dates, elles,
   n'y figuraient pas du tout.

## La mise en page

Quatre étages, séparés par du vide plutôt que par des traits :

| Étage | Contenu | Pourquoi là |
| --- | --- | --- |
| Outils du lecteur | `← Retour` (lien vers `/tournois` qui ne revient dans l'historique que s'il reste sur le site — `TOURNAMENT_PAGE_PATH.md`), témoin de flux, `⚙ Admin` | Ce qui parle de **qui regarde**, pas du tournoi. « À jour » décrit la page. |
| Identité | état, jeu (`· Individuel`), nom, description, `Modifier` | Ce qu'on lit en arrivant. |
| Les faits | grille étiquetée | Chaque valeur porte son intitulé. |
| Actions | chaîne officielle, inscription, invité, signalement | Hors du flux de lecture. |

## Les faits (`headerMetaItems`)

Module **pur** : il décide *ce qui* est affiché et dans quel ordre, jamais
comment. Les dates y restent au format ISO — leur mise en forme dépend du fuseau
du lecteur, que le module n'a pas à connaître.

Ordre : format → phase en cours → format des matchs → troisième place →
effectif → date d'inscription → début.

Règles :

- **Rien d'absent n'occupe une case.** Pas de format de match, pas de petite
  finale, pas de phase courante : la case n'existe pas, plutôt qu'un tiret à
  interpréter.
- **La date d'inscription qui compte maintenant.** L'ouverture tant qu'elle est à
  venir, la clôture ensuite, plus rien une fois le tournoi lancé — elle
  n'apprendrait rien et pousserait la date de début hors de vue.
- **`Joué le`** remplace `Début du tournoi` sur un tournoi terminé.
- **L'effectif porte une jauge**, bornée à 100 % (une inscription fantôme peut
  dépasser le plafond) et à 120 px de large : au-delà, elle cesse de se lire
  comme une mesure et devient le soulignement de la valeur.
- **`FORMAT_LABELS` est la source unique** du nom d'un format. C'est ce qui
  supprime le doublon, et ce qui garantit qu'un format ajouté demain ne
  s'affichera pas sous le nom d'un autre.

## Couleurs d'état

`STATE_META` associe à chaque état un **ton** — une variante sémantique des
pastilles (`DESIGN_SYSTEM.md` § Pastilles et étiquettes), jamais le rouge ni un
gris. Ce sont les teintes des rubans de `/tournois`
(`TOURNAMENT_LIST_CARDS.md` § Couleurs d'état) :

| État | Libellé | Ton | Teinte |
| --- | --- | --- | --- |
| `UPCOMING` | Prochainement | `accent` | `--violet-300` |
| `REGISTRATION` | Inscriptions ouvertes | `highlight` | `--pink-400` |
| `RUNNING` | En cours | `info` | `--blue-300` |
| `FINISHED` | Terminé | `success` | `--teal-400` |

Le rouge (`pill-live`) reste réservé à ce qui est **réellement à l'antenne**.
Un tournoi « en cours » n'est pas une diffusion — c'est la règle des trois sens
de « live » de `CLAUDE.md`, et `PhaseTimeline` s'y range aussi : sa pastille
suit `phaseStateVariant` (terminée `success`, même courante ; courante ou en cours `info`, à venir `accent`,
ignorée `neutral`). `⚙ Admin` prend `accent`.

### Habillage néon froid

- **Cadre** (`.header`, sur `.ds-header`) : liseré haut au dégradé de marque
  (`--grad-brand`), éclat violet dans le coin haut droit, bordure glacier.
- **Nom** (`.title`, sur `.ds-title`) : dégradé blanc glacé → cyan → violet.
- **Lien de retour** glacier (`--blue-300`, `--cyan-400` au survol) ; jauge
  d'effectif au dégradé de marque.
- **Panneaux de la fiche** (`page.module.css`, `.sheet` posé sur la section qui
  enveloppe la fiche) : titres de panneau (`.ds-section-title` `green`/`blue`)
  au dégradé de marque — texte et trait —, aplat `--ink` sous « Contraste
  renforcé » et à l'impression ; panneaux à liseré glacier et halo au survol
  (pointeur fin). « Zone de danger » garde son rouge.

## Tests

`tests/tournois/header-meta.test.ts` — libellés (unicité des formats, absence de
rouge sur un état), faits affichés (présence conditionnelle, effectif, jauge
bornée), dates (bascule ouverture/clôture, `Joué le`, ISO conservé) et mise en
page (le témoin de flux reste du côté du lecteur, la page ne rebâtit pas de
guirlande de pastilles).

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **En-tête de la fiche tournoi** (`app/(secured)/tournois/[id]/_lib/header-meta.ts` pur + `_components/TournamentHeader.tsx`) : l'en-tête alignait huit pastilles bleues identiques — témoin de flux, jeu, état, format **deux fois** (un `switch` écrit à la main, sans cas `BG_SURVIE`, annonçait « Double élim. » à côté du vrai mode), format des matchs, effectif, rôle du lecteur — sans un intitulé pour dire laquelle parlait du tournoi et laquelle parlait de la page ; les dates, elles, n'y figuraient pas. Quatre étages désormais : **outils du lecteur** (retour, témoin de flux, `⚙ Admin` — ce qui parle de *qui regarde*), **identité** (état, jeu, nom, description), **faits en grille étiquetée** (`headerMetaItems`, source unique `FORMAT_LABELS`), **actions**. Le module pur décide ce qui s'affiche et laisse les dates en ISO — leur mise en forme dépend du fuseau du lecteur. Un fait absent n'occupe pas de case, et la date d'inscription montrée est celle qui compte *maintenant* (ouverture tant qu'elle est à venir, clôture ensuite, plus rien une fois lancé). `STATE_META` n'accorde **aucun ton rouge** à un état de tournoi — `PhaseTimeline` s'y range aussi. Le `← Retour` est un lien vers `/tournois` qui ne cède à `router.back()` que si la page précédente est du site (`lib/shared/site-back.ts`, navigation relevée par `SiteNavigationTracker` dans la mise en page racine) ; la frise de progression suit l'en-tête ; les gestes sans retour de la fiche (abandon, retrait de pénalité, lancement forcé) passent par `ConfirmActionDialog`, jamais `window.confirm` ; et un flux SSE ouvert qui ne livre aucun instantané en 5 s bascule sur la lecture REST (`FIRST_SNAPSHOT_TIMEOUT_MS`). Voir `docs/features/TOURNAMENT_HEADER.md` et `docs/features/TOURNAMENT_PAGE_PATH.md`.
