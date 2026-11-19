# Section repliable (`Disclosure`)

`components/ui/disclosure.tsx` : une section dont le titre est un bouton qui
la replie ou la déplie. Premier usage : le planning (`CAST_PLANNING.md` —
« Matchs passés (N) », « Calcul et confirmation »).

## Comportement

- Le bouton est **dans** le titre (toujours un `h2` ; les titres de son contenu partent de `h3`), jamais
  l'inverse ; `aria-expanded`, et `aria-controls` seulement quand le contenu
  existe dans le DOM (ouvert, ou `keepMounted`). Clavier natif (Entrée, Espace).
- **Repliée par défaut** (`defaultOpen`). Avec `storageKey`, le choix du lecteur
  est gardé sur son appareil (`localStorage`, clé propre au lecteur quand
  plusieurs comptes se relaient sur l'appareil : `planning:past-open:<id>` ; `"1"` / `"0"`, lecture et
  écriture sous `try/catch` : sans stockage, l'état par défaut vaut).
- Le stockage se lit par `useSyncExternalStore` : le rendu serveur et
  l'hydratation voient l'état par défaut (aucun écart), le client relit la
  mémoire avant la première peinture — pas de saut de mise en page. Le magasin
  est **par instance** : le stockage n'est lu qu'une fois (jamais à chaque
  rendu, même quand la page se redessine à chaque rafraîchissement), puis à
  chaque évènement `storage` d'un autre onglet — suivi aussi après un clic local ;
  le choix de la visite y est posé aussi, si bien que sans stockage on replie et
  déplie quand même.
- Replié = **démonté** (sauf `keepMounted`) : la recherche dans la page ne
  trouve pas un match passé tant que la section est fermée — choix assumé, la
  liste est de l'historique et peut être longue.
- `keepMounted` : le contenu replié reste monté et masqué (`hidden`) — un
  formulaire en cours de saisie n'est pas perdu.
- `count` : le nombre d'éléments repliés, à la suite du titre.
- `aside` : à côté du titre, hors du bouton — un `<InfoHint>` **nu** (pas
  d'`InfoHintRow`) : l'en-tête est déjà la rangée, l'explication y passe à la
  ligne sur toute la largeur ; le titre ne cède sa place (30 px) que s'il y a un
  `aside` (`data-aside`).
- `--disclosure-body-gap` : l'écart du contenu (16 px) se règle depuis la
  classe de l'appelant.
- Chevron Lucide (`ChevronRight`), tourné quand la section est ouverte ; pas
  d'animation sous `prefers-reduced-motion` ; survol réservé aux pointeurs
  qui survolent, état pressé au toucher, contraste forcé géré.

## Pourquoi pas `Section` ni `BoardPanel`

`app/(secured)/tournois/Section.tsx` (index, accent, teinte d'état, ouverture
pilotée par le sommaire) et `BoardPanel` (pastilles, marque du lecteur, volets
d'un plateau) portent l'habillage de leur écran. `Disclosure` est la forme
neutre, réutilisable ailleurs ; un nouvel écran repliable part d'elle.

Tests : `tests/components/disclosure.test.tsx`.
