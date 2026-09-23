# Double forfait

Les **deux** engagées d'une rencontre déclarent forfait. Le forfait ordinaire
désigne une équipe, et son adversaire l'emporte au score plein du format ;
quand personne ne se présente, il n'y a plus de bénéficiaire à désigner.

L'arbitrage (permission `tournaments`) le prononce depuis le dialogue de score :
« Déclarer un forfait sur cette manche » → **« Les deux (double forfait) »** →
« Valider le résultat ».

## Ce qui est écrit

`bg_matches.double_forfeit = 1`, `status = 'COMPLETED'`, et **rien d'autre** :
ni vainqueur, ni perdant, ni score, ni `forfeit_team_id`.

- **Pas de 0-0.** Une rencontre close sans vainqueur avec deux scores égaux est
  un **match nul** partout où l'on relit les colonnes — classement du site,
  fiches, capital d'endurance. Sans score, l'assiette du classement
  (`playedMatchSql`) l'écarte d'elle-même.
- **Une colonne à part**, parce que `forfeit_team_id` ne sait nommer qu'une
  équipe. Le drapeau n'est lu qu'avec le statut (`isMatchDoubleForfeit`) : une
  ligne rouverte par un retour en arrière n'annonce rien.
- **Uniquement par la validation** (`POST .../resolve` avec
  `{ doubleForfeit: true }`, exclusif d'un score et d'un forfait nominatif —
  `DOUBLE_FORFEIT_EXCLUSIVE`). L'enregistrement (`PATCH .../scores`) le refuse
  (`DOUBLE_FORFEIT_RESOLVE_ONLY`) : c'est une décision, pas un avancement.

## Ce que chaque moteur en fait

Une seule règle — **les deux perdent** — déclinée par format
(`lib/shared/double-forfeit.ts`).

| Format | Effet |
| --- | --- |
| Élimination simple / double | Les deux sortent. Personne ne monte : le créneau d'aval reste vide, et le match suivant devient une **exemption** pour l'adversaire qui l'attend. En double élimination, personne ne tombe au repêchage — un seul créneau de perdant pour deux perdantes. |
| Ronde suisse | Une défaite pour chacune, 0 point, rien au Sonneborn-Berger. La rencontre reste dans l'historique (pas de réappariement). |
| Survie | Une défaite pour chacune. Un **barrage** clos en double forfait élimine les deux ; la parité se rattrape par la victoire d'office des manches suivantes. |
| BG Survie — qualification | Chacune perd le score plein du format (FT3 → −3), comme la perdante d'un forfait ordinaire. Le capital peut tomber à zéro : élimination. |
| BG Survie — arbre final | Comme l'élimination : le créneau reste vacant, l'adversaire passe par exemption (`planNextPlayoffRound`). La petite finale ne réunit que des demi-finalistes **battues** : s'il n'en reste qu'une, elle prend la 3ᵉ place par exemption. |
| Multi-phases | La règle du format de la phase. Une équipe sortie par double forfait n'est **jamais qualifiée** pour la phase suivante, même si son rang tombe dans la cible — sa place n'est pas repêchée. |

## Effets en cascade dans un arbre

Un double forfait pose un **vide** là où un résultat posait une équipe, et le
moteur comble ce vide tout seul : le match suivant, privé d'un camp, est clos
en exemption (`tryAutoResolveByes`), son bénéficiaire monte d'un tour, et deux
doubles forfaits voisins font un **match fantôme** dont la cible devient à son
tour une exemption. Toute une chaîne de rencontres **résolues par le moteur**
descend donc d'un seul résultat.

**Corriger** ce résultat doit défaire la chaîne, dans les deux sens
(`lib/server/tournaments/bracket-cascade.ts`, appelé par `adminResolveMatch`
avant `finalizeMatch`) :

- **double forfait → vainqueur** : l'exemption d'aval n'a plus lieu d'être, son
  bénéficiaire redescend, et tout ce qu'il avait atteint se vide avec lui ;
- **vainqueur → double forfait** : le créneau garni est **vidé** —
  `pushTeamToTarget` ignore un `null`, il ne sait pas écrire un vide —, pour que
  l'exemption naisse à son tour.

On défait, on ne recalcule pas : le nouveau résultat est ensuite propagé par le
chemin ordinaire, et les exemptions encore justes sont reposées par
`tryAutoResolveByes`, la fonction qui les avait posées.

**Le verrou suit la chaîne.** `dependentMatches` (`lib/shared/match-lock.ts`)
traverse désormais les rencontres **tranchées sans saisie** (exemptions, matchs
fantômes) : c'est la première rencontre réellement disputée au bout de la
chaîne qui verrouille, pas la cible directe, qui n'a jamais été jouée. Le
serveur (`checkDownstreamMatchesHaveNoScores`) et l'interface (bouton « Éditer
le score ») appliquent le même parcours. La cascade garde un dernier rempart :
une rencontre disputée rencontrée en aval fait refuser la correction plutôt que
d'être effacée.

L'arbre final d'une BG Survie n'a pas de liens de bracket : sa cascade est
celle de `repairPlayoffBracket` (un tour périmé sans saisie est réécrit), et
`finalizePlayoffsIfDone` **enchaîne** les tours nés joués — une finale et une
petite finale d'exemptions se posent et se closent dans le même entretien. Si
les doubles forfaits vident tous les créneaux du tour suivant, le tournoi se
clôt sans championne, sur le classement de qualification.

## Classement final

Une rencontre de podium met **deux places** en jeu (`podiumRanks`) :

- **finale close en double forfait** → pas de championne ; les deux finalistes
  sont **2ᵉ ex æquo**, la suivante est 3ᵉ ;
- **petite finale close en double forfait** → 3ᵉ place vacante, les deux à 4 ;
- **finale gagnée par exemption** (l'autre demi-finale était un double forfait)
  → championne, 2ᵉ place vacante, la gagnante de la petite finale reste 3ᵉ.

Les points de parcours (`lib/shared/tournament-placement.ts`) ne lisent que
l'ordre des rangs et traitent l'égalité comme un ex æquo : deux finalistes à
`2, 2` s'y partagent les deux premières places. Le multi-phases garde ces ex
æquo et cette vacance dans le classement du tournoi (`multiTournamentRanks`).

## Hors du classement du site

Aucune rencontre n'a eu lieu : la cote Elo transfère des points d'une perdante
à une gagnante, et il n'y a pas de gagnante. Les fiches (bilan, séries, forme)
l'ignorent de même. Les conséquences sportives restent entières — élimination,
défaite au classement du tournoi, rang final, donc points de parcours.

## Affichage

- Carte de match : « FF » des deux côtés, mention « Double forfait » (jamais
  « Match nul »).
- Dialogue de score : « Double forfait enregistré : A et B perdent toutes les
  deux. » ; l'annonce avant le clic nomme l'effet sur l'arbre (exemption du
  prochain adversaire).
- Retour en arrière : la rencontre s'annonce « double forfait » dans la liste
  de ce qui sera effacé.
- Journal Discord : `🏁 Match terminé … : A vs B (double forfait, aucune
  qualifiée).`
