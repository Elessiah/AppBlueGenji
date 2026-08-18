/**
 * Schémas explicatifs des modes de tournoi (`/regles/[slug]`).
 *
 * Tout est en SVG inline : aucune dépendance externe, thème respecté via les
 * tokens CSS (`--blue-500`, `--amber`, `--ink`…), et le rendu reste net à toutes
 * les tailles. Les schémas sont dessinés à largeur fixe et défilent
 * horizontalement sur mobile (cf. `.scroll` / `.svg` dans le module CSS) plutôt
 * que de se comprimer jusqu'à l'illisibilité.
 */
import type { RuleDiagram } from "@/lib/shared/tournament-rules";
import styles from "./RuleDiagram.module.css";
import { ScrollArea } from "@/components/cyber";

const BLUE = "var(--blue-500)";
const AMBER = "var(--amber)";
const RED = "var(--red-live)";
const INK = "var(--ink)";
const MUTE = "var(--ink-mute)";
const LINE = "var(--line-strong-cy)";
const SURFACE = "var(--cyber-bg-2)";

const MONO = "var(--font-mono)";

type BoxProps = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Une ou deux lignes de texte (deux = un match). */
  lines: string[];
  accent?: string;
  dashed?: boolean;
  /** Grise la boîte (équipe éliminée / place vide). */
  dim?: boolean;
};

/** Boîte de match : cadre fin + une ou deux lignes de texte. */
function Box({ x, y, w = 132, h = 44, lines, accent = LINE, dashed, dim }: BoxProps) {
  return (
    <g opacity={dim ? 0.45 : 1}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={7}
        fill={SURFACE}
        stroke={accent}
        strokeWidth={1.2}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={x + 11}
          y={lines.length === 1 ? y + h / 2 + 4 : y + 18 + i * 16}
          fill={i === 0 ? INK : MUTE}
          fontSize={12}
          fontFamily={MONO}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** Connecteur en équerre entre deux boîtes (sortie droite → entrée gauche). */
function Elbow({
  from,
  to,
  color = LINE,
  dashed,
}: {
  from: [number, number];
  to: [number, number];
  color?: string;
  dashed?: boolean;
}) {
  const midX = from[0] + (to[0] - from[0]) / 2;
  return (
    <polyline
      points={`${from[0]},${from[1]} ${midX},${from[1]} ${midX},${to[1]} ${to[0]},${to[1]}`}
      fill="none"
      stroke={color}
      strokeWidth={1.2}
      strokeDasharray={dashed ? "4 3" : undefined}
      markerEnd="url(#rule-arrow)"
    />
  );
}

function ArrowDefs() {
  return (
    <defs>
      <marker
        id="rule-arrow"
        viewBox="0 0 8 8"
        refX="6"
        refY="4"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M 0 1 L 7 4 L 0 7 z" fill="currentColor" />
      </marker>
    </defs>
  );
}

/** Étiquette de colonne (nom de round). */
function ColumnLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text
      x={x}
      y={y}
      fill={MUTE}
      fontSize={10.5}
      fontFamily={MONO}
      letterSpacing="0.14em"
    >
      {children.toUpperCase()}
    </text>
  );
}

function SingleEliminationDiagram() {
  const qfY = [30, 100, 170, 240];
  const sfY = [65, 205];
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 300"
      role="img"
      aria-label="Bracket à élimination simple : quatre quarts de finale, deux demi-finales, une finale."
      style={{ color: LINE }}
    >
      <ArrowDefs />
      <ColumnLabel x={20} y={16}>Quarts</ColumnLabel>
      <ColumnLabel x={228} y={16}>Demi-finales</ColumnLabel>
      <ColumnLabel x={436} y={16}>Finale</ColumnLabel>

      {qfY.map((y, i) => (
        <Box
          key={y}
          x={20}
          y={y}
          lines={[`Équipe ${i * 2 + 1}`, `Équipe ${i * 2 + 2}`]}
        />
      ))}
      {sfY.map((y) => (
        <Box key={y} x={228} y={y} lines={["Vainqueur", "Vainqueur"]} accent={BLUE} />
      ))}
      <Box x={436} y={135} lines={["Finaliste", "Finaliste"]} accent={BLUE} />

      {qfY.map((y, i) => (
        <Elbow
          key={y}
          from={[152, y + 22]}
          to={[228, sfY[Math.floor(i / 2)] + 22]}
          color={BLUE}
        />
      ))}
      {sfY.map((y) => (
        <Elbow key={y} from={[360, y + 22]} to={[436, 157]} color={BLUE} />
      ))}
      <Elbow from={[568, 157]} to={[612, 157]} color={BLUE} />

      <g>
        <rect
          x={612}
          y={133}
          width={70}
          height={48}
          rx={7}
          fill="rgba(90,200,255,0.10)"
          stroke={BLUE}
          strokeWidth={1.2}
        />
        <text x={647} y={153} fill={INK} fontSize={16} textAnchor="middle">
          🏆
        </text>
        <text
          x={647}
          y={170}
          fill={BLUE}
          fontSize={9.5}
          fontFamily={MONO}
          textAnchor="middle"
          letterSpacing="0.1em"
        >
          CHAMPIONNE
        </text>
      </g>

      <text x={20} y={292} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        Une défaite = sortie du tournoi.
      </text>
    </svg>
  );
}

