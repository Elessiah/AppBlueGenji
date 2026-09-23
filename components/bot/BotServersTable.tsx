import { BotServerEntry, BotServersPayload } from "@/lib/shared/types";
import { botRelayAccessibleLabel, resolveBotRelayState } from "@/lib/shared/bot-relay-status";
import {
  botPayloadColor,
  botPayloadLabel,
  botPayloadNumber,
  botPayloadText,
} from "@/lib/shared/bot-payload";

/**
 * Le nombre de barres rendues par cellule de tendance. La série arrive du bot
 * sans borne ; on garde les plus **récentes**, une tendance se lisant par sa
 * fin.
 *
 * Dix, et pas un nombre rond choisi au hasard : c'est ce que la cellule tient.
 * `.srv-spark` est une rangée `flex` de barres de 3 px séparées de 1,5 px, dans
 * une piste de 60 px — 44 px dans la bande resserrée. Les gouttières d'une
 * `flex` ne se compriment **pas** : à partir d'une quarantaine de points elles
 * dépassent à elles seules la piste, toutes les barres tombent à 0 px de large
 * et la ligne déborde sur la cellule voisine. Dix points font 43,5 px, ce qui
 * tient des deux côtés — et c'est aussi le format que le bot doit rendre
 * (`docs/features/BOT_FEATURES_NEEDED.md`).
 */
const MAX_SPARKLINE_POINTS = 10;

/**
 * Le tableau des serveurs où le bot est installé.
 *
 * La colonne d'état s'intitulait « STATUS » et rendait `● OK` / `● LAG` /
 * `○ OFF`. Elle s'intitule désormais « ÉTAT DU RELAIS » et se lit en français ;
 * la traduction elle-même vit dans `lib/shared/bot-relay-status.ts`, module pur
 * et testé, parce qu'elle ne dépend d'aucun rendu. Les valeurs renvoyées par le
 * bot sont inchangées.
 *
 * **Il reçoit la charge entière, et non son champ `servers`.**
 *
 * Il sépare deux silences — « le bot n'a rien dit » et « le bot a dit quelque
 * chose que la page ne sait pas lire » — et cette différence ne se lit **que**
 * sur la charge : une fois le champ extrait, `null` (aucune réponse) et
 * `undefined` (une réponse sans champ `servers`) sont la même valeur, qu'un
 * `?? null` chez l'appelant achevait de confondre. Le panneau annonçait alors
 * « BOT INJOIGNABLE » pendant que la bande d'état, tirée du **même**
 * `Promise.all`, affichait `OPERATIONAL` juste au-dessus.
 *
 * Même raisonnement que `botStatusOf` dans `lib/shared/bot-status-summary.ts`,
 * et pour la même raison : c'est le seul endroit qui voie encore la
 * différence. `fetchBotServers` est la seule source de `null` ici — coupe-
 * circuit ouvert, appel échoué, réponse non `ok`.
 */
export function BotServersTable({ payload }: { payload: BotServersPayload | null }) {
  // Même précaution que sur `sparkline` plus bas, et pour la même raison :
  // `fetchBotServers` fait un simple `as BotServersPayload` sur du JSON reçu.
  // Un `?? []` ne rattrape que `null` — une charge qui rangerait les serveurs
  // par identifiant passerait tout droit et `list.map` rendrait la page
  // entière en 500.
  const rows: unknown[] | null =
    payload !== null && Array.isArray(payload.servers) ? payload.servers : null;
  // Le `filter` ne fait pas double emploi avec l'`Array.isArray` : une charge
  // `{"servers": [null]}` est un tableau, elle passe la première garde, et
  // `s.status` lève au premier tour de boucle — exactement le 500 que la ligne
  // au-dessus vient d'écarter, une indirection plus loin.
  const list = (rows ?? []).filter(
    (s): s is BotServerEntry => s !== null && typeof s === "object",
  );

  // **Trois faits, jamais un seul chiffre.** Ramener l'absence de réponse à une
  // liste vide faisait affirmer « aucun serveur » — c'est-à-dire que le bot
  // n'est installé nulle part — quand la seule chose vraie était qu'on n'en
  // sait rien. Même règle que la case « Status » juste au-dessus, et que le
  // compteur de membres Discord de l'accueil : refus en `null`, jamais en zéro.
  //
  // Et « AUCUN SERVEUR » se juge sur la liste **reçue**, pas sur la liste
  // filtrée : une charge `{"servers": [null, null]}` est bien un tableau, elle
  // perd ses deux entrées au filtre, et le panneau annonçait alors le même
  // « le bot n'est installé nulle part » sur une réponse qui n'était
  // simplement pas lisible. Zéro reste réservé à un zéro constaté.
  const meta =
    payload === null
      ? "BOT INJOIGNABLE"
      : rows === null || (rows.length > 0 && list.length === 0)
        ? "RÉPONSE ILLISIBLE"
        : rows.length === 0
          ? "AUCUN SERVEUR"
          : // On ne dit rien de l'ordre ni du total : `fetchBotServers(8)`
            // **plafonne** la demande, et le tri par activité est encore une
            // case à cocher de `docs/features/BOT_FEATURES_NEEDED.md`. Le
            // panneau ne compte que ce qu'il montre.
            `${list.length} ${list.length === 1 ? "SERVEUR AFFICHÉ" : "SERVEURS AFFICHÉS"}`;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="title">Serveurs connectés</span>
        <span className="meta">{meta}</span>
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
          // Plafonné à ce que la cellule tient (voir la constante). Le `reduce`
          // plus bas a retiré le `RangeError` de `Math.max(...arr)` ; il restait
          // qu'une série de cinquante mille points écrivait cinquante mille
          // `<span>`, soit ~3 Mo d'HTML pour **une** rangée. Ne pas lever n'est
          // pas la même chose que rester utilisable.
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
                  style={{ "--c": botPayloadColor(s.accentColor) ?? undefined } as React.CSSProperties}
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
