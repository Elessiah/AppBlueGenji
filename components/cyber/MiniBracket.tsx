import styles from "./MiniBracket.module.css";

interface Match {
  a: string;
  b: string;
  sa: number | string;
  sb: number | string;
}

interface MiniBracketProps {
  matches: Match[];
}

function parseScore(s: number | string): number | null {
  if (s === "—" || s === "-") return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export function MiniBracket({ matches }: MiniBracketProps) {
  return (
    <div className={styles.root}>
      {matches.map((match, i) => {
        const saNum = parseScore(match.sa);
        const sbNum = parseScore(match.sb);
        const aWins =
          saNum !== null && sbNum !== null && saNum > sbNum;
        const bWins =
          saNum !== null && sbNum !== null && sbNum > saNum;

        return (
          <div key={i} className={styles.match}>
            <div className={`${styles.row} ${aWins ? styles.win : ""}`}>
              <span>{match.a}</span>
              <span className="num">{match.sa}</span>
            </div>
            <div className={`${styles.row} ${bWins ? styles.win : ""}`}>
              <span>{match.b}</span>
              <span className="num">{match.sb}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
