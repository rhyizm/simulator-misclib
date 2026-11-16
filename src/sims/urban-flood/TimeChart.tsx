"use client";

import { useId, useMemo, useState } from "react";
import type { SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

export type Metric = "hollow" | "under" | "rain";

const META: Record<Metric, { label: string; unit: string; scale: number; min: number; stepTo: number }> = {
  hollow: { label: "くぼ地の水深", unit: "cm", scale: 100, min: 20, stepTo: 10 },
  under: { label: "アンダーパスの水深", unit: "cm", scale: 100, min: 50, stepTo: 50 },
  rain: { label: "雨の強さ", unit: "mm/h", scale: 1, min: 60, stepTo: 20 },
};

function fmtClock(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

const W = 640;
const H = 220;
const PAD = { top: 26, right: 16, bottom: 28, left: 44 };

/**
 * 時間 × (くぼ地の水深 | アンダーパスの水深 | 雨の強さ) の折れ線グラフ。
 * 2 つの世界を同じ軸で比べる。ホバーで縦線と値を出す。
 */
export function TimeChart({
  series,
  durationMin,
  metric,
  onMetricChange,
  guide,
}: {
  series: ChartSeries[];
  durationMin: number;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
  /** 目安の線 (例: 下水道の能力、車が止まる水深) */
  guide?: { value: number; label: string };
}) {
  const id = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const meta = META[metric];
  const val = (p: SeriesPoint) => p[metric] * meta.scale;

  const yMax = useMemo(() => {
    let m = meta.min;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric] * meta.scale);
    if (guide) m = Math.max(m, guide.value * 1.1);
    return Math.ceil(m / meta.stepTo) * meta.stepTo;
  }, [series, metric, meta, guide]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / durationMin) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const yTicks = [0, yMax / 2, yMax];
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round((durationMin * i) / 4));
  const step = 5;
  const hover =
    hoverT === null
      ? null
      : series.map((s) => s.points[Math.min(s.points.length - 1, Math.round(hoverT / step))]);
  // 雨はどちらの世界も同じなので 1 本だけ描く
  const shown = metric === "rain" ? series.slice(0, 1) : series;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{meta.label} の推移</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(Object.keys(META) as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metric === m}
              onClick={() => onMetricChange(m)}
              className={`rounded-md border px-2 py-1 ${
                metric === m ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {META[m].label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${id}-title`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const t = ((px - PAD.left) / plotW) * durationMin;
          setHoverT(Math.max(0, Math.min(durationMin, t)));
        }}
        onMouseLeave={() => setHoverT(null)}
      >
        <title id={`${id}-title`}>
          {meta.label}の時間推移。{shown.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.left - 6} y={PAD.top - 12} fontSize={10} textAnchor="end" fill="var(--muted)">
          {meta.unit}
        </text>
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {fmtClock(t)}
          </text>
        ))}
        {guide && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(guide.value)}
              y2={y(guide.value)}
              stroke="var(--amber)"
              strokeDasharray="4 4"
            />
            <text x={W - PAD.right - 4} y={y(guide.value) - 4} fontSize={11} textAnchor="end" fill="var(--amber)">
              {guide.label}
            </text>
          </g>
        )}
        {shown.map((s) => (
          <path
            key={s.name}
            d={s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(val(p)).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={metric === "rain" ? "var(--accent)" : s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hoverT !== null && hover && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted)" strokeDasharray="3 3" />
            {shown.map((s, i) =>
              hover[i] ? (
                <circle
                  key={s.name}
                  cx={x(hover[i].t)}
                  cy={y(val(hover[i]))}
                  r={4}
                  fill={metric === "rain" ? "var(--accent)" : s.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </g>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {shown.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: metric === "rain" ? "var(--accent)" : s.color }}
              aria-hidden
            />
            <span>{metric === "rain" ? "雨 (両方の世界で同じ)" : s.name}</span>
            {hover && hover[i] && (
              <span className="font-mono text-muted">
                {fmtClock(hover[i].t)}: {val(hover[i]).toFixed(0)} {meta.unit}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
