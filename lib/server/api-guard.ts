/**
 * Garde-fous de débit des routes API.
 *
 * Le site tient sur un Raspberry Pi. Le cache
 * (`lib/server/cache.ts`) rend les lectures répétées presque gratuites, mais
 * « presque » n'est pas « rien » : chaque requête coûte encore une
 * désérialisation, une résolution de session, une réponse à sérialiser. Un
 * navigateur qui martèle F5 — ou un onglet parti en boucle — doit finir par se
 * heurter à un mur poli plutôt que par faire tomber le site pour les
 * quatre-vingt-dix-neuf autres.
 *
 * Les plafonds sont **larges** : personne n'y touche en naviguant normalement.
 * Ils bornent l'anormal, ils ne disciplinent pas l'usage.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ANONYMOUS_IDENTITY,
  refundRateLimit,
  rateLimitWindowOf,
  chargeRateLimit,
  checkRateLimit,
  consumeRateLimit,
  rateLimitIdentity,
  refundTokenBucket,
  takeTokenBucket,
  type RateLimitRule,
  type TokenBucketRule,
} from "./rate-limit";
import { clientIpFromForwardedFor, parseTrustedProxyHops } from "@/lib/shared/site-visits";

/**
 * Le proxy de cette installation écrit-il `X-Real-IP` ?
 *
 * Répond `false` par défaut, et ce défaut est le fond de l'affaire — voir
 * {@link requestClientIp}. La valeur est lue à chaque appel, pas figée à
 * l'import : un test qui la change doit pouvoir le faire sans recharger le
 * module, et le coût d'une lecture d'environnement est nul devant celui d'une
 * requête.
 */
function trustsRealIpHeader(): boolean {
  return process.env.TRUSTED_PROXY_REAL_IP === "true";
}

/**
 * IP du client telle que l'a vue le proxy de confiance.
 *
 * Même lecture que le compteur de fréquentation (`X-Forwarded-For` parcouru
 * depuis la droite sur `TRUSTED_PROXY_HOPS` relais) : un en-tête forgé par le
 * client ne doit pas permettre de se fabriquer une identité neuve à chaque
 * requête, sans quoi le plafond ne borne plus rien.
 *
 * **`X-Real-IP` n'est plus un repli silencieux**, et le raisonnement vaut d'être
 * gardé parce qu'il est contre-intuitif. Ce repli ne se déclenchait que là où
 * `X-Forwarded-For` manquait — c'est-à-dire précisément là où **aucun relais de
 * confiance n'avait écrit quoi que ce soit**, donc là où l'en-tête est forgeable
 * par l'appelant. Il n'aidait jamais un déploiement correctement mandaté (dans
 * lequel il est mort, `X-Forwarded-For` étant toujours présent) et offrait à un
 * appelant non mandaté un **seau neuf à chaque requête** : il affaiblissait le
 * plafond au lieu de le servir, exactement à l'envers de son intention.
 *
 * Il est donc devenu un choix déclaré, `TRUSTED_PROXY_REAL_IP=true`, que seul
 * l'exploitant d'une installation dont le proxy pose `X-Real-IP` et **pas**
 * `X-Forwarded-For` a une raison de poser. Sans déclaration, une identité qu'on
 * ne peut pas établir n'est pas plafonnée — ce que ce module tient déjà par
 * ailleurs : on préfère ne pas compter que compter faux.
 */
export function requestClientIp(req: Request): string | null {
  return clientIpFromHeaders(req.headers);
}

/**
 * Même lecture que {@link requestClientIp}, sur des en-têtes seuls — ceux que
 * `headers()` de Next rend à un code serveur qui n'a pas la requête en main
 * (l'ouverture de session, qui journalise l'adresse de connexion).
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  const forwarded = clientIpFromForwardedFor(
    headers.get("x-forwarded-for"),
    parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
  if (forwarded !== null) return forwarded;
  return trustsRealIpHeader() ? headers.get("x-real-ip") : null;
}

/**
 * Interrogation de la modale de lancement des matchs, par utilisateur. Elle
 * suit la page du joueur partout sur le site : quelques secondes d'intervalle
 * pendant un lancement, une minute sinon — soixante par minute laissent
 * plusieurs onglets ouverts sans jamais rien refuser à un usage normal.
 */
