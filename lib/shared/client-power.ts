/**
 * Régime de charge du navigateur : ce que la page a le droit de coûter.
 *
 * Un joueur de BlueGenji a très souvent le site **ouvert pendant qu'il joue** —
 * sur un second écran, ou derrière Overwatch / Marvel Rivals en plein écran —
 * pour voir son prochain adversaire et rapporter son score. Chaque image que la
 * page peint pendant ce temps (fond animé, halos, pastilles qui pulsent, arbre
 * redessiné à chaque score d'un autre match) est prise au jeu : processeur,
 * carte graphique et mémoire sont les mêmes.
 *
 * D'où quatre régimes, décidés ici et nulle part ailleurs :
 *
 * - `FULL` — la page est regardée et le lecteur n'a pas de match en cours :
 *   tout tourne ;
 * - `ECO` — la page est visible mais n'a pas le focus (second écran), **ou** la
 *   machine est à la peine (peu de cœurs, peu de mémoire, cadence d'affichage
 *   mesurée sous ~36 images/s — économiseur de batterie, navigateur bridé), ou
 *   le système demande de réduire les animations : plus aucune animation
 *   décorative, mais **toute donnée reçue s'affiche** — c'est justement là qu'on
 *   guette le début de son match ;
 * - `MATCH` — le lecteur a une rencontre en cours, de son coup d'envoi à son
 *   résultat : on retire tout ce qui n'est pas indispensable, focus ou non, et
 *   la mémoire du fond animé est rendue ;
 * - `SLEEP` — l'onglet est caché : rien ne se peint, les instantanés reçus
 *   attendent le retour pour être rendus, et hors match le flux descend au
 *   palier spectateur après une minute (le serveur y gagne autant que le poste).
 *
 * Ce qu'on ne coupe **jamais** : le flux SSE du tournoi et la détection des
 * évènements qui concernent le lecteur (match prêt, score à confirmer, manche
 * suivante), qui déclenchent le signal sonore et le titre d'onglet même quand
 * rien n'est rendu. Couper ce flux ferait manquer l'annonce qu'on attend — le
 * flux de `/bot`, qui n'annonce rien à personne, se ferme, lui, onglet caché.
 *
 * Module pur : aucune dépendance au navigateur, testable tel quel.
 */

/** Ce que l'utilisateur fait de la page, lu sur le document. */
export type PageAttention =
  /** Visible, et la fenêtre a le focus. */
  | "FOCUSED"
  /** Visible, mais le focus est ailleurs — un jeu, un autre écran. */
  | "BACKGROUND"
  /** Onglet caché, fenêtre réduite ou recouverte. */
  | "HIDDEN";

export type ClientPowerMode = "FULL" | "ECO" | "MATCH" | "SLEEP";

export type ClientPowerInput = {
  attention: PageAttention;
  /** Le lecteur a une rencontre en cours, dans cet onglet ou dans un autre. */
  matchFocus: boolean;
  /** `prefers-reduced-motion: reduce` — l'utilisateur a déjà demandé le calme. */
  reducedMotion?: boolean;
  /**
   * Machine ou navigateur à la peine (voir {@link performanceLimits}), et le
   * lecteur n'a pas demandé d'ignorer la détection.
   */
  performanceLimited?: boolean;
};

/** Sort du fond animé (`BgCanvas`). */
export type CanvasPolicy =
  /** Animé, cadence plafonnée. */
  | "ANIMATE"
  /** Une image fixe, plus aucune boucle. */
  | "STILL"
  /** Plus rien : le tampon de pixels est rendu au navigateur. */
  | "RELEASE";

export type ClientPowerPolicy = {
  mode: ClientPowerMode;
  /** Animations décoratives (CSS infinies, halos, rotations). */
  decorativeMotion: boolean;
  canvas: CanvasPolicy;
  /**
   * Délai maximal avant de **rendre** un instantané reçu qui ne touche pas le
   * lecteur. `0` = tout de suite ; `null` = pas avant le retour sur l'onglet.
   * Ce qui touche le lecteur (son match) est toujours rendu sans attendre.
   */
  snapshotRenderDelayMs: number | null;
  /** Horloges d'affichage (comptes à rebours, durées). */
  clocks: boolean;
  /**
   * Descendre le flux au palier spectateur après ce délai d'onglet caché ;
   * `null` = jamais. Hors match seulement : en match, le joueur doit entendre
   * « score à confirmer » à la seconde.
   */
  quietStreamAfterMs: number | null;
};

