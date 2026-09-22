import { CSSProperties, InputHTMLAttributes } from "react";

type CocheTheme = "tournoi" | "joueur" | "equipe";

interface CocheProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  theme?: CocheTheme;
}

const THEME_COLORS: Record<CocheTheme, { base: string; rgb: string }> = {
  tournoi: { base: "#4fe0a2", rgb: "79,224,162" },
  joueur: { base: "#59d4ff", rgb: "89,212,255" },
  equipe: { base: "#ff9d2e", rgb: "255,157,46" },
};

export function Coche({
  label,
  checked,
  onChange,
  theme = "joueur",
  ...props
}: CocheProps) {
  // Le thème donne **deux** valeurs, et il le faut : la couleur pleine de la
  // pastille et le triplet `r,g,b` de ses voiles. Un réglage unique servait les
  // deux, si bien qu'une couleur passée par un appelant sortait en
  // `rgba(#ff0000,0.28)` — déclaration invalide, donc anneau de focus muet. Il
  // n'avait aucun appelant : il est retiré plutôt que rafistolé.
  const { base: color, rgb: rgbColor } = THEME_COLORS[theme];

  return (
    // L'anneau de focus se pose en CSS (`.coche-input:focus-visible ~ .coche-pill`,
    // `app/globals.css`) : la case native est masquée, c'est elle qui reçoit le
    // focus et la pastille qui se voit. D'où le découpage en deux — l'étiquette
    // n'est plus qu'un cadre, la pastille est le frère de l'input — et la teinte
    // du thème passée en variable CSS, la feuille ne connaissant pas le thème.
    <label
      style={
        {
          display: "inline-flex",
          position: "relative",
          cursor: "pointer",
          "--coche-rgb": rgbColor,
        } as CSSProperties
      }
    >
      {/* `{...props}` passe **avant** : étalé après, un `onFocus` ou un `onBlur`
          d'appelant écraserait ceux du contrôle. Le style de masquage reste le
          dernier — la pastille ne se voit que parce que l'input, lui, ne se voit
          pas. */}
      <input
        {...props}
        className="coche-input"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          ...props.style,
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />
      <span
        className="coche-pill"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: 999,
          border: `1px solid ${checked ? `rgba(${rgbColor},0.4)` : "var(--line)"}`,
          background: checked ? `rgba(${rgbColor},0.1)` : "rgba(255,255,255,0.03)",
          fontSize: 14,
          userSelect: "none",
          transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `1.5px solid ${checked ? `rgba(${rgbColor},0.8)` : "rgba(255,255,255,0.2)"}`,
            background: checked ? color : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s",
            fontSize: 10,
            color: "var(--bg-0)",
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          {checked && "✓"}
        </span>
        <span style={{ color: checked ? "var(--text-0)" : "var(--text-1)" }}>
          {label}
        </span>
      </span>
    </label>
  );
}
