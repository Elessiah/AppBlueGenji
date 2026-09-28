# « Mes tournois » en tête de `/tournois`, sommaire et sections sans cadre vide

La liste des tournois empilait quatre sections fixes (« En cours »,
« Inscriptions ouvertes », « Prochainement », « Terminés »), chacune rendue
même vide avec un grand cadre « Vide » — et rien n'y distinguait les tournois
où le lecteur est engagé : un joueur devait les retrouver parmi quatre-vingts
cartes, derrière parfois trois cadres vides.

## Ce qui change

- **« Mes tournois »** vient en tête, seulement devancé par la section
  « Tournois invisibles » du staff. Elle rassemble les tournois **en cours,
  aux inscriptions ou à venir** où le joueur est engagé — par une équipe dont
  il est membre aujourd'hui, ou par son entrée solo en tournoi individuel —,
  dans cet ordre, chaque carte gardant l'habit de son état (`StateCard`).
  Ces tournois **quittent** leur section d'origine : aucun n'apparaît deux fois.
  Les **terminés** restent sous « Terminés », même joués : la section ne
  rassemble que ce qui attend encore quelque chose du joueur.
- **Une section vide n'est plus rendue.** Le **sommaire** qui remplace le
  bandeau de chiffres les montre toutes, avec leur compte : une section vide y
  reste, grisée, avec son zéro — « y a-t-il un tournoi en cours ? » se lit en
  une ligne au lieu d'un bloc. Si **aucune** section n'a de tournoi, un seul
  cadre le dit pour toute la page (« Aucun résultat pour cette recherche. »
  quand c'est le filtre qui a tout vidé).
- **Le sommaire mène aux sections** (`#tournois-<clé>`) et déplie au passage
  une section repliée (« Terminés ») : l'ouverture des sections est donc tenue
  par la page (`Section` accepte `open` / `onOpenChange`, et garde
  `defaultOpen` quand personne ne la pilote). `scroll-margin-top` garde le
  titre d'arrivée hors de l'en-tête collant.
- La numérotation (« 01 », « 02 »…) ne compte que les sections affichées.
- En-tête un peu resserré (titre, marges) : la première carte remonte d'autant.

## Pourquoi une lecture à part

La liste publique (`GET /api/tournaments`) est **la même pour tous** et
mutualisée côté serveur (`cachedTournamentList`) : elle ne peut pas savoir qui
la lit, et la rendre propre à chaque lecteur casserait ce cache, qui est la
lecture la plus sollicitée du site. `GET /api/me/tournaments` ne rend donc que
des **identifiants** (`listMyActiveTournamentIds`,
`lib/server/tournaments/my-tournaments.ts`), et la page découpe elle-même ses
paniers (`splitMyTournaments`, `_lib/page-sections.ts`, pur).

La requête ne pose **aucune** condition sur `participant_type` : une entrée
solo n'a aucun membre et une équipe réelle n'a pas de `solo_user_id`, si bien
que chaque branche (`e.solo_user_id = ?` / membre avec `left_at IS NULL`) ne
peut désigner que son propre type d'engagé — la lecture de
`resolveUserEntrant`, posée une fois pour toute la liste. Elle écarte les
tournois non publiés (aucun identifiant caché ne sort par elle) et les
terminés.

Le découpage se fait sur les paniers **déjà reclassés par l'horloge**
(`useScheduledBuckets`) : un tournoi qui démarre reste en tête. La lecture suit
la cadence de la liste (`useAutoRefresh`, retour sur l'onglet compris) :
s'inscrire depuis une fiche puis revenir suffit à voir le tournoi remonter.
Son échec est **silencieux** — la page retombe sur ses sections habituelles.

Ce n'est pas l'ancien onglet « Mes tournois » (`scope=mine`, retiré avec la
section des invisibles), qui listait les tournois **organisés** par le
lecteur.
