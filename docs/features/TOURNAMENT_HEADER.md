# En-tête de la fiche tournoi

`/tournois/[id]` — `_components/TournamentHeader.tsx` (rendu) + `_lib/header-meta.ts` (pur).

## Le problème

L'en-tête alignait **huit pastilles bleues identiques** sur une seule ligne :

```
[À JOUR] [OW2] [TERMINÉ] [DOUBLE ÉLIM.] [BLUEGENJI SURVIE] [FT3] [0/24] [⚙ ADMIN]
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
| Outils du lecteur | `← Retour`, témoin de flux, `⚙ Admin` | Ce qui parle de **qui regarde**, pas du tournoi. « À jour » décrit la page. |
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

`STATE_META` associe à chaque état un **ton**, jamais le rouge :

| État | Libellé | Ton |
| --- | --- | --- |
| `UPCOMING` | Prochainement | neutre |
| `REGISTRATION` | Inscriptions ouvertes | vert |
| `RUNNING` | En cours | bleu |
| `FINISHED` | Terminé | atténué |

Le rouge (`pill-live`) reste réservé à ce qui est **réellement à l'antenne**.
Un tournoi « en cours » n'est pas une diffusion — c'est la règle des trois sens
de « live » de `CLAUDE.md`, et `PhaseTimeline` s'y range aussi : la phase
courante y passe du rouge au bleu.

## Tests

`tests/tournois/header-meta.test.ts` — libellés (unicité des formats, absence de
rouge sur un état), faits affichés (présence conditionnelle, effectif, jauge
bornée), dates (bascule ouverture/clôture, `Joué le`, ISO conservé) et mise en
page (le témoin de flux reste du côté du lecteur, la page ne rebâtit pas de
guirlande de pastilles).
