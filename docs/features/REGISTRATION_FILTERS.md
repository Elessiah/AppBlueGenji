# Conditions d'inscription à un tournoi

> `lib/shared/registration-filters.ts` (pur) ·
> `lib/server/tournaments/registration-eligibility.ts` ·
> colonnes `bg_tournaments.registration_discord_requirement` / `registration_min_players`

## Le manque

Un tournoi s'annonçait ouvert à toute équipe existante. Deux refus tombaient donc
toujours trop tard, le jour du coup d'envoi :

- l'équipe de **deux joueurs** inscrite sur un tournoi 5v5, qui ne peut pas
  aligner une rencontre ;
- l'équipe que l'organisation **ne peut joindre** par aucun de ses membres, et
  dont la manche reste ouverte jusqu'au délai.

Les deux se lisent sur le roster **avant** l'inscription. Ce sont donc des
conditions du tournoi, pas des surprises d'arbitrage.

## La règle

> Deux réglages par tournoi, contrôlés à chaque inscription **d'un joueur**.

| Réglage              | Valeurs                                             | Défaut        |
| -------------------- | --------------------------------------------------- | ------------- |
| Discord vérifié      | `NONE` · `ANY_PLAYER` · `ALL_PLAYERS`                | `ANY_PLAYER`  |
| Joueurs minimum      | 1 à 20 (`1` = aucune exigence)                       | 5             |

`ANY_PLAYER` est le défaut parce qu'il rend l'équipe joignable en exigeant le
minimum : un interlocuteur suffit à reprogrammer une manche. `ALL_PLAYERS` sert
aux tournois où chaque joueur doit l'être individuellement (éligibilité, tournoi à
enjeu) ; `NONE` retire la condition. « Vérifié » renvoie à
`docs/features/DISCORD_VERIFICATION.md` : un tag **prouvé**, jamais une chaîne
saisie — c'est précisément le trou que la condition ferme.

Les colonnes sont `NOT NULL` avec ces défauts : un tournoi d'avant la migration
en hérite, ce qui est le comportement voulu pour la suite, puisque seules les
inscriptions **nouvelles** passent la condition.

## Trois règles de portée, à ne pas confondre

**1. Les équipes fantômes n'y sont pas soumises.** Ce sont des équipes sans
joueur, créées par le staff pour remplir un plateau : les y soumettre interdirait
l'usage même pour lequel elles existent. Le contrôle est donc posé dans
`registerCurrentUserTeam` — l'inscription **à l'initiative d'un joueur** — et
jamais dans le tronc commun `registerTeam`, que partage l'inscription en lot de
fantômes. C'est le seul endroit du moteur où la distinction se lit sans rien
deviner.

**2. Une inscription déjà enregistrée n'est jamais relue.** Les conditions se
jugent à l'écriture. Les durcir après coup ne désengage personne, pas plus
qu'abaisser `maxTeams` ne renvoie une équipe chez elle (ce que l'édition refuse,
d'ailleurs). Un engagé qui ne remplit plus les conditions se retire à la main
(`docs/features/ENTRANT_REMOVAL.md`).

**3. L'effectif minimal ne s'applique pas en tournoi individuel.** Un engagé y est
**une** personne : le défaut à 5 interdirait toute inscription à tout tournoi
solo, sur un réglage que le formulaire n'a même pas affiché. La condition Discord,
elle, s'applique telle quelle — « au moins un » et « tous » désignent le même
unique joueur. La valeur reste **enregistrée** sur un tournoi solo (elle
resservirait si le type de participants rebasculait) ; ce qui compte est que
personne ne la *lise*.

## Trois refus, trois gestes

| Code                              | Statut | Ce qu'il demande de faire |
| --------------------------------- | :----: | ------------------------- |
| `TEAM_TOO_FEW_PLAYERS`            | 409    | Recruter                  |
| `TEAM_NEEDS_VERIFIED_DISCORD`     | 409    | Qu'un joueur certifie son tag |
| `TEAM_NEEDS_ALL_VERIFIED_DISCORD` | 409    | Que tous le fassent       |

