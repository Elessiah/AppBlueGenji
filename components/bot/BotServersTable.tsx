import { BotServerEntry } from "@/lib/shared/types";
import { botRelayAccessibleLabel, resolveBotRelayState } from "@/lib/shared/bot-relay-status";

/**
 * Le tableau des serveurs où le bot est installé.
 *
 * La colonne d'état s'intitulait « STATUS » et rendait `● OK` / `● LAG` /
 * `○ OFF`. Elle s'intitule désormais « ÉTAT DU RELAIS » et se lit en français ;
 * la traduction elle-même vit dans `lib/shared/bot-relay-status.ts`, module pur
 * et testé, parce qu'elle ne dépend d'aucun rendu. Les valeurs renvoyées par le
 * bot sont inchangées.
 */
export function BotServersTable({ servers }: { servers: BotServerEntry[] | null }) {
  const list = servers ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Serveurs connectés</span>
        <span className="meta">{list.length} ACTIFS · TRIÉS PAR ACTIVITÉ 30J</span>
      </div>
      {/* Une grille de `div` reste un tableau pour qui le lit : sans ces rôles,
          un lecteur d'écran annonce une suite de textes sans jamais dire de
          quelle colonne ils viennent. Corollaire : chaque ligne doit exposer
          **autant de cellules** que l'en-tête a de colonnes — un `aria-hidden`
          posé sur l'une d'elles décalerait tout le tableau. */}
      <div className="srv-table" role="table" aria-label="Serveurs connectés au bot">
        <div className="srv-head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">SERVEUR</span>
          <span role="columnheader" style={{ textAlign: "right" }}>MEMBRES</span>
          <span role="columnheader" style={{ textAlign: "right" }}>RELAIS 30J</span>
          <span role="columnheader" style={{ textAlign: "right" }}>ÉTAT DU RELAIS</span>
          <span role="columnheader" style={{ textAlign: "right" }}>TENDANCE</span>
        </div>
        {list.map((s, rank) => {
          const relay = resolveBotRelayState(s.status);
          return (
            <div key={s.id} className="srv-row" role="row">
              <span className="srv-rank" role="cell">{String(rank + 1).padStart(2, "0")}</span>
              <span className="srv-name" role="cell">
                <span className="srv-sigil" style={{ "--c": s.accentColor } as React.CSSProperties}>
                  {s.sigil}
                </span>
                {s.name}
              </span>
              <span className="srv-num" role="cell">{s.memberCount.toLocaleString("fr-FR")}</span>
              <span className="srv-num" role="cell">{s.relays30j}</span>
              <span
                className={"srv-status " + relay.tone}
                role="cell"
                title={relay.hint}
                aria-label={botRelayAccessibleLabel(relay)}
              >
                {relay.label}
              </span>
              {/* Les barres sont un dessin : elles n'ont pas de texte, la
                  cellule se lit donc vide — mais elle existe, et l'en-tête
                  « TENDANCE » reste en face des autres colonnes. */}
              <span className="srv-spark" role="cell">
                {s.sparkline.map((v, i) => (
                  <span key={i} aria-hidden="true" style={{ height: `${(v / Math.max(...s.sparkline, 1)) * 100}%` }} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
