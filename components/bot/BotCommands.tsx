import { COMMANDS } from "./mocks";

function parseSyntax(syntax: string) {
  const match = syntax.match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) return { cmd: syntax, args: "" };
  return { cmd: match[1], args: match[2] || "" };
}

export function BotCommands() {
  return (
    <>
      <div className="bot-section-head">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            SECTION 03
          </div>
          <h2>Slash commands</h2>
        </div>
        <div className="meta">PRÉFIXE / · 8 COMMANDES</div>
      </div>

      <div className="card card-ticks">
        <div className="panel-head">
          <span className="title mono">~/bluegenji_relay $ help</span>
          <span className="meta">DERNIÈRE MAJ · BUILD 4f8a</span>
        </div>
        <div className="cmds">
          {COMMANDS.map((c, i) => {
            const { cmd, args } = parseSyntax(c.syntax);
            return (
              <div key={i} className="cmd-row">
                <span className="glyph">{c.glyph}</span>
                <span className="cmd">
                  <span className="syntax">
                    {cmd}
                    {args && (
                      <>
                        {" "}
                        <span className="arg">{args}</span>
                      </>
                    )}
                  </span>
                  <span className="desc">{c.desc}</span>
                </span>
                <span className="key">{c.key}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
