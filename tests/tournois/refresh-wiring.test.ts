import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Le flux SSE, le hook et les pages sont du câblage : pas de rendu testable ici
 * (composants clients, pas de DOM en test). Ce fichier vérifie donc au niveau
 * source — comme les autres pages du projet — mais **uniquement des invariants
 * qu'aucun test de comportement ne peut tenir** : le point de décision d'un
 * palier, un plafond appliqué, un garde-fou de dégradation.
 *
 * Ce qui a une logique propre est couvert ailleurs, et doit le rester :
 * `live-state.test.ts` (analyse et fusion des messages, reconnexion, échecs
 * définitifs), `tournament-broadcast.test.ts` (mutualisation, paliers, budget,
 * cycle de vie des salles), `cache.test.ts` (vol unique, invalidation),
 * `tournament-schedule.test.ts` (reclassement, comparaison des paniers),
 * `tournament-snapshot-frame.test.ts` (trame SSE), `tournament-snapshot.test.ts`
 * (mutualisation, entretien à la lecture), `state-running-maintenance.test.ts`
 * (`stateChanged`) et `app/api/tournaments/stream.test.ts` (accès, palier,
 * plafonds, place de flux rendue). Recopier ici l'expression exacte que ces
 * tests exercent déjà ne protégerait rien et casserait au premier remaniement.
 */
const stream = read("app/api/tournaments/[id]/stream/route.ts");
const hook = read("app/(secured)/tournois/[id]/_hooks/useTournamentLive.ts");
const detailPage = read("app/(secured)/tournois/[id]/page.tsx");
const listPage = read("app/(secured)/tournois/page.tsx");
const index = read("lib/server/tournaments/index.ts");
const visitTracker = read("components/visit-tracker.tsx");

describe("flux SSE — le contrat de la route", () => {
  it("envoie l'instantané et le contexte du lecteur d'emblée", () => {
    // C'est ce qui supprime le `GET /api/tournaments/:id` du cas nominal.
    expect(stream).toContain('type: "connected"');
    expect(stream).toContain("viewer,");
    expect(stream).toContain("snapshot,");
    expect(stream).toContain("tier,");
  });

  it("laisse le serveur décider du palier", () => {
    // Un client ne doit pas pouvoir se déclarer prioritaire : le palier se lit
    // sur la session et sur l'instantané, jamais sur la requête. Qui y entre est
    // vérifié par le comportement (`app/api/tournaments/stream.test.ts`).
    expect(stream).toMatch(/const tier = resolveRefreshTier\(/);
    expect(stream).toMatch(/const isParticipant =[\s\S]*?registrations\.some/);
  });

  it("plafonne les flux simultanés et leur rythme d'ouverture", () => {
    // Le second plafond n'est pas redondant : une fermeture libère aussitôt la
    // place, si bien qu'une boucle ouverture/fermeture échappe au premier.
    expect(stream).toContain("acquireStreamSlot(user.id)");
    expect(stream).toContain("enforceRateLimit(STREAM_OPEN_RULE, user.id)");
    expect(stream).toMatch(/status: 429/);
  });

  it("journalise une ouverture de flux impossible", () => {
    // `controller.error()` est un no-op sur un flux déjà fermé : sans trace, une
    // panne systématique ne se verrait que par des reconnexions perpétuelles.
    expect(stream).toMatch(/console\.error\([\s\S]{0,120}ouverture impossible/);
  });

  it("garde la connexion ouverte sans réveiller le client", () => {
    // Une ligne de commentaire SSE n'est pas remise à `onmessage`, et le proxy
    // ne doit pas mettre le flux en tampon.
    expect(stream).toContain("`: ping\\n\\n`");
    expect(stream).toContain('"X-Accel-Buffering": "no"');
  });
});

describe("hook temps réel — les garde-fous de dégradation", () => {
  it("n'abandonne jamais la reconnexion, sauf échec définitif", () => {
    // L'ancienne version renonçait après cinq essais : la page restait figée
    // jusqu'au F5. À l'inverse, réessayer sur une session expirée laisserait
    // « Reconnexion… » à l'écran pour l'éternité.
    expect(hook).not.toContain("maxReconnectAttempts");
    expect(hook).toMatch(/source\.onopen = \(\) => \{[\s\S]*?attempts = 0;/);
    expect(hook).toContain("const giveUp = (failure: LiveFailure)");
    expect(hook).toContain("showError(mapError(failure))");
  });

  it("rafraîchit au retour sur l'onglet, mais pas par-dessus un flux vivant", () => {
    // Relire alors que le flux tient relancerait, à la fin d'une manche, la
    // centaine de requêtes que ce flux existe pour éviter.
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(hook).toContain('window.addEventListener("online", onVisible)');
    expect(hook).toContain("FOCUS_REFRESH_MIN_INTERVAL_MS");
    expect(hook).toContain("if (!source && stale && !recentlyFetched) void load(true)");
  });

  it("ne sonde qu'en secours, à la cadence du palier", () => {
    expect(hook).toContain("REFRESH_CADENCE[stateRef.current.tier].detailFallbackMs");
    // Rien ne part quand l'onglet est caché, et le sondage cesse dès le retour
    // du flux comme après un échec définitif.
    expect(hook).toContain('document.visibilityState === "hidden"');
    expect(hook).toMatch(/source\.onopen[\s\S]*?stopFallback\(\)/);
    expect(hook).toContain("if (fallbackTimer !== null || stopped) return;");
  });

  it("repart de zéro quand on change de tournoi", () => {
    // L'App Router réutilise le composant d'un paramètre à l'autre : sans cette
    // remise à zéro, l'échec définitif du tournoi précédent condamnerait le
    // suivant, et son plateau s'afficherait un instant sous la mauvaise URL.
    expect(hook).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,300}?setFatal\(null\);[\s\S]{0,40}?\}, \[tournamentId\]\);/,
    );
  });

  it("libère tout au démontage", () => {
    expect(hook).toContain('document.removeEventListener("visibilitychange", onVisible)');
    expect(hook).toContain('window.removeEventListener("online", onVisible)');
    expect(hook).toContain("stopFallback();");
    expect(hook).toContain("source?.close();");
  });
});

