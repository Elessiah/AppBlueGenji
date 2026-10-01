# SonarQube typescript:S3776 — complexité cognitive

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Analyse

**SonarQube · code smell · critical · typescript:S3776** (94 occurrences, **11 corrigées**, **83 restantes**) — Cognitive Complexity of functions should not be too high (seuil 15). Tri du 2026-10-01 (feature/sonar-complexity) : seuls les cas d'extraction locale et sûre ont été réglés, sous tests existants ou ajoutés — validations pures (sponsors, recrutement, bénévoles, signalements, IPv6 privée), lecture des rapports CSP et d'`Accept-Encoding`, et quatre routes (forfait, signalement de problème, `scores`/`resolve` d'arbitrage : corps lu par `lib/shared/admin-score-body.ts`, refus traduits par une table). Familles laissées, volontairement : (1) **moteur et rejeu** (`lib/server/tournaments/*`, `lib/shared/bg-survie.ts`, `survival.ts`, `swiss*.ts`, `endurance-next-round.ts`, `tournament-phases.ts`, `ranking.ts`, `stats.ts`) — la complexité y reflète le domaine (formats, cascades, rejeux), et le risque de régression est élevé ; (2) **modules de règles** (`match-lock.ts`, `double-forfeit.ts`, `tournament-rollback.ts`, `content-reports.ts` serveur, `logo-quarantine.ts`, `account-identities.ts`, `oauth-flow.ts`, `database.ts`, `seed.ts`) — mêmes raisons, plus du SQL que seul `npm run seed` exerce ; (3) **gros composants de page** (`tournois/[id]/page.tsx`, `profil/page.tsx`, `TeamSettings.tsx`, `ReportProblemDialog.tsx`, `MatchLaunchCenter.tsx`, `TournamentForm.tsx`…) — à découper en sous-composants dans des refactors dédiés, pas en passant ; (4) routes d'API restantes (`teams/[id]/*`, `recruitment/[id]`) — chaînes de `if` de traduction d'erreurs, même remède que les quatre routes traitées (table de statuts), à faire avec leurs tests. Candidats prioritaires (score mesuré par eslint-plugin-sonarjs) : tournois/[id]/page.tsx:109 (98), bracket-double.ts:71 (77), bg-survie.ts:694 (73), match-launch-info.ts:277 (69), tournaments/validation.ts:226 (69), database.ts:196 (63), survival.ts:268 (62), stats.ts:358 (52), ReportProblemDialog.tsx:83 (51), tournament-phases.ts:326 (44). Pas de NOSONAR pour cette règle. — (rencontré sur : feature/sonarqube-docker-deploy-06e2c9)

## Occurrences (numéros de ligne relevés au moment de l'analyse)

- `app/(secured)/_shared/BgCanvas.tsx:105`
- `app/(secured)/equipes/[id]/_components/TeamSettings.tsx:48`
- `app/(secured)/joueurs/[id]/page.tsx:24`
- `app/(secured)/profil/ConnectedAppsSection.tsx:172`
- `app/(secured)/profil/DiscordVerificationDialog.tsx:58`
- `app/(secured)/profil/page.tsx:76`
- `app/(secured)/tournois/_components/TournamentForm.tsx:112`
- `app/(secured)/tournois/_components/TournamentForm.tsx:225`
- `app/(secured)/tournois/_lib/tournament-form-values.ts:224`
- `app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx:72`
- `app/(secured)/tournois/[id]/_components/GhostRegistrationDialog.tsx:49`
- `app/(secured)/tournois/[id]/_components/MatchLaunchStrip.tsx:40`
- `app/(secured)/tournois/[id]/_components/MatchLiveStrip.tsx:35`
- `app/(secured)/tournois/[id]/_components/MatchRow.tsx:48`
- `app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx:78`
- `app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx:70`
- `app/(secured)/tournois/[id]/_lib/live-state.ts:213`
- `app/(secured)/tournois/[id]/page.tsx:108`
- `app/(secured)/tournois/creer/PhaseCard.tsx:89`
- `app/api/recruitment/[id]/route.ts:13`
- `app/api/teams/[id]/invitations/route.ts:31`
- `app/api/teams/[id]/logo/route.ts:15`
- `app/api/teams/[id]/members/route.ts:14`
- `app/api/teams/[id]/route.ts:46`
- `app/benevoles/BenevolesSection.tsx:61`
- `app/recrutement/RecruitmentSection.tsx:85`
- `components/match-launch/MatchLaunchCenter.tsx:99`
- `components/notifications/PushNotificationsPanel.tsx:42`
- `components/reports/ReportProblemDialog.tsx:83`
- `lib/server/account-deletion-replay.ts:31`
- `lib/server/account-identities.ts:210`
- `lib/server/bot-docs.ts:116`
- `lib/server/content-reports.ts:585`
- `lib/server/database.ts:145`
- `lib/server/database.ts:196`
- `lib/server/database.ts:1790`
- `lib/server/logo-quarantine.ts:746`
- `lib/server/oauth-flow.ts:191`
- `lib/server/privacy-change-notifications.ts:176`
- `lib/server/remote-image-fetch.ts:95`
- `lib/server/seed.ts:588`
- `lib/server/seed.ts:1079`
- `lib/server/seed.ts:1215`
- `lib/server/seed.ts:1613`
- `lib/server/teams-service.ts:1187`
- `lib/server/tournament-broadcast.ts:409`
- `lib/server/tournaments/admin.ts:67`
- `lib/server/tournaments/admin.ts:413`
- `lib/server/tournaments/bg-survie.ts:817`
- `lib/server/tournaments/bg-survie.ts:965`
- `lib/server/tournaments/bot-logs.ts:819`
- `lib/server/tournaments/bracket-cascade.ts:106`
- `lib/server/tournaments/bracket-double.ts:72`
- `lib/server/tournaments/bracket-generator.ts:28`
- `lib/server/tournaments/bracket-single.ts:42`
- `lib/server/tournaments/edit.ts:214`
- `lib/server/tournaments/finalization.ts:379`
- `lib/server/tournaments/index.ts:663`
- `lib/server/tournaments/issue-reports.ts:73`
- `lib/server/tournaments/match-launch-info.ts:274`
- `lib/server/tournaments/match-reminders.ts:216`
- `lib/server/tournaments/match-replay.ts:40`
- `lib/server/tournaments/phases.ts:39`
- `lib/server/tournaments/phases.ts:213`
- `lib/server/tournaments/rollback.ts:288`
- `lib/server/tournaments/scoring.ts:230`
- `lib/server/tournaments/state.ts:53`
- `lib/server/tournaments/survival.ts:536`
- `lib/server/tournaments/swiss.ts:577`
- `lib/server/tournaments/validation.ts:57`
- `lib/server/tournaments/validation.ts:222`
- `lib/server/users-service.ts:1145`
- `lib/shared/bg-survie.ts:694`
- `lib/shared/double-forfeit.ts:77`
- `lib/shared/hooks/useDialogBehavior.ts:91`
- `lib/shared/stats.ts:330`
- `lib/shared/stats.ts:358`
- `lib/shared/survival.ts:268`
- `lib/shared/swiss.ts:118`
- `lib/shared/swiss.ts:238`
- `lib/shared/swiss.ts:331`
- `lib/shared/tournament-phases.ts:153`
- `lib/shared/tournament-phases.ts:326`