/**
 * Regroupement des rendus d'un joueur en match qui regarde ailleurs. Cinq
 * secondes : l'arbre d'un gros tournoi n'est redessiné qu'une fois pour tous les
 * scores des autres matchs tombés dans l'intervalle, et un second écran reste
 * à jour bien avant qu'on y jette un œil.
 */
export const MATCH_BACKGROUND_RENDER_DELAY_MS = 5_000;

/**
 * Délai d'onglet caché avant de descendre au palier spectateur. Une minute :
 * alterner entre deux onglets ne doit pas faire rouvrir le flux à chaque fois
 * (la reconnexion renvoie l'instantané entier), mais un onglet laissé derrière
 * un jeu pendant une soirée ne doit pas recevoir chaque score à la seconde.
 */
export const QUIET_STREAM_AFTER_MS = 60_000;

/**
 * Régime correspondant à une situation. L'onglet caché l'emporte sur tout, puis
 * le match ; une page sans focus, une machine à la peine et une demande de
 * mouvement réduit mènent toutes trois à `ECO` — ce régime *est* la page sans
 * animation, il n'y a pas lieu d'en tenir trois variantes.
 */
export function resolvePowerMode(input: ClientPowerInput): ClientPowerMode {
  if (input.attention === "HIDDEN") return "SLEEP";
  if (input.matchFocus) return "MATCH";
  if (input.attention === "BACKGROUND" || input.performanceLimited || input.reducedMotion) {
    return "ECO";
  }
  return "FULL";
}

/** Ce que chaque régime autorise. La table est la règle. */
export function powerPolicy(input: ClientPowerInput): ClientPowerPolicy {
  const mode = resolvePowerMode(input);
  switch (mode) {
    case "FULL":
      return {
        mode,
        decorativeMotion: true,
        canvas: "ANIMATE",
        snapshotRenderDelayMs: 0,
        clocks: true,
        quietStreamAfterMs: null,
      };
    case "ECO":
      return {
        mode,
        decorativeMotion: false,
        canvas: "STILL",
        snapshotRenderDelayMs: 0,
        clocks: true,
        quietStreamAfterMs: null,
      };
    case "MATCH":
      return {
        mode,
        decorativeMotion: false,
        canvas: "RELEASE",
        // La page a le focus : le joueur vient y rapporter son score, il doit
        // voir ce qu'il fait. Sinon on regroupe.
        snapshotRenderDelayMs:
          input.attention === "FOCUSED" ? 0 : MATCH_BACKGROUND_RENDER_DELAY_MS,
        clocks: true,
        quietStreamAfterMs: null,
      };
    case "SLEEP":
      return {
        mode,
        decorativeMotion: false,
        canvas: "RELEASE",
        snapshotRenderDelayMs: null,
        clocks: false,
        quietStreamAfterMs: input.matchFocus ? null : QUIET_STREAM_AFTER_MS,
      };
  }
}

/** Valeur de l'attribut `data-power` posé sur `<html>`. */
export function powerModeAttribute(mode: ClientPowerMode): string {
  return mode.toLowerCase();
}

// ---------------------------------------------------------------------------
// Performances limitées
// ---------------------------------------------------------------------------

/**
 * Ce que le navigateur dit de la machine, et ce qu'on a mesuré.
 *
 * Les deux premiers champs sont **déclarés** (`navigator.hardwareConcurrency`,
 * `navigator.deviceMemory` — ce dernier n'existe que sous Chromium) ; le
 * troisième est **mesuré** : l'intervalle médian entre deux images. C'est le seul
 * qui attrape aussi le bridage imposé par le navigateur ou le système —
 * économiseur de batterie qui plafonne à 30 images par seconde, mode
 * « efficacité », jeu qui accapare la carte graphique —, qu'aucune API ne dit.
 */
export type PerformanceProbe = {
  cores: number | null;
  memoryGb: number | null;
  /** Intervalle médian entre deux images, en ms ; `null` tant qu'on n'a pas mesuré. */
  frameIntervalMs: number | null;
};

export const UNKNOWN_PROBE: PerformanceProbe = { cores: null, memoryGb: null, frameIntervalMs: null };

export type PerformanceLimit = "LOW_CORES" | "LOW_MEMORY" | "SLOW_FRAMES";