function DoubleEliminationDiagram() {
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label="Double élimination : bracket haut, bracket bas et grande finale."
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>Bracket haut · invaincues</ColumnLabel>
      <Box x={20} y={30} lines={["Tour 1"]} h={38} accent={BLUE} />
      <Box x={186} y={30} lines={["Tour 2"]} h={38} accent={BLUE} />
      <Box x={352} y={30} lines={["Finale haute"]} h={38} accent={BLUE} />
      <Elbow from={[152, 49]} to={[186, 49]} color={BLUE} />
      <Elbow from={[318, 49]} to={[352, 49]} color={BLUE} />

      <ColumnLabel x={20} y={216}>Bracket bas · une défaite</ColumnLabel>
      <Box x={20} y={228} lines={["Tour 1 bas"]} h={38} accent={AMBER} />
      <Box x={186} y={228} lines={["Tour 2 bas"]} h={38} accent={AMBER} />
      <Box x={352} y={228} lines={["Finale basse"]} h={38} accent={AMBER} />
      <Elbow from={[152, 247]} to={[186, 247]} color={AMBER} />
      <Elbow from={[318, 247]} to={[352, 247]} color={AMBER} />

      {/* Chutes du bracket haut vers le bracket bas. */}
      {[
        [86, 20],
        [252, 186],
        [418, 352],
      ].map(([cx, boxX]) => (
        <g key={cx}>
          <line
            x1={cx}
            y1={68}
            x2={cx}
            y2={222}
            stroke={AMBER}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            markerEnd="url(#rule-arrow)"
            style={{ color: AMBER }}
          />
          <text
            x={cx + 8}
            y={150}
            fill={AMBER}
            fontSize={10.5}
            fontFamily={MONO}
            aria-hidden={boxX < 0}
          >
            perdant
          </text>
        </g>
      ))}

      <rect
        x={528}
        y={112}
        width={148}
        height={72}
        rx={9}
        fill="rgba(90,200,255,0.10)"
        stroke={BLUE}
        strokeWidth={1.3}
      />
      <text x={602} y={140} fill={INK} fontSize={12.5} fontFamily={MONO} textAnchor="middle">
        Grande finale
      </text>
      <text x={602} y={160} fill={MUTE} fontSize={11} fontFamily={MONO} textAnchor="middle">
        un seul match
      </text>
      <Elbow from={[484, 49]} to={[528, 132]} color={BLUE} />
      <Elbow from={[484, 247]} to={[528, 164]} color={AMBER} />

      <text x={20} y={312} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        Deux défaites = sortie du tournoi. Pas de belle en grande finale.
      </text>
    </svg>
  );
}

function SwissDiagram() {
  const groups: { label: string; teams: string; y: number; accent: string }[][] = [
    [{ label: "Seeding", teams: "8 équipes · 4 matchs", y: 120, accent: LINE }],
    [
      { label: "1 victoire", teams: "4 équipes · 2 matchs", y: 60, accent: BLUE },
      { label: "0 victoire", teams: "4 équipes · 2 matchs", y: 180, accent: AMBER },
    ],
    [
      { label: "2 victoires", teams: "2 équipes · 1 match", y: 30, accent: BLUE },
      { label: "1 victoire", teams: "4 équipes · 2 matchs", y: 120, accent: MUTE },
      { label: "0 victoire", teams: "2 équipes · 1 match", y: 210, accent: AMBER },
    ],
  ];
  const colX = [20, 250, 480];

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 300"
      role="img"
      aria-label="Ronde suisse : après chaque ronde, les équipes sont regroupées par score."
      style={{ color: LINE }}
    >
      <ArrowDefs />
      {["Ronde 1", "Ronde 2", "Ronde 3"].map((label, i) => (
        <ColumnLabel key={label} x={colX[i]} y={16}>
          {label}
        </ColumnLabel>
      ))}

      {groups.map((col, ci) =>
        col.map((g) => (
          <g key={`${ci}-${g.label}`}>
            <Box x={colX[ci]} y={g.y} w={168} h={50} lines={[g.label, g.teams]} accent={g.accent} />
          </g>
        )),
      )}

      {/* Ronde 1 → groupes de score. */}
      <Elbow from={[188, 145]} to={[250, 85]} color={BLUE} />
      <Elbow from={[188, 145]} to={[250, 205]} color={AMBER} />
      {/* Ronde 2 → ronde 3. */}
      <Elbow from={[418, 85]} to={[480, 55]} color={BLUE} />
      <Elbow from={[418, 85]} to={[480, 145]} color={MUTE} />
      <Elbow from={[418, 205]} to={[480, 145]} color={MUTE} />
      <Elbow from={[418, 205]} to={[480, 235]} color={AMBER} />

      <text x={20} y={288} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        Personne n&apos;est éliminé : toutes les équipes jouent chaque ronde.
      </text>
    </svg>
  );
}

