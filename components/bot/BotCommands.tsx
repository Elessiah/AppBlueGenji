import Link from "next/link";
// Le registre vient de `lib/shared` et non de `lib/server/bot-docs.ts`, qui
// importe `node:fs` : « `lib/server/*` ne s'importe jamais depuis un composant »
// doit rester vrai sans dépendre de ce que ce fichier-ci est aujourd'hui.
import { BOT_DOC_SECTIONS } from "@/lib/shared/bot-doc-sections";

/**
 * Les commandes du bot — **renvoyées à leur source**, jamais recopiées.
 *
 * Cette section listait huit commandes écrites en dur (`components/bot/mocks.ts`),
 * avec leurs arguments, leurs descriptions et un « BUILD 4f8a » inventé. Rien ne
 * la reliait au bot : une commande ajoutée, renommée ou retirée là-bas laissait
 * la page affirmer le contraire, et **aucun test ne pouvait le voir** — les deux
 * listes vivent dans deux dépôts, et celle-ci était syntaxiquement irréprochable.
 * C'est la panne la plus silencieuse qui soit : une documentation fausse qui a
 * l'air d'une documentation.
 *
 * Or le site sert déjà la vraie : `/bot/docs` lit le Markdown du dépôt voisin
 * **à chaud** (`lib/server/bot-docs.ts`, revalidation 60 s), si bien qu'une
 * correction chez le bot y apparaît dans la minute, sans rebuild. La section
 * mène donc là, et ne dit plus rien qu'elle ne puisse tenir.
 *
 * Une nuance à ne pas gommer : **le corps** de chaque page est relu chez le
 * bot, mais les **titres et résumés** affichés ici viennent de
 * `BOT_DOC_SECTIONS`, un registre de ce dépôt — c'est lui qui borne les
 * fichiers lisibles (garde-fou anti-traversée de chemin), il ne peut donc pas
 * venir d'ailleurs. Un document renommé chez le bot laisse donc sa vignette
 * ici, et le lien tombe sur la dégradation « momentanément indisponible » de
 * `loadBotDoc`. L'intitulé de la section dit « contenu relu » et non « liste
 * tenue à jour » : elle n'annonce que ce qu'elle tient.
 */
export function BotCommands() {
  return (
    <>
      <div className="bot-section-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            DOCUMENTATION · DÉPÔT DU BOT
          </div>
          <h2>Commandes et documentation</h2>
        </div>
        <div className="meta">CONTENU RELU DANS LE DÉPÔT DU BOT</div>
      </div>

      <div className="card card-ticks">
        <div className="panel-head">
          <span className="title mono">~/bluegenji_bot $ help</span>
          <span className="meta">{BOT_DOC_SECTIONS.length} DOCUMENTS</span>
        </div>
        <div className="bot-docs-links">
          <p className="bot-docs-intro">
            La liste des commandes slash, leurs arguments et leurs droits sont
            publiés par le bot lui-même. Cette page y renvoie plutôt que d&apos;en
            garder une copie, qui aurait vieilli sans prévenir : le contenu de
            chaque page est relu dans le dépôt du bot, une correction là-bas y
            apparaît dans la minute.
          </p>
          {/* `role="list"` n'est pas redondant : Safari retire le rôle d'une
              liste dont on a ôté les puces (`list-style: none`), et VoiceOver
              n'annonce alors plus « liste, N éléments ». */}
          <ul className="bot-docs-list" role="list">
            {BOT_DOC_SECTIONS.map((section) => (
              <li key={section.slug}>
                <Link href={`/bot/docs/${section.slug}`} className="bot-docs-link">
                  <span className="bot-docs-title">{section.title}</span>
                  <span className="bot-docs-summary">{section.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
