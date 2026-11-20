/**
 * Attend `work` au plus `timeoutMs`, puis rend la main ; ne lève jamais (un
 * échec de `work` compte comme sa fin). Le minuteur ne retient pas le
 * processus (`unref`) et part avec la course, gagnée ou perdue. Sert aux
 * attentes bornées de l'arrêt du serveur (`bot-log-shutdown.ts`).
 */
export async function boundedWait(work: Promise<unknown> | undefined, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, timeoutMs));
    timer.unref?.();
  });
  try {
    await Promise.race([(work ?? Promise.resolve()).catch(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