/** Deux cœurs logiques ou moins : le navigateur et un jeu se les disputent. */
export const LOW_CORES_MAX = 2;
/** Deux gigaoctets ou moins (valeur arrondie par le navigateur). */
export const LOW_MEMORY_GB_MAX = 2;
/**
 * Au-delà de 28 ms entre deux images (sous ~36 images/s), l'affichage est
 * ralenti : 30 images/s plafonnées par un économiseur, ou une machine qui ne
 * suit plus. Un écran à 60 Hz en donne 16,7, à 144 Hz 6,9.
 */
export const SLOW_FRAME_INTERVAL_MS = 28;
/** Nombre d'images mesurées par relevé (≈ 1,5 s à 60 Hz). */
export const FRAME_SAMPLE_SIZE = 90;

/**
 * Intervalle médian entre des instants d'images successifs (horodatages de
 * `requestAnimationFrame`). La médiane et non la moyenne : l'image longue d'une
 * hydratation ou d'un rendu d'arbre ne dit rien de la cadence habituelle.
 * `null` sous dix intervalles — trop peu pour conclure.
 */
export function medianFrameInterval(timestamps: readonly number[]): number | null {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (Number.isFinite(gap) && gap > 0) intervals.push(gap);
  }
  if (intervals.length < 10) return null;
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0 ? (intervals[mid - 1] + intervals[mid]) / 2 : intervals[mid];
}

/**
 * L'affichage est-il ralenti ? `null` (pas encore mesuré) ne conclut rien.
 *
 * Aucun seuil de sortie : une fois le ralenti constaté, l'appelant **ne mesure
 * plus** (voir `useClientPower`). Une mesure prise en éco — animations coupées —
 * n'est pas comparable à celle qui l'a déclenché : une machine lente *à cause*
 * des animations du site mesurerait vite, repasserait en régime complet,
 * ralentirait et rebasculerait, indéfiniment. Aucun écart entre deux seuils ne
 * casse une boucle de rétroaction ; seul le fait de ne pas remesurer le fait.
 */
export function isSlowFrameInterval(intervalMs: number | null): boolean {
  return intervalMs !== null && intervalMs > SLOW_FRAME_INTERVAL_MS;
}

/**
 * Limites constatées. `slowFrames` est tenu par l'appelant : un ralenti constaté
 * le reste jusqu'au rechargement ({@link isSlowFrameInterval}).
 */
export function performanceLimits(probe: PerformanceProbe, slowFrames: boolean): PerformanceLimit[] {
  const limits: PerformanceLimit[] = [];
  // Le nombre de cœurs n'est cru que si le navigateur déclare **aussi** sa
  // mémoire (Chromium, qui ne maquille ni l'un ni l'autre) : Firefox en mode
  // anti-empreinte (`resistFingerprinting`) et Tor Browser annoncent toujours
  // deux cœurs, et tiendraient en éco une machine à seize. Une vraie machine
  // modeste sous Firefox est de toute façon rattrapée par la cadence mesurée.
  if (
    probe.memoryGb !== null &&
    probe.cores !== null &&
    probe.cores > 0 &&
    probe.cores <= LOW_CORES_MAX
  ) {
    limits.push("LOW_CORES");
  }
  if (probe.memoryGb !== null && probe.memoryGb > 0 && probe.memoryGb <= LOW_MEMORY_GB_MAX) {
    limits.push("LOW_MEMORY");
  }
  if (slowFrames) limits.push("SLOW_FRAMES");
  return limits;
}

// ---------------------------------------------------------------------------
// Témoin
// ---------------------------------------------------------------------------

/**
 * Pourquoi la page est dans son régime. Le témoin les affiche : un joueur qui se
 * plaint d'un fond figé ou d'une page « qui ne bouge plus » doit pouvoir lire,
 * et nous dire, qu'il est en mode éco et pour quelle raison.
 */
export type PowerReason =
  | "HIDDEN"
  | "MATCH"
  | "BACKGROUND"
  | "REDUCED_MOTION"
  | "LOW_CORES"
  | "LOW_MEMORY"
  | "SLOW_FRAMES";

/**
 * Raisons actives, dans l'ordre où elles décident. `limits` ne compte que si la
 * détection n'est pas ignorée — `input.performanceLimited` le dit déjà.
 */
export function powerReasons(input: ClientPowerInput, limits: readonly PerformanceLimit[]): PowerReason[] {
  const reasons: PowerReason[] = [];
  if (input.attention === "HIDDEN") reasons.push("HIDDEN");
  if (input.matchFocus) reasons.push("MATCH");
  if (input.attention === "BACKGROUND") reasons.push("BACKGROUND");
  if (input.reducedMotion) reasons.push("REDUCED_MOTION");
  if (input.performanceLimited) reasons.push(...limits);
  return reasons;
}

