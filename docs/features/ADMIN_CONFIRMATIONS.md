# Confirmations des gestes du staff

## Règle

Un geste du staff (arbitrage, modération, administration) qui **défait** quelque
chose — résultat, horaire, inscription, ordre, rôle, donnée — passe par une
modale de confirmation (`ConfirmActionDialog`, `components/ui/`, ou la modale
propre au geste quand il a des paramètres : `MODAL_DIALOGS.md`). Jamais
`window.confirm` : ESLint le refuse.

- La modale dit **concrètement** ce qui sera perdu ou changé, et ce qui ne
  l'est pas (« son horaire conservé »).
- **Pas de friction gratuite** : on ne demande que dans l'état où le geste
  défait réellement quelque chose, état déduit des données déjà reçues par le
  client (règle pure dans `lib/shared/` ou `_lib/`, testée). Un premier résultat,
  un réordonnancement déjà manuel partent sans question.
- Une rafale de gestes du même ordre (flèches du seeding) ne demande **qu'une
  fois** par séance.
- Annuler ne fait rien ; un refus du serveur laisse la modale ouverte
  (`onConfirm` rend `false`) pour réessayer ou renoncer.

## Ordre de départ (seeding)

**Constat** : réordonner ne touche **aucun horaire de match**. Les matchs ne
naissent qu'au coup d'envoi, et `reorderSeeding` refuse tout réordonnancement
dès qu'un match existe (`SEEDING_LOCKED_STARTED`) — l'ancienne régénération du
plateau a disparu. Ce que le geste défait réellement : sur un tournoi seedé par
le **classement du site** (`RANKING`), le premier réordonnancement pose
`manual_seeding = 1`, **sans retour** — le classement ne rangera plus la liste,
et les inscriptions suivantes s'ajoutent en fin de liste.

D'où `seedingReorderNeedsConfirmation(source)` (`lib/shared/seeding.ts`) : vrai
en `RANKING` seulement. La flèche met le geste en attente, la modale le joue ;
après un succès, `manualConfirmed` évite de redemander le temps que le détail
rapporte `MANUAL`.

## Correction d'un résultat validé

`AdminScoreDialog` : sur un match déjà tranché (`COMPLETED`, nul et double
forfait compris — `scoreCorrectionNeedsConfirmation`, `_lib/score-form.ts`),
« Valider le résultat » demande confirmation (« Enregistrer » y est déjà
désactivé, `canSave: false`, et refusé en `MATCH_ALREADY_COMPLETED` ; il passe
quand même par la même porte, `run`). La modale rappelle le résultat publié et
dit ce que `adminResolveMatch` défait : une rencontre suivante encore sans score
(sinon le serveur refuse en `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES`) peut
changer d'adversaire, son horaire conservé ; le classement est recalculé ; un
tournoi déjà terminé repasse en cours (`reopenAfterCascade`). Le texte reste
valable pour tous les formats, avec ou sans liens de plateau.

## Audit (2026-10-05)

| Geste | Ce qu'il peut défaire | Confirmation |
|---|---|---|
| Réordonner le seeding (flèches) | Passe l'ordre en manuel, sans retour (si `RANKING`) | **Ajoutée** (`RANKING` seulement, une fois) |
| Corriger le score d'un match tranché | Résultat publié, adversaire en aval, classement, tournoi terminé rouvert | **Ajoutée** (match `COMPLETED` seulement) |
| Retirer un engagé | Inscription | `RemoveEntrantDialog` |
| Retour en arrière d'un stade | Résultats du stade, palmarès | `RollbackRoundDialog` (liste les rencontres effacées) |
| Avancer l'état / lancer maintenant | Fenêtre d'inscription, tirage | `AdvanceTournamentDialog` |
| Supprimer un tournoi | Tout | `DeleteTournamentDialog` (nom recopié) |
| Lancement forcé d'un match | « Prêt » attendus | `ConfirmActionDialog` (`MatchLaunchStrip`) |
| Activer la planification en cours de tournoi | Lancements sans date, « Prêt » | `ConfirmActionDialog` (fiche) ; avertissement dans le formulaire d'édition |
| Pénalité d'endurance / retrait | Capital d'endurance | `EndurancePenaltyDialog` / `ConfirmActionDialog` |
| Forfait d'équipe | Matchs restants | `ConfirmActionDialog` |
| Modifier un tournoi | — (verrouillé au coup d'envoi) | aucune, inutile |
| Programmer / dater un match | Horaire (formulaire dédié, réversible) | aucune, inutile |
| Modération joueur (avatar, suspension, levée) | Compte, avatar | `ConfirmActionDialog` (`PlayerModerationBar`, motif requis) |
| Retirer le logo d'une équipe | Logo | `ConfirmActionDialog` (`ModerationLogoBar`, motif requis) |
| Purger un logo en quarantaine | Fichier | `ArmedButton` (deux temps) |
| Masquer / restaurer un logo signalé | — (réversible) | aucune, inutile |
| Rôles & permissions d'un joueur | Droits, administration comprise | **Ajoutée** (`ConfirmActionDialog` dès qu'un rôle est accordé ou retiré) |
| Supprimer membre du bureau, bénévole, annonce, carte « À propos », chiffre, partenaire | Donnée publiée (photo du bénévole effacée) | **Ajoutée** (`ConfirmActionDialog`, remplace `window.confirm`) |
| Retirer son tag Discord (`/profil`) | Tag et sa certification | **Ajoutée** (`ConfirmActionDialog`, remplace `window.confirm`) |
| Supprimer son compte (`/profil`) | Compte (texte selon l'aperçu de suppression) | **Ajoutée** (`ConfirmActionDialog`, remplace `window.confirm`) |

## Rôles de plateforme

`PlayerRolesPanel` : « Enregistrer les rôles » calcule l'écart
(`diffPlatformRoles`, `lib/shared/permissions.ts`). Sans écart, l'envoi part
sans question ; sinon la modale liste ce que le joueur **gagne** et **perd**,
rôle par rôle avec son périmètre (`ROLE_DESCRIPTIONS`), et souligne
l'administration accordée (tous les droits, dont retirer ceux de l'auteur) ou
retirée (ne restent que les rôles encore cochés). Ton `danger` dès qu'un rôle
est retiré ou que l'administration est accordée, `primary` sinon. Retirer
**son propre** accès est impossible : le panneau n'est pas rendu sur sa propre
fiche et la route refuse en `CANNOT_MODIFY_SELF` — aucune phrase dédiée.
