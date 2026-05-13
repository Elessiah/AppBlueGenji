interface IconProps {
  name: "relay" | "swords" | "user" | "bell" | "key" | "chart" | "discord";
  size?: number;
}

export function Icon({ name, size = 22 }: IconProps) {
  const c = "currentColor";
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: c, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

  switch (name) {
    case "relay":
      return <svg {...props}><path d="M4 7h10M14 7l-3-3M14 7l-3 3M20 17H10M10 17l3-3M10 17l3 3"/></svg>;
    case "swords":
      return <svg {...props}><path d="M3 21l6-6M21 21l-6-6M3 3l8 8M21 3l-8 8M5 19l-2 2M19 19l2 2"/><path d="M11 11l2 2"/></svg>;
    case "user":
      return <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>;
    case "bell":
      return <svg {...props}><path d="M6 9a6 6 0 0112 0c0 5 2 7 2 7H4s2-2 2-7z"/><path d="M10 20a2 2 0 004 0"/></svg>;
    case "key":
      return <svg {...props}><circle cx="8" cy="14" r="4"/><path d="M11 14l9-9M16 5l3 3M14 7l3 3"/></svg>;
    case "chart":
      return <svg {...props}><path d="M4 20V8M10 20V4M16 20v-9M22 20H2"/></svg>;
    case "discord":
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M19.3 4.4A18 18 0 0014.9 3l-.2.4a16 16 0 014 2 14 14 0 00-13.4 0c1.2-.8 2.6-1.6 4-2L9 3a18 18 0 00-4.3 1.4C2 8.5 1.3 12.4 1.7 16.3a18 18 0 005.5 2.8l1.1-1.6a12 12 0 01-1.8-.9l.4-.3a13 13 0 0010.2 0l.4.3a12 12 0 01-1.8.9l1.1 1.6a18 18 0 005.5-2.8c.5-4.5-.4-8.4-2.9-12zM8.5 14.2c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3zm7 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3z"/></svg>;
    default:
      return null;
  }
}
