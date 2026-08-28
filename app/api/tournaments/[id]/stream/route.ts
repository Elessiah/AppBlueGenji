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
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, STREAM_OPEN_RULE } from "@/lib/server/api-guard";
import {
  acquireStreamSlot,
  joinTournamentRoom,
} from "@/lib/server/tournament-broadcast";
import {
  getTournamentSnapshot,
  getTournamentViewerContext,
} from "@/lib/server/tournaments-service";
import { can } from "@/lib/shared/permissions";
import { resolveRefreshTier } from "@/lib/shared/refresh-tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Battement de cœur. Une ligne de commentaire SSE (` : `) suffit à garder la
 * connexion ouverte au travers des proxys, sans réveiller le client : elle
 * n'est pas remise à `onmessage`.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Le plafond de flux simultanés ne borne pas le *rythme* d'ouverture : un
  // client qui ouvre et referme en boucle libère sa place à chaque fermeture et
  // y échapperait, tout en refaisant à chaque tour le travail le plus cher de
  // la route (session, instantané, contexte du lecteur).
  const throttled = enforceRateLimit(STREAM_OPEN_RULE, user.id);
  if (throttled) return throttled;

  const { id } = await context.params;
  const tournamentId = Number(id);
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    return new Response("Invalid tournament id", { status: 400 });
  }

  const snapshot = await getTournamentSnapshot(tournamentId);
  if (!snapshot) {
    return new Response("Tournament not found", { status: 404 });
  }

  const viewer = await getTournamentViewerContext(snapshot, user.id, can(user, "tournaments"));

  // Palier de fraîcheur : le staff et les engagés du tournoi sont servis à la
  // seconde, les spectateurs par fenêtres plus larges — même donnée, moins de
  // trafic (`lib/shared/refresh-tiers.ts`).
  const isParticipant =
    viewer.myTeamId !== null &&
    snapshot.registrations.some((row) => row.teamId === viewer.myTeamId);
  const tier = resolveRefreshTier({ isStaff: viewer.isAdmin, isParticipant });

  // Un onglet ouvre un flux. Le plafond ne gêne personne d'ordinaire ; il évite
  // qu'un client en boucle de reconnexion accapare la machine.
  const releaseSlot = acquireStreamSlot(user.id);
  if (!releaseSlot) {
    return new Response("Too many streams", {
      status: 429,
      headers: { "Retry-After": "30" },
    });
  }

  // Rien à servir si le client est déjà parti : ni encoder l'instantané (jusqu'à
  // 154 ko sur un gros plateau), ni ouvrir de salle, ni armer de battement.
  // C'est sous spam F5 que ce cas se présente — précisément quand ce travail
  // inutile coûte le plus cher.
  if (req.signal.aborted) {
    releaseSlot();
    // 204 plutôt que le 499 d'nginx : ce dernier est un code de journal, pas un
    // statut HTTP, et un mandataire ou une supervision le compterait comme une
    // famille d'erreurs inventée.
    return new Response(null, { status: 204 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let leaveRoom: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      /**
       * Rend tout ce qui a été pris. Défini **avant** la première écriture : la
       * place de flux ne doit survivre à aucune sortie, pas même celle d'une
       * exception. Une place jamais rendue vaut, au bout de quatre fois, un 429
       * permanent sur son propre tournoi.
       */
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        leaveRoom?.();
        releaseSlot();
        try {
          controller.close();
        } catch {
          // Déjà fermé par le client.
        }
      };

      const write = (frame: Uint8Array): void => {
        if (closed) throw new Error("STREAM_CLOSED");
        controller.enqueue(frame);
      };

      try {
        // Tout ce dont la page a besoin pour s'afficher, dès la connexion :
        // aucun appel REST supplémentaire dans le cas nominal.
        write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "connected",
              tournamentId,
              tier,
              viewer,
              snapshot,
              emittedAt: new Date().toISOString(),
            })}\n\n`,
          ),
        );

        leaveRoom = joinTournamentRoom(tournamentId, { tier, send: write });

        heartbeat = setInterval(() => {
          try {
            write(encoder.encode(`: ping\n\n`));
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
        cleanup();
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Neutralise la mise en tampon d'un reverse proxy, qui retiendrait les
      // messages et ferait croire à un flux mort.
      "X-Accel-Buffering": "no",
    },
  });
}
