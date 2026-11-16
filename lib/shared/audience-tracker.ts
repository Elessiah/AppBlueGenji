/**
 * Suivi des pages vues dans le navigateur — sans DOM ni horloge propres (tout
 * est injecté), pour être testé seul. Monté par `<AudienceBeacon />`.
 *
 * Une **page vue** est signalée **à son affichage** (`t: 0`, datée de son
 * début : l'heure de la carte de chaleur est celle où la page s'ouvre, même
 * lue des heures). Son **temps** onglet visible part à sa clôture (navigation
 * suivante, onglet en arrière-plan, départ) dans une **suite** (`c: 1`), datée
 * de cette clôture : le repli y lit la fin de la lecture, d'où se mesure
 * l'écart avant une nouvelle visite. Une longue lecture part par tranches
 * (`AUDIENCE_CHECKPOINT_MS`, au tic d'envoi) : chaque tranche part entière,
 * sous le plafond de temps, et commence où finit la précédente. Chaque suite
 * porte l'ancienneté de l'ouverture de sa page (`o`) : le serveur la range au
 * jour de cette page, même lue après minuit. Revenu au premier plan, l'onglet
 * ouvre une nouvelle suite sur la même page. Rien n'est gardé dans le navigateur :
 * la file vit en mémoire de la page et part par lots.
 */
import {
  AUDIENCE_CHECKPOINT_MS,
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
  /** Ouverture de la page vue que ce segment prolonge (ou ouvre). */
  openedAt: number;
}

export class AudienceTracker {
  private current: Segment | null = null;
  /**
   * File de la page : les anciennetés `a` (et `o` d'une suite) se calculent à
   * l'envoi, d'après l'instant que l'entrée date (et l'ouverture de sa page).
   */
  private queue: { entry: AudienceBeaconEntry; at: number; openedAt: number | null }[] = [];
  private hiddenPath: string | null = null;
  private arrived = false;
  /** Page comptée en dernier et son ouverture : un retour au premier plan sur elle ouvre une suite. */
  private counted: { path: string; openedAt: number } | null = null;

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
    this.start(path, this.counted?.path === path);
  }

  /** Départ de la page (fermeture, rechargement) : tout part. */
  leave(): void {
    this.finish();
    this.flush();
  }

  /** Envoi périodique de ce qui attend ; une lecture en cours depuis longtemps part en tranche. */
  tick(): void {
    this.checkpoint();
    this.flush();
  }

  /** Tranche d'une lecture qui dure : son temps part en suite, la lecture continue. */
  private checkpoint(): void {
    const segment = this.current;
    if (!segment || segment.visibleSince === null || !audiencePageKey(segment.path)) return;
    const now = this.deps.now();
    if (segment.engagedMs + now - segment.visibleSince < AUDIENCE_CHECKPOINT_MS) return;
    this.finish();
    this.current = { path: segment.path, engagedMs: 0, visibleSince: now, openedAt: segment.openedAt };
  }

  private start(path: string, continuation: boolean): void {
    const now = this.deps.now();
    const first = !continuation && !this.arrived;
    if (!continuation) this.arrived = true;
    const openedAt = continuation && this.counted ? this.counted.openedAt : now;
    this.current = { path, engagedMs: 0, visibleSince: now, openedAt };
    if (continuation || !audiencePageKey(path)) return;
    // La page vue part dès son affichage, datée de son début.
    this.counted = { path, openedAt };
    const entry: AudienceBeaconEntry = { p: path, t: 0, a: 0, d: this.deps.device() };
    if (first) {
      entry.f = 1;
      entry.r = this.deps.referrerHost();
    }
    this.enqueue(entry, now, null);
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
    this.enqueue({ p: segment.path, t: time, a: 0, d: this.deps.device(), c: 1 }, now, segment.openedAt);
  }

  private enqueue(entry: AudienceBeaconEntry, at: number, openedAt: number | null): void {
    this.queue.push({ entry, at, openedAt });
    if (this.queue.length >= AUDIENCE_CLIENT_FLUSH_SIZE) this.flush();
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    const now = this.deps.now();
    while (this.queue.length > 0) {
      this.deps.send(
        this.queue.splice(0, AUDIENCE_MAX_BATCH).map(({ entry, at, openedAt }) => {
          const sent: AudienceBeaconEntry = { ...entry, a: Math.max(0, Math.round(now - at)) };
          if (openedAt !== null) sent.o = Math.max(0, Math.round(now - openedAt));
          return sent;
        }),
      );
    }
  }

  /** Taille de la file (tests). */
  get pendingCount(): number {
    return this.queue.length;
  }
}
