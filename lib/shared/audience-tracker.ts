/**
 * Suivi des pages vues dans le navigateur — sans DOM ni horloge propres (tout
 * est injecté), pour être testé seul. Monté par `<AudienceBeacon />`.
 *
 * Une **page vue** est signalée **à son affichage** (`t: 0`, datée de son
 * début : l'heure de la carte de chaleur est celle où la page s'ouvre, même
 * lue des heures). Son **temps** onglet visible part à sa clôture (navigation
 * suivante, onglet en arrière-plan, départ) dans une **suite** (`c: 1`), datée
 * de cette clôture : le repli y lit la fin de la lecture, d'où se mesure
 * l'écart avant une nouvelle visite. Revenu au premier plan, l'onglet ouvre
 * une nouvelle suite sur la même page. Rien n'est gardé dans le navigateur :
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
  engagedMs: number;
  visibleSince: number | null;
}

export class AudienceTracker {
  private current: Segment | null = null;
  /** File de la page : l'ancienneté `a` se calcule à l'envoi, d'après l'instant que l'entrée date. */
  private queue: { entry: AudienceBeaconEntry; at: number }[] = [];
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
    this.current = { path, engagedMs: 0, visibleSince: now };
    if (continuation || !audiencePageKey(path)) return;
    // La page vue part dès son affichage, datée de son début.
    this.wasCounted.clear();
    this.wasCounted.add(path);
    const entry: AudienceBeaconEntry = { p: path, t: 0, a: 0, d: this.deps.device() };
    if (first) {
      entry.f = 1;
      entry.r = this.deps.referrerHost();
    }
    this.enqueue(entry, now);
  }

  /** Clôt la page en cours : son temps onglet visible part en suite, datée de cette clôture. */
  private finish(): void {
    const segment = this.current;
    this.current = null;
    if (!segment) return;
    const now = this.deps.now();
    const engaged = segment.engagedMs + (segment.visibleSince === null ? 0 : now - segment.visibleSince);
    if (!audiencePageKey(segment.path)) return;
    const time = Math.max(0, Math.min(AUDIENCE_MAX_ENGAGED_MS, Math.round(engaged)));
    if (time === 0) return;
    this.enqueue({ p: segment.path, t: time, a: 0, d: this.deps.device(), c: 1 }, now);
  }

  private enqueue(entry: AudienceBeaconEntry, at: number): void {
    this.queue.push({ entry, at });
    if (this.queue.length >= AUDIENCE_CLIENT_FLUSH_SIZE) this.flush();
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const now = this.deps.now();
    while (this.queue.length > 0) {
      this.deps.send(
        this.queue.splice(0, AUDIENCE_MAX_BATCH).map(({ entry, at }) => ({ ...entry, a: Math.max(0, Math.round(now - at)) })),
      );
    }
  }

  /** Taille de la file (tests). */
  get pendingCount(): number {
    return this.queue.length;
  }
}
