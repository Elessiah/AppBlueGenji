import Link from "next/link";
import { BOT_DOC_SECTIONS } from "@/lib/server/bot-docs";

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
        <div className="meta">LUE DEPUIS LE BOT · MISE À JOUR CONTINUE</div>
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
            garder une copie, qui aurait vieilli sans prévenir.
          </p>
          <ul className="bot-docs-list">
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
