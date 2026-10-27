/**
 * Ce que le site fait des identifiants qu'un joueur lui confie — **dit au
 * joueur**, à l'endroit où il les saisit.
 *
 * Ces phrases vivent ici, une fois, partagées par `/connexion`, `/profil` et la
 * fiche joueur. Deux copies auraient divergé au premier ajustement, et la
 * divergence porterait sur ce que le site **promet** — le genre d'écart
 * qu'aucun test d'intégration ne rattrape et qu'un joueur découvre en
 * constatant le contraire. Les écrans les lisent dans la langue de la page
 * (`audience.*`, `discord.*`… des espaces de messages) ; le français de chaque
 * copie égale celui d'ici (testé).
 *
 * Rédaction courte (`docs/features/INFO_HINTS.md`) : une ligne visible pour
 * l'essentiel, le détail derrière le bouton « i ».
 *
 * Module **pur** : des chaînes et des listes de lecteurs, sans contexte.
 */

/**
 * Une explication « qui le voit » : une phrase d'entrée, les lecteurs, une
 * phrase de fin. Rendue en liste derrière le bouton « i » (`AudienceList`,
 * `components/ui/info-hint.tsx`) ; même forme sous `audience.*` dans chaque
 * espace de messages qui la montre (`profile`, `login`, `players`).
 */
export type IdentityAudience = { readonly title: string; readonly items: readonly string[]; readonly footer: string };

/**
 * Qui voit un tag Discord **certifié**, et personne d'autre.
 *
 * L'ordre suit `canViewDiscordTag` : les administrateurs toujours, l'arbitrage
 * seulement tant que le titulaire est inscrit à un tournoi vivant (tout état
 * sauf `FINISHED`, inscriptions comprises), les parties d'un match par sa
 * fenêtre « Contacts », les autres joueurs seulement si le titulaire a coché
 * « Tag Discord ». « Personne d'autre » n'est pas une formule de style — le
 * tag n'est **jamais** montré à un visiteur sans compte.
 */
export const DISCORD_TAG_AUDIENCE: IdentityAudience = {
  title: "Un tag certifié est visible par :",
  items: [
    "les administrateurs, à tout moment ;",
    "les arbitres, tant que tu es inscrit à un tournoi non terminé ;",
    "les membres des deux équipes de ton match, dès que ses adversaires sont connus et jusqu'à sa fin, et ses casters le temps du match ;",
    "si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres dès que ses adversaires sont connus et jusqu'à sa fin ;",
    "les autres joueurs, seulement si tu coches « Tag Discord » dans tes réglages de confidentialité.",
  ],
  footer: "Personne d'autre.",
};

/**
 * Qui lit encore un BattleTag **masqué** : les parties d'un match, dans sa
 * seule fenêtre « Contacts » et sa fenêtre de lancement (décision du
 * 2026-10-19 : les deux fenêtres sont nommées partout), et comment cesser de
 * le partager. Dite là où on le renseigne (profil, rattachement Battle.net,
 * connexion par Blizzard) et sur la fiche de son titulaire.
 */
export const HIDDEN_BATTLETAG_AUDIENCE: IdentityAudience = {
  title: "Masqué, ton BattleTag ne se lit plus que dans la fenêtre « Contacts » de tes matchs et dans leur fenêtre de lancement :",
  items: [
    "si tu y es présenté comme contact : les membres des deux équipes, les arbitres et les administrateurs, dès que les adversaires sont connus et jusqu'à la fin du match, et les casters le temps du match ;",
    "si tu castes un match : ses deux équipes et ses autres casters le temps du match, et les arbitres et les administrateurs dès que ses adversaires sont connus et jusqu'à sa fin ;",
    "la fenêtre de lancement, elle, ne s'ouvre qu'aux deux équipes et aux casters.",
  ],
  footer:
    "Pour ne plus le partager du tout, efface-le de ton profil (s'il vient de Battle.net, détache d'abord Battle.net, après avoir ajouté un autre moyen de connexion si c'est le seul).",
};

/**
 * Ce que la connexion par Discord fait du pseudo — dit **sous le bouton**, avant
 * le clic.
 *
 * Se connecter **n'est pas** certifier : la connexion enregistre le pseudo que
 * Discord donne, invisible de tous, et la certification — qui ouvre le tag à
 * l'organisation — reste un geste distinct. La ligne visible dit l'essentiel ;
 * le bouton « i » dit où certifier ({@link DISCORD_LOGIN_TAG_DETAILS}) et qui
 * lirait le tag une fois certifié ({@link DISCORD_TAG_AUDIENCE}).
 */
export const DISCORD_LOGIN_TAG_NOTICE = "Enregistre ton pseudo Discord, sans le certifier : personne ne le voit.";

/** Où se fait la certification, après une connexion par Discord (ou par le code du bot). */
export const DISCORD_LOGIN_TAG_DETAILS =
  "Tu pourras le certifier dans « Mon profil » ou dans la fenêtre proposée après une connexion par Discord ou Blizzard.";

/**
 * Ce que la case « Tag Discord » des réglages de visibilité ouvre, et ce
 * qu'elle n'ouvre pas : elle ne vaut que pour un tag certifié
 * (`canViewDiscordTag`), et la certification l'ouvre déjà à l'organisation et
 * aux parties de ses matchs — aux autres joueurs, seulement par cette case.
 */
export const DISCORD_PLAYER_VISIBILITY_NOTICE =
  "« Tag Discord » ne vaut que pour un tag certifié : un tag non certifié reste masqué, case cochée ou non. Certifié, il est déjà visible de l'organisation et des contacts de tes matchs.";

/**
 * Ajout sous les cases quand « Tag Discord » est cochée sur un tag **non**
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

/** Ce qu'un tag **non** certifié vaut : rien, pour personne — la ligne visible sous le champ. */
export const DISCORD_TAG_UNVERIFIED_NOTICE = "Tag non certifié : personne ne le voit, pas même les administrateurs.";

/**
 * Ce qu'on y perd, derrière le « i » : sans certification, le tag est une note
 * privée, et l'organisation ne peut pas joindre le joueur pendant son tournoi.
 */
export const DISCORD_TAG_UNVERIFIED_CONSEQUENCE =
  "Sans certification, l'organisation ne peut pas te joindre pendant un tournoi : certifie-le pour qu'elle le puisse.";

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
  "Si tu rattaches Battle.net, Blizzard remplit ce champ et le met à jour à chaque connexion, à la place de ta saisie.";

/**
 * À quoi servent les identifiants de jeu — et à quoi ils ne servent pas : la
 * finalité, dite à la collecte, reste visible sous le champ.
 *
 * Le site ne lit aucune statistique de jeu : ces champs n'existent que pour
 * qu'un joueur puisse en ajouter un autre. Le dire évite la crainte inverse.
 */
export const GAME_TAG_NOTICE = "Sert seulement à t'ajouter en jeu, jamais pour des statistiques.";
