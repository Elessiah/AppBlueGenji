/**
 * Schémas explicatifs des modes de tournoi (`/regles/[slug]`).
 *
 * Tout est en SVG inline : aucune dépendance externe, thème respecté via les
 * tokens CSS (`--blue-500`, `--violet-400`, `--pink-400`, `--ink`…), et le rendu reste net à toutes
 * les tailles. Les schémas sont dessinés à largeur fixe et défilent
 * horizontalement sur mobile (cf. `.scroll` / `.svg` dans le module CSS) plutôt
 * que de se comprimer jusqu'à l'illisibilité.
 */
import type { Locale } from "@/lib/shared/locales";
import { formatMessage, type MessageValues } from "@/lib/shared/message-format";
import type { RuleDiagram, RulesMessages } from "@/lib/shared/tournament-rules";
import styles from "./RuleDiagram.module.css";
import { ScrollArea } from "@/components/cyber";

const BLUE = "var(--blue-500)";
/** Bracket bas, rangée des perdants : violet néon (aucune teinte chaude, DESIGN_SYSTEM.md). */
const LOWER = "var(--violet-400)";
/** Zone de coupe : rose néon — le rouge est réservé au direct (`.pill-live`). */
const CUT = "var(--pink-400)";
const INK = "var(--ink)";
const MUTE = "var(--ink-mute)";
const LINE = "var(--line-strong-cy)";
const SURFACE = "var(--cyber-bg-2)";

const MONO = "var(--font-mono)";

/** Textes des schémas (`rules.diagram`), dans la langue de la page. */
type DiagramText = RulesMessages["diagram"];

type DiagramProps = Readonly<{ t: DiagramText; locale: Locale }>;