describe("page de tournoi — ce que voit le lecteur", () => {
  it("relit immédiatement après une action de l'utilisateur", () => {
    // Celui qui agit mérite un retour instantané, quel que soit son palier :
    // score, abandon, inscription, arbitrage, seeding, équipe fantôme.
    expect(detailPage.match(/void refresh\(\)/g)?.length).toBeGreaterThanOrEqual(6);
    // `router.refresh()` n'a aucun effet ici : les données viennent du hook.
    expect(detailPage).not.toContain("router.refresh()");
  });

  it("sort de l'attente quand l'échec précède la donnée", () => {
    // Sans ce cas, la page resterait sur « Chargement… » pour toujours : le seul
    // état où il ne reste que le F5, et où il ne sert à rien.
    expect(detailPage).toContain("if (fatal && !detail) {");
    expect(detailPage).toContain('href={fatal === "UNAUTHORIZED" ? "/connexion" : "/tournois"}');
  });

  it("retire les actions quand le suivi est arrêté", () => {
    // Une équipe qui saisit son score en fin de manche n'a aucun moyen de
    // deviner que son plateau date de plusieurs minutes — l'arbitrage non plus.
    expect(detailPage).toContain("const frozen = fatal !== null;");
    expect(detailPage).toMatch(/const canReport = [\s\S]{0,80}if \(frozen\) return false;/);
    expect(detailPage).toMatch(/const canAdminResolve = [\s\S]{0,80}if \(frozen\) return false;/);
    expect(detailPage).toMatch(/canForfeit = [\s\S]{0,40}!frozen/);
    // La plus destructrice des actions de la page suit la même règle : on ne
    // supprime pas un tournoi depuis un plateau dont on sait qu'il est périmé.
    expect(detailPage).toMatch(/detail\.canDelete && !frozen/);
  });

  it("dit au lecteur que la page se tient à jour seule", () => {
    // Sans repère visible, on recharge par précaution même quand tout arrive.
    expect(detailPage).toContain("<LiveIndicator isLive={isLive} tier={tier} fatal={fatal} />");
  });
});

