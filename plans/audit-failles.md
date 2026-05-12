# Audit des failles

Contexte: audit du projet réalisé le 12 mai 2026. Les tests et le build passent, mais plusieurs failles ou fragilités métier ont été identifiés.

## 1. Brute-force possible sur le login Discord

- **Gravité**: élevée
- **Zone concernée**: `app/api/auth/discord/request/route.ts`, `app/api/auth/discord/verify/route.ts`, `lib/server/users-service.ts`
- **Description**: le code de connexion Discord est un code à 6 chiffres valide 10 minutes. Le compteur `attempts` est bien stocké en base, mais il n’est jamais utilisé pour bloquer ou ralentir les essais après plusieurs échecs.
- **Impact**:
  - Un attaquant qui connaît le `discordId` peut tenter un grand nombre de combinaisons.
  - Le risque augmente si l’API n’est pas protégée par un rate limit externe.
  - Cela peut mener à une prise de session non autorisée.
- **Pourquoi c’est un problème**:
  - Le secret est court.
  - Le service accepte un nombre illimité d’essais pendant toute la fenêtre de validité.
  - Le compteur d’échecs n’a pas d’effet défensif réel.
- **Correction recommandée**:
  - Bloquer la vérification après un seuil d’échecs.
  - Ajouter un délai progressif entre les tentatives.
  - Invalider le challenge après trop d’erreurs.
  - Ajouter un rate limit côté route API.

## 2. Open redirect dans le flux Google OAuth

- **Gravité**: moyenne
- **Zone concernée**: `app/api/auth/google/start/route.ts`, `lib/server/auth.ts`, `app/api/auth/google/callback/route.ts`
- **Description**: le paramètre `redirect` est stocké tel quel dans le cookie d’état OAuth, puis réutilisé au retour de Google sans validation de destination.
- **Impact**:
  - Un utilisateur peut être redirigé vers une URL externe après authentification.
  - Cela peut être utilisé pour du phishing ou pour détourner le trafic après login.
  - Même si ce n’est pas une exfiltration directe, c’est une faiblesse de confiance sur un point très sensible.
- **Pourquoi c’est un problème**:
  - La redirection est acceptée sans liste blanche.
  - Le callback reconstruit l’URL via `new URL(...)`, ce qui permet de suivre une cible absolue.
  - Le flux d’authentification amplifie l’impact car la redirection se fait juste après la connexion.
- **Correction recommandée**:
  - N’autoriser que des chemins relatifs internes.
  - Rejeter toute URL absolue ou tout chemin hors de l’application.
  - Normaliser systématiquement la destination sur un préfixe interne, par exemple `/`.

## 3. Dépassement possible de `max_teams` lors des inscriptions aux tournois

- **Gravité**: moyenne
- **Zone concernée**: `lib/server/tournaments-service.ts`
- **Description**: l’inscription vérifie d’abord le nombre d’équipes déjà inscrites, puis insère la nouvelle inscription. Cette logique n’est pas protégée par un verrou fort ou une contrainte de capacité en base.
- **Impact**:
  - Deux requêtes simultanées peuvent passer la vérification au même moment.
  - Le tournoi peut accepter plus d’équipes que prévu.
  - Le bracket généré ensuite peut être incohérent avec la taille maximale attendue.
- **Pourquoi c’est un problème**:
  - Le contrôle est fait en lecture avant écriture.
  - Il n’existe pas de contrainte SQL qui empêche strictement le dépassement.
  - La transaction seule ne suffit pas à éliminer le race condition si le niveau d’isolation ne verrouille pas la plage utile.
- **Correction recommandée**:
  - Verrouiller la ligne ou le tournoi pendant l’inscription.
  - Ajouter une contrainte ou un mécanisme atomique côté base.
  - Réaliser l’incrémentation et la vérification dans une opération unique.
  - Ajouter un test de concurrence pour reproduire le cas.

## 4. Mise à jour partielle du profil qui réinitialise des champs de visibilité

- **Gravité**: moyenne
- **Zone concernée**: `app/(secured)/profil/page.tsx`, `app/api/profile/route.ts`, `lib/server/users-service.ts`
- **Description**: l’UI du profil n’envoie que `overwatch`, `marvel` et `major` dans l’objet `visibility`, alors que le backend attend aussi `avatar` et `pseudo`. Lors d’une sauvegarde, les champs non envoyés sont écrasés avec `null`.
- **Impact**:
  - Une simple modification du profil peut remettre à zéro des préférences de confidentialité.
  - L’utilisateur peut perdre la visibilité choisie pour l’avatar ou le pseudo sans le vouloir.
  - Le bug est silencieux, donc difficile à diagnostiquer.
- **Pourquoi c’est un problème**:
  - Le contrat front/back n’est pas aligné.
  - Le backend traite l’absence de champ comme une volonté de suppression.
  - La sauvegarde du profil devient destructive sur des valeurs qui devraient être préservées.
- **Correction recommandée**:
  - Envoyer toutes les clés de visibilité depuis le front.
  - Ou changer le backend pour ne mettre à jour que les clés explicitement présentes.
  - Ajouter un test d’intégration qui vérifie qu’une sauvegarde partielle ne modifie pas les autres préférences.

## 5. Absence de protection explicite sur certains endpoints sensibles

- **Gravité**: faible à moyenne, selon l’exposition réseau
- **Zone concernée**: `app/api/bot/stats/route.ts`, `app/api/landing/*`
- **Description**: certains endpoints publics exposent des métriques ou des données de landing sans authentification. Ce n’est pas forcément une faille si c’est volontaire, mais cela mérite une revue explicite.
- **Impact**:
  - Divulgation de métriques d’usage ou de disponibilité.
  - Surface d’attaque plus large si l’endpoint interne est accessible hors du réseau attendu.
- **Pourquoi c’est à surveiller**:
  - Le code ne montre pas de garde d’accès dédiée.
  - La sécurité dépend alors entièrement de la topologie réseau et des variables d’environnement.
- **Correction recommandée**:
  - Confirmer si ces routes doivent être publiques.
  - Si non, ajouter une authentification ou une vérification d’origine stricte.
  - Documenter clairement les endpoints exposés volontairement.

## Priorité conseillée

1. Corriger le login Discord.
2. Corriger l’open redirect OAuth.
3. Sécuriser l’inscription concurrente aux tournois.
4. Corriger la sauvegarde partielle du profil.
5. Revoir les endpoints publics à vocation interne.