function SurvivalDiagram() {
  const rows = (count: number, x: number, y: number, cutFrom: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => {
      const inCut = i >= cutFrom;
      return (
        <g key={`${prefix}-${i}`}>
          <rect
            x={x}
            y={y + i * 26}
            width={150}
            height={22}
            rx={5}
            fill={inCut ? "rgba(255,77,94,0.10)" : SURFACE}
            stroke={inCut ? RED : LINE}
            strokeWidth={1.1}
          />
          <text x={x + 9} y={y + i * 26 + 15} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
            {i + 1}
          </text>
          <text x={x + 26} y={y + i * 26 + 15} fill={inCut ? RED : INK} fontSize={11} fontFamily={MONO}>
            {`Équipe ${String.fromCharCode(65 + i)}`}
          </text>
        </g>
      );
    });

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label="Mode Survie : classement unique, appariement par paires adjacentes et coupe des deux dernières."
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>Classement du round</ColumnLabel>
      {rows(8, 20, 30, 6, "r1")}

      {/* Appariements par paires adjacentes. */}
      {[0, 1, 2, 3].map((p) => (
        <g key={p}>
          <path
            d={`M 176 ${43 + p * 52} L 192 ${43 + p * 52} L 192 ${69 + p * 52} L 176 ${69 + p * 52}`}
            fill="none"
            stroke={BLUE}
            strokeWidth={1.2}
          />
          <text x={198} y={60 + p * 52} fill={BLUE} fontSize={10.5} fontFamily={MONO}>
            vs
          </text>
        </g>
      ))}

      <text x={244} y={40} fill={MUTE} fontSize={11} fontFamily={MONO}>
        1 vs 2, 3 vs 4…
      </text>
      <text x={244} y={58} fill={MUTE} fontSize={11} fontFamily={MONO}>
        puis reclassement
      </text>
      <line
        x1={244}
        y1={76}
        x2={244}
        y2={210}
        stroke={LINE}
        strokeWidth={1.1}
        strokeDasharray="3 3"
      />
      <text x={244} y={230} fill={RED} fontSize={11} fontFamily={MONO}>
        coupe : les 2
      </text>
      <text x={244} y={248} fill={RED} fontSize={11} fontFamily={MONO}>
        dernières sortent
      </text>

      <Elbow from={[352, 150]} to={[400, 150]} color={BLUE} />

      <ColumnLabel x={412} y={18}>Round suivant</ColumnLabel>
      {rows(6, 412, 30, 4, "r2")}

      <text x={412} y={222} fill={MUTE} fontSize={11} fontFamily={MONO}>
        … jusqu&apos;à la championne.
      </text>

      {/* Encart barrage. */}
      <rect
        x={412}
        y={240}
        width={264}
        height={62}
        rx={8}
        fill="rgba(245,165,36,0.08)"
        stroke={AMBER}
        strokeWidth={1.2}
      />
      <text x={426} y={260} fill={AMBER} fontSize={11} fontFamily={MONO} letterSpacing="0.08em">
        ⚖ EFFECTIF IMPAIR
      </text>
      <text x={426} y={278} fill={MUTE} fontSize={11} fontFamily={MONO}>
        Round 1 : barrage entre les
      </text>
      <text x={426} y={294} fill={MUTE} fontSize={11} fontFamily={MONO}>
        2 dernières, le perdant sort.
      </text>
    </svg>
  );
}