export function powerModeLabel(mode: ClientPowerMode): string {
  switch (mode) {
    case "FULL":
      return "Complet";
    case "ECO":
      return "Éco";
    case "MATCH":
      return "Match";
    case "SLEEP":
      return "Veille";
  }
}

/** Ce que le régime retire, en une phrase lisible par un joueur. */
export function powerModeDescription(mode: ClientPowerMode): string {
  switch (mode) {
    case "FULL":
      return "Toutes les animations tournent.";
    case "ECO":
      return "Animations décoratives et fond animé suspendus ; les données restent à jour en direct.";
    case "MATCH":
      return "Page allégée pendant ton match : animations suspendues, mémoire du fond rendue, plateau des autres matchs rafraîchi toutes les 5 s quand tu regardes ton jeu. Ton match, lui, s'affiche tout de suite.";
    case "SLEEP":
      return "Onglet caché : rien n'est dessiné, tu seras prévenu par le titre de l'onglet et un signal sonore.";
  }
}

export function powerReasonLabel(reason: PowerReason, probe: PerformanceProbe): string {
  switch (reason) {
    case "HIDDEN":
      return "Onglet caché ou fenêtre réduite";
    case "MATCH":
      return "Tu as un match en cours";
    case "BACKGROUND":
      return "La page n'a pas le focus (jeu, autre fenêtre ou second écran)";
    case "REDUCED_MOTION":
      return "Ton système demande de réduire les animations";
    case "LOW_CORES":
      return `Processeur modeste (${probe.cores ?? "?"} cœur${(probe.cores ?? 0) > 1 ? "s" : ""})`;
    case "LOW_MEMORY":
      return `Mémoire modeste (${probe.memoryGb ?? "?"} Go)`;
    case "SLOW_FRAMES":
      return probe.frameIntervalMs
        ? `Affichage ralenti (≈ ${Math.round(1000 / probe.frameIntervalMs)} images/s mesurées — économiseur de batterie, navigateur bridé ou machine chargée)`
        : "Affichage ralenti";
  }
}

/**
 * Le témoin ne s'affiche que pour un régime qui **tient page regardée** : match,
 * machine à la peine, mouvement réduit. Hors du régime complet donc, mais pas
 * pour la seule absence de focus — cliquer le témoin rendrait le focus à la
 * page, qui repasserait en régime complet et le ferait disparaître sous le
 * pointeur ; et cette cause-là se lève d'elle-même au premier clic. En veille,
 * personne ne le verrait.
 *
 * Une exception, `ignoredLimits` : le lecteur a demandé d'ignorer une limite
 * **constatée**. La page repasse alors en régime complet, mais le témoin reste —
 * c'est lui qui porte la case qui défait ce choix, et il dit ce qui a été vu.
 */
export function showsPowerBadge(
  mode: ClientPowerMode,
  reasons: readonly PowerReason[],
  ignoredLimits = false,
): boolean {
  if (mode === "SLEEP") return false;
  if (ignoredLimits) return true;
  if (mode !== "ECO" && mode !== "MATCH") return false;
  return reasons.some((reason) => reason !== "BACKGROUND" && reason !== "HIDDEN");
}

/** Clé `localStorage` : le lecteur a demandé d'ignorer la détection de performances. */
export const IGNORE_PERFORMANCE_STORAGE_KEY = "bg_power_ignore_perf";

// ---------------------------------------------------------------------------
// Match en cours du lecteur
// ---------------------------------------------------------------------------

/**
 * Avance prise sur l'horaire annoncé d'une rencontre : le régime `MATCH` part
 * dix minutes avant, le temps de lancer le jeu et de rejoindre le salon.
 */
export const MATCH_FOCUS_LEAD_MS = 10 * 60_000;

/** Ce dont la détection a besoin — satisfait par `TournamentDetail`. */
export type MatchFocusDetail = {
  card: { state: string };
  myTeamId: number | null;
  matches: ReadonlyArray<{
    status: string;
    team1Id: number | null;
    team2Id: number | null;
    startAt: string | null;
  }>;
};

/**
 * Rencontres du lecteur qui se jouent ou vont se jouer : prêtes (les deux
 * engagées connues) ou en attente de confirmation du score. Une exemption n'a
 * qu'une engagée, elle ne se joue pas.
 */