describe("liste des tournois — sans flux SSE", () => {
  it("se rafraîchit d'elle-même à la cadence du palier", () => {
    expect(listPage).toContain("useAutoRefresh");
    // La cadence vient du palier, jamais d'un nombre écrit sur place.
    expect(listPage).toContain("refreshCadenceFor({ isStaff: isAdmin }).listIntervalMs");
    // Un incident réseau passager ne doit pas couvrir l'écran de notifications,
    // pas plus qu'une requête abandonnée par le rafraîchissement suivant.
    expect(listPage).toContain("if (signal?.aborted || silent) return;");
  });

  it("fait basculer les états sans requête, bandeau compris", () => {
    // Sinon le bandeau annoncerait « À VENIR » un tournoi affiché juste dessous
    // en « INSCRIPTIONS ».
    // Une seule horloge, un seul minuteur : les deux jeux se recouvrent presque
    // entièrement.
    expect(listPage).toContain("useScheduledBuckets(buckets)");
    expect(listPage).toContain("buildTickerItems(scheduledBuckets)");
  });

  it("rafraîchit aussi la section des invisibles", () => {
    // La seule section réservée à ceux qui vivent sur cette page ne doit pas
    // être la seule à exiger un F5.
    expect(listPage).toContain("const loadHidden = useCallback(");
    expect(listPage).toContain("loadHidden(true, signal)");
    expect(listPage).toContain("sameTournaments(previous, hidden) ? previous : hidden");
  });

  it("ne se redessine pas pour une réponse identique", () => {
    expect(listPage).toContain("sameBuckets(previous, all) ? previous : all");
  });
});

describe("lectures serveur — ce qui garde le cache utile", () => {
  it("synchronise les états hors du cache, sans en faire une condition", () => {
    // Dedans, les événements publiés par la synchronisation invalideraient la
    // liste qu'elle vient de rendre correcte ; et son échec ne doit pas vider
    // `/tournois` alors que le cache tenait une liste servable.
    expect(index).toContain("await syncVisibleTournaments().catch(() => undefined);");
    expect(index.indexOf("await syncVisibleTournaments().catch(")).toBeLessThan(
      index.indexOf('cachedTournamentList("public"'),
    );
  });

  it("fait apparaître un tournoi créé sans attendre le cache", () => {
    // Sans cela, l'auteur revient sur la liste, ne le voit pas, et rafraîchit —
    // au moment précis où il cherche une confirmation.
    expect(index).toMatch(
      /await connection\.commit\(\);[\s\S]{0,400}invalidateTournamentLists\(\);\s*return tournamentId;/,
    );
  });

  it("rattrape la clôture qu'un score provoque, sans risquer l'écriture", () => {
    // Les événements de score ne touchent plus aux listes ; la comparaison
    // d'état s'en charge — et n'a pas le droit de lever après le commit.
    expect(index).toContain("await invalidateListsIfStateChanged(tournamentId, stateBefore);");
    expect(index).toMatch(
      /async function invalidateListsIfStateChanged\([\s\S]{0,700}?try \{[\s\S]{0,300}?\} catch \{/,
    );
  });

  it("mutualise l'aperçu du plateau entre lecteurs autorisés", () => {
    // Gaté par une permission, mais identique pour tous ceux qui y ont droit :
    // le recalculer par lecteur referait la requête de classement du site à
    // chaque connexion SSE.
    expect(index).toContain("const preview = canPreview ? await getTournamentPreview(");
    const notifications = read("lib/server/tournaments/notifications.ts");
    expect(notifications).toContain("invalidateTournamentPreview(tournamentId);");

    // Et il ne sort pas du module : sa signature ne porte aucun droit, le seul
    // chemin public passe par `getTournamentViewerContext`, qui l'exige.
    expect(index).not.toContain("export { getTournamentPreview");
  });

  it("ne réserve une connexion que là où elle sert", () => {
    // En tournoi par équipes, `getUserActiveTeam` ouvre sa propre requête :
    // réserver une place d'un pool de 25 pour ne rien en faire doublerait la
    // pression à chaque connexion SSE.
    expect(index).toContain("const myTeamId = isSolo");
    expect(index).toContain("(await getUserActiveTeam(userId))?.teamId ?? null;");
  });
});
describe("compteur de visites — déduplication dans l'onglet", () => {
  it("ne pose la marque qu'après une réponse acceptée", () => {
    // `fetch` ne rejette que sur incident réseau : un 500 (serveur en
    // redémarrage) ou un 429 arrive dans le `then`. Marquer là ferait perdre la
    // visite pour toute la fenêtre alors que rien n'a été enregistré — et c'est
    // au redémarrage que toutes les visites en cours tombent ensemble.
    expect(visitTracker).toMatch(/response\.ok\s*\)\s*rememberPing\(\)/);
    expect(visitTracker).not.toContain(".then(() => rememberPing())");
  });
});
