# Invitations d'équipe — le joueur visé prévenu (TEAM-INVITE-NOTIFY)

Trois gestes ne se voyaient que si le joueur visé ouvrait « Mon profil » ou la
fiche de son équipe : une **invitation** de la gestion d'une équipe, une
**reprise** d'équipe fantôme proposée par le staff (`claimGhostTeam`, une
invitation marquée `OWNER`, `GHOST_TEAMS.md`) et la **propriété** de son équipe
qu'un propriétaire vient de lui transférer (`transferTeamOwnership`, immédiate,
sans acceptation : seule la notification est nouvelle). Chacun part désormais en
notification push et en message privé Discord, sujet `TEAM_INVITATION`
(« Invitations d'équipe »).

## Modules

| Rôle | Fichier |
| --- | --- |
| Règle pure (qui, borne, message privé, lien) | `lib/shared/team-invite-notice.ts` |
| Texte du push (FR + EN) | `teamInvitationPush` (`lib/shared/push-messages.ts`, `messages/{fr,en}/pushMessages.json`) |
| Lecture et envoi | `lib/server/team-invite-notifications.ts` (`notifyTeamInvite`, `notifyTeamInviteInBackground`) |
| Points de départ | `inviteToTeam` (`lib/server/teams/invitations.ts`), `claimGhostTeam` (`lib/server/ghost-teams-service.ts`), `transferTeamOwnership` (`lib/server/teams/roster.ts`) |
| Transport | `notifyUsers` → push + `POST /internal/notify/dm` (bot, route existante : **aucun changement du bot**) |

## Quand

**Après** l'écriture validée seulement : l'instruction seule de `inviteToTeam`,
le `commit` de `claimGhostTeam`, la transaction de `withTeamRosterLock` pour le
transfert (qui lève avant tout envoi si elle est défaite). Jamais attendu par la
requête (`void … .catch`) : le geste est fait, le message n'est qu'un
avertissement. Une invitation qui valide une demande déjà en attente
(« JOINED ») n'annonce rien : le joueur a lui-même demandé.

## Qui reçoit

- Le joueur visé, s'il n'est ni l'**auteur** du geste, ni **supprimé**, ni
  **suspendu** (il ne peut pas se connecter pour répondre — même règle SQL que
  la session, `activeSuspensionSql`).
- Jamais pour une **entrée solo**, ni une équipe dissoute. Une invitation ou une
  propriété ne concerne qu'une équipe réelle ; une reprise, qu'une fantôme.
- Message privé : par un moyen **prouvé** seulement (identifiant Discord, ou tag
  certifié). Sinon le push seul.
- Invitation ordinaire : `TEAM_INVITE_NOTICES_DAILY_CAP` (10) joueurs
  distincts au plus dans la fenêtre de `TEAM_INVITE_NOTICE_COOLDOWN_HOURS`
  (24 h) — par équipe **et** par auteur, toutes ses équipes confondues (une
  équipe recréée ne repart pas de zéro) —, et un joueur ne reçoit l'invitation
  que de `TEAM_INVITE_NOTICES_PER_PLAYER_CAP` (3) équipes distinctes dans la
  fenêtre, pour que le bot ne soit pas classé comme spammeur. Une équipe dont
  le joueur a été membre (ligne `bg_team_members`, partie comprise) n'entre
  pas dans ce dernier plafond, dans les deux sens : elle n'est pas comptée
  parmi les équipes qui le sollicitent (`NOT EXISTS` dans `teams_to_player`),
  et son invitation passe même au-delà de trois équipes inconnues
  (`formerMember`, lu par une requête à part). L'invitation, elle, est
  toujours enregistrée.
- Reprise proposée par le staff : les mêmes plafonds qu'une invitation : 10
  joueurs distincts par auteur, 3 fantômes distinctes par joueur, ancienne
  équipe exemptée (`GhostClaimNoticeBudget`, une seule requête).
- **Une fois par sorte, équipe et joueur** dans la fenêtre (invitation retirée
  puis renvoyée, reprise refaite, propriété que deux membres se renvoient) :
  réservation en mémoire `claimTeamNoticeSlot` (clé `sorte:équipe:joueur`,
  20 000 entrées au plus). Comptée sur les avis **partis**, pas sur les lignes
  écrites : une invitation restée muette (compte suspendu, plafond atteint) ne
  retient plus l'avis suivant de la même équipe. Elle se prend une fois l'avis
  décidé et se rend si rien n'a été remis (bot tombé sans appareil, ou erreur :
  `releaseTeamNoticeSlot`) ; un redémarrage l'oublie (au pire un avis de plus).
- **Plafond du site** : `TEAM_NOTICE_DMS_HOURLY_CAP` (60) messages privés
  d'équipe par heure, tous comptes confondus (`claimTeamNoticeDmSlot`, en
  mémoire) — les plafonds par compte ne bornent pas N comptes jetables. Au-delà,
  le push seul : rien ne part sur Discord, l'invitation reste sur « Mon profil ».
  Une place prise pour un message privé qui n'est pas parti (bot injoignable,
  envoi refusé, erreur) est rendue (`releaseTeamNoticeDmSlot`, dans la même
  fenêtre seulement) : une panne du bot n'épuise pas le plafond.
- `claimGhostTeam` envoie l'avis **après** sa transaction et son `finally` : un
  rédacteur qui lève ne peut pas défaire la reprise validée.
- Les plafonds en base comptent les **tentatives** (lignes écrites,
  l'invitation qui vient d'être enregistrée comprise) : un compte qui invite en
  boucle reste borné même quand ses invitations ne font rien partir.

## Ce que dit le message

Le **nom de l'équipe seul** (`discordInline` sur Discord : ni mention, ni lien,
ni balisage), jamais le pseudo ni le `#id` de qui invite, propose ou transfère.
Une reprise dit « Tu peux reprendre l'équipe [nom](lien) » / "You can take
over the team [name](link)" — le nom de l'équipe seul, sans « un admin »
(décision D4 de l'utilisateur, 2026-11-09) : le nom en lien masqué vers `/profil#invitations`, ses crochets et
parenthèses échappés par `discordInline` ; le push dit la même phrase sans lien.
Langue du compte (`BOT_DM_LANGUAGE.md`), bilingue si elle est illisible. Lien :
`/profil#invitations` pour répondre (invitation, reprise), `/equipes/[id]` pour
la propriété — `/en/…` pour un compte anglais (`localizedSiteUrl`,
`localeHref`). Étiquette du push : `team-<id>-invite` / `team-<id>-owner`.

## Bot injoignable

`notifyUsers` rend `discord: null` : une ligne pm2 sans donnée de joueur
(`[teams] bot injoignable : message privé d'équipe non remis (INVITE)`), le push
part quand même. Une base indisponible pendant la lecture : une ligne pm2
(`failureReason`), rien d'autre.

## Juridique

Registre T03 (sous-finalité et destinataire Discord) et T12 (sujet push) ;
`/rgpd` FR + EN (section « Notifications push », liste des messages privés du
moyen Discord) ; `PRIVACY_CHANGES` `2026-11-invitations-equipe-notifiees`
(datée du 2026-11-05, lendemain de la nuit de déploiement prévue — à avancer si
la fusion glisse). Rien de nouveau n'est collecté ni conservé.

## Tests

`tests/lib/shared/team-invite-notice.test.ts`,
`tests/lib/server/team-invite-notifications.test.ts`, déclencheurs dans les
tests des trois services.
