# Responsive Tables

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Tableaux `.table-row` sous 920 px** : repli en pile, en-tête masqué, chaque valeur qui ne se lit pas seule porte son intitulé par `data-label` (rendu en `::before`) — un nouveau tableau libelle ses cellules de valeur
- **Tableau dans une modale** (`CertificationPromptDialog`) : `.table-row` replie à 920 px de **fenêtre**, trop tard pour une modale de 640 px ; la modale garde donc ses propres règles (repli à 560 px, rôles ARIA `table`/`row`/`cell` comme le roster d'équipe, en-têtes conservés pour les lecteurs d'écran, `data-label` en libellé visuel seulement).
