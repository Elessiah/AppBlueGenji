# Index des fonctionnalités

Une ligne par document de `docs/features/`, rangée par domaine. Lire le document pointé avant de toucher la fonctionnalité ; une fonctionnalité nouvelle ajoute ici sa ligne dans la PR qui crée son document.

## Moteur de tournoi (`lib/server/tournaments-service.ts`)

- `SURVIVAL_MODE.md` — Survie (`SURVIVAL`) : groupe unique, coupes des 2 derniers, rejeu complet depuis les matchs.
- `SWISS_MODE.md` — Ronde suisse : rondes fixes, appariement par retour sur trace, départages.
- `MULTI_PHASE_TOURNAMENTS.md` — Multi-phases (`MULTI`) : 2 à 8 phases, qualification fixe ou en pourcentage, plan re-résolu à chaque fin de phase.
- `BG_SURVIE_MODE.md` — BlueGenji Survie (`BG_SURVIE`) : capital d'endurance, plafond de manches, arbre final imposé.
- `ENDURANCE_NEXT_ROUND_PREVIEW.md` — BG Survie : aperçu, pour l'arbitrage, des rencontres de la manche suivante acquises quel que soit le score.
- `ENDURANCE_PENALTIES.md` — BG Survie : pénalités, entrées du rejeu, qui se **retirent** (jamais une pénalité inverse).
- `ENDURANCE_ROUND_PANELS.md` — BG Survie : un volet par manche, vrai arbre des play-offs.
- `ROUND_MATCH_SECTIONS.md` — Matchs d'une manche (BG Survie, Survie, suisse) rangés en cinq sections d'état séparées par un filet, triés par date puis tête de série.
- `SOLO_TOURNAMENTS.md` — Tournoi individuel (`SOLO`) : entrée solo par joueur, `resolveUserEntrantTeamId`.
- `MATCH_FORMAT.md` — Format de match BO/FT, `checkMatchScores` unique client/serveur.
- `MATCH_DRAWS.md` — Matchs nuls et plafond de maps : `isMatchPlayed`, `isMatchDrawn`, `matchWinnerSide`.
- `REGISTRATION_FILTERS.md` — Conditions d'inscription : effectif minimal, Discord certifié, compte Blizzard.
- `UNDERFILLED_TOURNAMENTS.md` — Tournoi sans adversaires : 0 ou 1 engagée au coup d'envoi → clos.
- `MATCH_LAUNCH.md` — Lancement d'un match : lobby, trois « Prêt », contacts, inscription du caster.
- `MATCH_PLANNING.md` — Planification des matchs par l'arbitrage (`TO_PLAN`).
- `SCORE_EDIT_LOCK.md` — Verrouillage d'un score dès que la manche suivante porte une saisie, **y compris pour un admin**.
- `DOUBLE_FORFEIT.md` — Double forfait et ses cascades dans un arbre.
- `FINISHED_TOURNAMENT_RECONCILIATION.md` — Corriger un tournoi terminé : le classement se rejoue, le tournoi ne se rouvre pas.
- `SCORE_EDIT_DIALOG.md` — Dialogue d'arbitrage : « Enregistrer » (avancement) vs « Valider le résultat » (propagation).
- `PLAYER_SCORE_ENTRY.md` — Saisie, confirmation et contestation du score par un joueur ; forfait sur la manche.
- `MAP_SCORES.md` — Saisie du score map par map (code de replay + score de map), score du match dérivé dans le circuit existant.
- `TOURNAMENT_PREVIEW.md` — Aperçu du plateau pendant les inscriptions (staff et cast), sans écriture.
- `SEEDING_ORDER.md` — Ordre de seeding aux flèches ↑ / ↓, figé au coup d'envoi.
- `ENTRANT_REMOVAL.md` — Retrait d'un engagé, jusqu'au coup d'envoi seulement.
- `TOURNAMENT_EDITING.md` — Édition après création : fenêtres `FULL` / `RESTRICTED` / `LOCKED`.
- `EARLY_TOURNAMENT_LAUNCH.md` — Avancer le tournoi d'une étape : on ne fait jamais avancer une date, seulement la reculer.
- `ROUND_ROLLBACK.md` — Retour en arrière d'un stade, répétable, tous formats.
- `TOURNAMENT_DELETION.md` — Suppression définitive : seul contrôle sur `user.isAdmin`.
- `HIDDEN_TOURNAMENTS_SECTION.md` — Section « Tournois invisibles » de `/tournois`, réservée à `tournaments`.
- `TOURNAMENT_VISIBILITY_ACCESS.md` — Fiche d'un tournoi non publié : 404 hors permission `tournaments`.
- `BYE_FUNCTIONALITY.md` — Exemptions (byes) des effectifs non puissances de deux.
- `VARIABLE_SIZE_TOURNAMENTS.md` — Taille variable des arbres.
- `TOURNAMENT_SYNC_SCOPE.md` — Entretien de fond : seuls les tournois qui ont quelque chose à faire, une transaction par tournoi.
- `REALTIME_REFRESH.md` — Flux SSE, instantané commun + contexte du lecteur, paliers de fraîcheur, caches.

