# Accessibilité — lien « Voir » de la banderole de recrutement

Tâche 6 d'`ACCESSIBILITE.md` (WCAG 2.4.4, 2.5.3, 2.5.8 · RGAA 6.1).

`components/recruitment-highlight.tsx` : la banderole discrète fait défiler les
annonces prioritaires et importantes, chacune suivie d'un lien « Voir → ».

- **Nom accessible.** « Voir → » seul ne dit pas où il mène, surtout lu hors
  contexte dans une liste de liens. Le lien porte `aria-label` =
  `bannerLinkLabel(ad)`, soit « Voir l'annonce : <titre> ». Il **commence** par
  le mot affiché, sans quoi la commande vocale « cliquer sur Voir » ne le
  trouverait plus (2.5.3). La flèche est `aria-hidden`. Les deux formes du lien
  (ancre native sur `/recrutement`, `<Link>` ailleurs) portent le même nom.
- **Taille de cible.** Réduite à sa ligne de texte en 11 px, la cible mesurait
  14 px de haut. Elle passe à **24 px** (`min-height`, `inline-flex`), prise
  sur le rembourrage de la banderole : sa hauteur ne change pas (40,8 px
  mesurés avant comme après). Une marge négative compense le rembourrage
  horizontal, le texte reste à sa place.
- **Survol.** La cible ayant maintenant une surface, le survol la teinte
  légèrement, comme les boutons voisins.

Tests : `tests/app/recruitment-highlight-server.test.tsx` (nom accessible sur les
deux formes du lien, hauteur minimale de la cible).
