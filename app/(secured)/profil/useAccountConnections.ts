"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountConnection } from "@/lib/shared/account-connections";

/**
 * Les moyens de connexion du compte, chargés **une fois pour la page**.
 *
 * La liste ne servait qu'à « Applications connectées », qui allait la chercher
 * elle-même. Elle a maintenant un second lecteur, plus haut dans la page : le
 * champ « BattleTag Overwatch », verrouillé dès que Blizzard est rattaché
 * (`lib/shared/battletag-lock.ts`). Deux `fetch` pour la même donnée en
 * feraient deux vérités — le temps d'un rattachement, la section dirait
 * « rattaché » pendant que le champ resterait ouvert, et la sauvegarde
 * partirait vers un 409.
 *
 * D'où le chargement remonté à la page, qui passe la liste **et** son `reload`
 * à la section : un retrait fait là-bas doit rouvrir le champ d'ici dans le
 * même geste.
 *
 * `pending` n'est pas déductible de `connections === null`, et c'est tout le
 * sujet de la phrase du verrou : « pas encore lue » et « lecture échouée » se
 * confondraient sinon, et l'écran annoncerait une panne pendant le temps normal
 * d'un aller-retour. Il part donc à `true`, avant même le premier rendu — le
 * profil s'affiche dès que `GET /api/profile` répond, ce qui arrive
 * régulièrement avant celle-ci.
 */
export function useAccountConnections(): {
  connections: AccountConnection[] | null;
  pending: boolean;
  reload: () => Promise<void>;
} {
  const [connections, setConnections] = useState<AccountConnection[] | null>(null);
  const [pending, setPending] = useState(true);
  /**
   * Le numéro de la **dernière lecture lancée**, comme pour l'état Discord.
   *
   * Deux lectures peuvent être en vol — retirer une application puis en
   * rattacher une autre en lance deux —, et rien ne garantit qu'elles
   * reviennent dans l'ordre : la plus vieille, revenue la dernière, reposerait
   * une liste périmée. Une `ref` et non un état : elle ne doit provoquer aucun
   * rendu, et se lit à sa valeur du moment, pas à celle figée dans la fermeture.
   */
  const readSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = (readSeq.current += 1);
    setPending(true);
    try {
      const res = await fetch("/api/profile/connections", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { connections?: AccountConnection[] };
      if (seq !== readSeq.current) return;
      setConnections(payload.connections ?? []);
    } catch {
      // Silencieux, mais **pas anodin** : la liste reste `null`, donc le champ
      // verrouillé reste verrouillé. Le reste du profil s'enregistre
      // normalement — le `PATCH` n'emporte le BattleTag que s'il a changé — et
      // c'est le serveur qui tranche de toute façon.
    } finally {
      // L'attente ne se lève que sur la **dernière** : la dépassée qui rentre la
      // première ferait annoncer une panne pendant qu'une lecture court encore.
      if (seq === readSeq.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { connections, pending, reload };
}
