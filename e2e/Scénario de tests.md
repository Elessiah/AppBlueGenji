# Scénario de tests — BlueGenji Arena

> Document de référence pour les tests E2E (Playwright, `e2e/*.spec.ts`).
> Corrigé et aligné sur l'implémentation réelle + périmètre de développement validé.
>
> **Légende :**
> - ✅ Comportement déjà en place
> - 🔧 À développer / corriger dans ce lot
> - 🧪 Couvert par un test E2E

---

## 0. Pré-requis & authentification de test

Le site est **passwordless** : connexion via **Google OAuth** ou **code Discord à 6 chiffres**
(envoyé en DM par le bot). L'OAuth et le flux Discord réel ne sont **pas** testés en E2E
(dépendances externes) ; on les vérifie uniquement au niveau du **rendu** de `/connexion`.

Pour les parcours authentifiés, on utilise le **bypass `DEV_AUTH`** (`lib/server/auth.ts`,
inactif si `NODE_ENV=production`). 🔧 Le bypass est enrichi pour pouvoir **provisionner un
utilisateur de test neuf** (compte vierge : sans équipe, stats à 0, sans battletags ni
majorité renseignés) plutôt que de réutiliser le compte admin `321`. Cela permet de tester
le parcours « nouveau compte » de bout en bout sans système de mot de passe.

- Sans `E2E_AUTH_USER` → bypass désactivé → les routes `(secured)` redirigent vers `/connexion`.
- Avec `E2E_AUTH_USER=fresh` → un utilisateur de test vierge (non-admin) est créé/réutilisé et
  sert d'identité bypass.
- Avec `E2E_AUTH_USER=<id>` → bypass sur cet id précis (ex. compte admin pour les parcours admin).

---

# 1. Nouvel utilisateur

## 1.1 Connexion / Inscription

🧪 Depuis la page d'accueil, en tant que visiteur, le **header public** affiche en haut à
**droite** les actions « Connexion » et « Rejoindre ». 🔧 Une fois **connecté**, ces deux
boutons disparaissent et laissent place à **l'avatar + le pseudo** (header landing dynamique).

🧪 Le bouton mène à `/connexion`, qui propose **deux voies** : Google OAuth et code Discord
(flux en 2 étapes : saisie de l'ID Discord → saisie du code à 6 chiffres). Le rendu des deux
voies est vérifié sans appel externe réel.

## 1.2 Première connexion (compte vierge)

🧪 Un compte neuf doit présenter des **statistiques à 0** et **aucune équipe**. Ses
informations (BattleTag Overwatch, Tag Marvel Rivals, **pseudo Discord**, statut majeur) se
renseignent depuis la page **Profil** (`/profil`).

> Note : une **modale dédiée de première connexion** reste une amélioration possible (non
> incluse dans ce lot — la saisie se fait via la page Profil).

## 1.3 Profil

🧪 Dans l'espace tournois (`/tournois`, `/equipes`, `/joueurs`, `/profil`…), j'accède à mon
profil en cliquant sur **mon pseudo + mon avatar en haut à droite** de la fenêtre.

Je peux modifier toutes mes informations :

- Pseudo sur le site ✅
- BattleTag Overwatch ✅
- BattleTag Marvel Rivals ✅
- 🔧 Pseudo Discord (**ajouté au scope**)
- Statut majeur ✅
- Visibilité publique (BattleTag OW, Tag Marvel, Majorité) ✅

🧪 J'ai accès à mes statistiques, **à 0 pour une première connexion**.

🧪 Je peux me **déconnecter** → retour à la page d'accueil, avec le retour des boutons
Connexion / Rejoindre.

🔧 **Suppression de compte** : un bouton permet de supprimer mon compte. Le compte devient
**anonyme** (pseudo anonymisé, battletags / pseudo Discord / majorité effacés) mais les
**statistiques et l'historique restent conservés**. La déconnexion suit la suppression.

---

# 2. Gestion des équipes

> **Rôles réels** (corrigé) : `OWNER`, `CAPITAINE`, `MANAGER`, `COACH`, `TANK`, `DPS`, `HEAL`
> (cumulables, stockés en tableau JSON). Les rôles de **gestion** (OWNER, CAPITAINE, MANAGER)
> peuvent administrer l'équipe.

## 2.1 Administration d'équipe

🧪 Connecté et **sans équipe**, sur `/equipes`, un bouton (aux couleurs de la page, **orange**)
permet de **créer une équipe**.

🔧 Le formulaire de création accepte : **nom**, **description** (ajoutée), logo (optionnel).
Le créateur reçoit automatiquement le rôle `OWNER`.

🔧 L'admin d'équipe (rôles de gestion) peut :

- 🔧 **Inviter** des membres (système d'invitation, plus d'ajout forcé par pseudo) ;
- 🔧 **Kick** un membre (en tant que propriétaire / rôle de gestion) ;
- attribuer / retirer des rôles ✅ ;
- éditer le nom / le logo / 🔧 la description.

🔧 Le **propriétaire** peut **dissoudre l'équipe** (soft-delete) : le nom, la description et le
logo (données saisies) sont effacés et les membres détachés, mais la ligne et tout l'historique
généré par la plateforme (inscriptions, matchs, classements) sont **conservés à jamais**. Une
équipe dissoute disparaît de l'annuaire `/equipes` mais sa fiche reste consultable (stats), avec
un bandeau « Équipe dissoute » ; elle n'est plus rejoignable ni administrable.

## 2.2 Membre d'équipe

🔧 En tant qu'utilisateur connecté **sans équipe**, je peux **rejoindre** une équipe en
**self-service** (et/ou accepter une invitation reçue).

🔧 Une fois dans l'équipe, je peux la **quitter** à tout moment (un OWNER doit d'abord
transférer la propriété).

