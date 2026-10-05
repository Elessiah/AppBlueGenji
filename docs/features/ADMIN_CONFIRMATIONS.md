# Confirmations des gestes du staff

## Règle

Un geste du staff (arbitrage, modération, administration) qui **défait** quelque
chose — résultat, horaire, inscription, ordre, rôle, donnée — passe par une
modale de confirmation (`ConfirmActionDialog`, ou la modale propre au geste
quand il a des paramètres : `MODAL_DIALOGS.md`). Jamais `window.confirm`.

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
« Enregistrer » comme « Valider le résultat » demandent confirmation. La modale
rappelle le résultat publié et dit ce que `adminResolveMatch` défait : l'équipe
qualifiée dans la rencontre suivante (encore sans score — sinon le serveur
refuse en `CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES`) est remplacée, son
horaire conservé, et le classement est recalculé.

## Audit (2026-10-05)

| Geste | Ce qu'il peut défaire | Confirmation |
|---|---|---|
| Réordonner le seeding (flèches) | Passe l'ordre en manuel, sans retour (si `RANKING`) | **Ajoutée** (`RANKING` seulement, une fois) |
| Corriger le score d'un match tranché | Résultat publié, équipe qualifiée en aval, classement | **Ajoutée** (match `COMPLETED` seulement) |
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
| Modération joueur (avatar, suspension, levée) | Compte, avatar | modale de `PlayerModerationBar` |
| Retirer le logo d'une équipe | Logo | modale de `ModerationLogoBar` |
| Purger un logo en quarantaine | Fichier | `ArmedButton` (deux temps) |
| Masquer / restaurer un logo signalé | — (réversible) | aucune, inutile |
| Rôles & permissions d'un joueur | Droits d'administration | **à faire** (lot suivant) |
| Supprimer membre du bureau, bénévole, annonce, carte « À propos », chiffre, partenaire | Donnée publiée | `window.confirm` — **à remplacer** (lot suivant) |

### Lot suivant

- `window.confirm` restants (`BureauSection`, `BenevolesSection`,
  `RecruitmentSection`, `AboutPillars`, `AboutStats`, `SponsorsGrid`, et le
  retrait du tag Discord sur `/profil`) : la modale de confirmation vit sous
  `tournois/[id]/_components/`, et trois variantes coexistent (`ConfirmActionDialog`,
  `equipes/[id]/_components/ConfirmDialog`, celle de `PlayerModerationBar`) —
  à unifier dans `components/ui/` avant de les remplacer.
- `PlayerRolesPanel` : confirmer quand l'enregistrement accorde ou retire le
  rôle administrateur.
