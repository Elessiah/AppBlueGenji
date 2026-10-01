# Multi-phases — `qualifierValue` `NaN` acceptée

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Constat

`findPhaseIssue` (`lib/shared/tournament-phases.ts`) borne la valeur de qualification d'une phase par des comparaisons (`<`, `>`). `normalizePhaseConfigs` convertit la saisie brute par `Number(...)` : une valeur non numérique devient `NaN`, et toute comparaison avec `NaN` étant fausse, elle n'est jamais jugée « hors bornes ». La validation laisse donc passer une phase sans cible de qualification exploitable.

Les réglages de manches de la Suisse et de la Survie réagiraient de même à un `NaN`, mais ils ne passent pas par `Number(...)`, si bien que le cas ne se produit pas.

## Piste

Refuser tout nombre non fini (`Number.isFinite`) dans `findPhaseIssue`, avec un test sur la saisie brute. C'est un changement de comportement : à faire dans sa propre PR, hors du lot de refactorisation S3776 (#358) qui l'a relevé et l'a volontairement laissé tel quel.
