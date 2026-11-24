"use client";

import { fmtTemp, Reading } from "@/lib/sigap";

/** Grafik suhu sederhana (SVG) dengan pita zona bahaya. */
export default function TempChart({ readings, dangerMin, dangerMax }: { readings: Reading[]; dangerMin: number; dangerMax: number }) {
  if (readings.length === 0) return <p className="muted small">Belum ada data sensor.</p>;
  const W = 720, H = 240, P = { l: 44, r: 12, t: 12, b: 28 };
  const temps = readings.map((r) => r.tempX10 / 10);
  const lo = Math.min(0, ...temps, dangerMin / 10 - 5);
  const hi = Math.max(80, ...temps, dangerMax / 10 + 5);
  const t0 = readings[0].ts, t1 = Math.max(readings[readings.length - 1].ts, t0 + 1);
  const x = (ts: number) => P.l + ((ts - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (t: number) => P.t + (1 - (t - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = readings.map((r, i) => `${i ? "L" : "M"}${x(r.ts).toFixed(1)},${y(r.tempX10 / 10).toFixed(1)}`).join(" ");
  const ticks = [0, 20, 40, 60, 80].filter((v) => v >= lo && v <= hi);
  const fmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const inDanger = (t: number) => t > dangerMin && t < dangerMax;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#fbfdfc", borderRadius: 10 }}>
      <rect x={P.l} width={W - P.l - P.r} y={y(dangerMax / 10)} height={y(dangerMin / 10) - y(dangerMax / 10)} fill="#fde8e8" />
      <text x={W - P.r - 4} y={y(dangerMax / 10) + 14} textAnchor="end" fontSize="11" fill="#c53030">
        Zona bahaya {fmtTemp(dangerMin)} – {fmtTemp(dangerMax)}
      </text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#e1e7e2" />
          <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5f6f65">{v}°</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#0f7b4a" strokeWidth="2" />
      {readings.map((r, i) => (
        <circle key={i} cx={x(r.ts)} cy={y(r.tempX10 / 10)} r="2.6" fill={inDanger(r.tempX10) ? "#c53030" : "#0f7b4a"}>
          <title>{`${fmt(r.ts)} · ${fmtTemp(r.tempX10)}`}</title>
        </circle>
      ))}
      <text x={P.l} y={H - 8} fontSize="11" fill="#5f6f65">{fmt(t0)}</text>
      <text x={W - P.r} y={H - 8} textAnchor="end" fontSize="11" fill="#5f6f65">{fmt(t1)}</text>
    </svg>
  );
}
