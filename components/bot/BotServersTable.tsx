import { BotServerEntry } from "@/lib/shared/types";
import { botRelayAccessibleLabel, resolveBotRelayState } from "@/lib/shared/bot-relay-status";
import { botPayloadLabel, botPayloadNumber, botPayloadText } from "@/lib/shared/bot-payload";

/**
 * Le tableau des serveurs où le bot est installé.
 *
 * La colonne d'état s'intitulait « STATUS » et rendait `● OK` / `● LAG` /
 * `○ OFF`. Elle s'intitule désormais « ÉTAT DU RELAIS » et se lit en français ;
 * la traduction elle-même vit dans `lib/shared/bot-relay-status.ts`, module pur
 * et testé, parce qu'elle ne dépend d'aucun rendu. Les valeurs renvoyées par le
 * bot sont inchangées.
 */
/**
 * Le nombre de barres rendues par cellule de tendance. La série arrive du bot
 * sans borne ; on garde les plus **récentes**, une tendance se lisant par sa
 * fin.
 */
const MAX_SPARKLINE_POINTS = 60;

export function BotServersTable({ servers }: { servers: BotServerEntry[] | null }) {
  // Même précaution que sur `sparkline` juste en dessous, et pour la même
  // raison : `fetchBotServers` fait un simple `as BotServersPayload` sur du
  // JSON reçu. Un `?? []` ne rattrape que `null` — une charge qui rangerait
  // les serveurs par identifiant passerait tout droit et `list.map` rendrait
  // la page entière en 500.
  // …et le `filter` ne fait pas double emploi avec l'`Array.isArray` : une
  // charge `{"servers": [null]}` est un tableau, elle passe la première garde,
  // et `s.status` lève au premier tour de boucle — exactement le 500 que la
  // ligne au-dessus vient d'écarter, une indirection plus loin.
  const list = (Array.isArray(servers) ? servers : []).filter(
    (s): s is BotServerEntry => s !== null && typeof s === "object",
  );

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
          // Plafonné : la cellule fait quelques dizaines de pixels de large, une
          // barre de plus n'y est pas visible — mais elle est bien rendue. Le
          // `reduce` plus bas a retiré le `RangeError` de `Math.max(...arr)` ;
          // il restait qu'une série de cinquante mille points écrivait
          // cinquante mille `<span>`, soit ~3 Mo d'HTML pour **une** rangée.
          // Ne pas lever n'est pas la même chose que rester utilisable.
          const sparkline = (Array.isArray(s.sparkline) ? s.sparkline : []).slice(
            -MAX_SPARKLINE_POINTS,
          );
          // `Math.max(...arr)` passe la série entière en arguments : au-delà de
          // quelque cent mille points, c'est un `RangeError` — une charge du bot
          // suffirait à rendre la page en 500. Un `reduce` n'a pas de pile à
          // remplir.
          // `Number.isFinite` et non `v ?? 0` : ce dernier ne rattrape que `null`
          // et `undefined`. Un point en chaîne rendait `Math.max` `NaN`, qui
          // empoisonne tous les tours suivants — et chaque barre sortait en
          // `height: NaN%`, donc une colonne « tendance » vide sans une erreur.
          // Borné **des deux côtés**, comme les barres de `BotLatencyCard` : un
          // point négatif rendait `height: -400%`, déclaration invalide que le
          // navigateur laisse tomber — la barre disparaît sans rien dire, et
          // `peak` reste à sa graine, ce qui aplatit toute la colonne.
          const point = (v: unknown) => Math.max(0, botPayloadNumber(v) ?? 0);
          const peak = sparkline.reduce<number>((max, v) => Math.max(max, point(v)), 1);
          return (
            // `s.id` n'est pas plus garanti que les autres champs — et un
            // `?? ` ne rattrape que `null` : deux entrées sans identifiant
            // donnaient deux `key={undefined}`, deux entrées dont
            // l'identifiant est un objet deux `"[object Object]"`. Dans les
            // deux cas, un avertissement React et une réconciliation des
            // rangées qui ne tient plus au retour sur la page.
            <div key={botPayloadText(s.id) ?? `rang-${rank}`} className="srv-row" role="row">
              <span className="srv-rank" role="cell">{String(rank + 1).padStart(2, "0")}</span>
              <span className="srv-name" role="cell">
                {/* Le sigil répète les initiales du nom qui le suit : sans
                    `aria-hidden`, la cellule s'annonce « NV Nova Esports ».
                    Même règle que le mode `decorative` de `UserAvatar`. */}
                <span
                  className="srv-sigil"
                  aria-hidden="true"
                  style={{ "--c": botPayloadText(s.accentColor) } as React.CSSProperties}
                >
                  {botPayloadLabel(s.sigil)}
                </span>
                {/* Les deux derniers champs de la rangée, et les seuls qui
                    tombent **directement** en enfants de React : un objet ou un
                    tableau y lève « Objects are not valid as a React child »
                    pendant le rendu, donc toute la page en 500 — là où un
                    nombre mal typé se contentait de mal s'afficher. */}
                {botPayloadLabel(s.name)}
              </span>
              {/* `?? 0` ne rattrape que `null` : un compte arrivé en chaîne
                  tombait sur `String.prototype.toLocaleString`, qui ne groupe
                  rien — « 12345 » à côté d'un « 12 345 », soit deux échelles
                  dans la même colonne —, et un objet rendait « [object
                  Object] ». Aucune exception, donc aucun signal. */}
              <span className="srv-num" role="cell">{(botPayloadNumber(s.memberCount) ?? 0).toLocaleString("fr-FR")}</span>
              <span className="srv-num" role="cell">{(botPayloadNumber(s.relays30j) ?? 0).toLocaleString("fr-FR")}</span>
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
                  <span key={i} aria-hidden="true" style={{ height: `${(point(v) / peak) * 100}%` }} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
