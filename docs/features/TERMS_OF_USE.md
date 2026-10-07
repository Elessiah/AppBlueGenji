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
est gardée 30 s par compte, vidée à l'acceptation. Elle rend **pourquoi** on
demande (`termsRequestFor`, module pur) : `FIRST` à qui n'a jamais accepté,
`UPDATED` à qui a accepté une version antérieure — la modale titre alors « Les
conditions d'utilisation ont changé » et nomme la version et sa date, au lieu du
« Tu gères désormais une équipe » qui serait faux pour un gérant de longue date.
Rouverte par un geste refusé (409 `TERMS_ACCEPTANCE_REQUIRED`) sans réponse de
la mise en page, elle garde le texte d'une première acceptation.

## Versions

| Version | En vigueur depuis | Pourquoi |
|---|---|---|
| 1 | 24 septembre 2026 | Première version. |
| 2 | 1er octobre 2026 | Changements de fond : âge minimum, licence, responsabilité des gérants, juridiction. Tout compte qui avait accepté la version 1 la réaccepte — à la connexion par la case de `/connexion`, ou par la modale s'il gère une équipe ; ses gestes de gestion sont refusés en 409 d'ici là. |

`TERMS_UPDATED_AT` est daté du **lendemain** de la mise en ligne quand l'heure
du déploiement n'est pas connue, comme `PRIVACY_CHANGES`.

## Traduction anglaise (lot 7b-1)

`/en/conditions-utilisation` rend `TERMS_SECTIONS_EN` (`lib/shared/terms-of-use-en.ts`), traduction
section par section de `TERMS_SECTIONS` — mêmes identifiants, même ordre, mêmes liens. **Le
français fait foi et reste le texte accepté** : la page anglaise le dit en tête, et les fenêtres
d'acceptation sous `/en` le rappellent sous leur case (`TERMS_TRANSLATION_NOTE`). Accepter sous
`/en` enregistre la même `TERMS_VERSION` ; traduire n'avance jamais la version.

**Règle** : toute modification de fond se fait **dans les deux langues, dans la même PR** (avec
`TERMS_VERSION`), et met à jour la référence du français (`tests/fixtures/legal-fr/`), que
`tests/app/site-legal-i18n.test.tsx` compare au rendu, au caractère près. Détail : `I18N.md`
§ Textes légaux du site.

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
Rendues par l'export RGPD, effacées à l'anonymisation — **les deux** : la
table *et* les deux colonnes du compte (elles restaient sur la ligne anonymisée,
sans limite de durée, alors que la preuve dont elles résument la dernière ligne
était effacée). Les comptes anonymisés avant cette règle sont rattrapés par
`reconcileDeletedAccounts`, d'une instruction qui ne leur tire pas de nouveau
pseudo d'emprunt.

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

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Conditions d'utilisation** (`lib/shared/terms-of-use.ts` pur + `lib/server/terms-acceptance.ts`, page `/conditions-utilisation`) : texte et **version** au même endroit ; avancer `TERMS_VERSION` redemande l'acceptation. Acceptées à la **création du compte** (case de la modale d'entrée de `/connexion` ; `terms=1` scellé dans le cookie d'état OAuth comme l'intention, `termsAccepted` pour le code Discord — un compte **neuf** sans acceptation est refusé, `TERMS_REQUIRED`), à la **création d'une équipe** (`acceptTerms`, exigé par `POST /api/teams`), avant d'**inscrire** l'équipe à un tournoi, et en **recevant la gestion** d'une équipe — geste que le receveur ne fait pas : la mise en page racine présente les conditions (`TermsAcceptanceModal`) et les gestes de gestion sont refusés en 409 `TERMS_ACCEPTANCE_REQUIRED` tant qu'il ne les a pas acceptées (jamais pour retirer un logo, ni pour le staff sur une fantôme). L'envoi d'un logo exige en plus la case « je détiens les droits » (`LOGO_RIGHTS_NOT_CERTIFIED`). Preuve dans `bg_terms_acceptances`. Voir `docs/features/TERMS_OF_USE.md`.
