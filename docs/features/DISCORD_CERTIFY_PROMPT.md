# Certification du tag Discord proposée à la connexion

> `lib/shared/discord-certify-prompt.ts` (pur) · `lib/server/users/discord-certify-prompt.ts` ·
> `POST /api/profile/discord/certify-prompt` · `components/discord/DiscordCertifyPrompt.tsx` ·
> `app/(secured)/profil/useCertifyRequest.ts`

Demande du 2026-10-21 : dès l'inscription et à chaque connexion, une fenêtre
**propose** la certification du tag Discord, avec ses effets en un tableau, et
un bouton « Ne plus voir ». Portée élargie le même jour aux connexions Blizzard.

## Une proposition, pas un consentement arraché

La certification reste un geste spécifique (RGPD, art. 4.11 et 7.4 —
`DISCORD_VERIFICATION.md`) : la fenêtre ne coche rien, se connecter ne certifie
toujours rien, et « Plus tard » / « Ne plus voir » ne coûtent rien. Seul le clic
sur « Certifier mon tag » certifie, par la route existante.

## Qui la voit, et quand

| Condition | Où elle est tenue |
| --- | --- |
| Session ouverte par **Discord** (bouton OAuth, code en message privé) ou **Blizzard** — pas Google ni One Tap | `CERTIFY_PROMPT_DOORS` ; `createSession` pose `bg_user_sessions.certify_prompt_due = 1` — seulement pour un compte non certifié et sans « Ne plus voir » (sous-requête dans l'`INSERT`) : les autres n'en paient aucune lecture |
| Une fois par connexion | la première réponse lève la marque (`markDiscordCertifyPromptSeen`) ; rien à proposer (déjà certifié, « Ne plus voir ») la lève aussi, à la première lecture — plus aucune requête ensuite |
| Compte vivant, tag **non certifié**, pas de « Ne plus voir » | `loadDiscordCertifyPrompt`, une requête, toutes conditions dans le `WHERE` |
| Après la confidentialité et les conditions, jamais par-dessus | `certifyPromptOpen` (`lib/shared/global-modals.ts`) ; la fenêtre suit `PRIVACY_CHANGES_ANSWERED_EVENT` et `TERMS_ACCEPTED_EVENT` (émis par `TermsAcceptanceModal`) et s'ouvre sans rechargement — sauf si la confidentialité s'est fermée sur un **lien d'action** (`privacyFollowedLink`) : l'écran visé n'est pas couvert, la proposition revient au chargement suivant |
| Pas sur `/connexion`, `/conditions-utilisation`, `/rgpd`, `/mentions-legales`, `/accessibilite`, pages légales du bot | `certifyPromptSilencedOn`, sur `LEGAL_PAGE_PATHS` — la même liste que les conditions (`TERMS_FREE_PATHS` l'étend) : une page légale nouvelle s'ajoute là, une fois |
| Fait taire la modale d'arrivée du recrutement | `RecruitmentHighlight modalHeld`, dès qu'elle est due, **quelle que soit la page** (muette sur une page légale, elle s'ouvre à la navigation suivante), **verrouillé** jusqu'au prochain chargement complet : le `router.refresh()` d'une réponse ne la fait pas surgir derrière — ordre : confidentialité → conditions → certification → recrutement |

**Montée par la mise en page racine**, comme `TermsAcceptanceModal`, et non par
l'espace connecté : c'est la seule qui rend la **première page après la
connexion**, quelle que soit la destination (`redirectTo` peut être une page
publique ; la connexion par code fait `router.refresh()`, qui la relit). Les
pages légales et la connexion la taisent. La marque se lit **avec la session**
(`getCurrentUser`, colonne `s.certify_prompt_due`) : aucune requête de plus tant
qu'elle est à `0`.

**Chargée seulement quand elle peut s'ouvrir** (`DiscordCertifyPromptLazy`,
rendu par la mise en page sous `certifyPrompt &&`) : sans proposition, ni son
code ni ses textes ne partent — aucun poids sur le premier chargement des
pages ; due mais en attente (confidentialité, conditions, page qui la tait), le
morceau attend aussi, puis reste monté. Le relais est seul à suivre ces
attentes et dit à la fenêtre si elle peut s'ouvrir (`canOpen`) ; un tag
certifié depuis `/profil` avant son chargement (conditions encore à accepter)
clôt la proposition pour la session (`LATER`) sans la charger. Due, la lecture part dès la session lue
(attendue avec les conditions) ; la marque levée faute de rien à proposer ne
retarde pas la page (écriture non attendue). Tenue, la modale du recrutement
ne reçoit pas ses annonces sur ce chargement (`modalAds` vide). Ses textes
ont **leur** espace, `certifyPrompt` (hors de la coquille, qui voyage avec
chaque page) ; un morceau par langue (`next/dynamic`, `ssr: false`, `orReload`),
une page française ne télécharge jamais l'anglais. Le relais retient ce qui
arrive avant le morceau (réponse à la confidentialité, lien d'action compris ;
conditions acceptées ou de nouveau exigées). Le toast « déjà certifié » de
`/profil` est dans l'espace `profile` (`discord.alreadyVerified`).

**Jamais sur un état périmé** (« sur aucun appareil », `/rgpd`) — garde
`DiscordCertifyPromptGate`, **dans le morceau** (rien de plus sur les pages sans
proposition) : une lecture de la proposition ne vaut que `RECHECK_AFTER_MS`
(30 s), et seulement si le canal des autres onglets écoutait déjà — un
`router.refresh()` ou une relecture une fois le morceau monté. La lecture de
la mise en page, elle, date d'avant le canal (une réponse donnée dans un autre
onglet pendant le chargement du morceau serait perdue) : la **première**
ouverture, et toute ouverture au-delà du délai, relit d'abord la proposition (`GET
/api/profile/discord/certify-prompt` → `{ prompt }`, `recheckCertifyPrompt`),
**fermée en cas de doute** (panne : la marque reste, elle revient au chargement
suivant ou au prochain `router.refresh()` qui la dit due, lequel annule aussi
une relecture en cours ; une réponse **tranchée** « plus due », elle, ne se
rouvre pas sur ce chargement) ; la relecture peut changer le parcours. Une
lecture de la mise en page n'est datée qu'après une relecture tranchée depuis
le montage (une lecture partie avant le montage peut avoir manqué une réponse).
Affichée — ou de nouveau permise après une page qui la taisait, sans perdre
sa confirmation —, elle se relit par `useAutoRefresh` (`intervalMs: null`,
`pageShow`, `freshAt`, `runOnEnable`) au retour de l'onglet (`visibilitychange`,
`pageshow`), au plus une fois par `RECHECK_AFTER_MS`, et ne se ferme alors que
sur une réponse **tranchée** (`{ prompt: null }`, 401) — un réseau pas encore
revenu ne l'escamote pas : le rafraîchissement rend `"RETRY"` et le crochet le
retente **une** fois (`online`, `focus`). Une réponse écrite dans un autre
onglet du navigateur **par le même compte** la ferme sans requête
(`BroadcastChannel` `bg:certify-prompt`, message `{ type, userId, from }`
vérifié par `isAnsweredMessageFor`, posté par `answerCertifyPrompt` sur un
canal aussitôt refermé) ; celle d'un autre compte, connecté entre-temps dans
ce navigateur, ne ferme rien. Répondue (ici, ailleurs, ou sur un refus sans
issue) ou certifiée, le relais démonte le morceau : canal et écoutes fermés.
Aucun sondage, aucune requête abandonnée qui continue (`AbortController`) ;
une session sans marque répond au `GET` sans la lecture du chargeur (seule
celle de la session), et le `GET` n'écrit jamais (`loadDiscordCertifyPrompt(…,
{ clearStale: false })` : la marque périmée est levée par la page suivante).

Le contournement de développement (`DEV_AUTH_USER_ID`) n'a pas de session : la
fenêtre ne s'y montre pas. Pour la voir en local, se connecter vraiment par
Discord ou Blizzard (ou poser la marque à la main sur sa ligne de session).

## Deux parcours

`certifyPromptFor` décide du bouton principal :

- **`ONE_CLICK`** — mêmes conditions que `certifyLinkedDiscordTag` (Discord
  rattaché, pseudo nommé par Discord, certifiable). La fenêtre montre le tag et
  appelle `POST /api/profile/discord { handle, linkedOnly: true }` —
  `linkedOnly` interdit le chemin à code (Discord détaché entre-temps :
  `DISCORD_NOT_LINKED`, aucun message privé). Seul `status: "VERIFIED"`
  vaut succès → proposition close pour la session (`LATER`), `showSuccess`,
  `DISCORD_CERTIFIED_EVENT` (un `/profil` ouvert relit son état Discord) et
  `router.refresh()`. L'un des quatre codes d'état changé ferme la fenêtre
  (`LATER`) et renvoie vers « Mon profil » ; compte supprimé
  (`PROFILE_NOT_FOUND`, `ACCOUNT_DELETED`) ou session close (`UNAUTHORIZED`)
  la ferment avec un toast dédié et relisent la page, sur les deux boutons ;
  tout autre refus la garde ouverte, en toast.
- **`DIALOG`** — tout autre compte non certifié, le plus souvent une connexion
  Blizzard sans Discord. Sans aucun tag enregistré (`hasTag: false`), la
  fenêtre propose de l'**ajouter** (« Ajouter et certifier ton tag Discord ? »,
  bouton « Ajouter mon tag → ») au lieu de parler d'un tag absent. Le bouton
  (« Certifier mon tag → ») clôt la
  proposition pour la session et mène à `/profil?certifier=discord` (ou, déjà
  sur `/profil`, émet `CERTIFY_DIALOG_EVENT`) : `useCertifyRequest` ouvre
  **le** `DiscordVerificationDialog` une fois l'état Discord lu — code en
  message privé, ou passage par Discord pour un compte rattaché sans pseudo
  nommé. L'adresse seule ne l'ouvre pas : la page qui y mène pose une demande
  en mémoire (`requestCertifyDialog`, valable `CERTIFY_DIALOG_REQUEST_TTL_MS`,
  une minute), consommée par `/profil` (`takeCertifyDialogRequest`) — un lien
  venu d'un autre site, ou ouvert dans un nouvel onglet, mène au profil sans
  ouvrir le dialogue (EF-04). Rien du dialogue n'est recopié ; le paramètre est retiré de l'adresse.
  Tag certifié entre-temps : un toast le dit au lieu d'ouvrir le dialogue.
  Certifié depuis ce dialogue, `/profil` émet `DISCORD_CERTIFIED_EVENT`
  (`certifiedFromProfileEvent`, qu'il ne relit pas lui-même) : une fenêtre
  encore en attente (conditions à accepter) se close pour la session
  (`LATER`), comme après un succès d'un clic.

Le BattleTag n'y figure pas : il est vérifié par Battle.net au rattachement
(`OAUTH_PROVIDERS.md`), sans geste à proposer.

## Réponses

| Geste | Effet |
| --- | --- |
| « Certifier mon tag » | certifie (`ONE_CLICK`) ou mène au dialogue (`DIALOG`, la proposition est close pour la session) ; un refus `STATE_CHANGED` d'un clic (tag changé, absent ou non attesté, Discord détaché — et, branche défensive, un 2xx sans `VERIFIED`, que `linkedOnly` rend inatteignable) close aussi la proposition pour la session (`LATER`), toast `certifyChanged` — l'entrée `PRIVACY_CHANGES` rectificative le nomme |
| « Plus tard », Échap, clic sur le voile | `POST … { action: "LATER", userId }` (`keepalive` : un lien qui change de document ne l'annule pas) — fermée tout de suite ; un échec d'écriture la fait seulement revenir au prochain chargement (un changement de parcours `ONE_CLICK` → `DIALOG` ne la rouvre pas) |
| « Ne plus voir » | `POST … { action: "NEVER", userId }` — `bg_users.discord_certify_prompt_dismissed_at` (date du premier choix, `COALESCE`) puis **toutes** les sessions du compte (au mieux : un échec de cette seconde écriture est journalisé, le choix reste gardé et le chargeur, qui filtre sur la date, lève la marque restée), et l'invitation de la fiche tournoi retenue pour ce compte est oubliée (`forgetCertificationPromptsOf`) ; succès en toast, échec en toast et fenêtre gardée (compte supprimé entre-temps : fenêtre fermée, toast dédié) |

Route : `GET` (relecture, ci-dessus : 401 sans session, 500
`CERTIFY_PROMPT_FAILED`) ; `POST` : 401 sans session, 400 `INVALID_ACTION`
(action ou compte `userId` absent ou malformé — un client d'avant ce champ
n'est jamais dit « autre compte »), 409 `CERTIFY_PROMPT_OTHER_ACCOUNT` (la
fenêtre a été montrée à un autre compte que celui de la session : rien n'est
écrit, la fenêtre se ferme, toast `otherAccount`), 409 `ACCOUNT_DELETED` (compte
supprimé entre-temps) ; un « Plus tard » d'une session qui ne doit plus rien
répond sans écrire — « Ne plus voir », lui, est toujours gardé (un « Plus tard »
d'un autre onglet a pu lever la marque avant), 503 `CERTIFY_PROMPT_UNAVAILABLE` (colonne absente), 500
`CERTIFY_PROMPT_FAILED`. Provenance vérifiée par le middleware. Aucune réponse
ne certifie. Il n'existe pas de geste pour réafficher la fenêtre : la
certification reste offerte dans « Mon profil », que la fenêtre nomme.

## Le tableau

« Ce que change la certification », sans / avec, tiré de `canViewDiscordTag`,
`canSeeDiscordVerification` et de la portée `certified` des messages de match
(`lib/server/notify.ts`), en deux groupes (`CERTIFY_PROMPT_GROUPS`). « Qui voit
ton tag » : administrateurs (toujours), arbitres (tournoi en cours ou à venir ; pour un match que l'on caste, dès que ses adversaires sont connus et jusqu'à sa fin),
ton match (dès que les adversaires sont connus, caster — et équipes d'un match
que l'on caste — le temps du match),
autres joueurs (case « Tag Discord »), visiteurs (jamais). « Autres effets » :
pastille sur la fiche (joueurs connectés), messages privés de match (sauf
opposition) et, au seul parcours `DIALOG` d'un compte **sans Discord
rattaché** (`discordLinked: false`), le rattachement du compte Discord par le
code reçu en message privé, si ce Discord n'est pas déjà rattaché à un autre
compte (`CERTIFY_PROMPT_ROW_SHOWN`, une règle par ligne exigée par le type
`CertifyPromptRow` ; `certifyPromptRowsFor`). Soi-même n'a pas de ligne : on voit toujours son propre tag, rien
n'y change. Sans certification : personne d'autre que toi. Puis une
ligne : retirer son tag ou changer de pseudo Discord retire la certification.
Textes de l'espace `certifyPrompt` (FR et EN) ; le détail complet reste dans le
dialogue (`DISCORD_VERIFICATION_EXPOSURE`, qui nomme aussi l'arbitre d'un match
que le joueur caste). Tableau natif (`th` `scope`, titres de groupe en `rowgroup`), colonnes
« Sans » / « Avec », trois colonnes serrées sous
480 px, boutons empilés (les deux refus côte à côte, le principal pleine largeur
dessous, dans l'ordre de tabulation). Le corps défilant garde un plancher (`min(120px, 22dvh)`, repli `vh`) : à fort
zoom, le tableau reste lisible au lieu de s'écraser sous les boutons, et la
fenêtre (`.dialog-bounded`) défile alors en entier, boutons compris. Focus
d'ouverture sur la fenêtre elle-même (`useDialogBehavior({ initialFocus:
"container" })`, sans défilement, anneau discret au clavier — `:focus-visible`, pas au clic), ouverte en haut :
son titre est annoncé et en vue, et Entrée n'y certifie ni ne ferme pour de
bon ; `Maj+Tab` depuis la fenêtre reboucle sur son dernier bouton
(`focusTrapTarget`, `onContainer`). Un `DISCORD_CERTIFIED_EVENT` après
une réponse déjà donnée sur ce chargement n'écrit pas un second `LATER`. La flèche
du parcours `DIALOG` est décorative (`aria-hidden`).

## Données

`bg_users.discord_certify_prompt_dismissed_at` : exporté
(`discordCertifyPromptDismissedAt`), remis à `NULL` à l'anonymisation.
`bg_user_sessions.certify_prompt_due` : part avec la session, jamais exportée
(l'export ne rend aucune session ; `/rgpd` le dit). Déclaré :
`PRIVACY_CHANGES` `2026-10-proposition-certification-discord` puis l'entrée
rectificative `2026-10-proposition-certification-discord-marque-de-session`
(la marque posée à chaque connexion, levée à la première réponse — FR et EN),
registre T01 (choix et marque) et T04 (« Ne plus voir » tait aussi
l'invitation de la fiche tournoi faite au meneur quand Discord seul manque),
lignes « Choix « Ne plus voir » de la certification Discord » et
« Certification du pseudo Discord » du tableau des données de `/rgpd`
(`rgpd-policy.ts`, FR et EN).
Les deux colonnes sont tolérées absentes (`ALTER` échoué) : session écrite sans
la marque, fenêtre muette, export et anonymisation intacts. Le repli se fait
**colonne par colonne** (`selectUserRows`, `exportOwnData`, toutes les
combinaisons) : l'absence de l'une n'efface jamais la lecture de l'autre.
Colonne du compte absente : `loadDiscordCertifyPrompt` lève aussi la marque de
session, sans relire à chaque page ; `selectUserRows` retient pour le processus
la lecture tombée sur une colonne absente et ne la retente plus.