## Pages et interface des tournois

- `TOURNAMENT_HEADER.md` — En-tête de la fiche : outils du lecteur, identité, faits, actions.
- `TOURNAMENT_PAGE_PATH.md` — Arrivée, retour et confirmations de la fiche tournoi.
- `ADMIN_CONFIRMATIONS.md` — Audit des gestes du staff qui défont quelque chose, et quand ils se font confirmer.
- `TOURNAMENT_PROGRESS.md` — Frise de progression, de masqué à terminé.
- `TOURNAMENT_LIST_CARDS.md` — Cartes de la liste `/tournois`.
- `TOURNAMENT_LIST_TOOLBAR.md` — Recherche, filtres et sections de `/tournois`.
- `MY_TOURNAMENTS_SECTION.md` — « Mes tournois » en tête de `/tournois`, sommaire.
- `TOURNAMENT_IMAGE.md` — Illustration ou logo d'un tournoi, cadrage au rendu.
- `TOURNAMENT_ENTRANT_LOGOS.md` — Logos des engagés, rendus par `EntrantName`.
- `TOURNAMENT_MATCH_CARD_STYLES.md` — Carte de match et fiche de tournoi sur les jetons.
- `MATCH_CARD_LAYOUT.md` — Carte de match lisible : engagés et score d'abord, zone d'état, une action principale + « Plus d'actions » (inventaire par public).
- `TOURNAMENT_RULES_SETTINGS.md` — Réglages d'un tournoi affichés sur sa page de règles.
- `RULES_PAGE_LAYOUT.md` — Mise en page des pages de règles `/regles/[slug]` ; teinte de chaque mode (carte, page, schémas).
- `BRACKET_SECTIONS.md` — Sections repliables de l'arbre.
- `BRACKET_SLOT_HEIGHT.md` — Hauteur des créneaux de l'arbre à élimination.
- `LANDING_ANIMATIONS.md` — Animations de l'accueil (apparition au défilement, décompte, éclats, reflet, pastille d'attente) sous la porte unique du régime de charge ; plan des lots de couleur suivants.
- `FEATURED_MATCH_LINK.md` — Match mis en avant sur l'accueil (choix, jamais « À planifier ») et lien profond vers un match (`#match-<id>`).

## Authentification et comptes

- `AUTH_SYSTEM.md` — Sessions, portes d'entrée sans mot de passe, quotas du code Discord, provenance des écritures.
- `OAUTH_PROVIDERS.md` — OAuth Google / Discord / Blizzard, une seule mécanique ; rattachement depuis le profil.
- `DISCORD_VERIFICATION.md` — Certification du tag Discord, visibilité du tag.
- `SESSION_REVOCATION.md` — Fermer ses autres sessions.
- `SAFE_LOGIN_REDIRECT.md` — Destination d'après connexion : chemin du site seulement.
- `SECURITY_HEADERS_CSP.md` — En-têtes de sécurité et CSP en application (page cassée : lire `/api/csp-report`).
- `DEV_AUTH_BYPASS.md` — `DEV_AUTH_USER_ID`, en développement seulement.
- `PERMISSION_ROLES.md` — Rôles de plateforme cumulables et permissions `can(user, …)`.
- `PROFILE_SCREEN.md` — Écran « Mon profil ».
- `ACCOUNT_MENU.md` — Menu du compte, hauteur des barres de navigation.
- `ACCOUNT_DELETION.md` — Suppression d'un compte : effacement ou anonymisation.
- `ACCOUNT_SUSPENSION.md` — Suspension d'un compte.
- `USER_AVATAR_IMPORT.md` — Photos OAuth copiées chez nous, jamais relayées.
- `USER_AVATAR_DISPLAY.md` — `<UserAvatar>`, repli à initiale, `visibleAvatarUrl`.
- `PLAYER_ROSTER_STATUS.md` — Statut d'appartenance d'un joueur (`ROSTER`, `FREE_AGENT`, `UNAFFILIATED`).