**409 et non 400** : la saisie est bonne, c'est l'état de l'équipe qui ne convient
pas — et il se corrige, ce qu'un « requête invalide » ne laisserait pas entendre.

Trois codes distincts plutôt qu'un « conditions non remplies » unique : chacun
nomme le geste qui le lève, et le capitaine n'a pas à deviner laquelle des deux
conditions a bloqué. L'ordre des contrôles suit la même intention — l'effectif
d'abord, parce que reprocher un tag manquant à une équipe de deux joueurs
enverrait corriger le moins urgent des deux.

Un roster **vide** est refusé explicitement sous `ALL_PLAYERS` : un `every` sur un
tableau vide rend `true`, et l'effectif minimal (plancher 1) l'a déjà écarté en
tournoi par équipes — mais la garde ferme le cas pour de bon.

## Où la règle est écrite, et combien de fois

Une seule fois : `checkRegistrationFilters`. Elle sert **deux fois**, aux deux
bouts :

- `registerCurrentUserTeam` la lève en 409 (le serveur est le juge) ;
- `canUserRegister` ferme le bouton d'inscription, pour ne pas proposer un geste
  voué à l'échec. Le roster peut changer entre le rendu et le clic : c'est le
  serveur qui tranche, celui-ci n'existe que pour l'affordance.

En tournoi individuel, le bouton se juge sur le **joueur** et non sur son entrée
solo, qui n'existe peut-être pas encore : sinon la fermeture n'arriverait jamais à
temps pour la première inscription.

Les lectures de roster vivent dans `registration-eligibility.ts`, **toujours sur
la connexion de l'appelant** : l'inscription tient un verrou sur la ligne du
tournoi, et emprunter une seconde place du pool sous ce verrou arme un convoi.
Le roster compte les membres **actifs** (`left_at IS NULL`) : un joueur parti
n'est ni un effectif ni un interlocuteur.

## Édition et affichage

Les deux champs sont dans `RESTRICTED_FIELDS` : **modifiables après publication**,
tant que le tournoi n'est pas lancé. C'est délibéré — un tournoi annoncé où
personne ne peut s'inscrire (cinq joueurs exigés sur un plateau d'équipes à
quatre) doit pouvoir être ouvert sans être recréé. Rien n'est rétroactif, d'où
l'absence de garde du genre « ne peut plus être durci ».

Côté lecture, `registrationFiltersSummary` écrit la phrase **une fois** pour les
deux usages — annoncer les conditions (case « Conditions d'inscription » de
l'en-tête du tournoi) et expliquer un refus. La case n'apparaît que sur un tournoi
`UPCOMING` ou `REGISTRATION` : passé le coup d'envoi plus personne n'entre, et la
garder afficherait une condition d'accès comme un trait de palmarès.

Les conditions voyagent sur `TournamentCard.registrationFilters`, donc dans
l'instantané diffusé : ce sont des conditions publiques, rien de personnel.

## Jeu de test

`lib/server/seed.ts` donne un tag Discord à tous les joueurs fictifs et en
certifie **deux sur trois** (motif déterministe, le seed reste reproductible) :
un jeu où personne n'est certifié rendrait l'inscription impossible à essayer,
un jeu où tout le monde l'est ne montrerait jamais le refus. Deux tournois de la
matrice prennent les bords — « Inscriptions Sans Condition » (`NONE`, 1 joueur) et
« Inscriptions Tous Certifiés » (`ALL_PLAYERS`, 5 joueurs).

## Voir aussi

- `docs/features/DISCORD_VERIFICATION.md` — ce qu'« un tag vérifié » veut dire
- `docs/features/GHOST_TEAMS.md` — pourquoi les fantômes échappent aux conditions
- `docs/features/TOURNAMENT_EDITING.md` — les trois fenêtres d'édition
