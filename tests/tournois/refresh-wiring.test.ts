import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// Le flux SSE, le hook et les pages sont du câblage : pas de rendu testable ici
// (composants clients, pas de DOM en test). On vérifie donc au niveau source,
// comme pour les autres pages du projet — la logique, elle, est couverte par
// `live-state.test.ts`, `tournament-broadcast.test.ts` et `cache.test.ts`.
const stream = read("app/api/tournaments/[id]/stream/route.ts");
const hook = read("app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts");
const detailPage = read("app/(secured)/tournois/[id]/page.tsx");
const listPage = read("app/(secured)/tournois/page.tsx");
const snapshot = read("lib/server/tournaments/snapshot.ts");

describe("flux SSE — ce qui part à la connexion", () => {
  it("envoie l'instantané et le contexte du lecteur d'emblée", () => {
    // C'est ce qui supprime le `GET /api/tournaments/:id` du cas nominal.
    expect(stream).toContain('type: "connected"');
    expect(stream).toContain("viewer,");
    expect(stream).toContain("snapshot,");
    expect(stream).toContain("tier,");
  });

  it("laisse le serveur décider du palier", () => {
    // Un client ne doit pas pouvoir se déclarer prioritaire.
    expect(stream).toContain("resolveRefreshTier({ isStaff: viewer.isAdmin, isParticipant })");
    expect(stream).toMatch(/const isParticipant =[\s\S]*?registrations\.some/);
  });

  it("passe par la salle partagée plutôt que par un abonnement direct", () => {
    expect(stream).toContain("joinTournamentRoom(tournamentId, { tier, send: write })");
  });

  it("plafonne les flux d'un même utilisateur", () => {
    expect(stream).toContain("acquireStreamSlot(user.id)");
    expect(stream).toMatch(/status: 429/);
  });

  it("libère la place et quitte la salle à la fermeture", () => {
    expect(stream).toContain("leaveRoom()");
    expect(stream).toContain("releaseSlot?.()");
    expect(stream).toContain('req.signal.addEventListener("abort", cleanup)');
  });

  it("garde la connexion ouverte sans réveiller le client", () => {
    // Une ligne de commentaire SSE n'est pas remise à `onmessage`.
    expect(stream).toContain("`: ping\\n\\n`");
    // Et le proxy ne doit pas mettre le flux en tampon.
    expect(stream).toContain('"X-Accel-Buffering": "no"');
  });

  it("répond 404 sur un tournoi inconnu plutôt que d'ouvrir un flux vide", () => {
    expect(stream).toMatch(/if \(!snapshot\) \{\s*return new Response\("Tournament not found", \{ status: 404 \}\)/);
  });
});

describe("hook temps réel", () => {
  it("n'abandonne jamais la reconnexion", () => {
    // L'ancienne version renonçait après cinq essais : la page restait figée
    // jusqu'au F5, exactement ce qu'on cherche à supprimer.
    expect(hook).not.toContain("maxReconnectAttempts");
    expect(hook).toContain("reconnectDelayMs(attempts)");
    expect(hook).toMatch(/source\.onopen = \(\) => \{[\s\S]*?attempts = 0;/);
  });

  it("rafraîchit au retour sur l'onglet", () => {
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(hook).toContain('window.addEventListener("online", onVisible)');
    expect(hook).toContain("FOCUS_REFRESH_MIN_INTERVAL_MS");
  });

  it("ne sonde qu'en secours, à la cadence du palier", () => {
    expect(hook).toContain("REFRESH_CADENCE[stateRef.current.tier].detailFallbackMs");
    // Rien ne part quand l'onglet est caché.
    expect(hook).toContain('document.visibilityState === "hidden"');
    // Et le sondage s'arrête dès que le flux revient.
    expect(hook).toMatch(/source\.onopen[\s\S]*?stopFallback\(\)/);
  });

  it("libère tout au démontage", () => {
    expect(hook).toContain('document.removeEventListener("visibilitychange", onVisible)');
    expect(hook).toContain('window.removeEventListener("online", onVisible)');
    expect(hook).toContain("stopFallback();");
    expect(hook).toContain("source?.close();");
  });
});

describe("page de tournoi", () => {
  it("relit immédiatement après une action de l'utilisateur", () => {
    // Celui qui agit mérite un retour instantané, quel que soit son palier.
    expect(detailPage).toContain("const { tournament: detail, refresh } = useTournamentLive");
    // Score, abandon, inscription, arbitrage, seeding, équipe fantôme.
    expect(detailPage.match(/void refresh\(\)/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("n'appelle plus router.refresh() sur une page cliente", () => {
    // Sans effet ici : les données viennent du hook, pas du rendu serveur.
    expect(detailPage).not.toContain("router.refresh()");
  });
});

describe("liste des tournois", () => {
  it("se rafraîchit d'elle-même à la cadence du palier", () => {
    expect(listPage).toContain("useAutoRefresh");
    expect(listPage).toContain("REFRESH_CADENCE[resolveRefreshTier({ isStaff: isAdmin })].listIntervalMs");
  });

  it("tait l'échec des rafraîchissements de fond", () => {
    // Un incident réseau passager ne doit pas couvrir l'écran de notifications.
    expect(listPage).toContain("if (failure && !silent) showError");
    expect(listPage).toContain("useAutoRefresh(() => load(true)");
  });

  it("fait basculer les états sans requête", () => {
    expect(listPage).toContain("useScheduledBuckets(buckets)");
    expect(listPage).toContain("useScheduledBuckets(myBuckets)");
  });
});

describe("instantané partagé", () => {
  it("déclenche la bascule d'état à la lecture, quel que soit l'état courant", () => {
    // Avant, l'entretien était réservé aux tournois déjà RUNNING : la page d'un
    // tournoi dont l'heure de début était passée restait aux inscriptions
    // jusqu'à ce que quelqu'un charge la liste.
    expect(snapshot).toContain("(await hasPendingStateTransition(tournamentRow)) ||");
  });

  it("porte une empreinte du contenu", () => {
    expect(snapshot).toContain("function snapshotVersion");
    expect(snapshot).toContain("const version = snapshotVersion(payload);");
  });

  it("encode la trame une seule fois", () => {
    // Elle part telle quelle à tous les abonnés de la salle.
    expect(snapshot).toContain("const frame = encoder.encode(");
  });

  it("mutualise la construction", () => {
    expect(snapshot).toContain("cached(cacheKey(tournamentId), SNAPSHOT_TTL_MS,");
  });
});
