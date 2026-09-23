import { Sparkline } from "./Sparkline";
import { BotKpis as BotKpisType } from "@/lib/shared/types";
import { botPayloadNumber } from "@/lib/shared/bot-payload";
import { botKpiDeltaAccessibleLabel, resolveBotKpiDelta } from "@/lib/shared/bot-kpi-delta";

export function BotKpis({ kpis }: { kpis: BotKpisType | null }) {
  const entries = [
    {
      key: "servers",
      lbl: "Serveurs",
      data: kpis?.servers,
    },
    {
      key: "channels",
      lbl: "Channels relayés",
      data: kpis?.channels,
    },
    {
      key: "messages",
      lbl: "Messages traités",
      unit: "30j",
      data: kpis?.messages,
    },
    {
      key: "relays",
      lbl: "Relais inter-serveur",
      unit: "30j",
      data: kpis?.relays,
    },
  ];

  return (
    <div className="kpis">
      {entries.map((entry) => {
        // `?? "—"` ne rattrape que `null` : un `delta` arrivé en objet tombait
        // en enfant de React, qui lève « Objects are not valid as a React
        // child » — la page entière en 500. Et le ton était écrit en dur
        // (`up`, `▲`) : une baisse annoncée `-8 %` sortait en vert, flèche
        // vers le haut. La règle vit dans `lib/shared/bot-kpi-delta.ts`.
        const delta = resolveBotKpiDelta(entry.data?.delta);
        return (
          <div key={entry.key} className="card card-ticks kpi">
            <div className="kpi-head">
              <span className="kpi-lbl">{entry.lbl}</span>
              {/* La flèche et la couleur sont un dessin : elles ne se lisent
                  ni au lecteur d'écran ni en nuances de gris, d'où le nom
                  accessible qui dit le sens en toutes lettres. */}
              <span
                className={"kpi-delta " + delta.tone}
                aria-label={botKpiDeltaAccessibleLabel(delta, entry.lbl)}
              >
                {delta.glyph ? <span aria-hidden="true">{delta.glyph} </span> : null}
                {delta.label}
              </span>
            </div>
            <div className="kpi-val">
              {/* `entry.data ? entry.data.value.toLocaleString(…)` : la garde
                  portait sur l'objet, jamais sur le champ. Une charge
                  `{"servers": {}}` passait donc la condition et `.toLocaleString`
                  levait sur `undefined`. Même charge non validée (`as BotKpis`)
                  que la bande d'état et le tableau des serveurs. */}
              {botPayloadNumber(entry.data?.value)?.toLocaleString("fr-FR") ?? "—"}
              {entry.unit && <span className="unit">/ {entry.unit}</span>}
            </div>
            <div className="kpi-spark">
              {Array.isArray(entry.data?.series) ? <Sparkline data={entry.data.series} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
