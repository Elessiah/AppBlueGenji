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
`termsAccepted` dans le corps du code Discord et de Google One Tap. **Un compte
neuf sans acceptation est refusé** (`TERMS_REQUIRED`) ; un compte existant se
connecte toujours.

Recevoir la main sur une équipe (propriété transférée, rôle de gérant, fantôme
confiée) ne passe par aucun geste de celui qui la reçoit. La mise en page racine
pose donc la question à chaque chargement (`needsTermsForTeamManagement`) et
présente les conditions ; « Plus tard » ferme la fenêtre, mais les gestes de
gestion restent refusés en **409 `TERMS_ACCEPTANCE_REQUIRED`**, et ce refus
rouvre la fenêtre (`TERMS_REQUIRED_EVENT`).

## Gestes de gestion soumis aux conditions

Nom, sigle et description ; envoi d'un logo ; rôles ; exclusion ; invitation ;
acceptation d'une demande d'adhésion ; transfert de propriété. **Pas** : retirer
un logo (le geste qu'on veut voir faire à qui doute de ses droits), refuser une
demande, dissoudre l'équipe, et rien de ce que fait le staff sur une fantôme.

## Envoi d'un logo

Case « Je certifie détenir les droits sur ce logo » (`LOGO_RIGHTS_FIELD`),
exigée par la route (`LOGO_RIGHTS_NOT_CERTIFIED`, 400) **avant** tout traitement
du fichier. Décochée après chaque envoi : chaque image certifiée est la sienne.

## Données

`bg_users.terms_version` / `terms_accepted_at` (dernière acceptation, consultée
avant un geste) et `bg_terms_acceptances` (la preuve : version, contexte, date).
Rendues par l'export RGPD, effacées à l'anonymisation.
