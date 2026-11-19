# Section repliable (`Disclosure`)

`components/ui/disclosure.tsx` : une section dont le titre est un bouton qui
la replie ou la déplie. Premier usage : le planning (`CAST_PLANNING.md` —
« Matchs passés (N) », « Calcul et confirmation »).

## Comportement

- Le bouton est **dans** le titre (`h2` par défaut, `level={3}` sinon), jamais
  l'inverse ; `aria-expanded`, et `aria-controls` seulement quand le contenu
  existe dans le DOM (ouvert, ou `keepMounted`). Clavier natif (Entrée, Espace).
- **Repliée par défaut** (`defaultOpen`). Avec `storageKey`, le choix du lecteur
  est gardé dans son navigateur (`localStorage`, `"1"` / `"0"`, lecture et
  écriture sous `try/catch` : sans stockage, l'état par défaut vaut).
- Le stockage n'est lu **qu'après le montage** : le premier rendu est toujours
  l'état par défaut, identique côté serveur et client (pas d'écart
  d'hydratation).
- `keepMounted` : le contenu replié reste monté et masqué (`hidden`) — un
  formulaire en cours de saisie n'est pas perdu.
- `count` : le nombre d'éléments repliés, à la suite du titre.
- `aside` : à côté du titre, hors du bouton — un `<InfoHint>` **nu** (pas
  d'`InfoHintRow`) : l'en-tête est déjà la rangée, l'explication y passe à la
  ligne sur toute la largeur.
- Chevron Lucide (`ChevronRight`), tourné quand la section est ouverte ; pas
  d'animation sous `prefers-reduced-motion`.

## Pourquoi pas `Section` ni `BoardPanel`

`app/(secured)/tournois/Section.tsx` (index, accent, teinte d'état, ouverture
pilotée par le sommaire) et `BoardPanel` (pastilles, marque du lecteur, volets
d'un plateau) portent l'habillage de leur écran. `Disclosure` est la forme
neutre, réutilisable ailleurs ; un nouvel écran repliable part d'elle.

Tests : `tests/components/disclosure.test.tsx`.