function viewerOpenMatches(detail: MatchFocusDetail) {
  const me = detail.myTeamId;
  if (me === null || detail.card.state !== "RUNNING") return [];
  return detail.matches.filter(
    (match) =>
      (match.status === "READY" || match.status === "AWAITING_CONFIRMATION") &&
      match.team1Id !== null &&
      match.team2Id !== null &&
      (match.team1Id === me || match.team2Id === me),
  );
}

/** Instant (ms) à partir duquel une rencontre met le lecteur en régime `MATCH`. */
function focusStartsAt(match: { startAt: string | null }): number {
  if (!match.startAt) return Number.NEGATIVE_INFINITY;
  const at = Date.parse(match.startAt);
  // Un horaire illisible ne doit pas retenir le calme : on le traite comme
  // absent, c'est-à-dire « jouable maintenant ».
  return Number.isFinite(at) ? at - MATCH_FOCUS_LEAD_MS : Number.NEGATIVE_INFINITY;
}

/**
 * Le lecteur a-t-il une rencontre en cours ?
 *
 * Du **coup d'envoi** (rencontre prête sans horaire, ou horaire proche) au
 * **résultat** (la rencontre passe `COMPLETED`). Une rencontre en attente de
 * confirmation compte encore : l'adversaire peut contester, et le joueur est
 * toujours dans sa partie.
 */
export function viewerMatchFocus(detail: MatchFocusDetail | null, now: number): boolean {
  if (!detail) return false;
  return viewerOpenMatches(detail).some((match) => focusStartsAt(match) <= now);
}

/**
 * Prochain instant où {@link viewerMatchFocus} changera **sans qu'aucune donnée
 * n'arrive** : l'approche d'un horaire annoncé. `null` s'il n'y en a pas — les
 * autres bascules passent toutes par un instantané du flux.
 */
export function nextViewerMatchFocusChangeAt(
  detail: MatchFocusDetail | null,
  now: number,
): number | null {
  if (!detail) return null;
  let next: number | null = null;
  for (const match of viewerOpenMatches(detail)) {
    const at = focusStartsAt(match);
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Bail inter-onglets
// ---------------------------------------------------------------------------

/**
 * Clé `localStorage` du régime `MATCH` partagé entre onglets : l'onglet du
 * tournoi le déclare, l'accueil ouvert à côté se calme aussi. Aucune donnée
 * personnelle — un identifiant d'onglet tiré au hasard et une échéance.
 */
export const MATCH_FOCUS_STORAGE_KEY = "bg_match_focus";

/**
 * Durée d'un bail. Renouvelé tant que l'onglet reste en match : un onglet fermé
 * brutalement (plantage, arrêt de la machine) ne laisse pas les autres calmés
 * plus longtemps que cela.
 */
export const MATCH_FOCUS_LEASE_MS = 20 * 60_000;

/** Baux par onglet : identifiant d'onglet → échéance (ms). */
export type MatchFocusLeases = Record<string, number>;

/** Lit la valeur stockée ; tout ce qui n'est pas un bail valide est ignoré. */
export function parseMatchFocusLeases(raw: string | null | undefined): MatchFocusLeases {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const leases: MatchFocusLeases = {};
  for (const [tab, until] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof until === "number" && Number.isFinite(until)) leases[tab] = until;
  }
  return leases;
}

/** Retire les baux échus. */
export function pruneMatchFocusLeases(leases: MatchFocusLeases, now: number): MatchFocusLeases {
  const kept: MatchFocusLeases = {};
  for (const [tab, until] of Object.entries(leases)) {
    if (until > now) kept[tab] = until;
  }
  return kept;
}

/** Pose (ou retire, `until = null`) le bail d'un onglet, en purgeant les échus. */
export function updateMatchFocusLease(
  leases: MatchFocusLeases,
  tabId: string,
  until: number | null,
  now: number,
): MatchFocusLeases {
  const next = pruneMatchFocusLeases(leases, now);
  if (until === null) delete next[tabId];
  else next[tabId] = until;
  return next;
}

/** Échéance du dernier bail encore valide, ou `null` : personne n'est en match. */
export function activeMatchFocusUntil(leases: MatchFocusLeases, now: number): number | null {
  let latest: number | null = null;
  for (const until of Object.values(leases)) {
    if (until > now && (latest === null || until > latest)) latest = until;
  }
  return latest;
}
