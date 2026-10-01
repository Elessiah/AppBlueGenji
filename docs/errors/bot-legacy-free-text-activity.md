# Niveaux et rôles en texte libre antérieurs aux choix fermés du bot

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Entrée d'origine

[2026-10-01] blueGenjiBot `ActivityDaily` (`detail`) + `Scrim.level` / `Recrute.role` — blueGenjiBot#37 a fermé les choix de `/scrim niveau` (débutant, intermédiaire, avancé) et `/recrute role` (tank, dps, heal, coach, manager), mais les valeurs saisies **avant** en texte libre restent : 30 jours dans `Scrim`/`Recrute`, puis **sans limite** dans les nombres par jour d'`ActivityDaily` (colonne `detail`), où un pseudo saisi à la place d'un niveau ou d'un rôle survit, auteur effacé. La politique du bot le dit (« seules les annonces antérieures à cette règle portent un texte libre ») — piste : migration unique au démarrage du bot qui ramène toute valeur hors liste à la valeur de la liste qu'elle désigne, sinon à « autre », dans `Scrim`, `Recrute` et `ActivityDaily` (en fusionnant les comptes de même clé) — (rencontré sur : feature/bot-privacy-texts-2)
