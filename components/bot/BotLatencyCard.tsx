import { BotStatus } from "@/lib/shared/types";
import { botPayloadNumber } from "@/lib/shared/bot-payload";

/** Une mesure affichable : un nombre fini **et positif ou nul**, sinon `null`. */
function measure(value: unknown): number | null {
  const n = botPayloadNumber(value);
  return n !== null && n >= 0 ? n : null;
}

export function BotLatencyCard({ status }: { status: BotStatus | null }) {
  // La carte reçoit **la même charge** que la bande d'état juste au-dessus, et
  // `fetchBotStatus` la rend par un simple `as BotStatus` sur du JSON reçu : un
  // `?? 0` ne rattrape que `null` et `undefined`, si bien qu'un `cpuUsage`
  // arrivé en chaîne traversait le garde-fou et faisait lever le `.toFixed()`
  // qui suit — toute la page `/bot` en 500. `botPayloadNumber` écarte aussi le
  // `NaN`, qui ne lève pas mais finit en `width: NaN%`.
  //
  // Une mesure illisible reste `null` jusqu'à l'affichage, et c'est elle seule
  // qui rend « — » : le repli sur zéro, puis `=== 0 ? "—"`, confondait les deux
  // cas dans les deux sens — un bot au repos qui mesure réellement `cpuUsage: 0`
  // affichait « — » au-dessus d'une barre à 0 %. Une valeur **négative** n'est
  // pas davantage une mesure (discord.js rend `-1` de latence avant le premier
  // battement de la passerelle) : elle rejoint l'illisible.
  const gateway = measure(status?.gatewayLatency);
  const cpu = measure(status?.cpuUsage);
  const ram = measure(status?.ramUsage);

  // Les barres sont bornées **des deux côtés** : une valeur négative rendrait
  // une largeur négative, déclaration invalide que le navigateur laisse tomber
  // — la barre garderait alors celle du rendu précédent.
  const bar = (ratio: number) => Math.max(0, Math.min(ratio, 1)) * 100;

  // Le repli à zéro ne vaut que pour la **largeur** : une barre vide ne dit
  // rien de faux, un « 0 » écrit à côté, si.
  const cells = [
    { label: "GATEWAY", value: gateway ?? "—", unit: "ms", width: bar((gateway ?? 0) / 100) },
    { label: "CPU", value: cpu?.toFixed(1) ?? "—", unit: "%", width: bar((cpu ?? 0) / 100) },
    { label: "RAM", value: ram?.toFixed(0) ?? "—", unit: "MB", width: bar((ram ?? 0) / 1024) },
  ];

  return (
    <section className="panel lat-card">
      <div className="panel-head">
        <span className="title">Santé du système</span>
        <span className="meta">SAMPLED 5s</span>
      </div>
      <div className="panel-body">
        {cells.map((cell) => (
          <div key={cell.label} className="lat-cell">
            <span className="l">{cell.label}</span>
            <span className="v ok">
              {cell.value} <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{cell.unit}</span>
            </span>
            <div className="lat-bar">
              <i style={{ width: `${cell.width}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