export const MATCH_LAUNCH_READ_RULE: RateLimitRule = {
  name: "match-launch-read",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Contacts d'un match, ouverts depuis sa carte (bouton « Contacts »). Compteur
 * propre : partagé avec l'interrogation de la modale, quelques ouvertures
 * épuiseraient le quota de plusieurs onglets en plein lancement (429 sur la
 * modale comme sur les contacts). Trente par minute couvrent largement un
 * usage humain.
 */
export const MATCH_CONTACTS_READ_RULE: RateLimitRule = {
  name: "match-contacts-read",
  limit: 30,
  windowMs: 60_000,
};

/** Compteur des salons vocaux d'un match, relu toutes les 10 s par sa page, flux coupé seulement (30 par minute et par compte : trois onglets sans flux en prennent dix-huit). */
export const MATCH_VOICE_READ_RULE: RateLimitRule = {
  name: "match-voice-read",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Bascule de l'option « Salons vocaux d'équipe » d'un tournoi, par compte :
 * chaque vrai changement poste au journal Discord du staff, remet
 * l'étranglement du balayage à zéro et rejoue l'entretien des lancements.
 * Trente en cinq minutes couvrent un staff qui corrige plusieurs tournois ;
 * au-delà, c'est une bascule en boucle.
 */
export const TEAM_VOICE_TOGGLE_RULE: RateLimitRule = {
  name: "team-voice-toggle",
  limit: 30,
  windowMs: 5 * 60_000,
};

/**
 * Bascule « vue joueur » d'une session (`POST /api/auth/player-view`), par
 * compte. Chaque vrai changement écrit la session, laisse une ligne pm2
 * nommée et fait reconnecter les flux de la session : dix par minute couvrent
 * tous les allers-retours d'un membre du staff qui vérifie un écran ; au-delà,
 * c'est une boucle. Les **entrées** seulement : toute requête de la route passe
 * d'abord par {@link PLAYER_VIEW_EXIT_RULE}.
 */
export const PLAYER_VIEW_TOGGLE_RULE: RateLimitRule = {
  name: "player-view-toggle",
  limit: 10,
  windowMs: 60_000,
};

/**
 * Règle large de `POST /api/auth/player-view`, par compte : **toute** requête
 * y passe avant la lecture du corps (retours, entrées, corps refusés) ; une
 * entrée refusée par {@link PLAYER_VIEW_TOGGLE_RULE} y rend sa place, si bien
 * que les entrées n'en prennent jamais plus de vingt (deux fenêtres étroites)
 * et que le retour, qui ne fait que rendre des droits, garde de la marge.
 * Trente par minute ne se touchent pas en usage normal, mais une boucle ne
 * martèle plus la base sans fin. Elle borne aussi les changements de contexte
 * retenus par compte (`RECONNECT_MEMORY_PER_USER`, son double : une fenêtre
 * fixe laisse passer deux salves de part et d'autre de sa limite).
 */
export const PLAYER_VIEW_EXIT_RULE: RateLimitRule = {
  name: "player-view-exit",
  limit: 30,
  windowMs: 60_000,
};

/** Bascule de la planification des matchs par l'arbitrage d'un tournoi, par compte (même plafond). */
export const REFEREE_SCHEDULING_TOGGLE_RULE: RateLimitRule = {
  name: "referee-scheduling-toggle",
  limit: 30,
  windowMs: 5 * 60_000,
};

/** Bascule de l'option « Check-in des matchs » d'un tournoi, par compte (même plafond). */
export const MATCH_CHECK_IN_TOGGLE_RULE: RateLimitRule = {
  name: "match-check-in-toggle",
  limit: 30,
  windowMs: 5 * 60_000,
};

/** Vidage d'un salon vocal d'équipe par l'arbitrage (`POST /api/admin/matches/[id]/voice/clear`), par compte. */
export const VOICE_CLEAR_RULE: RateLimitRule = {
  name: "voice-clear",
  limit: 20,
  windowMs: 60_000,
};

/**
 * Horaires de match posés, changés ou retirés par un arbitre : chaque geste
 * écrit aux joueurs des deux engagées (message privé Discord, push) et pousse
 * aux arbitres. Trois cents gestes en cinq minutes (un par seconde) laissent
 * planifier d'une traite un plateau entier — 126 manches en double
 * élimination à 64 —, réenregistrements compris ; au-delà, c'est un client qui
 * boucle ou une session volée, et le bot risquerait les limites anti-spam de
 * Discord.
 */
export const MATCH_SCHEDULE_WRITE_RULE: RateLimitRule = {
  name: "match-schedule-write",
  limit: 300,
  windowMs: 5 * 60_000,
};

/**
 * Choix d'une carte dans un pool (`PUT /api/matches/[id]/map-pick`), par
 * compte. Chaque choix écrit une ligne au journal du staff et reconstruit
 * l'instantané : cent vingt en cinq minutes couvrent le staff qui choisit pour
 * tout un tour, une équipe n'en fait que quelques-uns ; au-delà, c'est une
 * bascule en boucle.
 */
export const MAP_PICK_WRITE_RULE: RateLimitRule = {
  name: "map-pick-write",
  limit: 120,
  windowMs: 5 * 60_000,
};

/**
 * Le même plafond pour l'arbitrage (`tournaments`), qui choisit pour tout un
 * tour : soixante matchs à deux ou trois cartes, avec quelques corrections,
 * dépassaient les cent vingt choix — un 429 en pleine manche. Seuls les choix
 * acceptés comptent (un refus rend sa place, `reserveRateLimit`).
 */
export const MAP_PICK_STAFF_WRITE_RULE: RateLimitRule = {
  name: "map-pick-staff-write",
  limit: 600,
  windowMs: 5 * 60_000,
};

/**
 * Tous les appels de `PUT /api/matches/[id]/map-pick`, refusés compris, par
 * compte : les refus rendant leur place aux deux plafonds ci-dessus, celui-ci
 * borne la boucle de choix refusés (chacun relit le match, et une carte
 * refusée prend le verrou du tournoi et du match). Au-dessus de
 * `MAP_PICK_STAFF_WRITE_RULE` : l'arbitrage qui corrige un tour n'y bute pas.
 */
export const MAP_PICK_ATTEMPT_RULE: RateLimitRule = {
  name: "map-pick-attempt",
  limit: 900,
  windowMs: 5 * 60_000,
};

/**
 * Le même borne pour un joueur (sans `tournaments`) : son plafond de choix
 * acceptés est `MAP_PICK_WRITE_RULE` (120), et ses refus ne doivent pas lui
 * ouvrir les 900 appels de l'arbitrage — une boucle de cartes refusées, chacune
 * sous le verrou du tournoi, concurrencerait la saisie des scores.
 */
export const MAP_PICK_PLAYER_ATTEMPT_RULE: RateLimitRule = {
  name: "map-pick-player-attempt",
  limit: 180,
  windowMs: 5 * 60_000,
};

/**
 * Reports de score d'un engagé (`POST …/matches/[matchId]/report`), refus
 * compris, par compte. Chaque envoi prend le verrou du match et relit le
 * détail adverse ; une équipe n'en fait que quelques-uns par match (saisie,
 * retouche, confirmation). Le plafond borne aussi l'avance de l'instant de
 * dépôt sur l'horloge (une seconde par retouche dans la même seconde,
 * `reportedAtAssignment`) à une vingtaine de secondes.
 */
export const SCORE_REPORT_WRITE_RULE: RateLimitRule = {
  name: "score-report-write",
  limit: 20,
  windowMs: 60_000,
};

/** Lectures d'un utilisateur connecté : liste et détail des tournois. */
export const TOURNAMENT_READ_RULE: RateLimitRule = {
  name: "tournament-read",
  limit: 90,
  windowMs: 60_000,
};

/**
 * Relecture des propositions d'**un** match (`GET …/matches/[matchId]/proposals`),
 * par compte : seau distinct de `TOURNAMENT_READ_RULE`, pour que les relectures
 * des dialogues de score (trois au plus par proposition, `useProposalMaps`)
 * n'entament pas la lecture REST de secours du détail.
 */
export const MATCH_PROPOSALS_READ_RULE: RateLimitRule = {
  name: "match-proposals-read",
  limit: 60,
  windowMs: 60_000,
};

/** Lectures publiques de la vitrine, par IP. */
export const LANDING_READ_RULE: RateLimitRule = {
  name: "landing-read",
  limit: 180,
  windowMs: 60_000,
};

/**
 * Lectures publiques d'un tournoi (`/suivre/tournois/[id]`), par réseau
 * (`clientNetworkKey` : une adresse IPv4, un préfixe IPv6 `/64`).
 *
 * Un onglet en relit une toutes les 27 s au plus vite (30 s, gigue de −10 %
 * comprise) : un peu plus de deux par minute, sans compter les ouvertures et
 * les retours sur l'onglet. Le plafond laisse passer une salle de LAN entière
 * derrière une même adresse — une centaine d'écrans (≈ 222 lectures par
 * minute), avec la marge des ouvertures et des reprises — et ne borne que la
 * boucle d'un client déréglé. Une lecture servie par le cache ne coûte rien ;
 * celles qui font **reconstruire** la réponse ont leur propre plafond
 * (`SPECTATOR_REBUILD_RULE`).
 */
export const SPECTATOR_READ_RULE: RateLimitRule = {
  name: "spectator-read",
  limit: 360,
  windowMs: 60_000,
};

/**
 * Lectures publiques d'un tournoi qui font **reconstruire** sa réponse (aucune
 * réponse fraîche ni calcul en vol), par réseau (`clientNetworkKey`) : un
 * **seau à jetons**, dix d'avance puis un par seconde.
 *
 * Le plafond des lectures ne suffit pas : une seule adresse qui parcourt des
 * dizaines de tournois publiés, chacun hors du cache, ferait reconstruire six
 * instantanés entiers (matchs, rejeu des classements) par seconde. Une salle
 * de LAN qui suit un tournoi n'en provoque qu'une par durée de vie (quatre par
 * minute au calme) ; soixante par minute laissent une marge large à qui en suit
 * plusieurs. Un débit plutôt qu'une fenêtre : une fenêtre fixe laissait passer
 * soixante reconstructions d'un coup, puis soixante autres juste après sa remise
 * à zéro — ici, jamais plus de dix à la fois sur le pool MySQL.
 */
export const SPECTATOR_REBUILD_RULE: TokenBucketRule = {
  name: "spectator-rebuild",
  capacity: 10,
  refillMs: 1_000,
};

/**
 * Rendus d'une image d'aperçu de tournoi ou de match **absente de la mémoire**
 * (`/og/<langue>/tournament-…png`, `SHARE_EMBEDS.md`), par réseau : un seau à
 * jetons, quarante d'avance puis un toutes les deux secondes. Une image servie
 * depuis la mémoire, ou un rendu en vol qu'on rejoint, ne coûte rien.
 *
 * Satori et `sharp` sur le Raspberry : sans ce plafond, un client qui
 * parcourt plus de couples (match, langue) que la réserve `embed` n'en garde
 * ferait rendre une image par requête, sans que le plafond des lectures
 * publiques ne le compte (la réponse publique, elle, est en cache). Un message
 * Discord ou un tweet n'en fait rendre qu'une ; au plafond, la carte neutre.
 *
 * Large d'avance : les robots d'aperçu (Discord, X) viennent de quelques
 * réseaux partagés par tous les liens collés, et une ronde de liens de matchs
 * postée d'un coup ne doit pas tomber sur la carte neutre. Le processeur, lui,
 * est borné par la file (`MAX_CONCURRENT_RENDERS`, `MAX_QUEUED_EMBED_RENDERS`,
 * part de chaque réseau), pas par ce seau.
 */
export const SHARE_EMBED_RENDER_RULE: TokenBucketRule = {
  name: "share-embed-render",
  capacity: 40,
  refillMs: 2_000,
};

/**
 * Retire le port d'une adresse qui en porte un (`1.2.3.4:51234`,
 * `[2001:db8::1]:51234`) : un client qui change de port à chaque connexion
 * resterait sinon une clé par connexion, hors de tout plafond. Une adresse IPv6
 * sans crochets reste telle quelle (ses deux-points ne sont pas un port).
 */
function withoutPort(value: string): string {
  const bracketed = /^(\[[^\]]*\]):\d{1,5}$/.exec(value);
  if (bracketed) return bracketed[1];
  // IPv4, nue ou écrite en IPv6 (`::ffff:203.0.113.7:4433`) : sans ce second
  // cas, le port restait collé et l'adresse passait pour un /64 commun.
  const ipv4 = /^((?:::ffff:)?\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/i.exec(value);
  return ipv4 ? ipv4[1] : value;
}

/**
 * Identité de débit d'un **réseau** : l'adresse IPv4 telle quelle, une adresse
 * IPv6 ramenée à son préfixe `/64` — ce qu'un seul abonné reçoit d'ordinaire,
 * et dans lequel il peut tirer une adresse neuve à chaque requête. Sans ce
 * regroupement, un seul hôte IPv6 contournait tout plafond par adresse.
 * Une adresse IPv4 écrite en IPv6 (`::ffff:203.0.113.7`) redevient IPv4 ; une
 * valeur illisible est rendue telle quelle.
 */
export function clientNetworkKey(ip: string | null): string | null {
  if (ip === null) return null;
  const address = withoutPort(ip.trim()).replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!address.includes(":")) return address || null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  const halves = address.split("::");
  if (halves.length > 2) return address;
  const groupsOf = (part: string) =>
    part === "" ? [] : part.split(":").flatMap((group) => (group.includes(".") ? ["0", "0"] : [group]));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return address;
  const groups = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return address;
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

/**
 * Lectures de l'annuaire et des fiches, par utilisateur : `/api/players`,
 * `/api/teams` et la fiche de chacun.
 *
 * Un seul seau pour les quatre routes : ce qu'il borne est le rythme auquel un
 * compte fait recalculer des statistiques, quelle que soit la fiche visée. Ce
 * sont les seules lectures de l'espace connecté qu'un F5 maintenu rendait
 * coûteuses — l'annuaire des joueurs recharge les matchs de tout le site. Large :
 * soixante pages d'annuaire ou de fiche par minute, personne ne lit à ce rythme.
 */
export const DIRECTORY_READ_RULE: RateLimitRule = {
  name: "directory-read",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Questions « ces comptes ont-ils une fiche ? » des liens de joueur
 * (`POST /api/players/profileless`, décision D86), par compte. Un seau à part de
 * {@link DIRECTORY_READ_RULE} : chaque chargement de page en pose une (une par
 * centaine de noms affichés), et elles ne doivent pas épuiser celui de
 * l'annuaire. Soixante par minute : chaque onglet en pose au plus 24
 * (`PROFILELESS_BURST_GAP_MS`), deux onglets de classement ouverts ensemble
 * tiennent dessous. La borne ne protège pas la liste des comptes supprimés :
 * c'est le nom exigé avec chaque compte (`profilelessAmong`), et la borne des
 * noms faux essayés par compte demandé et par jour, tous visiteurs confondus
 * (`admitProfilelessName`), qui la ferment.
 */
export const PROFILELESS_LOOKUP_RULE: RateLimitRule = {
  name: "profileless-lookup",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Créations et dissolutions d'équipe, par compte (un seul seau pour les deux).
 *
 * Chaque dissolution d'une équipe inscrite vide la liste du classement et les
 * vues de l'accueil, que les visiteurs suivants recalculent (rejeu, conversions
 * `sharp` du podium) : une boucle « créer → dissoudre » le commandait à volonté.
 * Dix gestes par heure couvrent une équipe créée par erreur puis refaite ; le
 * staff `tournaments` (équipes fantômes) n'est pas plafonné. Seul un geste
 * **réussi** est décompté : le geste est réservé d'une seule instruction
 * ({@link enforceRateLimit}, sans `await` entre contrôle et décompte — des
 * requêtes parallèles ne passent pas toutes), puis rendu s'il est refusé
 * avant d'avoir eu lieu ({@link reserveRateLimit}) : un nom déjà pris ne coûte
 * rien.
 */
export const TEAM_LIFECYCLE_RULE: RateLimitRule = {
  name: "team-lifecycle",
  limit: 10,
  windowMs: 60 * 60_000,
};

/**
 * Inscriptions et désinscriptions d'un joueur à un tournoi (un seul seau pour
 * les deux, `POST`/`DELETE /api/tournaments/[id]/register`), par compte.
 *
 * Depuis la désinscription (`docs/features/SELF_WITHDRAWAL.md`), s'inscrire se
 * défait : une boucle « inscrire → désinscrire » prenait le verrou du tournoi,
 * vidait le classement, l'accueil et l'instantané du tournoi, relançait le flux
 * de chaque spectateur et remplissait le journal du staff sur Discord à
 * volonté. Dix gestes en dix minutes couvrent une inscription faite par erreur
 * puis refaite, sur plusieurs tournois ; le staff `tournaments` n'est pas
 * plafonné. Seul un geste **réussi** est décompté ({@link reserveRateLimit}) :
 * un refus (inscriptions closes, droit manquant, tournoi lancé) ne coûte rien.
 */
export const TOURNAMENT_REGISTRATION_TOGGLE_RULE: RateLimitRule = {
  name: "tournament-registration-toggle",
  limit: 10,
  windowMs: 10 * 60_000,
};

/**
 * Écritures d'identité d'une équipe — nom, sigle, description, logo posé ou
 * retiré (`PATCH /api/teams/[id]`, `POST`/`DELETE /api/teams/[id]/logo`), par
 * compte. Un renommage ou un logo changé d'une équipe inscrite vide le
 * classement, ses PNG et les vues de l'accueil : sans plafond, une boucle le
 * commandait à volonté. Trente écritures en dix minutes couvrent largement
 * une fiche qu'on retouche ; le staff `tournaments` (équipes fantômes, saisie
 * en série) n'est pas plafonné.
 */
export const TEAM_IDENTITY_WRITE_RULE: RateLimitRule = {
  name: "team-identity-write",
  limit: 30,
  windowMs: 10 * 60_000,
};

/**
 * {@link TEAM_IDENTITY_WRITE_RULE} pour un compte, réservée en une instruction
 * ({@link reserveRateLimit}) : `refused` porte la réponse 429 au-delà du
 * plafond, `refund` rend la place d'une écriture refusée avant d'avoir eu lieu
 * (nom pris, droit manquant, fichier invalide) — seule une écriture faite
 * compte, comme pour {@link TEAM_LIFECYCLE_RULE}. Jamais plafonnée pour le
 * staff `tournaments`.
 */
export function reserveTeamIdentityWrite(
  userId: number,
  managesGhostTeams: boolean,
): ReturnType<typeof reserveRateLimit> {
  return managesGhostTeams ? { refused: null, refund: () => undefined } : reserveRateLimit(TEAM_IDENTITY_WRITE_RULE, userId);
}

/**
 * « Ne plus voir » de l'invitation à certifier de la fiche tournoi
 * (`POST /api/profile/certification-prompt`), par compte. Un lecteur le coche
 * une fois ; le plafond borne un client en boucle, qui jouait une requête par
 * appel. Réservé d'une seule instruction ({@link enforceRateLimit}).
 */
export const CERTIFICATION_PROMPT_OFF_RULE: RateLimitRule = {
  name: "certification-prompt-off",
  limit: 10,
  windowMs: 60 * 60_000,
};

/**
 * « Mes rôles » (`PUT /api/teams/[id]/my-roles`), par compte. Chaque appel lit
 * l'appartenance puis, pour un membre, ouvre une transaction et verrouille sa
 * ligne : sans plafond, un script en boucle (sur son équipe ou sur n'importe
 * quel identifiant) occupait le pool. Un membre enregistre ses rôles quelques
 * fois ; trente enregistrements en cinq minutes ne gênent personne.
 * Décompté d'une seule instruction ({@link enforceRateLimit}).
 */
export const TEAM_OWN_ROLES_WRITE_RULE: RateLimitRule = {
  name: "team-own-roles-write",
  limit: 30,
  windowMs: 5 * 60_000,
};

/**
 * Lectures du planning des casts et arbitres (`GET /api/planning`), par
 * compte : une page en lit une à l'ouverture et après chaque geste qui ne se
 * reporte pas sur place ; sans plafond, un membre en boucle occupait le pool
 * (sept lectures chacune). Au-dessus de la somme des gestes permis
 * (`PLANNING_WRITE_RULE` + `PLANNING_BATCH_RULE`, même fenêtre) : une rafale
 * de gestes acceptés ne se voit jamais refuser sa relecture.
 */
export const PLANNING_READ_RULE: RateLimitRule = {
  name: "planning-read",
  limit: 400,
  windowMs: 5 * 60_000,
};

/**
 * Rafale des lectures du planning, en plus de `PLANNING_READ_RULE` : sans
 * elle, les 400 lectures de la fenêtre pouvaient partir en une minute (près
 * de 2 800 requêtes au pool). 200 par minute, autant que les gestes permis
 * en cinq minutes (`PLANNING_WRITE_RULE` + `PLANNING_BATCH_RULE`) : même
 * tassée en une minute, une rafale de gestes acceptés garde sa relecture (un
 * geste refusé pour excès, lui, ne relit pas la page).
 */
export const PLANNING_READ_BURST_RULE: RateLimitRule = {
  name: "planning-read-burst",
  limit: 200,
  windowMs: 60_000,
};

/**
 * Gestes unitaires du planning (sa disponibilité, « caster autonome »,
 * désignation et réglages du staff), par compte. Large : on coche des
 * créneaux en rafale, une semaine chargée en compte quelques dizaines.
 */
export const PLANNING_WRITE_RULE: RateLimitRule = {
  name: "planning-write",
  limit: 180,
  windowMs: 5 * 60_000,
};

/**
 * Gestes de lot du staff (calcul, confirmation), par compte : chacun tient le
 * verrou du planning ; vingt en cinq minutes suffisent à tout reprendre.
 */
export const PLANNING_BATCH_RULE: RateLimitRule = {
  name: "planning-batch",
  limit: 20,
  windowMs: 5 * 60_000,
};

/**
 * Ouvertures du flux temps réel, par utilisateur.
 *
 * Distinct du plafond de flux *simultanés* (`MAX_STREAMS_PER_USER`) : celui-ci
 * borne le rythme d'ouverture, que le premier laisse passer puisqu'une
 * fermeture libère aussitôt la place. Large : un onglet ouvre un flux et le
 * garde, une reconnexion en rafale est plafonnée par l'attente exponentielle.
 */
export const STREAM_OPEN_RULE: RateLimitRule = {
  name: "tournament-stream-open",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Enregistrement d'une visite, par IP.
 *
 * Plafond de **requêtes**, distinct du plafond d'**insertions** appliqué par
 * `site-visits-service` : celui-ci borne le travail fait avant même de savoir
 * s'il y a une visite à enregistrer (résolution de session, lecture de la
 * fenêtre). Large — un visiteur normal envoie deux pings par heure.
 */
export const VISIT_REQUEST_RULE: RateLimitRule = {
  name: "site-visits-request",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Clés suivies au plus par seau de la mesure d'audience. Ses seaux refusent
 * une clé nouvelle quand ils sont pleins (jamais vidés : ce serait rendre ses
 * plafonds à qui les sature) ; large, pour qu'il faille des dizaines de
 * milliers de réseaux actifs dans la minute pour les remplir. Quelques Mo.
 */
export const AUDIENCE_MAX_KEYS = 50_000;

/**
 * Signalements de pages vues (`/api/audience`, registre T19), par réseau
 * (`clientNetworkKey` : une adresse IPv4, un préfixe IPv6 `/64` — sans quoi un
 * hôte IPv6 tirerait une adresse, donc un plafond neuf, à chaque envoi).
 *
 * Un navigateur envoie sa file au plus toutes les minutes, ou à chaque dixième
 * entrée, ou quand l'onglet passe en arrière-plan : deux envois par minute
 * environ. Le plafond est large pour une adresse partagée (réseau mobile
 * derrière un NAT d'opérateur, salle d'un événement en réseau local), dont
 * les visiteurs ne doivent pas disparaître des chiffres ; il borne seulement
 * un client qui fabrique des signalements (20 entrées par envoi au plus). La
 * clé (le réseau) ne vit qu'en mémoire, deux minutes au plus après sa dernière
 * requête.
 */
export const AUDIENCE_REQUEST_RULE: RateLimitRule = {
  name: "audience-request",
  limit: 120,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/**
 * Envois par préfixe IPv6 `/48` et par minute : un abonné IPv6 reçoit souvent
 * un `/56` (256 réseaux `/64`), un hébergeur un `/48` (65 536) — sans ce
 * second étage, chacun de ces réseaux aurait ses plafonds neufs.
 */
export const AUDIENCE_WIDE_REQUEST_RULE: RateLimitRule = {
  name: "audience-request-wide",
  limit: 600,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/**
 * Pages vues retenues par réseau et par minute (les suites, qui n'apportent que
 * du temps borné par la visite, n'y comptent pas). Un visiteur en ouvre
 * quelques-unes par minute ; cent vingt laissent passer une salle entière et
 * bornent ce qu'un client qui fabrique des signalements ajoute aux chiffres.
 */
export const AUDIENCE_VIEW_RULE: RateLimitRule = {
  name: "audience-view",
  limit: 120,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/** Pages vues retenues par préfixe IPv6 `/48` et par minute (voir {@link AUDIENCE_WIDE_REQUEST_RULE}). */
export const AUDIENCE_WIDE_VIEW_RULE: RateLimitRule = {
  name: "audience-view-wide",
  limit: 600,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/**
 * Pages vues retenues pour tout le site, par minute : la borne absolue de ce
 * que des signalements fabriqués depuis de nombreux réseaux ajoutent aux
 * chiffres. Bien au-dessus du trafic réel du site ; atteinte, le reste de la
 * minute est perdu pour tous plutôt que gonflé.
 */
export const AUDIENCE_GLOBAL_VIEW_RULE: RateLimitRule = {
  name: "audience-view-global",
  limit: 6_000,
  windowMs: 60_000,
};

/**
 * Navigateurs nouveaux (user-agents) par réseau et par minute. L'empreinte
 * d'un visiteur est celle du couple réseau (adresse IPv4, `/64` en IPv6) +
 * navigateur : changer d'adresse dans son `/64` n'en fait pas un autre ; sans
 * ce plafond, un client qui change de user-agent à chaque envoi se ferait
 * passer pour autant de visiteurs. Une salle de LAN n'a que quelques versions
 * de navigateur, et un navigateur déjà vu n'y compte plus.
 */
export const AUDIENCE_IDENTITY_RULE: RateLimitRule = {
  name: "audience-identity",
  limit: 30,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/** Navigateurs distincts par préfixe IPv6 `/48` et par minute. */
export const AUDIENCE_WIDE_IDENTITY_RULE: RateLimitRule = {
  name: "audience-identity-wide",
  limit: 150,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
};

/** Navigateurs nouveaux pour tout le site, par minute (borne absolue, comme {@link AUDIENCE_GLOBAL_VIEW_RULE}). */
export const AUDIENCE_GLOBAL_IDENTITY_RULE: RateLimitRule = {
  name: "audience-identity-global",
  limit: 1_500,
  windowMs: 60_000,
};

/**
 * Réserve du site entier où puise la part de chaque réseau
 * ({@link AUDIENCE_FAIR_VIEWS}) : sans elle, la part, exempte de
 * {@link AUDIENCE_GLOBAL_VIEW_RULE}, se multipliait par le nombre de réseaux
 * (mille adresses à vingt pages chacune passaient 20 000 pages par minute).
 * Le site ne reçoit donc jamais plus que la somme des deux plafonds.
 */
export const AUDIENCE_GLOBAL_FAIR_VIEW_RULE: RateLimitRule = {
  name: "audience-view-global-fair",
  limit: 6_000,
  windowMs: 60_000,
};

/** Réserve de la part des navigateurs nouveaux ({@link AUDIENCE_FAIR_IDENTITIES}), comme {@link AUDIENCE_GLOBAL_FAIR_VIEW_RULE}. */
export const AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE: RateLimitRule = {
  name: "audience-identity-global-fair",
  limit: 1_500,
  windowMs: 60_000,
};

/**
 * Navigateurs déjà vus (clé : réseau — l'adresse IPv4, le `/64` en IPv6 —
 * + condensé court du user-agent, celle de l'empreinte du visiteur ; en
 * mémoire seulement). Fenêtre glissante : un navigateur actif ne redevient
 * pas nouveau chaque minute, sa clé s'efface une minute après sa dernière
 * requête. Plein, il refuse les clés nouvelles plutôt que de se vider : un
 * seau vidé ferait reparaître tous les navigateurs comme nouveaux.
 */
const AUDIENCE_IDENTITY_SEEN_RULE: RateLimitRule = {
  name: "audience-identity-seen",
  limit: Number.MAX_SAFE_INTEGER,
  windowMs: 60_000,
  maxKeys: AUDIENCE_MAX_KEYS,
  overflow: "refuse",
  slide: true,
};

/**
 * Part de chaque réseau (et de son `/48`), par minute, qui puise dans une
 * réserve du site à part ({@link AUDIENCE_GLOBAL_FAIR_VIEW_RULE},
 * {@link AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE}) plutôt que dans les plafonds
 * du site : un foyer, un téléphone derrière le NAT d'un opérateur restent
 * comptés quand des réseaux fabriquant des signalements épuisent ces
 * plafonds-là, et la réserve borne ce que la part ajoute, tous réseaux confondus.
 */
export const AUDIENCE_FAIR_IDENTITIES = 5;
/** Voir {@link AUDIENCE_FAIR_IDENTITIES}. */
export const AUDIENCE_FAIR_VIEWS = 20;

/** Réseau d'un envoi dont l'adresse est illisible : tous partagent un même plafond. */
export const AUDIENCE_UNKNOWN_NETWORK = "unknown-network";

/** Clé du plafond qui vaut pour tout le site. */
const AUDIENCE_SITE_KEY = "site";

/** Intervalle minimal entre deux avertissements « réseau illisible plafonné ». */
export const AUDIENCE_UNKNOWN_WARN_INTERVAL_MS = 10 * 60_000;
let lastUnknownWarnAt = Number.NEGATIVE_INFINITY;
let lastSeenFullWarnAt = Number.NEGATIVE_INFINITY;

/** Adresse IPv4 bien formée (quatre octets de 0 à 255). */
function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Identité de débit d'un envoi de mesure d'audience : son réseau (adresse IPv4,
 * `/64` IPv6), ou un réseau commun si l'adresse est illisible. Une valeur qui
 * n'est pas une adresse (`X-Forwarded-For` forgé quand aucun mandataire de
 * confiance ne le réécrit) rejoint le réseau commun : sinon chaque valeur
 * inventée aurait ses plafonds neufs.
 */
export function audienceNetworkKey(ip: string | null): string {
  const network = clientNetworkKey(ip);
  if (network === null || !(isIpv4(network) || network.endsWith("::/64"))) return AUDIENCE_UNKNOWN_NETWORK;
  return network;
}

/** Préfixe IPv6 `/48` d'une adresse (second étage des plafonds), `null` pour IPv4 ou une adresse illisible. */
export function audienceWideNetworkKey(ip: string | null): string | null {
  return wideOf(audienceNetworkKey(ip));
}

/** Préfixe `/48` d'un réseau `/64`, `null` pour un autre réseau. */
function wideOf(network: string): string | null {
  if (!network.endsWith("::/64")) return null;
  return `${network.slice(0, -"::/64".length).split(":").slice(0, 3).join(":")}::/48`;
}

/**
 * Les adresses de tous les visiteurs sont illisibles (proxy mal réglé :
 * `TRUSTED_PROXY_HOPS`) et leur plafond commun est atteint : la mesure perd
 * des visiteurs réels. Signalé dans les journaux, au plus une fois par
 * {@link AUDIENCE_UNKNOWN_WARN_INTERVAL_MS}.
 */
function warnUnknownNetworkThrottled(network: string, now: number = Date.now()): void {
  if (network !== AUDIENCE_UNKNOWN_NETWORK || now - lastUnknownWarnAt < AUDIENCE_UNKNOWN_WARN_INTERVAL_MS) return;
  lastUnknownWarnAt = now;
  console.warn("[audience] Adresse client illisible : plafond commun atteint, pages vues écartées (vérifier TRUSTED_PROXY_HOPS).");
}

/**
 * Le registre des navigateurs déjà vus est plein : chaque envoi d'un navigateur
 * qu'il ne contient pas est compté comme nouveau (plafonds de navigateurs).
 * Signalé, au plus une fois par {@link AUDIENCE_UNKNOWN_WARN_INTERVAL_MS}.
 */
function warnSeenRegistryFull(now: number = Date.now()): void {
  if (now - lastSeenFullWarnAt < AUDIENCE_UNKNOWN_WARN_INTERVAL_MS) return;
  lastSeenFullWarnAt = now;
  console.warn("[audience] Registre des navigateurs déjà vus plein : envois comptés comme navigateurs nouveaux.");
}

/** Remet à zéro les avertissements « réseau illisible » et « registre plein » (tests). */
export function resetAudienceUnknownWarning(): void {
  lastUnknownWarnAt = Number.NEGATIVE_INFINITY;
  lastSeenFullWarnAt = Number.NEGATIVE_INFINITY;
}

/** Plafonds (règle, clé) qu'un même geste doit tous respecter : contrôlés tous, puis décomptés tous. */
function consumeAll(limits: readonly (readonly [RateLimitRule, string])[]): { allowed: boolean; retryAfterMs: number } {
  for (const [rule, key] of limits) {
    const state = checkRateLimit(rule, key);
    if (!state.allowed) return { allowed: false, retryAfterMs: state.retryAfterMs };
  }
  for (const [rule, key] of limits) {
    const state = consumeRateLimit(rule, key);
    if (!state.allowed) return { allowed: false, retryAfterMs: state.retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Plafonds d'un réseau, puis de son `/48` s'il est en IPv6. */
function tiers(network: string, perNetwork: RateLimitRule, perWide: RateLimitRule): [RateLimitRule, string][] {
  const wide = wideOf(network);
  return wide ? [[perNetwork, network], [perWide, wide]] : [[perNetwork, network]];
}

/** Plafond des envois de `/api/audience` (réseau, puis `/48` en IPv6) : `429` au-delà. */
export function throttleAudienceRequest(ip: string | null): NextResponse | null {
  const network = audienceNetworkKey(ip);
  const state = consumeAll(tiers(network, AUDIENCE_REQUEST_RULE, AUDIENCE_WIDE_REQUEST_RULE));
  if (state.allowed) return null;
  warnUnknownNetworkThrottled(network);
  return tooManyRequests(state.retryAfterMs);
}

/** Ce geste est-il parmi les `share` premiers de chaque étage dans la fenêtre ? */
function withinFairShare(limits: readonly (readonly [RateLimitRule, string])[], share: number): boolean {
  return limits.every(([rule, key]) => rule.limit - checkRateLimit(rule, key).remaining < share);
}

/**
 * Contrôle et décompte d'un geste sous ses étages (`limits`, puis `extra`)
 * et un plafond du site : la réserve de la part (`fair`) d'abord tant que le
 * geste est dans la part de son réseau ({@link AUDIENCE_FAIR_IDENTITIES}),
 * le plafond commun (`site`) sinon — ou quand la réserve est épuisée (des
 * réseaux forgés l'ont remplie) : un foyer n'est pas écarté tant que le site
 * a de la place. Le total du site reste borné par la somme des deux.
 */
function consumeWithSiteCap(
  limits: readonly [RateLimitRule, string][],
  site: RateLimitRule,
  fair: RateLimitRule,
  share: number,
  extra: readonly [RateLimitRule, string][] = [],
): { allowed: boolean; retryAfterMs: number } {
  if (withinFairShare(limits, share)) {
    const reserved = consumeAll([...limits, [fair, AUDIENCE_SITE_KEY], ...extra]);
    if (reserved.allowed) return reserved;
  }
  return consumeAll([...limits, [site, AUDIENCE_SITE_KEY], ...extra]);
}

/**
 * Pages vues qu'un envoi peut encore ajouter aux chiffres (`/api/audience`) :
 * aucune si ce navigateur (réseau + user-agent, comme l'empreinte) est nouveau
 * et que son réseau, son `/48` ou — au-delà de la part de chaque réseau — le
 * site a déjà vu trop de navigateurs nouveaux dans la minute
 * ({@link AUDIENCE_IDENTITY_RULE}), sinon les suites et les pages vues sous
 * {@link AUDIENCE_VIEW_RULE} (réseau, `/48`, site). Les entrées refusées sont
 * écartées sans bruit. Registre des navigateurs déjà vus plein : l'envoi est
 * compté comme un navigateur nouveau, jamais écarté pour ce seul motif.
 */
export function admitAudienceViews<T extends { isView: boolean }>(
  ip: string | null,
  userAgent: string,
  views: readonly T[],
): T[] {
  const network = audienceNetworkKey(ip);
  const seenKey = `${network}\u0000${createHash("sha256").update(userAgent).digest("base64url").slice(0, 16)}`;
  const seen = checkRateLimit(AUDIENCE_IDENTITY_SEEN_RULE, seenKey);
  if (!seen.allowed || seen.remaining === AUDIENCE_IDENTITY_SEEN_RULE.limit) {
    const identityTiers = tiers(network, AUDIENCE_IDENTITY_RULE, AUDIENCE_WIDE_IDENTITY_RULE);
    // Registre plein de navigateurs actifs (peut-être saturé exprès) : ce
    // navigateur n'y entre pas, mais il n'est pas écarté pour autant — chaque
    // envoi compte comme un navigateur nouveau, sous les mêmes plafonds.
    if (!seen.allowed) warnSeenRegistryFull();
    const identity = consumeWithSiteCap(
      identityTiers,
      AUDIENCE_GLOBAL_IDENTITY_RULE,
      AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE,
      AUDIENCE_FAIR_IDENTITIES,
      seen.allowed ? [[AUDIENCE_IDENTITY_SEEN_RULE, seenKey]] : [],
    );
    if (!identity.allowed) {
      warnUnknownNetworkThrottled(network);
      return [];
    }
  } else {
    // Déjà vu : sa fenêtre glisse.
    chargeRateLimit(AUDIENCE_IDENTITY_SEEN_RULE, seenKey);
  }
  const viewTiers = tiers(network, AUDIENCE_VIEW_RULE, AUDIENCE_WIDE_VIEW_RULE);
  let dropped = false;
  const admitted = views.filter((view) => {
    if (!view.isView) return true;
    const allowed = consumeWithSiteCap(viewTiers, AUDIENCE_GLOBAL_VIEW_RULE, AUDIENCE_GLOBAL_FAIR_VIEW_RULE, AUDIENCE_FAIR_VIEWS).allowed;
    dropped ||= !allowed;
    return allowed;
  });
  if (dropped) warnUnknownNetworkThrottled(network);
  return admitted;
}

/**
 * Lectures relayées vers le bot (`/api/bot/*`), par IP.
 *
 * Ces routes ne touchent pas la base : elles rouvrent une requête vers le bot,
 * qui tourne sur la même machine. Le coupe-circuit de `bot-integration` couvre
 * la panne, pas l'affluence — d'où ce plafond, large comme les autres, sur une
 * page de vitrine ouverte sans compte.
 */
export const BOT_READ_RULE: RateLimitRule = {
  name: "bot-read",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Ouvertures du flux d'activité du bot, par IP.
 *
 * Par IP et non par utilisateur : `/bot` est une page de vitrine, ouverte aux
 * visiteurs sans compte. Distinct du plafond de flux *simultanés*
 * (`lib/server/bot-feed-guard.ts`), qui borne ce qui reste ouvert quand
 * celui-ci ne voit qu'un rythme.
 */
export const BOT_FEED_OPEN_RULE: RateLimitRule = {
  name: "bot-feed-open",
  limit: 30,
  windowMs: 60_000,
};

/**
 * Rapports de violation de la politique de sécurité du contenu, par IP.
 *
 * Large, parce que le navigateur décide seul quand envoyer : une page qui
 * viole la politique à trois endroits produit trois rapports par chargement,
 * sans que le visiteur y soit pour rien. Le plafond ne protège donc pas une
 * intention, il borne le travail que peut coûter une origine — le
 * dédoublonnage côté journal fait le reste.
 */
export const CSP_REPORT_RULE: RateLimitRule = {
  name: "csp-report",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Signalements de problème, par utilisateur.
 *
 * Étroit, à rebours des autres plafonds : chaque appel envoie un message privé
 * à tous les arbitres. Un joueur en signale un, éventuellement deux quand la
 * situation évolue — au-delà, c'est du bruit qu'aucun arbitre ne peut trier en
 * pleine soirée de tournoi.
 */
export const ISSUE_REPORT_RULE: RateLimitRule = {
  name: "tournament-issue-report",
  limit: 5,
  windowMs: 10 * 60_000,
};

/**
 * Téléversements d'image (avatar, logo d'équipe, photo de bénévole, logo et
 * bandeau de partenaire, image de tournoi), par compte.
 *
 * Chaque envoi fait lire jusqu'à 5 Mo, décoder et réencoder une image par
 * `sharp` — le travail le plus lourd qu'un compte puisse commander au serveur,
 * un Raspberry Pi. Vingt en dix minutes couvrent un recadrage raté puis refait
 * plusieurs fois ; au-delà, c'est une boucle.
 */
export const IMAGE_UPLOAD_RULE: RateLimitRule = {
  name: "image-upload",
  limit: 20,
  windowMs: 10 * 60_000,
};

/**
 * Signalements de problème, par utilisateur et **par jour**.
 *
 * Le plafond de dix minutes borne une rafale, pas une journée : seul, il
 * laissait un engagé écrire à tous les arbitres sept cents fois par jour, et
 * quelques comptes suffisaient à faire classer le bot comme spammeur par
 * Discord. Vingt couvrent largement une soirée de tournoi difficile.
 */
export const ISSUE_REPORT_DAILY_RULE: RateLimitRule = {
  name: "tournament-issue-report-daily",
  limit: 20,
  windowMs: 24 * 60 * 60_000,
};

/**
 * Envois du formulaire « Signaler un problème », par compte ou, sans compte,
 * par IP.
 *
 * Étroit pour la même raison que le signalement d'un tournoi : chaque envoi
 * écrit en privé au propriétaire et au président de l'association. Une
 * personne en envoie un, deux si elle précise ; au-delà, c'est du bruit. Le
 * plafond global, lui, est en base (`REPORTS_HOURLY_CAP`) : il tient aussi
 * quand l'appelant n'a pas d'identité.
 */
export const REPORT_SUBMIT_RULE: RateLimitRule = {
  name: "content-report-submit",
  limit: 5,
  windowMs: 30 * 60_000,
};

/**
 * Abonnements et réglages des notifications push, par compte.
 *
 * Chaque abonnement fait écrire le serveur vers un service de push au premier
 * envoi ; un appareil s'abonne une fois, et le panneau renvoie son abonnement
 * à chaque ouverture. Trente écritures en dix minutes ne gênent aucun usage et
 * bornent un script qui remplirait la table d'abonnements.
 */
export const PUSH_WRITE_RULE: RateLimitRule = {
  name: "push-subscription-write",
  limit: 30,
  windowMs: 10 * 60_000,
};

/**
 * Recherche de joueurs, d'équipes ou de tournois dans le formulaire de
 * signalement, par compte. Une frappe au clavier en déclenche une (après
 * temporisation) : soixante par minute ne gênent aucune saisie, et bornent un
 * script qui voudrait parcourir l'annuaire par là.
 */
export const REPORT_TARGET_SEARCH_RULE: RateLimitRule = {
  name: "content-report-target-search",
  limit: 60,
  windowMs: 60_000,
};

/**
 * Demandes d'un code de connexion Discord, **par compte Discord visé**.
 *
 * Étroit, comme le signalement de problème et pour une raison voisine : chaque
 * appel envoie un message privé à quelqu'un — ici, à la personne dont on
 * prétend être. Un joueur en demande un, deux si le premier s'est perdu.
 *
 * Le plafond porte sur l'identifiant Discord **résolu par le bot**, et non sur
 * l'IP : c'est le seul axe qu'un attaquant ne peut pas faire tourner, puisqu'il
 * lui faut précisément viser sa victime. Il borne donc deux choses à la fois —
 * le harcèlement par messages privés, et le nombre de codes neufs qu'on peut
 * mettre en jeu (chacun rouvrant un quota d'essais).
 */
export const DISCORD_CODE_REQUEST_RULE: RateLimitRule = {
  name: "discord-code-request",
  limit: 3,
  windowMs: 15 * 60_000,
};

/**
 * Demandes d'un code de connexion Discord, **par IP appelante**.
 *
 * Le plafond par compte visé ne peut être posé qu'**après** avoir résolu le
 * pseudo en identifiant — c'est-à-dire après un aller-retour vers le bot, qui
 * interroge Discord à son tour. Cette route anonyme ouvrait donc une requête
 * sortante par appel, sans borne : celui-ci la ferme au plus tôt, avant la
 * moindre dépense.
 *
 * Par IP, faute de compte à qui l'imputer — le même axe que `BOT_READ_RULE`,
 * qui existe pour la même raison, avec la même faiblesse assumée (une identité
 * absente n'est pas plafonnée) : c'est une borne de coût, pas la garantie de
 * sécurité, qui vit en base (`MAX_DISCORD_CODES_PER_WINDOW`).
 *
 * **Large, et délibérément.** Une IP n'est pas une personne : un tournoi joué en
 * réseau local, un internat, un lycée sortent tous par la même adresse, et
 * quarante joueurs qui se connectent au coup d'envoi sont un usage normal, pas
 * une attaque. Les bornes étroites de cette route sont posées sur le compte
 * visé, là où elles désignent quelque chose ; celle-ci ne borne que la dépense
 * (un aller-retour vers le bot), et un plafond qui refuse la connexion à la
 * moitié d'un plateau coûterait plus cher que ce qu'il économise.
 */
export const DISCORD_CODE_REQUEST_IP_RULE: RateLimitRule = {
  name: "discord-code-request-ip",
  limit: 120,
  windowMs: 15 * 60_000,
};

/**
 * Vérifications d'un code de connexion Discord, **par couple (défi visé, IP
 * appelante)**.
 *
 * Première ligne, gratuite — **pas** la garantie. Le secret est tenu par deux
 * bornes en base : le quota d'essais porté par le code lui-même
 * (`MAX_DISCORD_CODE_ATTEMPTS`, réservé par un `UPDATE … WHERE attempts < ?`)
 * et le nombre de codes délivrables à un compte
 * (`MAX_DISCORD_CODES_PER_WINDOW`). Ce plafond-ci vit dans une `Map` d'un seul
 * processus dont le seau se vide entièrement dès qu'on lui fabrique dix mille
 * clés (`rate-limit.ts`, `bucket.clear()`) — et la clé est justement un
 * identifiant que l'appelant choisit. Il écarte le bruit ; il ne prouve rien.
 *
 * **L'IP appelante est dans la clé, et ce n'est pas cosmétique.** Posé sur le
 * seul compte visé — l'axe de la demande de code —, ce plafond désignait la
 * **victime** : la route est anonyme, et dix codes bidon suffisaient alors à
 * fermer la connexion Discord d'un joueur nommé pendant un quart d'heure. (La
 * demande de code ne publie plus l'identifiant Discord : la vérification
 * désigne désormais le **défi** par un jeton imprévisible.) Le compte visé est bien le seul axe qu'un attaquant ne peut pas
 * faire tourner — mais c'est précisément ce qui fait de lui un mauvais axe
 * *ici* : le refus retombe sur la personne visée, pas sur l'appelant. Le
 * décompte des essais, lui, reste porté par le code en base, où changer d'IP
 * n'y donne pas droit.
 */
export const DISCORD_CODE_VERIFY_RULE: RateLimitRule = {
  name: "discord-code-verify",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Certifications de tag Discord, **par compte du site**.
 *
 * L'axe change par rapport à la connexion, et c'est le point à retenir : la
 * route est **authentifiée**, donc il existe enfin quelqu'un à qui imputer
 * l'appel. Ce que le plafond protège n'est plus la victime d'un message privé
 * non sollicité mais la **dépense** — chaque essai résout un tag auprès du bot,
 * qui interroge Discord.
 *
 * Le message privé reste borné par ailleurs, sur le compte Discord visé
 * (`DISCORD_CODE_REQUEST_RULE`) et en base
 * (`MAX_DISCORD_CODES_PER_WINDOW`) : un joueur ne peut pas faire sonner le
 * Discord d'un autre plus souvent en passant par cette route que par la page de
 * connexion.
 *
 * Assez large pour l'usage réel (un joueur se trompe de tag, corrige, réessaie),
 * assez étroit pour qu'une boucle ne coûte rien.
 */
export const DISCORD_VERIFY_TAG_RULE: RateLimitRule = {
  name: "discord-verify-tag",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Confirmations d'une certification (le code saisi), **par compte du site**.
 *
 * Un seau **distinct** de celui de la demande, et ce n'est pas de la symétrie
 * décorative : les deux gestes se suivent, et partager un seul seau laisse les
 * essais du premier épuiser le quota du second. Un joueur qui se trompe dix fois
 * de tag — chaque essai comptant, même quand la résolution échoue sans rien
 * envoyer — se verrait alors refuser la confirmation d'un code qu'il vient de
 * recevoir, et qui expire en dix minutes. La connexion Discord sépare ses deux
 * règles pour exactement cette raison.
 *
 * Le décompte des essais, lui, reste porté par le code en base
 * (`MAX_DISCORD_CODE_ATTEMPTS`) : ce plafond-ci ne borne que le bruit.
 */
export const DISCORD_VERIFY_CONFIRM_RULE: RateLimitRule = {
  name: "discord-verify-confirm",
  limit: 10,
  windowMs: 15 * 60_000,
};

/**
 * Applique un plafond. Renvoie la réponse 429 à retourner tel quel, ou `null`
 * si la requête peut continuer.
 *
 * **Une identité absente n'est pas plafonnée.** C'est délibéré : sans en-tête
 * de proxy — `next start` exposé directement, reverse-proxy déployé sans
 * `proxy_set_header X-Forwarded-For`, banc d'essai local — *tous* les visiteurs
 * partageraient sinon le même seau, et cent joueurs se verraient refuser la
 * page d'accueil au bout de 180 requêtes cumulées. Le garde-fou provoquerait la
 * panne qu'il doit éviter. On préfère ne pas compter que compter faux : la
 * borne de croissance de la table de fréquentation, elle, reste assurée côté
 * `site-visits-service`, qui plafonne les **insertions**.
 *
 * `Retry-After` est renseigné : un client correct saura attendre plutôt que
 * réessayer aussitôt.
 */
/** Identité plafonnée : compte, réseau, ou inconnue (jamais plafonnée). */
type RateIdentity = string | number | null | undefined;

export function enforceRateLimit(
  rule: RateLimitRule,
  identity: RateIdentity,
): NextResponse | null {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return null;

  const state = consumeRateLimit(rule, key);
  if (state.allowed) return null;
  return tooManyRequests(state.retryAfterMs);
}

/**
 * Le même refus que {@link enforceRateLimit}, **sans rien décompter** : pour
 * refuser d'emblée un client déjà au plafond, avant un travail préalable
 * (lecture en base) que le décompte, fait juste avant l'action, ne couvrirait
 * pas.
 */
export function peekRateLimit(
  rule: RateLimitRule,
  identity: RateIdentity,
): NextResponse | null {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return null;
  const state = checkRateLimit(rule, key);
  return state.allowed ? null : tooManyRequests(state.retryAfterMs);
}

/**
 * Réserve une action comme {@link enforceRateLimit} (contrôle et décompte en
 * une instruction) et rend, avec la réservation, de quoi la **rendre** si
 * l'action est refusée avant d'avoir eu lieu (refus métier : nom pris, droit
 * manquant). La place rendue est celle de **cette** fenêtre : si la fenêtre
 * s'est rouverte entre-temps, rien n'est décrémenté. Une identité inconnue
 * n'est ni plafonnée ni décomptée.
 */
export function reserveRateLimit(
  rule: RateLimitRule,
  identity: RateIdentity,
): { refused: NextResponse; refund: () => void } | { refused: null; refund: () => void } {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return { refused: null, refund: () => undefined };
  const state = consumeRateLimit(rule, key);
  if (!state.allowed) return { refused: tooManyRequests(state.retryAfterMs), refund: () => undefined };
  const windowResetAt = rateLimitWindowOf(rule, key) ?? undefined;
  let refunded = false;
  return {
    refused: null,
    refund: () => {
      if (refunded) return;
      refunded = true;
      refundRateLimit(rule, key, Date.now(), windowResetAt);
    },
  };
}

/**
 * Prend un jeton du seau `rule` pour cette identité : `null` s'il est pris (ou
 * si l'identité est inconnue, jamais plafonnée), sinon le refus `429` à servir.
 */
export function takeRateToken(
  rule: TokenBucketRule,
  identity: RateIdentity,
): NextResponse | null {
  const key = rateLimitIdentity(identity);
  if (key === ANONYMOUS_IDENTITY) return null;
  const state = takeTokenBucket(rule, key);
  return state.allowed ? null : tooManyRequests(state.retryAfterMs);
}

/** Rend le jeton pris par {@link takeRateToken} pour un travail qui n'a pas eu lieu. */
export function refundRateToken(rule: TokenBucketRule, identity: RateIdentity): void {
  const key = rateLimitIdentity(identity);
  if (key !== ANONYMOUS_IDENTITY) refundTokenBucket(rule, key);
}

/** Le refus `429` commun : code seul, `Retry-After` en secondes (au moins 1), jamais mis en cache. */
export function tooManyRequests(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "TOO_MANY_REQUESTS" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        "Cache-Control": "no-store",
      },
    },
  );
}
