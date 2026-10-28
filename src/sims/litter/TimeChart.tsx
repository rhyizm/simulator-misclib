"use client";

import { useId, useMemo, useState } from "react";
import type { SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

export type Metric = "street" | "littered";

const METRIC_LABEL: Record<Metric, string> = {
  street: "道に落ちているごみ",
  littered: "ポイ捨ての累計",
};

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function fmtHour(startHour: number, t: number): string {
  const total = startHour * 60 + Math.floor(t / 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 時刻 × (道のごみ | ポイ捨ての累計) の折れ線グラフ。
 * 2 系列を同じ軸で比べる。ホバーで縦線とツールチップを出す。
 */
export function TimeChart({
  series,
  durationSec,
  startHour,
  metric,
  onMetricChange,
}: {
  series: ChartSeries[];
  durationSec: number;
  startHour: number;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric]);
    const unit = m > 2000 ? 1000 : m > 200 ? 100 : 10;
    return Math.max(10, Math.ceil(m / unit) * unit);
  }, [series, metric]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / durationSec) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(" "),
  );

  const yTicks = [0, yMax / 2, yMax];
  const hours = durationSec / 3600;
  const tickEvery = hours > 8 ? 3 : 2;
  const xTicks = Array.from({ length: Math.floor(hours / tickEvery) + 1 }, (_, i) => i * tickEvery * 3600);
  // 系列は 2 分ごとに記録している
  const step = series[0]?.points[1] ? series[0].points[1].t - series[0].points[0].t : 1;

  const hover =
    hoverT === null
      ? null
      : series.map((s) => {
          const idx = Math.min(s.points.length - 1, Math.round(hoverT / step));
          return s.points[idx];
        });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{METRIC_LABEL[metric]} の推移</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["street", "littered"] as const).map((m) => (
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
              {m === "street" ? "道のごみ" : "ポイ捨て累計"}
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
          const t = ((px - PAD.left) / plotW) * durationSec;
          setHoverT(Math.max(0, Math.min(durationSec, t)));
        }}
        onMouseLeave={() => setHoverT(null)}
      >
        <title id={`${id}-title`}>
          {METRIC_LABEL[metric]}の時間推移。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v.toLocaleString()}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {fmtHour(startHour, t)}
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name + i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
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
          <span key={s.name + i} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span>{s.name}</span>
            {hover && hover[i] && (
              <span className="font-mono text-muted">
                {fmtHour(startHour, hover[i].t)}: {hover[i][metric].toLocaleString()} 個
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
