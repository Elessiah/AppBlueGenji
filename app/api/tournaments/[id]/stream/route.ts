/**
 * Flux temps réel d'un tournoi (SSE).
 *
 * Le flux **transporte la donnée** au lieu de se contenter de la signaler : à
 * la connexion il envoie l'instantané complet du tournoi et le contexte du
 * lecteur, puis chaque nouvelle version. Le client n'a donc plus rien à
 * recharger — ni au fil du tournoi, ni au retour sur l'onglet.
 *
 * Le calcul de l'instantané et le regroupement des envois vivent dans
 * `lib/server/tournament-broadcast.ts` : une seule passe en base par tournoi,
 * quel que soit le nombre de spectateurs.
 */
import { currentTokenHash, getCurrentUser } from "@/lib/server/auth";
import {
  registerSessionStream,
  revocationMark,
  revokedSince,
} from "@/lib/server/session-streams";
import { enforceRateLimit, STREAM_OPEN_RULE } from "@/lib/server/api-guard";
import {
  acquireStreamSlot,
  joinTournamentRoom,
} from "@/lib/server/tournament-broadcast";
import {
  getVisibleTournamentSnapshot,
  getTournamentViewerContext,
} from "@/lib/server/tournaments-service";
import { can, canAny } from "@/lib/shared/permissions";
import { resolveRefreshTier } from "@/lib/shared/refresh-tiers";
import {
  decideStreamWrite,
  STREAM_QUEUE_HIGH_WATER_BYTES,
} from "@/lib/server/stream-backpressure";
import { acceptsGzip, GZIP_STREAM_HEADER } from "@/lib/server/sse-gzip";
import { snapshotFrameOf } from "@/lib/server/tournaments/snapshot";
import {
  connectedFrameBytes,
  pingFrameBytes,
  type StreamEncoding,
} from "@/lib/server/tournament-stream-frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Battement de cœur. Une ligne de commentaire SSE (` : `) suffit à garder la
 * connexion ouverte au travers des proxys, sans réveiller le client : elle
 * n'est pas remise à `onmessage`.
 */
const HEARTBEAT_MS = 25_000;

