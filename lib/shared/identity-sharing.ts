/**
 * Ce que le site fait des identifiants qu'un joueur lui confie — **dit au
 * joueur**, à l'endroit où il les saisit.
 *
 * Ces phrases existaient, mais **pas là où elles servent**. L'exposition d'un
 * tag Discord certifié est énoncée sur `/connexion`, juste avant la case où l'on
 * tape son pseudo ; le fait que Blizzard réécrive le BattleTag à chaque
 * connexion n'est écrit nulle part ailleurs que dans le `CLAUDE.md`. Or
 * `/profil` est précisément l'écran où l'on revient *après*, celui où l'on
 * modifie ces champs des mois plus tard, et il n'en disait rien : le joueur y
 * corrige un tag sans savoir qui le lit, et voit son BattleTag changer tout seul
 * sans savoir pourquoi.
 *
 * Elles vivent donc ici, une fois, partagées par les deux écrans. Deux copies
 * auraient divergé au premier ajustement, et la divergence porterait sur ce que
 * le site **promet** — le genre d'écart qu'aucun test ne rattrape et qu'un
 * joueur découvre en constatant le contraire.
 *
 * Module **pur** : ce sont des chaînes, sans lecteur ni contexte.
 */

/**
 * Qui voit un tag Discord **certifié**, et personne d'autre.
 *
 * L'ordre suit `canViewDiscordTag` : soi-même toujours, les administrateurs
 * toujours, l'arbitrage seulement pendant un tournoi vivant, les autres joueurs
 * seulement si le titulaire a coché « Tag Discord ». « Jamais personne
 * d'autre » n'est pas une formule de style — le tag n'est **jamais** montré à
 * un visiteur sans compte, et c'est la seule phrase qui le dise au joueur.
 */
export const DISCORD_TAG_AUDIENCE =
  "les administrateurs le voient, les arbitres tant que tu es engagé dans un tournoi, et les joueurs et le caster de ton match le temps de la rencontre, à partir de son lancement ; les autres joueurs, seulement si tu le rends visible dans tes réglages de confidentialité. Jamais personne d'autre.";

/**
 * Ce que la case « Tag Discord » des réglages de visibilité ouvre, et ce
 * qu'elle n'ouvre pas.
 *
 * La phrase qu'elle remplace renvoyait le tag à « ses propres réglages », la
 * certification — or la certification l'ouvre à l'**organisation**
 * (administrateurs, arbitres), jamais aux autres joueurs : un joueur qui
 * voulait être trouvé par ses coéquipiers n'avait aucun geste pour cela. La
 * case est ce geste, et elle ne vaut que pour un tag certifié
 * (`canViewDiscordTag`), ce que le joueur doit lire avant de la cocher.
 */
export const DISCORD_PLAYER_VISIBILITY_NOTICE =
  "La certification ouvre ton tag Discord à l'organisation (administrateurs, arbitres pendant un tournoi), pas aux autres joueurs : coche « Tag Discord » pour qu'ils le voient sur ta fiche. Un tag non certifié reste masqué, case cochée ou non.";

/**
 * Ajout à la phrase précédente quand la case est cochée sur un tag **non**
 * certifié : le joueur croit s'être rendu joignable, et il ne l'est pas.
 */
export const DISCORD_PLAYER_VISIBILITY_PENDING =
  "Ton tag n'est pas certifié : il restera masqué aux autres joueurs tant que tu ne l'auras pas certifié.";

/**
 * Même situation sans **aucun** tag enregistré : « certifie ton tag » renverrait
 * à un tag qui n'existe pas, le geste est d'abord d'en enregistrer un.
 */
export const DISCORD_PLAYER_VISIBILITY_NO_TAG =
  "Tu n'as pas encore de tag Discord : enregistre-le puis certifie-le pour que les autres joueurs le voient.";

/**
 * Ce qu'un tag **non** certifié vaut : rien, pour personne.
 *
 * La nuance compte au moment de choisir : sans certification, le tag est une
 * note privée, et l'organisation ne peut pas joindre le joueur pendant son
 * tournoi.
 */
export const DISCORD_TAG_UNVERIFIED_AUDIENCE =
  "personne ne le voit, pas même les administrateurs. L'organisation ne peut donc pas te joindre pendant un tournoi.";

/**
 * Le geste qui défait la certification — **celui qui existe à l'écran**.
 *
 * Il est nommé partout où l'exposition est annoncée : il faut savoir qu'il y a
 * quelque chose à annuler, et c'est le **seul** chemin, il n'existe aucune route
 * de décertification.
 *
 * La phrase disait « modifier ton tag », ce que le moteur fait bien (toute
 * écriture du tag efface `discord_verified_at`) mais que le joueur ne peut pas
 * faire : un tag certifié appartient à un compte **rattaché**, et `/profil`
 * rend alors le champ en lecture seule — Discord possède le pseudo. Le geste
 * offert est le retrait, et nommer celui qui n'existe plus laissait le lecteur
 * chercher un champ qu'il ne peut pas remplir.
 */
export const DISCORD_CERTIFICATION_UNDO =
  "Pour l'annuler, retire ton tag depuis « Mon profil ».";

/**
 * Blizzard **écrit** le BattleTag, et l'écrase à chaque connexion.
 *
 * Entre ce que Blizzard affirme et ce qu'un joueur a tapé, la source fait foi :
 * un tag mal recopié ne se voit pas, il se constate quand l'ajout en jeu échoue.
 * Le joueur doit savoir pourquoi son champ change sans qu'il y touche.
 */
export const BLIZZARD_BATTLETAG_NOTICE =
  "Si tu rattaches Battle.net, Blizzard renseigne ce BattleTag et le remet à jour à chaque connexion — ta saisie est alors remplacée par celle de la source.";

/**
 * À quoi servent les identifiants de jeu — et à quoi ils ne servent pas.
 *
 * Le site ne lit aucune statistique de jeu : ces champs n'existent que pour
 * qu'un joueur puisse en ajouter un autre. Le dire évite la crainte inverse.
 */
export const GAME_TAG_NOTICE =
  "Sert uniquement à ce que les autres joueurs puissent t'ajouter en jeu — jamais pour des statistiques.";
