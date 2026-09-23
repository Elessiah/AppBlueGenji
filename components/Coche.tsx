import { CSSProperties, InputHTMLAttributes } from "react";

type CocheTheme = "tournoi" | "joueur" | "equipe";

/**
 * `className` et `style` sortent avec `type` et `onChange`, et pour la même
 * raison : ce qui se **voit** ici n'est pas l'input mais la pastille, et l'input
 * est masqué (`opacity: 0`, 0×0). Une classe ou un style d'appelant posé dessus
 * ne peindrait rien — les accepter pour les jeter donne un réglage qui compile,
 * ne fait rien et ne le dit pas. Le compilateur les refuse donc, comme il refuse
 * de redéfinir le `type`.
 *
 * `disabled` sort avec eux, et c'est le plus grave des quatre : il ne fait pas
 * *rien*, il fait la **moitié**. Posé sur l'input masqué, il bloque bien le
 * geste — mais la pastille, seule chose visible, garde son cadre plein, sa
 * couleur de texte et son `cursor: pointer` : le contrôle annonce un clic qu'il
 * refuse. C'est exactement ce que cette feuille interdit ailleurs (une case
 * désactivée se dit en couleurs, `globals.css`), et un réglage qui ment est pire
 * qu'un réglage absent. Le jour où une pastille doit pouvoir s'éteindre, c'est
 * ici que l'état se peint — pas chez l'appelant.
 */
interface CocheProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "onChange" | "className" | "style" | "disabled"
  > {
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
      {/* `{...props}` passe **avant** : étalé après, il écraserait le `type`, le
          `checked` et l'`onChange` du contrôle. Ce qui suit n'est donc pas
          surchargeable, et ce que l'appelant ne peut pas surcharger, il ne peut
          pas non plus l'écrire — `className` et `style` sont refusés par le type
          (voir `CocheProps`) plutôt que reçus puis jetés. */}
      <input
        {...props}
        className="coche-input"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
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
