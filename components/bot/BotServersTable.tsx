import { BotServerEntry } from "@/lib/shared/types";

/**
 * L'état du relais d'un serveur, **dit en français**.
 *
 * La colonne s'intitulait « STATUS » et rendait `● OK` / `● LAG` / `○ OFF` : trois
 * mots anglais sans définition nulle part, dont le deuxième ne veut rien dire
 * pour un lecteur — « lag » est le vocabulaire du bot, pas celui de la page. Ce
 * que la colonne décrit est en réalité **le relais** de ce serveur : à jour, en
 * retard, ou arrêté. Les valeurs renvoyées par le bot (`ok`/`lag`/`off`) sont
 * inchangées — c'est leur traduction qui manquait, et elle vit ici, à l'endroit
 * qui les affiche.
 */
const STATUS_LABEL: Record<BotServerEntry["status"], string> = {
  ok: "● À jour",
  lag: "● Retard",
  off: "○ Hors ligne",
};

/** Ce que chaque état veut dire, pour qui s'arrête sur la cellule. */
const STATUS_HINT: Record<BotServerEntry["status"], string> = {
  ok: "Les annonces sont relayées sans délai sur ce serveur.",
  lag: "Le relais fonctionne mais accuse du retard sur ce serveur.",
  off: "Le bot ne relaie plus rien sur ce serveur.",
};

export function BotServersTable({ servers }: { servers: BotServerEntry[] | null }) {
  const list = servers ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Serveurs connectés</span>
        <span className="meta">{list.length} ACTIFS · TRIÉS PAR ACTIVITÉ 30J</span>
      </div>
      <div className="srv-table">
        <div className="srv-head">
          <span>#</span>
          <span>SERVEUR</span>
          <span style={{ textAlign: "right" }}>MEMBRES</span>
          <span style={{ textAlign: "right" }}>RELAIS 30J</span>
          <span style={{ textAlign: "right" }}>RELAIS</span>
          <span style={{ textAlign: "right" }}>TENDANCE</span>
        </div>
        {list.map((s, rank) => (
          <div key={s.id} className="srv-row">
            <span className="srv-rank">{String(rank + 1).padStart(2, "0")}</span>
            <span className="srv-name">
              <span className="srv-sigil" style={{ "--c": s.accentColor } as React.CSSProperties}>
                {s.sigil}
              </span>
              {s.name}
            </span>
            <span className="srv-num">{s.memberCount.toLocaleString("fr-FR")}</span>
            <span className="srv-num">{s.relays30j}</span>
            <span className={"srv-status " + s.status} title={STATUS_HINT[s.status]}>
              {STATUS_LABEL[s.status]}
            </span>
            <span className="srv-spark">
              {s.sparkline.map((v, i) => (
                <span key={i} style={{ height: `${(v / Math.max(...s.sparkline, 1)) * 100}%` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
