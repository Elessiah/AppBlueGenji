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
 * jour de cette page, même lue après minuit. Revenu au premier plan après une
 * courte pause, l'onglet ouvre une nouvelle suite sur la même page ; après une
 * pause d'au moins {@link AUDIENCE_VISIT_GAP_MINUTES} min, ou un autre jour, il
 * compte une **nouvelle page vue** (le serveur ne compterait pas une suite
 * hors de toute visite). Une machine mise en veille onglet visible (aucun
 * événement de visibilité) se voit au tic suivant, en retard de plus de
 * {@link AUDIENCE_SUSPEND_GAP_MS} : la lecture s'arrête au dernier tic, puis
 * reprend comme après une pause. Rien n'est gardé dans le navigateur : la file
 * vit en mémoire de la page et part par lots.
 */
import {
  AUDIENCE_CHECKPOINT_MS,
  AUDIENCE_CLIENT_FLUSH_SIZE,
  AUDIENCE_MAX_BATCH,
  AUDIENCE_MAX_ENGAGED_MS,
  AUDIENCE_SUSPEND_GAP_MS,
  AUDIENCE_VISIT_GAP_MINUTES,
  audienceBeaconPath,
  audiencePageKey,
  parisClock,
  type AudienceBeaconEntry,
  type AudienceDevice,
} from "@/lib/shared/audience";

export interface AudienceTrackerDeps {
  /** Horloge murale en ms depuis l'époque (`Date.now`) : le jour de Paris s'y lit. */
  now(): number;
  isVisible(): boolean;
  device(): AudienceDevice;
  /** Nom d'hôte du référent externe de l'arrivée, ou `null`. */
  referrerHost(): string | null;
  send(entries: AudienceBeaconEntry[]): void;
}

interface Segment {
  path: string;
  visibleSince: number;
  /** Dernier instant où la page tournait (début ou tic) : une veille se voit à l'écart suivant. */
  aliveAt: number;
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
  /** Fin de la dernière lecture close (onglet masqué ou veille) : mesure la pause au retour. */
  private pausedAt: number | null = null;
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
    const end = this.finish();
    if (end !== null) this.pausedAt = end;
    this.hiddenPath = path;
    this.flush();
  }

  /** L'onglet revient au premier plan : une suite s'ouvre (ou la page vue, si elle n'avait jamais été visible). */
  visible(): void {
    if (this.current || !this.hiddenPath) return;
    const path = this.hiddenPath;
    this.hiddenPath = null;
    this.resume(path);
  }

  /**
   * Reprise de `path` après une pause : une page déjà comptée reprend en suite
   * si la pause est courte et le jour le même ; sinon (ou page jamais vue)
   * une page vue s'ouvre pour de bon.
   */
  private resume(path: string): void {
    const now = this.deps.now();
    const counted = this.counted;
    const pausedAt = this.pausedAt;
    this.pausedAt = null;
    const shortPause = pausedAt !== null && now - pausedAt < AUDIENCE_VISIT_GAP_MINUTES * 60_000;
    const sameDay = counted !== null && parisClock(new Date(counted.openedAt)).day === parisClock(new Date(now)).day;
    this.start(path, counted?.path === path && shortPause && sameDay);
  }

  /** Départ de la page (fermeture, rechargement) : tout part. */
  leave(): void {
    this.finish();
    this.flush();
  }

  /** Envoi périodique de ce qui attend ; une lecture en cours depuis longtemps part en tranche. */
  tick(): void {
    const segment = this.current;
    if (segment) {
      const now = this.deps.now();
      if (now - segment.aliveAt > AUDIENCE_SUSPEND_GAP_MS) {
        // Veille : la lecture s'est arrêtée au dernier tic, elle reprend comme après une pause.
        this.pausedAt = this.finish();
        this.resume(segment.path);
      } else {
        segment.aliveAt = now;
        this.checkpoint();
      }
    }
    this.flush();
  }

  /** Tranche d'une lecture qui dure : son temps part en suite, la lecture continue. */
  private checkpoint(): void {
    const segment = this.current;
    if (!segment || !audiencePageKey(segment.path)) return;
    const now = this.deps.now();
    if (now - segment.visibleSince < AUDIENCE_CHECKPOINT_MS) return;
    this.finish();
    this.current = { path: segment.path, visibleSince: now, aliveAt: now, openedAt: segment.openedAt };
  }

  private start(path: string, continuation: boolean): void {
    const now = this.deps.now();
    const first = !continuation && !this.arrived;
    if (!continuation) this.arrived = true;
    const openedAt = continuation && this.counted ? this.counted.openedAt : now;
    this.current = { path, visibleSince: now, aliveAt: now, openedAt };
    if (continuation || !audiencePageKey(path)) return;
    // La page vue part dès son affichage, datée de son début.
    this.counted = { path, openedAt };
    // Seule l'adresse type du gabarit part : jamais un numéro, un pseudo ni un nom.
    const entry: AudienceBeaconEntry = { p: audienceBeaconPath(path) ?? "/autre", t: 0, a: 0, d: this.deps.device() };
    if (first) {
      entry.f = 1;
      entry.r = this.deps.referrerHost();
    }
    this.enqueue(entry, now, null);
  }

  /**
   * Clôt la page en cours : son temps onglet visible part en suite, datée de
   * cette clôture — le dernier tic si la page n'a plus tourné depuis (veille).
   *
   * @returns L'instant de la clôture, ou `null` sans page en cours.
   */
  private finish(): number | null {
    const segment = this.current;
    this.current = null;
    if (!segment) return null;
    const now = this.deps.now();
    const end = now - segment.aliveAt > AUDIENCE_SUSPEND_GAP_MS ? segment.aliveAt : now;
    if (!audiencePageKey(segment.path)) return end;
    const time = Math.max(0, Math.min(AUDIENCE_MAX_ENGAGED_MS, Math.round(end - segment.visibleSince)));
    if (time > 0) this.enqueue({ p: audienceBeaconPath(segment.path) ?? "/autre", t: time, a: 0, d: this.deps.device(), c: 1 }, end, segment.openedAt);
    return end;
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