🔧 Quand je suis **membre ou propriétaire** d'une équipe, un **bouton d'accès rapide** à mon
équipe apparaît dans la nav, à côté de mon profil (haut droite).

---

# 3. Gestion des tournois

## 3.1 Administration des tournois

### Création et déroulé

🔧 En tant qu'**administrateur** (`is_admin` en base), je peux créer un tournoi via un
**bouton bleu** en haut de `/tournois`. 🔧 Ce bouton est **masqué pour les non-admins** et la
route API `/api/tournaments` (POST) **rejette** les non-admins.

🧪 La création se fait sur une **page** (`/tournois/creer`, corrigé : ce n'est pas une modale).
Champs : titre, description, jeu, nombre d'équipes max, format (**simple élimination** avec
petite finale optionnelle, **double élimination**), et dates de visibilité / ouverture
inscriptions / fermeture inscriptions / début.

✅ L'inscription d'une équipe n'est possible qu'entre ouverture et fermeture des inscriptions ;
l'arbre n'est visible qu'à partir de la date de début.

✅ À la génération, l'arbre s'adapte au nombre d'équipes et génère des **byes** pour combler
les trous.

🧪 À la date de début, l'arbre est dessiné, lisible, avec un tracé reliant chaque match au
suivant (sauf finale / grande finale).

🧪 Je peux cliquer sur n'importe quelle équipe pour rejoindre sa page équipe.

🧪 Le **vainqueur** d'un match avance au match suivant ; en simple élimination le perdant
n'avance pas.

🧪 En cas d'élimination, l'équipe a un **classement** visible sous l'arbre (ex. 64 équipes :
éliminés du 1er round = top 64, du round suivant = top 32, etc.).

🧪 À la fin : le vainqueur est **TOP 1**, le perdant de la finale **TOP 2**. Les statistiques
et l'historique des équipes se mettent à jour automatiquement.

### Scores

🧪 En tant qu'**administrateur**, je peux éditer le score des matchs en cours et de ceux qui
les précèdent **tant que le match suivant n'a pas commencé**.

🧪 En tant que **staff / propriétaire / rôle de gestion**, je peux modifier le score du match
que mon équipe joue ; une fois un **vainqueur désigné**, je ne peux plus revenir en arrière.
La modale de score permet : modifier + valider (réversible) **ou** valider + désigner le
vainqueur (fait avancer le tournoi, irréversible).

---

# 4. Recherche & annuaires (filtres) — *section ajoutée*

> Ces filtres existent déjà dans le code mais n'étaient pas couverts par le scénario.

## 4.1 Joueurs (`/joueurs`) ✅🧪

- Recherche par pseudo / équipe.
- Filtre par **rôle** : Tous, DPS, Tank, Heal, Coach.
- Filtre par **statut** : Tous, Free agents (sans roster).
- Tri : Pseudo, Tournois.
- 🧪 Cliquer un profil → page joueur publique (infos visibles, stats, historique).

## 4.2 Équipes (`/equipes`) ✅🧪

- Recherche par nom / région.
- Filtre par **jeu** : Toutes, Overwatch 2, Marvel Rivals.
- Tri : Classement, Nom, Victoires, Effectif.

## 4.3 Tournois (`/tournois`) ✅🧪

- Recherche (raccourci ⌘K / Ctrl+K).
- Filtre par **jeu** : Tous, Overwatch 2, Marvel Rivals.
- Sections par statut : En cours, Inscriptions ouvertes, Prochainement, Terminés.
