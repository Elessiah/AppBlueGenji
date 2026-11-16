/**
 * Suivi des pages vues dans le navigateur — sans DOM ni horloge propres (tout
 * est injecté), pour être testé seul. Monté par `<AudienceBeacon />`.
 *
 * Une **page vue** court de son affichage à la navigation suivante, ou au
 * passage de l'onglet en arrière-plan ; seul le temps **onglet visible** est
 * compté. Revenu au premier plan, l'onglet ouvre une **suite** (`c: 1`), qui
 * n'apporte que du temps à la même page. Rien n'est gardé dans le navigateur :
 * la file vit en mémoire de la page et part par lots.
 */
import {
  AUDIENCE_CLIENT_FLUSH_SIZE,
  AUDIENCE_MAX_BATCH,
  AUDIENCE_MAX_ENGAGED_MS,
  audiencePageKey,
  type AudienceBeaconEntry,
  type AudienceDevice,
} from "@/lib/shared/audience";

export interface AudienceTrackerDeps {
  now(): number;
  isVisible(): boolean;
  device(): AudienceDevice;
  /** Nom d'hôte du référent externe de l'arrivée, ou `null`. */
  referrerHost(): string | null;
  send(entries: AudienceBeaconEntry[]): void;
}

interface Segment {
  path: string;
  startedAt: number;
  engagedMs: number;
  visibleSince: number | null;
  first: boolean;
  continuation: boolean;
}

export class AudienceTracker {
  private current: Segment | null = null;
  /** File de la page : l'ancienneté `a` se calcule à l'envoi, d'après le début de la page vue. */
  private queue: { entry: AudienceBeaconEntry; startedAt: number }[] = [];
  private hiddenPath: string | null = null;
  private arrived = false;
  /** Page comptée en dernier : un retour au premier plan sur elle ouvre une suite. */
  private readonly wasCounted = new Set<string>();

  constructor(private readonly deps: AudienceTrackerDeps) {}

  /** La page affichée est `path` (premier affichage ou navigation interne). */
  navigate(path: string): void {
    if (this.current?.path === path) return;
    this.finish();
    if (!this.deps.isVisible()) {
      // Ouverte en arrière-plan : comptée au premier passage au premier plan.
      this.hiddenPath = path;
      this.current = null;
      return;
    }
    this.hiddenPath = null;
    this.start(path, false);
  }

  /** L'onglet passe en arrière-plan : la page en cours est close et la file part. */
  hidden(): void {
    const path = this.current?.path ?? this.hiddenPath;
    this.finish();
    this.hiddenPath = path;
    this.flush();
  }

  /** L'onglet revient au premier plan : une suite s'ouvre (ou la page vue, si elle n'avait jamais été visible). */
  visible(): void {
    if (this.current || !this.hiddenPath) return;
    const path = this.hiddenPath;
    this.hiddenPath = null;
    // Une page déjà comptée reprend en suite ; une page jamais vue s'ouvre pour de bon.
    this.start(path, this.wasCounted.has(path));
  }

  /** Départ de la page (fermeture, rechargement) : tout part. */
  leave(): void {
    this.finish();
    this.flush();
  }

  /** Envoi périodique de ce qui attend. */
  tick(): void {
    this.flush();
  }

  private start(path: string, continuation: boolean): void {
    const now = this.deps.now();
    const first = !continuation && !this.arrived;
    if (!continuation) this.arrived = true;
    this.current = { path, startedAt: now, engagedMs: 0, visibleSince: now, first, continuation };
  }

  private finish(): void {
    const segment = this.current;
    this.current = null;
    if (!segment) return;
    const now = this.deps.now();
    const engaged = segment.engagedMs + (segment.visibleSince === null ? 0 : now - segment.visibleSince);
    if (!audiencePageKey(segment.path)) return;
    const entry: AudienceBeaconEntry = {
      p: segment.path,
      t: Math.max(0, Math.min(AUDIENCE_MAX_ENGAGED_MS, Math.round(engaged))),
      a: 0,
      d: this.deps.device(),
    };
    if (segment.continuation) entry.c = 1;
    else {
      this.wasCounted.clear();
      this.wasCounted.add(segment.path);
    }
    if (segment.first) {
      entry.f = 1;
      entry.r = this.deps.referrerHost();
    }
    this.queue.push({ entry, startedAt: segment.startedAt });
    if (this.queue.length >= AUDIENCE_CLIENT_FLUSH_SIZE) this.flush();
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const now = this.deps.now();
    while (this.queue.length > 0) {
      this.deps.send(
        this.queue.splice(0, AUDIENCE_MAX_BATCH).map(({ entry, startedAt }) => ({ ...entry, a: Math.max(0, Math.round(now - startedAt)) })),
      );
    }
  }

  /** Taille de la file (tests). */
  get pendingCount(): number {
    return this.queue.length;
  }
}