## Équipes

- `TEAM_MANAGEMENT_PAGE.md` — Fiche d'équipe en mode gestion, invitations, rôles.
- `TEAM_TAG.md` — Sigle d'équipe unique, facultatif.
- `TEAM_DIRECTORY_LOGOS.md` — Logos dans l'annuaire `/equipes`.
- `TEAM_JOIN_REQUEST_NOTIFICATION.md` — Demande d'adhésion annoncée à la gestion sur Discord.
- `GHOST_TEAMS.md` — Équipes fantômes et inscription en lot.
- `ENTITY_LINKS.md` — Noms cliquables : `TeamLink`, `PlayerLink`, `EntrantLink`.

## Classements et statistiques

- `DEEP_STATS.md` — Statistiques approfondies des fiches équipe et joueur.
- `TEAM_RANKING_POINTS.md` — Points d'équipe : une seule source, `loadTeamRanking`.
- `ELO_RANKING.md` — Cote de type Elo, rejouée depuis les matchs.
- `RANKING_PAGE.md` — Page `/classement` (podium, tableau, filtres par jeu, en-tête selon la session) et règle d'ordre du classement.
- `TOURNAMENT_PLACEMENT_POINTS.md` — Points de parcours selon le rang final.

## RGPD, légal et modération

- `RGPD_DATA_RIGHTS.md` — Données, consentement et droits des utilisateurs.
- `PRIVACY_CHANGES_CONSENT.md` — `PRIVACY_CHANGES` : annoncer tout changement de traitement.
- `PROCESSING_REGISTER.md` — Registre des traitements publié (`/rgpd/registre`).
- `RGPD_LOGS_AND_VISITS.md` — Journaux Discord et visites sans données nominatives.
- `CONNECTION_LOGS.md` — Journal des données de connexion (LCEN).
- `BACKUP_DATA_PROTECTION.md` — Sauvegardes chiffrées et journal des suppressions.
- `SITE_VISIT_STATS.md` — Fréquentation du site, empreintes salées.
- `CONTENT_REPORTS.md` — Signalements, contestations, panneau de modération.
- `LOGO_QUARANTINE.md` — Quarantaine des images signalées.
- `TERMS_OF_USE.md` — Conditions d'utilisation et leur acceptation.
- `LEGAL_PAGE.md` — Mentions légales, coordonnées protégées (`ProtectedContact`).
- `BOT_LEGAL_PAGES.md` — Pages légales bilingues du bot.
- `LICENSE_SOURCE_CODE.md` — Licence AGPL et lien « Code source ».
- `UNTRUSTED_NAMES.md` — Noms saisis (`visibleText`) et textes vers Discord (`discordInline`, `discordQuote`).

## Interface et accessibilité

