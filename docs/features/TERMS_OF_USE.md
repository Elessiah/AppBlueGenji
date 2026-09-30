# Conditions d'utilisation

Texte et version dans `lib/shared/terms-of-use.ts`, page publique
`/conditions-utilisation` rendue depuis ce registre : la page ne peut pas
afficher autre chose que la version que les comptes acceptent. **Modifier une
règle de fond = avancer `TERMS_VERSION`**, ce qui redemande l'acceptation.

## Quand on accepte

| Moment | Où | Contexte enregistré |
|---|---|---|
| Création du compte | case de la modale d'entrée de `/connexion` (avec le consentement RGPD) | `SIGNUP` |
| Connexion suivante, case cochée | idem, si la version courante n'était pas encore acceptée | `LOGIN` |
| Création d'une équipe | case du formulaire `/equipes/creer`, exigée par `POST /api/teams` | `TEAM_CREATION` |
| Réception de la gestion d'une équipe | modale `TermsAcceptanceModal` (mise en page racine) | `TEAM_MANAGEMENT` |

Le site n'a pas de formulaire d'inscription : un compte naît à la première
connexion. L'acceptation voyage donc avec la connexion — `terms=1` scellé dans le
cookie d'état OAuth (comme l'intention, jamais relu dans l'URL du rappel),
`termsAccepted` dans le corps du code Discord. **Un compte
neuf sans acceptation est refusé** (`TERMS_REQUIRED`) ; un compte existant se
connecte toujours.

Recevoir la main sur une équipe (propriété transférée, rôle de gérant, fantôme
confiée) ne passe par aucun geste de celui qui la reçoit. La mise en page racine
pose donc la question à chaque chargement (`needsTermsForTeamManagement`) et
présente les conditions. « Plus tard » ferme la fenêtre pour **douze heures au
plus** ; les gestes de gestion restent refusés en **409
`TERMS_ACCEPTANCE_REQUIRED`**, et ce refus rouvre la fenêtre
(`TERMS_REQUIRED_EVENT`), report ou non.

Le report vit dans un cookie `bg_terms_later` (valeur `1`), lu par la mise en
page : gardé dans le seul état React, il tombait à chaque F5, nouvel onglet ou
lien ouvert depuis Discord. Trois réglages le tiennent :

- `max-age` **posé** (12 h) — un cookie sans durée revient au redémarrage du
  navigateur quand la restauration de session est active ;
- `SameSite=Lax` — un lien ouvert depuis Discord est une navigation venue d'un
  autre site, qui n'emporte pas un cookie `Strict` ;
- **effacé à chaque connexion et déconnexion** (`createSession` /
  `clearSession`) — il n'est lié à aucun compte, et le report d'un joueur ne
  doit pas valoir pour le suivant sur un ordinateur partagé.

La fenêtre se tait sur `/conditions-utilisation` et sur `/connexion`, et fait
taire la modale d'arrivée du recrutement tant qu'elle s'ouvre d'elle-même :
deux modales ne se superposent pas (`lib/shared/global-modals.ts`, ordre
confidentialité → conditions → recrutement).

## Gestes de gestion soumis aux conditions

Nom, sigle et description ; envoi d'un logo ; rôles ; exclusion ; invitation ;
acceptation d'une demande d'adhésion ; transfert de propriété ; **inscription à
un tournoi**. **Pas** : retirer un logo (le geste qu'on veut voir faire à qui
doute de ses droits), refuser une demande, dissoudre l'équipe, retirer l'équipe
d'un tournoi ou y déclarer forfait (on ne retient pas une équipe faute d'une
case cochée), et rien de ce que fait le staff sur une fantôme.

Le contrôle est posé geste par geste (`assertTermsAccepted`), **après** celui du
rôle, et non dans `userCanManageTeam` : ce dernier sert aussi à la **lecture**
(`canManage` de la fiche), qu'une case non cochée ne doit pas fermer.

La question « ce compte doit-il accepter ? » que pose la mise en page racine
tient en **une** requête (version acceptée et rôles, par jointure) et sa réponse
est gardée 30 s par compte, vidée à l'acceptation.

## Envoi d'un logo

Case « Je certifie détenir les droits sur ce logo » (`LOGO_RIGHTS_FIELD`),
exigée par la route (`LOGO_RIGHTS_NOT_CERTIFIED`, 400) **avant** tout traitement
du fichier. La case n'apparaît **qu'une fois un fichier choisi** et disparaît
avec lui : sur la fiche d'équipe, le logo s'envoie en deux temps (choisir, puis
certifier et « Envoyer le logo »), et la case est figée pendant l'envoi. Elle
était auparavant cochée *avant* le choix et restait affichée après : la décocher
une fois le logo en ligne ne retirait rien, une garantie qui avait l'air
révocable sans l'être. Chaque nouveau fichier redemande la garantie.

## Données

`bg_users.terms_version` / `terms_accepted_at` (dernière acceptation, consultée
avant un geste) et `bg_terms_acceptances` (la preuve : version, contexte, date).
Rendues par l'export RGPD, effacées à l'anonymisation.

## Âge minimum et vocabulaire

Un compte exige **15 ans** (`SITE_MINIMUM_AGE`, repris par `/rgpd#age-minimum`).
La condition est **déclarative** : le site ne recueille pas de date de
naissance, et la majorité déclarée (`isAdult`) ne dit rien d'un seuil à 15 ans —
aucun contrôle technique ne la tient. L'âge d'**adhésion** à l'association
(16 ans, art. 6 des statuts) est distinct : un compte n'est pas une adhésion, et
les conditions disent « utilisateur », jamais « membre », pour un titulaire de
compte.

## Licence sur les contenus

La section « Contenus publiés par les utilisateurs » nomme les quatre éléments
qu'exige le CPI (L131-3) : étendue (reproduire, représenter, adapter le format),
destination (site et communications liées aux tournois), lieu (monde entier) et
durée (celle de la publication sur le site, et, pour une diffusion faite pendant
celle-ci, celle de sa mise en ligne). Le retrait vaut pour l'avenir : les
diffusions et publications déjà faites ne sont pas reprises. Avatar et pseudos de
jeu, données personnelles à finalité étroite (`rgpd-policy.ts`), ne sont sous
licence que sur le site. Le titre de cette
section est cité par `lib/shared/logo-quarantine.ts` : le renommer, c'est
renommer ces citations dans le même changement.