function format(locale: Locale, message: string, values: MessageValues): string {
  return formatMessage(locale, message, values);
}

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
function Box({ x, y, w = 132, h = 44, lines, accent = LINE, dashed, dim }: Readonly<BoxProps>) {
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
          key={i} /* NOSONAR S6479 — lignes d'une étiquette de schéma, constantes */
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
}: Readonly<{
  from: [number, number];
  to: [number, number];
  color?: string;
  dashed?: boolean;
}>) {
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
function ColumnLabel({ x, y, children }: Readonly<{ x: number; y: number; children: string }>) {
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

function SingleEliminationDiagram({ t, locale }: DiagramProps) {
  const qfY = [30, 100, 170, 240];
  const sfY = [65, 205];
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 300"
      role="img"
      aria-label={t.single.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />
      <ColumnLabel x={20} y={16}>{t.single.quarterFinals}</ColumnLabel>
      <ColumnLabel x={228} y={16}>{t.single.semiFinals}</ColumnLabel>
      <ColumnLabel x={436} y={16}>{t.single.final}</ColumnLabel>

      {qfY.map((y, i) => (
        <Box
          key={y}
          x={20}
          y={y}
          lines={[format(locale, t.team, { name: i * 2 + 1 }), format(locale, t.team, { name: i * 2 + 2 })]}
        />
      ))}
      {sfY.map((y) => (
        <Box key={y} x={228} y={y} lines={[t.single.winner, t.single.winner]} accent={BLUE} />
      ))}
      <Box x={436} y={135} lines={[t.single.finalist, t.single.finalist]} accent={BLUE} />

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
          {t.champion}
        </text>
      </g>

      <text x={20} y={292} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        {t.single.footnote}
      </text>
    </svg>
  );
}

function DoubleEliminationDiagram({ t }: DiagramProps) {
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label={t.double.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>{t.double.upperColumn}</ColumnLabel>
      <Box x={20} y={30} lines={[t.double.upperRound1]} h={38} accent={BLUE} />
      <Box x={186} y={30} lines={[t.double.upperRound2]} h={38} accent={BLUE} />
      <Box x={352} y={30} lines={[t.double.upperFinal]} h={38} accent={BLUE} />
      <Elbow from={[152, 49]} to={[186, 49]} color={BLUE} />
      <Elbow from={[318, 49]} to={[352, 49]} color={BLUE} />

      <ColumnLabel x={20} y={216}>{t.double.lowerColumn}</ColumnLabel>
      <Box x={20} y={228} lines={[t.double.lowerRound1]} h={38} accent={LOWER} />
      <Box x={186} y={228} lines={[t.double.lowerRound2]} h={38} accent={LOWER} />
      <Box x={352} y={228} lines={[t.double.lowerFinal]} h={38} accent={LOWER} />
      <Elbow from={[152, 247]} to={[186, 247]} color={LOWER} />
      <Elbow from={[318, 247]} to={[352, 247]} color={LOWER} />

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
            stroke={LOWER}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            markerEnd="url(#rule-arrow)"
            style={{ color: LOWER }}
          />
          <text
            x={cx + 8}
            y={150}
            fill={LOWER}
            fontSize={10.5}
            fontFamily={MONO}
            aria-hidden={boxX < 0}
          >
            {t.double.loser}
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
        {t.double.grandFinal}
      </text>
      <text x={602} y={160} fill={MUTE} fontSize={11} fontFamily={MONO} textAnchor="middle">
        {t.double.singleMatch}
      </text>
      <Elbow from={[484, 49]} to={[528, 132]} color={BLUE} />
      <Elbow from={[484, 247]} to={[528, 164]} color={LOWER} />

      <text x={20} y={312} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        {t.double.footnote}
      </text>
    </svg>
  );
}

function SwissDiagram({ t, locale }: DiagramProps) {
  const wins = (count: number) => format(locale, t.swiss.wins, { count });
  const group = (teams: number) => format(locale, t.swiss.group, { teams, matches: teams / 2 });
  const groups: { label: string; teams: string; y: number; accent: string }[][] = [
    [{ label: t.swiss.seeding, teams: group(8), y: 120, accent: LINE }],
    [
      { label: wins(1), teams: group(4), y: 60, accent: BLUE },
      { label: wins(0), teams: group(4), y: 180, accent: LOWER },
    ],
    [
      { label: wins(2), teams: group(2), y: 30, accent: BLUE },
      { label: wins(1), teams: group(4), y: 120, accent: MUTE },
      { label: wins(0), teams: group(2), y: 210, accent: LOWER },
    ],
  ];
  const colX = [20, 250, 480];

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 300"
      role="img"
      aria-label={t.swiss.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />
      {[1, 2, 3].map((number) => format(locale, t.swiss.round, { number })).map((label, i) => (
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
      <Elbow from={[188, 145]} to={[250, 205]} color={LOWER} />
      {/* Ronde 2 → ronde 3. */}
      <Elbow from={[418, 85]} to={[480, 55]} color={BLUE} />
      <Elbow from={[418, 85]} to={[480, 145]} color={MUTE} />
      <Elbow from={[418, 205]} to={[480, 145]} color={MUTE} />
      <Elbow from={[418, 205]} to={[480, 235]} color={LOWER} />

      <text x={20} y={288} fill={MUTE} fontSize={11.5} fontFamily={MONO}>
        {t.swiss.footnote}
      </text>
    </svg>
  );
}

function SurvivalDiagram({ t, locale }: DiagramProps) {
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
            fill={inCut ? "rgba(var(--pink-400-rgb), 0.1)" : SURFACE}
            stroke={inCut ? CUT : LINE}
            strokeWidth={1.1}
          />
          <text x={x + 9} y={y + i * 26 + 15} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
            {i + 1}
          </text>
          <text x={x + 26} y={y + i * 26 + 15} fill={inCut ? CUT : INK} fontSize={11} fontFamily={MONO}>
            {format(locale, t.team, { name: String.fromCodePoint(65 + i) })}
          </text>
        </g>
      );
    });

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label={t.survival.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>{t.survival.standings}</ColumnLabel>
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
            {t.survival.versus}
          </text>
        </g>
      ))}

      <text x={244} y={40} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.survival.pairing}
      </text>
      <text x={244} y={58} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.survival.reseed}
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
      <text x={244} y={230} fill={CUT} fontSize={11} fontFamily={MONO}>
        {t.survival.cutLine1}
      </text>
      <text x={244} y={248} fill={CUT} fontSize={11} fontFamily={MONO}>
        {t.survival.cutLine2}
      </text>

      <Elbow from={[352, 150]} to={[400, 150]} color={BLUE} />

      <ColumnLabel x={412} y={18}>{t.survival.nextRound}</ColumnLabel>
      {rows(6, 412, 30, 4, "r2")}

      <text x={412} y={222} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.survival.untilChampion}
      </text>

      {/* Encart barrage. */}
      <rect
        x={412}
        y={240}
        width={264}
        height={62}
        rx={8}
        fill="rgba(var(--violet-400-rgb), 0.08)"
        stroke={LOWER}
        strokeWidth={1.2}
      />
      <text x={426} y={260} fill={LOWER} fontSize={11} fontFamily={MONO} letterSpacing="0.08em">
        {t.survival.oddTitle}
      </text>
      <text x={426} y={278} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.survival.oddLine1}
      </text>
      <text x={426} y={294} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.survival.oddLine2}
      </text>
    </svg>
  );
}

