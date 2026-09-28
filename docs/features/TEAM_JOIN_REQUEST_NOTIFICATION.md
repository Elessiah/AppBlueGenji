# Demande d'adhésion — la gestion de l'équipe prévenue sur Discord

Une demande d'adhésion (`bg_team_invitations.kind = 'REQUEST'`) ne se voyait que
sur la fiche de l'équipe, à qui pensait à l'ouvrir : un joueur pouvait attendre
des jours une réponse que personne ne savait devoir donner. Dès qu'elle est
enregistrée, le bot écrit désormais en message privé à ceux qui **ont qualité
pour y répondre**.

## Modules

| Rôle | Fichier |
| --- | --- |
| Règle pure (destinataires, borne, message) | `lib/shared/team-join-request-notice.ts` |
| Lecture et envoi | `lib/server/team-join-notifications.ts` |
| Point de départ | `requestToJoinTeam` (`lib/server/teams-service.ts`) |
| Transport | `pushDiscordDirectMessages` → `POST /internal/notify/dm` (bot, route existante) |

## Qui reçoit

- **Le propriétaire et les managers** (`OWNER`, `MANAGER` — `hasTeamManagementRole`),
  membres **actuels** (`left_at IS NULL`) d'un compte non supprimé : c'est la
  paire qui accepte ou refuse la demande. Un capitaine, un coach ou un joueur ne
  reçoit rien — il n'aurait aucun geste à faire.
- Joignables par un moyen **prouvé** seulement : identifiant Discord, ou tag
  **certifié**. Un tag saisi à la main peut désigner n'importe qui.

## Ce que dit le message

Le nom de l'équipe et le lien de sa fiche (`/equipes/[id]`), où la demande
s'accepte ou se refuse. **Aucun pseudo de joueur**, règle de tous les messages
Discord du site (`docs/features/RGPD_LOGS_AND_VISITS.md`) : le demandeur se lit
sur la fiche, derrière une connexion.

## Borne anti-répétition

Une demande se retire (`DELETE /api/invitations/[id]`) et se redépose ; sans
borne, le bouton « Rejoindre » ferait vibrer le téléphone du propriétaire en
boucle. Le bot n'écrit donc que si la demande est la **seule** de ce joueur à
cette équipe depuis `TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS` (24 h), tous statuts
confondus. La demande, elle, est toujours enregistrée : seul le message est
retenu. Aucune table de plus — les lignes de `bg_team_invitations` suffisent à
compter.

La borne par équipe ne borne pas le **nombre** d'équipes : un compte — gratuit
par OAuth — demandait à rejoindre chaque équipe du site et faisait écrire le bot
à toutes leurs gestions dans la journée. D'où un second plafond, toutes équipes
confondues : au plus `TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP` (5) demandes du même
joueur dans la fenêtre donnent un message ; au-delà, elles sont enregistrées et
visibles sur les fiches, sans message. Les deux comptes se lisent en une seule
requête (`SUM(team_id = ?)`, `COUNT(*)`), et `shouldNotifyTeamJoinRequest` les
juge ensemble.

## Ce qui ne déclenche rien

- Une demande qui **rejoint directement** l'équipe (une invitation l'attendait) :
  il n'y a plus rien à trancher.
- Une demande refusée (équipe fantôme, entrée solo, dissoute, joueur déjà en
  équipe, demande déjà en attente).

## Dégradation

Meilleur effort, jamais attendu : la demande est déjà écrite quand le message
part, et un bot injoignable (ou le coupe-circuit ouvert) la laisse intacte — la
gestion la verra sur la fiche. Un échec est journalisé dans pm2.

## Données personnelles

Nouvel usage de l'identifiant Discord / du tag certifié : déclaré au registre
(T03), dans la politique (`rgpd-policy.ts`, ligne « ID Discord ») et par une
entrée de `PRIVACY_CHANGES` (`2026-09-demande-adhesion-discord`).