function MultiDiagram() {
  type FunnelLevel = { in: number; out: number; x: number; y: number };

  const FunnelBox = ({ in: inCount, out: outCount, x, y }: FunnelLevel) => (
    <g>
      <rect
        x={x}
        y={y}
        width={160}
        height={60}
        rx={8}
        fill={SURFACE}
        stroke={LINE}
        strokeWidth={1.2}
      />
      <text x={x + 80} y={y + 20} fill={INK} fontSize={18} fontWeight={600} textAnchor="middle" fontFamily={MONO}>
        {inCount}
      </text>
      <text x={x + 80} y={y + 48} fill={MUTE} fontSize={10.5} textAnchor="middle" fontFamily={MONO}>
        {`→ ${outCount}`}
      </text>
    </g>
  );

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 680 300"
      role="img"
      aria-label="Tournoi multi-phases : chaque phase affine l'effectif. Phase 1 : Ronde suisse 128→64, Phase 2 : Survie 64→16, Phase 3 : Double élimination 16→1."
      style={{ color: LINE }}
    >
      <ArrowDefs />

      {/* Phase labels */}
      <ColumnLabel x={35} y={18}>Phase 1</ColumnLabel>
      <ColumnLabel x={245} y={18}>Phase 2</ColumnLabel>
      <ColumnLabel x={460} y={18}>Phase finale</ColumnLabel>

      {/* Funnel boxes */}
      <FunnelBox in={128} out={64} x={20} y={50} />
      <FunnelBox in={64} out={16} x={220} y={50} />
      <FunnelBox in={16} out={1} x={420} y={50} />

      {/* Format labels */}
      <text x={100} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        RONDE SUISSE
      </text>
      <text x={300} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        SURVIE
      </text>
      <text x={500} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        DOUBLE ÉLIM.
      </text>

      {/* Flow arrows */}
      <Elbow from={[180, 80]} to={[220, 80]} color={BLUE} />
      <Elbow from={[380, 80]} to={[420, 80]} color={BLUE} />

      {/* Legend/explanation */}
      <text x={20} y={190} fill={MUTE} fontSize={11} fontFamily={MONO}>
        Chaque phase joue indépendamment et ne transmet
      </text>
      <text x={20} y={208} fill={MUTE} fontSize={11} fontFamily={MONO}>
        que ses qualifiées à la suivante. Formats combinables
      </text>
      <text x={20} y={226} fill={MUTE} fontSize={11} fontFamily={MONO}>
        pour affiner progressivement le podium.
      </text>

      {/* Trophy for winner */}
      <g>
        <rect
          x={535}
          y={60}
          width={120}
          height={50}
          rx={7}
          fill="rgba(90,200,255,0.10)"
          stroke={BLUE}
          strokeWidth={1.2}
        />
        <text x={595} y={82} fill={INK} fontSize={14} textAnchor="middle">
          🏆
        </text>
        <text
          x={595}
          y={103}
          fill={BLUE}
          fontSize={9}
          fontFamily={MONO}
          textAnchor="middle"
          letterSpacing="0.1em"
        >
          CHAMPIONNE
        </text>
      </g>

      <Elbow from={[545, 80]} to={[535, 85]} color={BLUE} />
    </svg>
  );
}

/**
 * Mode « BlueGenji Survie » : capital d'endurance qui monte et descend, puis
 * arbre à 8 dont les affrontements suivent le tableau imposé.
 */