type FunnelLevel = { in: number; out: number; x: number; y: number };

function FunnelBox({ in: inCount, out: outCount, x, y }: Readonly<FunnelLevel>) {
  return (
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
}

function MultiDiagram({ t, locale }: DiagramProps) {
  return (
    <svg
      className={styles.svg}
      viewBox="0 0 680 300"
      role="img"
      aria-label={t.multi.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />

      {/* Phase labels */}
      <ColumnLabel x={35} y={18}>{format(locale, t.multi.phase, { number: 1 })}</ColumnLabel>
      <ColumnLabel x={245} y={18}>{format(locale, t.multi.phase, { number: 2 })}</ColumnLabel>
      <ColumnLabel x={460} y={18}>{t.multi.finalPhase}</ColumnLabel>

      {/* Funnel boxes */}
      <FunnelBox in={128} out={64} x={20} y={50} />
      <FunnelBox in={64} out={16} x={220} y={50} />
      <FunnelBox in={16} out={1} x={420} y={50} />

      {/* Format labels */}
      <text x={100} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        {t.multi.swiss}
      </text>
      <text x={300} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        {t.multi.survival}
      </text>
      <text x={500} y={135} fill={BLUE} fontSize={11} fontFamily={MONO} textAnchor="middle" letterSpacing="0.05em">
        {t.multi.double}
      </text>

      {/* Flow arrows */}
      <Elbow from={[180, 80]} to={[220, 80]} color={BLUE} />
      <Elbow from={[380, 80]} to={[420, 80]} color={BLUE} />

      {/* Legend/explanation */}
      <text x={20} y={190} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.multi.line1}
      </text>
      <text x={20} y={208} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.multi.line2}
      </text>
      <text x={20} y={226} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.multi.line3}
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
          {t.champion}
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
function BgSurvieDiagram({ t, locale }: DiagramProps) {
  const teams = ["A", "B", "C", "D", "E"];
  const points = [11, 9, 9, 5, 0];

  return (
    <svg
      className={styles.svg}
      viewBox="0 0 700 330"
      role="img"
      aria-label={t.bgSurvie.ariaLabel}
      style={{ color: LINE }}
    >
      <ArrowDefs />

      <ColumnLabel x={20} y={18}>{t.bgSurvie.endurance}</ColumnLabel>
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
              fill={out ? "rgba(var(--pink-400-rgb), 0.1)" : SURFACE}
              stroke={out ? CUT : LINE}
              strokeWidth={1.1}
            />
            <text x={30} y={48 + index * 32} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
              {index + 1}
            </text>
            <text x={48} y={48 + index * 32} fill={out ? CUT : INK} fontSize={11} fontFamily={MONO}>
              {format(locale, t.team, { name: team })}
            </text>
            <text
              x={196}
              y={48 + index * 32}
              fill={out ? CUT : BLUE}
              fontSize={12}
              fontFamily={MONO}
              textAnchor="end"
            >
              {out ? "0 ✕" : format(locale, t.bgSurvie.points, { points: points[index] })}
            </text>
          </g>
        );
      })}

      <text x={20} y={214} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.perMap}
      </text>
      <text x={20} y={232} fill={CUT} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.atZero}
      </text>
      <text x={20} y={256} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.pairing}
      </text>
      <text x={20} y={274} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.tieLine1}
      </text>
      <text x={20} y={292} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.tieLine2}
      </text>

      <Elbow from={[228, 120]} to={[288, 120]} color={BLUE} />

      <ColumnLabel x={300} y={18}>{t.bgSurvie.playoffs}</ColumnLabel>
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
            {format(locale, t.bgSurvie.seed, { number: top })}
          </text>
          <text x={314} y={70 + index * 62} fill={INK} fontSize={11.5} fontFamily={MONO}>
            {format(locale, t.bgSurvie.seed, { number: bottom })}
          </text>
          {/* Le côté se lit en face de chaque seed : une seule mention
              « gauche / droite » entre les deux lignes chevauchait les noms. */}
          {index === 0 && (
            <>
              <text x={436} y={50} fill={MUTE} fontSize={10} fontFamily={MONO} textAnchor="end">
                {t.bgSurvie.left}
              </text>
              <text x={436} y={70} fill={MUTE} fontSize={10} fontFamily={MONO} textAnchor="end">
                {t.bgSurvie.right}
              </text>
            </>
          )}
        </g>
      ))}

      <Elbow from={[458, 150]} to={[510, 150]} color={BLUE} />

      <text x={520} y={60} fill={MUTE} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.semiFinals}
      </text>
      <text x={520} y={82} fill={INK} fontSize={11} fontFamily={MONO}>
        {t.bgSurvie.thenFinal}
      </text>
      <rect
        x={520}
        y={100}
        width={158}
        height={58}
        rx={8}
        fill="rgba(var(--violet-400-rgb), 0.08)"
        stroke={LOWER}
        strokeWidth={1.2}
      />
      <text x={534} y={122} fill={LOWER} fontSize={11} fontFamily={MONO} letterSpacing="0.08em">
        {t.bgSurvie.thirdPlace}
      </text>
      <text x={534} y={142} fill={MUTE} fontSize={10.5} fontFamily={MONO}>
        {t.bgSurvie.withFinal}
      </text>
    </svg>
  );
}