- `DESIGN_SYSTEM.md` — « Cyber minimal » : jetons, primitives `components/cyber/`.
- `BACKGROUND_NEON_REFRESH.md` — Fonds noirs à éclats bleutés, néon de navigation.
- `TYPOGRAPHY.md` — Polices hébergées, plancher de taille.
- `RESPONSIVE_TABLES.md` — Tableaux `.table-row` libellés par `data-label`.
- `MODAL_DIALOGS.md` — Modales : portail, `useDialogBehavior`, `useBackdropDismiss`.
- `NUMBER_INPUT.md` — `<NumberInput>`.
- `CHECKBOX_STYLES.md` — Cases à cocher et radios.
- `TAP_SELECTION.md` — Sélection de texte au toucher, `data-tap-zone`.
- `IMAGE_CROP.md` — Recadrage manuel de toute image importée.
- `LOCAL_UPLOAD_URLS.md` — Une image servie vient du site (`localUploadUrl`).
- `CLIENT_POWER_MODES.md` — Régime de charge du navigateur, `--deco-anim-state`.
- `ACCESSIBILITY_MENU.md` — Menu d'accessibilité et pauses.
- `ACCESSIBILITY_QUICK_WINS.md` — Lien d'évitement, titres, langue, page courante.
- `ACCESSIBILITY_LANDMARKS_FOCUS.md` — Repères des pages vitrine, focus des champs.
- `ACCESSIBILITY_FORM_ERRORS_STATEMENT.md` — Erreurs rattachées aux champs, déclaration d'accessibilité.
- `ACCESSIBILITY_SCROLL_AREA_FOCUS.md` — `<ScrollArea>` focalisable seulement quand elle défile.
- `ACCESSIBILITY_ARIA_AND_ENTITY_TITLES.md` — Rôles ARIA de la fiche tournoi, titres des fiches.
- `ACCESSIBILITY_RECRUITMENT_BANNER_LINK.md` — Lien « Voir » de la banderole de recrutement.
- `ERROR_PAGES_AND_ANCHORS.md` — Pages d'erreur, ancres sous l'en-tête collant.
- `PUBLIC_NAVIGATION.md` — Menu burger et pied de page de la vitrine.
- `CARD_REORDERING.md` — Réordonnancement des cartes (bureau, association, partenaires).

## Vitrine

- `EDITABLE_SITE_COPY.md` — Textes éditables (`site-copy.ts`, `<EditableCopy>`).
- `LANDING_HERO_FOLD.md` — Accueil en desktop : l'appel principal au premier écran.
- `LANDING_MOBILE_LAYOUT.md` — Accueil en mobile.
- `LANDING_LEADERBOARD.md` — Classement de l'accueil.
- `LANDING_CALENDAR_LINKS.md` — Événements de l'accueil cliquables.
- `LANDING_TOURNAMENT_BOARD.md` — Tableau des tournois de l'accueil.
- `ABOUT_PILLARS_MANAGEMENT.md` — Piliers de « L'association ».
- `ABOUT_STATS_MANAGEMENT.md` — Cartes chiffrées de « L'association ».
- `BUREAU_MANAGEMENT.md` — Gestion du bureau.
- `BENEVOLES_MANAGEMENT.md` — Gestion des bénévoles.
- `SPONSOR_MANAGEMENT.md` — Gestion des partenaires.
- `SPONSOR_LOGO_PROXY.md` — Logos de partenaires servis depuis notre origine.
- `SPONSOR_CARDS.md` — Cartes partenaires.
- `DISCORD_COMMUNITY.md` — Invitation Discord unique et compteur de membres.
- `RECRUITMENT.md` — Annonces de recrutement et statut d'importance.
- `SEO.md` — `robots.txt`, sitemap, JSON-LD.
- `SHARE_METADATA.md` — Aperçu des liens partagés.
- `WEB_APP_MANIFEST.md` — Manifeste, `minimal-ui`, écrans de lancement iOS.

## Bot, Discord et diffusion

- `BOT_INTEGRATION.md` — Appels app → bot, flux d'activité anonymisé.
- `BOT_PAGE.md` — Pages `/bot` et `/bot/docs`.
- `BOT_FEATURES_NEEDED.md` — Fonctionnalités à développer côté bot.
- `DISCORD_NOTIFICATIONS.md` — Rappels de match et signalement d'un problème.
- `BOT_ACTIVITY_LOG.md` — Journal d'activité : une ligne par fait accompli.
- `REFEREE_ALERTS.md` — Alertes au rôle arbitre.
- `PUSH_NOTIFICATIONS.md` — Notifications push, registre `PUSH_TOPICS`, `notifyUsers` / `notifyStaff`.
- `LIVE_STREAMS.md` — Diffusion en direct, vocabulaire « En cours » / « En direct ».
- `MATCH_START_DATES.md` — Dates de début des matchs (saisie jour/mois/demi-heure, 21:00 par défaut, année déduite).
- `MATCH_REPLAYS.md` — Rediff YouTube d'un match terminé.

## Infra et outillage

- `MIGRATION_LOCK.md` — Migrations sous verrou nommé.
- `VERSIONING.md` — Bump, tag et release automatiques à la fusion.
- `DEPENDENCY_RISKS.md` — Avis npm audit restants (`braces`, `deepmerge`), surcharges (`uri-js`, `sprintf-js`) et règle du lockfile Windows.