/** Le client demande-t-il le palier spectateur (onglet caché, hors match) ? */
function wantsQuietStream(req: Request): boolean {
  try {
    return new URL(req.url).searchParams.get("quiet") === "1";
  } catch {
    return false;
  }
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  // Repère pris **avant** la lecture de la session : une révocation commitée
  // pendant celle-ci ne trouverait pas encore le flux à fermer.
  const mark = revocationMark();
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  /**
   * Nettoyage de la connexion, hissé hors de `start` pour que `cancel` — et la
   * révocation de la session — puissent l'appeler.
   *
   * Le flux se termine par deux portes distinctes : le signal de la requête,
   * quand le client se déconnecte, et l'annulation du corps de la réponse, quand
   * c'est le runtime qui le referme. Ne brancher que la première laisse la place
   * de flux prise par la seconde — et quatre occurrences valent un 429 permanent
   * sur son propre tournoi.
   */
  let cleanup: () => void = () => undefined;

  // La session n'est lue qu'ici : le flux s'inscrit donc **dès maintenant**
  // auprès d'elle (`lib/server/session-streams.ts`), pour qu'une déconnexion,
  // une révocation, une suspension ou une suppression de compte le ferme —
  // y compris pendant les lectures qui précèdent l'ouverture. Celles qui sont
  // tombées pendant la lecture de la session elle-même sont retrouvées par le
  // repère (`revokedSince`).
  const tokenHash = await currentTokenHash();
  let revoked = false;
  const unregister = registerSessionStream(user.id, tokenHash, () => {
    revoked = true;
    cleanup();
  });
  const refuse = (response: Response): Response => {
    unregister();
    return response;
  };
  if (revokedSince(user.id, tokenHash, mark)) {
    return refuse(new Response("Unauthorized", { status: 401 }));
  }

  // Toute sortie imprévue (base indisponible pendant les lectures) désinscrit
  // le flux : le registre est global, et une reconnexion en boucle pendant une
  // panne le ferait grossir sans fin.
  try {
    // Le plafond de flux simultanés ne borne pas le *rythme* d'ouverture : un
    // client qui ouvre et referme en boucle libère sa place à chaque fermeture et
    // y échapperait, tout en refaisant à chaque tour le travail le plus cher de
    // la route (session, instantané, contexte du lecteur).
    const throttled = enforceRateLimit(STREAM_OPEN_RULE, user.id);
    if (throttled) return refuse(throttled);

    const { id } = await context.params;
    const tournamentId = Number(id);
    if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
      return refuse(new Response("Invalid tournament id", { status: 400 }));
    }

    // Gestion résolue **avant** la lecture : elle décide aussi de l'accès. Un
    // tournoi dont la date de visibilité n'est pas atteinte n'est lisible que par
    // la permission `tournaments`, ici comme par la lecture REST de secours
    // (`lib/shared/tournament-visibility.ts`) — un droit posé sur une seule des
    // deux portes n'arriverait qu'après une coupure du direct.
    const canManage = can(user, "tournaments");

    // 404 et non 403 : le tournoi qu'on cache ne doit pas se trahir par le code
    // de refus. « N'existe pas » et « pas encore publié » se répondent pareil.
    const snapshot = await getVisibleTournamentSnapshot(tournamentId, { canManage });
    if (!snapshot) {
      return refuse(new Response("Tournament not found", { status: 404 }));
    }

    // L'aperçu du plateau va plus loin que la gestion : le cast y a droit sans
    // pouvoir rien modifier (`docs/features/TOURNAMENT_PREVIEW.md`). La diffusion
    // est, elle, un droit d'écriture à part (`docs/features/LIVE_STREAMS.md`) —
    // qui doit voyager par ici comme par la lecture REST, ce flux étant le chemin
    // nominal : sans lui, un arbitre n'aurait ses commandes d'antenne qu'après
    // une coupure du direct.
    const narratesLive = canAny(user, ["tournaments", "casting"]);
    const viewer = await getTournamentViewerContext(snapshot, user.id, {
      canManage,
      canPreview: narratesLive,
      canManageLive: can(user, "live"),
      // Suppression définitive : administrateur strict. Ce droit doit voyager par
      // les deux portes — ici et par la lecture REST de secours —, faute de quoi
      // la zone de danger n'apparaîtrait qu'après une coupure du direct.
      canDelete: user.isAdmin === true,
      // Annuler un abandon : administrateur strict, par les deux portes aussi.
      canCancelForfeit: user.isAdmin === true,
    });

    // Palier de fraîcheur : ceux qui font le tournoi — staff, cast, engagés — sont
    // servis à la seconde, les spectateurs par fenêtres plus larges : même donnée,
    // moins de trafic (`lib/shared/refresh-tiers.ts`).
    //
    // Le cast compte parmi les prioritaires, et pas seulement le staff : un caster
    // commente le match pendant qu'il se joue. Le laisser au palier spectateur lui
    // ferait décrire un plateau vieux de vingt secondes, alors même qu'on vient de
    // lui accorder l'aperçu du tirage.
    const isParticipant =
      viewer.myTeamId !== null &&
      snapshot.registrations.some((row) => row.teamId === viewer.myTeamId);

    // `?quiet=1` : l'onglet est caché depuis une minute et son lecteur n'a pas de
    // match en cours (`lib/shared/client-power.ts`). Il **demande** le palier
    // spectateur — il recevra encore l'annonce de son match, à la fenêtre des
    // spectateurs (vingt secondes d'ordinaire, jusqu'à une minute quand le budget
    // de sortie d'une grosse salle l'élargit) — et libère ce budget pour ceux qui
    // jouent. Un client ne peut que se déclasser ainsi, jamais se promouvoir.
    const tier = wantsQuietStream(req)
      ? "STANDARD"
      : resolveRefreshTier({ isStaff: narratesLive, isParticipant });

    // Un onglet ouvre un flux. Le plafond ne gêne personne d'ordinaire ; il évite
    // qu'un client en boucle de reconnexion accapare la machine.
    // Session révoquée pendant les lectures : la porte ordinaire répondrait 401.
    if (revoked) {
      return refuse(new Response("Unauthorized", { status: 401 }));
    }

    const releaseSlot = acquireStreamSlot(user.id);
    if (!releaseSlot) {
      return refuse(
        new Response("Too many streams", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
      );
    }

    // Rien à servir si le client est déjà parti : ni encoder l'instantané (jusqu'à
    // 238 ko sur un gros plateau), ni ouvrir de salle, ni armer de battement.
    // C'est sous spam F5 que ce cas se présente — précisément quand ce travail
    // inutile coûte le plus cher.
    if (req.signal.aborted) {
      releaseSlot();
      unregister();
      // 204 plutôt que le 499 d'nginx : ce dernier est un code de journal, pas un
      // statut HTTP, et un mandataire ou une supervision le compterait comme une
      // famille d'erreurs inventée.
      return new Response(null, { status: 204 });
    }

    // Compression du flux (`lib/server/sse-gzip.ts`) : tout navigateur l'accepte
    // pour `EventSource`, et l'instantané d'un gros plateau y fond de 238 Ko à
    // ~14 Ko — autant de budget de sortie rendu à la salle.
    const encoding: StreamEncoding = acceptsGzip(req.headers.get("accept-encoding"))
      ? "gzip"
      : "identity";

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let leaveRoom: (() => void) | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;

        // Renseigné **avant** la première écriture : la place de flux ne doit
        // survivre à aucune sortie, pas même celle d'une exception.
        cleanup = (): void => {
          if (closed) return;
          closed = true;
          if (heartbeat !== null) clearInterval(heartbeat);
          leaveRoom?.();
          releaseSlot();
          unregister();
          try {
            controller.close();
          } catch {
            // Déjà fermé par le client.
          }
        };

        // Contre-pression (`lib/server/stream-backpressure.ts`) : une connexion
        // bloquée sans être fermée ne fait jamais échouer `enqueue`, et chaque
        // trame s'ajoutait à une file en mémoire sans borne. File pleine, la trame
        // n'est pas écrite (`false` : la salle garde l'abonné en retard et lui
        // renverra la dernière version au dégagement) ; pleine trop longtemps, la
        // connexion est fermée.
        let backedUpSince: number | null = null;
        const write = (frame: Uint8Array): boolean => {
          if (closed) throw new Error("STREAM_CLOSED");
          const decision = decideStreamWrite(controller.desiredSize, backedUpSince, Date.now());
          backedUpSince = decision.backedUpSince;
          if (decision.action === "CLOSE") {
            // `error` et non `close` : fermer laisserait la file attendre d'être
            // lue par un client qui ne lit plus ; l'erreur la libère sur-le-champ.
            try {
              controller.error(new Error("STREAM_STALLED"));
            } catch {
              // Flux déjà terminé.
            }
            cleanup();
            throw new Error("STREAM_CLOSED");
          }
          if (decision.action === "SKIP") return false;
          controller.enqueue(frame);
          return true;
        };

        try {
          // L'en-tête gzip part une fois, avant toute trame : chaque trame qui
          // suit est un morceau *deflate* autonome. Dix octets, hors
          // contre-pression — la file est vide à ce stade.
          if (encoding === "gzip") controller.enqueue(GZIP_STREAM_HEADER);

          // Tout ce dont la page a besoin pour s'afficher, dès la connexion :
          // aucun appel REST supplémentaire dans le cas nominal. L'instantané
          // n'est pas resérialisé : ses octets — déjà comprimés, le cas échéant —
          // sont repris de la trame en cache ; seule l'enveloppe est propre au
          // lecteur.
          write(
            connectedFrameBytes(
              {
                type: "connected",
                tournamentId,
                tier,
                viewer,
                emittedAt: new Date().toISOString(),
              },
              snapshot,
              snapshotFrameOf(snapshot),
              encoding,
            ),
          );

          // `close` sert au cas où le tournoi disparaît : la salle termine alors
          // le flux, et le client bascule sur son écran « Tournoi introuvable »
          // au lieu de contempler un plateau figé annoncé « Direct ».
          //
          // `version` dit à la salle ce que ce lecteur vient de recevoir. Sans
          // elle, elle ne connaissait que la dernière version *diffusée* à son
          // palier : un abonné dont la lecture d'ouverture précédait de peu une
          // diffusion en héritait sans l'avoir reçue, et restait sur un plateau
          // périmé — jusqu'au prochain changement, c'est-à-dire indéfiniment sur
          // un tournoi calme.
          leaveRoom = joinTournamentRoom(
            tournamentId,
            {
              tier,
              encoding,
              version: snapshot.version,
              send: write,
              close: cleanup,
            },
            snapshot,
          );

          heartbeat = setInterval(() => {
            try {
              write(pingFrameBytes(encoding));
            } catch {
              cleanup();
            }
          }, HEARTBEAT_MS);
          heartbeat.unref?.();

          // Course résiduelle : le contrôle plus haut a pu passer juste avant que
          // le client ne parte. Un signal DÉJÀ avorté ne déclenche jamais son
          // écouteur.
          if (req.signal.aborted) {
            cleanup();
            return;
          }
          req.signal.addEventListener("abort", cleanup);
        } catch (error) {
          // Signaler AVANT de nettoyer : `cleanup()` ferme le flux, et
          // `controller.error()` est un no-op silencieux sur un flux déjà fermé —
          // le client croirait à une fermeture propre, et rien ne resterait dans
          // les journaux d'une panne pourtant systématique.
          console.error(`[tournaments/${tournamentId}/stream] ouverture impossible`, error);
          try {
            controller.error(error);
          } catch {
            // Flux déjà en erreur : rien à signaler de plus.
          }
          cleanup();
        }
      },
      cancel() {
        cleanup();
      },
    },
    // File mesurée en octets, pas en trames : c'est la mémoire qu'on borne, et la
    // stratégie par défaut (une trame) déclarerait la file pleine dès la trame
    // d'ouverture encore non lue.
    {
      highWaterMark: STREAM_QUEUE_HIGH_WATER_BYTES,
      size: (chunk: Uint8Array) => chunk.byteLength,
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        // `no-transform` reste : il écarte la compression **tamponnante** d'un
        // mandataire ou du serveur de Next, qui retiendrait les trames. La nôtre
        // vide après chaque trame (`lib/server/sse-gzip.ts`).
        "Cache-Control": "no-cache, no-transform",
        ...(encoding === "gzip" ? { "Content-Encoding": "gzip" } : {}),
        Vary: "Accept-Encoding",
        Connection: "keep-alive",
        // Neutralise la mise en tampon d'un reverse proxy, qui retiendrait les
        // messages et ferait croire à un flux mort.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    unregister();
    throw error;
  }
}
