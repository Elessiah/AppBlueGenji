import { BotStatus } from "@/lib/shared/types";

export function BotLatencyCard({ status }: { status: BotStatus | null }) {
  const gateway = status?.gatewayLatency ?? 0;
  const cpu = status?.cpuUsage ?? 0;
  const ram = status?.ramUsage ?? 0;

  const cells = [
    { label: "GATEWAY", value: gateway === 0 ? "—" : gateway, unit: "ms", width: Math.min(gateway / 100, 1) * 100 },
    { label: "CPU", value: cpu === 0 ? "—" : cpu.toFixed(1), unit: "%", width: Math.min(cpu, 100) },
    { label: "RAM", value: ram === 0 ? "—" : ram.toFixed(0), unit: "MB", width: Math.min(ram / 1024, 1) * 100 },
  ];

  return (
    <section className="panel lat-card">
      <div className="panel-head">
        <span className="title">Santé du système</span>
        <span className="meta">SAMPLED 5s</span>
      </div>
      <div className="panel-body">
        {cells.map((cell) => (
          <div key={cell.label} className="lat-cell">
            <span className="l">{cell.label}</span>
            <span className="v ok">
              {cell.value} <span style={{ fontSize: 12, color: "var(--fg-mute)" }}>{cell.unit}</span>
            </span>
            <div className="lat-bar">
              <i style={{ width: `${cell.width}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