function BgSurvieDiagram() {
  const teams = ["A", "B", "C", "D", "E"];
  const points = [11, 9, 9, 5, 0];

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label="Mode BlueGenji Survie : capital d'endurance par équipe, élimination à zéro, puis play-offs à huit."
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>Endurance</ColumnLabel>
      {teams.map((team, index) => {
        const out = points[index] === 0;
        return (
          <g key={team}>
            <rect
              x={20}
              y={30 + index * 32}
              width={200}
              height={26}
              rx={5}
              fill={out ? "rgba(255,77,94,0.10)" : SURFACE}
              stroke={out ? RED : LINE}
              strokeWidth={1.1}
            />
            <text x={30} y={48 + index * 32} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
              {index + 1}
            </text>
            <text x={48} y={48 + index * 32} fill={out ? RED : INK} fontSize={11} fontFamily={MONO}>
              {`Équipe ${team}`}
            </text>
            <text
              x={196}
              y={48 + index * 32}
              fill={out ? RED : BLUE}
              fontSize={12}
              fontFamily={MONO}
              textAnchor="end"
            >
              {out ? "0 ✕" : `${points[index]} pts`}
            </text>
          </g>
        );
      })}

      <text x={20} y={214} fill={MUTE} fontSize={11} fontFamily={MONO}>
        +1 par map gagnée · −1 par map perdue
      </text>
      <text x={20} y={232} fill={RED} fontSize={11} fontFamily={MONO}>
        à 0 : éliminée sur-le-champ
      </text>
      <text x={20} y={256} fill={MUTE} fontSize={11} fontFamily={MONO}>
        Appariement : 1 vs 2, 3 vs 4…
      </text>
      <text x={20} y={274} fill={MUTE} fontSize={11} fontFamily={MONO}>
        égalité de points : ordre du
      </text>
      <text x={20} y={292} fill={MUTE} fontSize={11} fontFamily={MONO}>
        classement précédent conservé
      </text>

      <Elbow from={[228, 120]} to={[288, 120]} color={BLUE} />

      <ColumnLabel x={300} y={18}>Play-offs à 8</ColumnLabel>
      {[
        ["8", "4"],
        ["6", "2"],
        ["1", "5"],
        ["3", "7"],
      ].map(([top, bottom], index) => (
        <g key={top}>
          <rect
            x={300}
            y={30 + index * 62}
            width={150}
            height={52}
            rx={6}
            fill={SURFACE}
            stroke={LINE}
            strokeWidth={1.1}
          />
          <text x={314} y={50 + index * 62} fill={INK} fontSize={11.5} fontFamily={MONO}>
            {`Seed ${top}`}
          </text>
          <text x={314} y={70 + index * 62} fill={INK} fontSize={11.5} fontFamily={MONO}>
            {`Seed ${bottom}`}
          </text>
          <text x={436} y={60 + index * 62} fill={MUTE} fontSize={10} fontFamily={MONO} textAnchor="end">
            {index === 0 ? "gauche / droite" : ""}
          </text>
        </g>
      ))}

      <Elbow from={[458, 150]} to={[510, 150]} color={BLUE} />

      <text x={520} y={60} fill={MUTE} fontSize={11} fontFamily={MONO}>
        Demi-finales
      </text>
      <text x={520} y={82} fill={INK} fontSize={11} fontFamily={MONO}>
        puis finale
      </text>
      <rect
        x={520}
        y={100}
        width={158}
        height={58}
        rx={8}
        fill="rgba(245,165,36,0.08)"
        stroke={AMBER}
        strokeWidth={1.2}
      />
      <text x={534} y={122} fill={AMBER} fontSize={11} fontFamily={MONO} letterSpacing="0.08em">
        🥉 PETITE FINALE
      </text>
      <text x={534} y={142} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
        jouée avec la finale
      </text>
    </svg>
  );
}

const DIAGRAMS: Record<RuleDiagram, () => React.JSX.Element> = {
  SINGLE: SingleEliminationDiagram,
  DOUBLE: DoubleEliminationDiagram,
  SWISS: SwissDiagram,
  SURVIVAL: SurvivalDiagram,
  MULTI: MultiDiagram,
  BG_SURVIE: BgSurvieDiagram,
};

const LEGENDS: Record<RuleDiagram, { color: string; label: string }[]> = {
  SINGLE: [
    { color: BLUE, label: "Progression du vainqueur" },
    { color: LINE, label: "Match du tour" },
  ],
  DOUBLE: [
    { color: BLUE, label: "Bracket haut" },
    { color: AMBER, label: "Bracket bas" },
  ],
  SWISS: [
    { color: BLUE, label: "Groupe de tête" },
    { color: AMBER, label: "Groupe de queue" },
  ],
  SURVIVAL: [
    { color: BLUE, label: "Appariement" },
    { color: RED, label: "Zone de coupe" },
    { color: AMBER, label: "Barrage" },
  ],
  MULTI: [
    { color: BLUE, label: "Flux des qualifiées" },
    { color: LINE, label: "Effectif d'une phase" },
  ],
  BG_SURVIE: [
    { color: BLUE, label: "Endurance restante" },
    { color: RED, label: "Capital épuisé" },
    { color: AMBER, label: "Petite finale" },
  ],
};

/**
 * Schéma d'un mode, encadré, légendé et défilable horizontalement sur mobile.
 */
export function RuleDiagramFigure({
  diagram,
  caption,
}: {
  diagram: RuleDiagram;
  caption: string;
}) {
  const Diagram = DIAGRAMS[diagram];
  return (
    <figure className={styles.frame} style={{ margin: 0 }}>
      <ul className={styles.legend}>
        {LEGENDS[diagram].map((item) => (
          <li key={item.label} className={styles.legendItem}>
            <span className={styles.swatch} style={{ color: item.color, background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
      <ScrollArea className={styles.scroll} ariaLabel={`Schéma : ${caption}`}>
        <Diagram />
      </ScrollArea>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
