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
  // Même précaution que sur `sparkline` juste en dessous, et pour la même
  // raison : `fetchBotServers` fait un simple `as BotServersPayload` sur du
  // JSON reçu. Un `?? []` ne rattrape que `null` — une charge qui rangerait
  // les serveurs par identifiant passerait tout droit et `list.map` rendrait
  // la page entière en 500.
  const list = Array.isArray(servers) ? servers : [];

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
          <span role="columnheader" style={{ textAlign: "right" }}>
            {/* « RELAIS 30J » compte, celle-ci qualifie : deux en-têtes
                homonymes se reliraient l'un pour l'autre. Sous 640 px la
                colonne des relais est masquée — l'homonymie part avec elle,
                et « ÉTAT DU » avec, faute de place dans la piste. */}
            <span className="srv-col-qualifier">ÉTAT DU </span>RELAIS
          </span>
          <span role="columnheader" style={{ textAlign: "right" }}>TENDANCE</span>
        </div>
        {list.map((s, rank) => {
          const relay = resolveBotRelayState(s.status);
          // Même raison que pour l'état : la charge du bot n'est pas validée à
          // l'exécution (`as BotServersPayload` sur du JSON reçu). Un champ
          // manquant doit donner une cellule fade, jamais un `TypeError` — qui
          // ferait rendre toute la page `/bot` en 500, bien pire que la case
          // vide qu'on vient de chasser.
          const sparkline = Array.isArray(s.sparkline) ? s.sparkline : [];
          // `Math.max(...arr)` passe la série entière en arguments : au-delà de
          // quelque cent mille points, c'est un `RangeError` — une charge du bot
          // suffirait à rendre la page en 500. Un `reduce` n'a pas de pile à
          // remplir.
          const peak = sparkline.reduce((max, v) => Math.max(max, v ?? 0), 1);
          return (
            <div key={s.id} className="srv-row" role="row">
              <span className="srv-rank" role="cell">{String(rank + 1).padStart(2, "0")}</span>
              <span className="srv-name" role="cell">
                {/* Le sigil répète les initiales du nom qui le suit : sans
                    `aria-hidden`, la cellule s'annonce « NV Nova Esports ».
                    Même règle que le mode `decorative` de `UserAvatar`. */}
                <span
                  className="srv-sigil"
                  aria-hidden="true"
                  style={{ "--c": s.accentColor } as React.CSSProperties}
                >
                  {s.sigil}
                </span>
                {s.name}
              </span>
              <span className="srv-num" role="cell">{(s.memberCount ?? 0).toLocaleString("fr-FR")}</span>
              <span className="srv-num" role="cell">{(s.relays30j ?? 0).toLocaleString("fr-FR")}</span>
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
                {sparkline.map((v, i) => (
                  <span key={i} aria-hidden="true" style={{ height: `${((v ?? 0) / peak) * 100}%` }} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
