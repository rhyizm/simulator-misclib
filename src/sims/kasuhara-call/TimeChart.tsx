"use client";

import { useId, useMemo, useState } from "react";
import { SERIES_STEP, clock, type SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

type Metric = "waiting" | "abandoned";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

/**
 * 時刻 × (保留中の人数 | あきらめた客の累計) の折れ線グラフ。
 * 2 系列を同じ軸で比べる。ホバーで縦線とツールチップを出す。
 */
export function TimeChart({
  series,
  durationMin,
  metric,
  onMetricChange,
}: {
  series: ChartSeries[];
  durationMin: number;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric]);
    return Math.max(10, Math.ceil(m / 10) * 10);
  }, [series, metric]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / durationMin) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(" "),
  );

  const yTicks = [0, yMax / 2, yMax];
  const xTicks = Array.from({ length: 5 }, (_, i) => (durationMin * i) / 4);

  const hover = hoverT === null
    ? null
    : series.map((s) => {
        const idx = Math.min(s.points.length - 1, Math.round(hoverT / SERIES_STEP));
        return s.points[idx];
      });

  const metricLabel = metric === "waiting" ? "保留で待っている人数" : "待ちきれずに切った客 (累計)";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{metricLabel} の推移</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["waiting", "abandoned"] as const).map((m) => (
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
              {m === "waiting" ? "保留中" : "あきらめた客"}
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
        <title id={`${id}-title`}>{metricLabel}の時間推移。{series.map((s) => s.name).join("と")}の比較。</title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {clock(t)}
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hoverT !== null && hover && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted)" strokeDasharray="3 3" />
            {hover.map((p, i) =>
              p ? (
                <circle key={i} cx={x(p.t)} cy={y(p[metric])} r={4} fill={series[i].color} stroke="var(--card)" strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span>{s.name}</span>
            {hover && hover[i] && (
              <span className="font-mono text-muted">
                {clock(hover[i].t)}: {hover[i][metric]} 人
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
