import { BotStatus } from "@/lib/shared/types";
import { botStatusNumber } from "@/lib/shared/bot-status-summary";

export function BotLatencyCard({ status }: { status: BotStatus | null }) {
  // La carte reçoit **la même charge** que la bande d'état juste au-dessus, et
  // `fetchBotStatus` la rend par un simple `as BotStatus` sur du JSON reçu : un
  // `?? 0` ne rattrape que `null` et `undefined`, si bien qu'un `cpuUsage`
  // arrivé en chaîne traversait le garde-fou et faisait lever le `.toFixed()`
  // qui suit — toute la page `/bot` en 500. `botStatusNumber` écarte aussi le
  // `NaN`, qui ne lève pas mais finit en `width: NaN%`.
  const gateway = botStatusNumber(status?.gatewayLatency) ?? 0;
  const cpu = botStatusNumber(status?.cpuUsage) ?? 0;
  const ram = botStatusNumber(status?.ramUsage) ?? 0;

  // Les barres sont bornées **des deux côtés** : une valeur négative rendrait
  // une largeur négative, déclaration invalide que le navigateur laisse tomber
  // — la barre garderait alors celle du rendu précédent.
  const bar = (ratio: number) => Math.max(0, Math.min(ratio, 1)) * 100;

  const cells = [
    { label: "GATEWAY", value: gateway === 0 ? "—" : gateway, unit: "ms", width: bar(gateway / 100) },
    { label: "CPU", value: cpu === 0 ? "—" : cpu.toFixed(1), unit: "%", width: bar(cpu / 100) },
    { label: "RAM", value: ram === 0 ? "—" : ram.toFixed(0), unit: "MB", width: bar(ram / 1024) },
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
              {cell.value} <span style={{ fontSize: 12, color: "var(--fg-mute)" }}>{cell.unit}</span>
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