const DIAGRAMS: Record<RuleDiagram, (props: DiagramProps) => React.JSX.Element> = {
  SINGLE: SingleEliminationDiagram,
  DOUBLE: DoubleEliminationDiagram,
  SWISS: SwissDiagram,
  SURVIVAL: SurvivalDiagram,
  MULTI: MultiDiagram,
  BG_SURVIE: BgSurvieDiagram,
};

function legends(t: DiagramText): Record<RuleDiagram, { color: string; label: string }[]> {
  return {
    SINGLE: [
      { color: BLUE, label: t.single.legendProgress },
      { color: LINE, label: t.single.legendMatch },
    ],
    DOUBLE: [
      { color: BLUE, label: t.double.legendUpper },
      { color: LOWER, label: t.double.legendLower },
    ],
    SWISS: [
      { color: BLUE, label: t.swiss.legendTop },
      { color: LOWER, label: t.swiss.legendBottom },
    ],
    SURVIVAL: [
      { color: BLUE, label: t.survival.legendPairing },
      { color: CUT, label: t.survival.legendCut },
      { color: LOWER, label: t.survival.legendPlayIn },
    ],
    MULTI: [
      { color: BLUE, label: t.multi.legendFlow },
      { color: LINE, label: t.multi.legendSize },
    ],
    BG_SURVIE: [
      { color: BLUE, label: t.bgSurvie.legendEndurance },
      { color: CUT, label: t.bgSurvie.legendDepleted },
      { color: LOWER, label: t.bgSurvie.legendThirdPlace },
    ],
  };
}

/**
 * Schéma d'un mode, encadré, légendé et défilable horizontalement sur mobile.
 * Composant serveur : ses textes (`rules.diagram`) arrivent dans la langue de
 * la page, rien n'est traduit dans le navigateur.
 */
export function RuleDiagramFigure({
  diagram,
  caption,
  text,
  locale,
}: Readonly<{
  diagram: RuleDiagram;
  caption: string;
  text: DiagramText;
  locale: Locale;
}>) {
  const Diagram = DIAGRAMS[diagram];
  return (
    <figure className={styles.frame} style={{ margin: 0 }}>
      <ul className={styles.legend}>
        {legends(text)[diagram].map((item) => (
          <li key={item.label} className={styles.legendItem}>
            <span className={styles.swatch} style={{ color: item.color, background: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
      <ScrollArea className={styles.scroll} ariaLabel={format(locale, text.scrollLabel, { caption })}>
        <Diagram t={text} locale={locale} />
      </ScrollArea>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
