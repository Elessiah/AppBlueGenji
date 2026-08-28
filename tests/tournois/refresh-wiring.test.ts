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

  it("nettoie aussi quand la requête est déjà abandonnée", () => {
    // Un signal déjà avorté ne déclenche jamais son écouteur : sans ce
    // contrôle, la place de flux resterait prise pour toujours — et au bout de
    // quatre F5 rapides, l'utilisateur se verrait refuser son propre tournoi.
    expect(stream).toMatch(/if \(req\.signal\.aborted\) \{\s*cleanup\(\);\s*return;/);
  });

  it("borne aussi le rythme d'ouverture", () => {
    expect(stream).toContain("enforceRateLimit(STREAM_OPEN_RULE, user.id)");
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

  it("ne relit pas par-dessus un flux vivant", () => {
    // Sinon, à la fin d'une manche, cent spectateurs revenant sur leur onglet
    // relancent la centaine de requêtes que le flux existe pour éviter.
    expect(hook).toContain("if (!source && stale && !recentlyFetched) void load(true)");
  });

  it("ignore une lecture qui n'apporte rien", () => {
    expect(hook).toContain(
      "if (payload.version && payload.version === stateRef.current.detail?.version) return null;",
    );
  });

  it("cesse de réessayer sur un échec définitif", () => {
    // Une session expirée ne passera pas toute seule : réessayer indéfiniment
    // laisserait la page sur « Reconnexion… » pour l'éternité, sans jamais
    // orienter vers la page de connexion.
    expect(hook).toContain("const giveUp = (failure: LiveFailure)");
    expect(hook).toContain("showError(mapError(failure))");
    expect(hook).toMatch(/if \(cancelled \|\| stopped \|\| reconnectTimer !== null\) return;/);
    expect(hook).toContain("if (fallbackTimer !== null || stopped) return;");
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
    expect(detailPage).toContain(
      "const { tournament: detail, refresh, isLive, tier, fatal } = useTournamentLive",
    );
    // Score, abandon, inscription, arbitrage, seeding, équipe fantôme.
    expect(detailPage.match(/void refresh\(\)/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("sort de l'attente quand l'échec précède la donnée", () => {
    // Sans ce cas, la page resterait sur « Chargement… » pour toujours : le seul
    // état où il ne reste que le F5, et où il ne sert à rien.
    expect(detailPage).toContain("if (fatal && !detail) {");
    expect(detailPage).toContain('href={fatal === "UNAUTHORIZED" ? "/connexion" : "/tournois"}');
  });

  it("retire les actions quand le suivi est arrêté", () => {
    // Une équipe qui saisit son score en fin de manche n'a aucun moyen de
    // deviner que son plateau date de plusieurs minutes.
    expect(detailPage).toContain("const frozen = fatal !== null;");
    expect(detailPage.match(/!frozen/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("n'appelle plus router.refresh() sur une page cliente", () => {
    // Sans effet ici : les données viennent du hook, pas du rendu serveur.
    expect(detailPage).not.toContain("router.refresh()");
  });

  it("dit au lecteur que la page se tient à jour seule", () => {
    // Sans repère visible, on recharge par précaution même quand tout arrive.
    expect(detailPage).toContain("<LiveIndicator isLive={isLive} tier={tier} fatal={fatal} />");
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
    expect(listPage).toContain("useAutoRefresh((signal) => load(true, signal)");
  });

  it("fait basculer les états sans requête", () => {
    expect(listPage).toContain("useScheduledBuckets(buckets)");
    expect(listPage).toContain("useScheduledBuckets(myBuckets)");
  });

  it("ne se redessine pas pour une réponse identique", () => {
    // Sinon chaque relecture de fond redessine les 68 cartes et réarme les
    // minuteurs de bascule, pour un contenu inchangé.
    expect(listPage).toContain("sameBuckets(previous, all.value) ? previous : all.value");
    expect(listPage).toContain("sameBuckets(previous, mine.value) ? previous : mine.value");
  });

  it("fait suivre le bandeau au reclassement local", () => {
    // Sinon le bandeau annoncerait « À VENIR » un tournoi affiché juste dessous
    // en « INSCRIPTIONS ».
    expect(listPage).toContain("buildTickerItems(scheduledBuckets)");
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
    expect(snapshot).toContain("const version = snapshotVersion(payloadJson);");
  });

  it("ne sérialise l'instantané qu'une fois", () => {
    // Le hachage et la trame partagent le même JSON : sur un plateau de 254
    // matchs (~150 ko), le sérialiser deux fois se paie à chaque construction.
    expect(snapshot).toContain("const payloadJson = JSON.stringify(payload);");
    expect(snapshot.match(/JSON\.stringify\(payload\)/g)).toHaveLength(1);
  });

  it("mutualise la construction", () => {
    expect(snapshot).toContain("cached(cacheKey(tournamentId), SNAPSHOT_TTL_MS,");
  });

  it("ne réserve une connexion que là où elle sert", () => {
    // En tournoi par équipes, `getUserActiveTeam` ouvre sa propre requête :
    // réserver une place d'un pool de 25 pour ne rien en faire doublerait la
    // pression à chaque connexion SSE.
    const index = read("lib/server/tournaments/index.ts");
    expect(index).toContain("const myTeamId = isSolo");
    expect(index).toContain("(await getUserActiveTeam(userId))?.teamId ?? null;");
  });

  it("ne laisse pas l'entretien conditionner la lecture", () => {
    // La synchronisation est une transaction sur tous les tournois en cours :
    // son échec ne doit pas vider `/tournois` alors que le cache tenait une
    // liste parfaitement servable.
    const index = read("lib/server/tournaments/index.ts");
    expect(index).toContain("await syncVisibleTournaments().catch(() => undefined);");
  });

  it("synchronise les états en dehors du cache de liste", () => {
    // Dedans, les événements publiés par la synchronisation invalideraient la
    // liste qu'elle vient de rendre correcte.
    const index = read("lib/server/tournaments/index.ts");
    const sync = index.indexOf("await syncVisibleTournaments().catch(");
    const cachedCall = index.indexOf('cachedTournamentList("public"');
    expect(sync).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(cachedCall);
  });
});
