"use client";

import { useId, useMemo, useState } from "react";
import { CUT_MONTHS, TOTAL_MONTHS, type SeriesPoint } from "./model";
import { monthLabel } from "./render";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

export type Metric = "price" | "gain";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function fmtValue(v: number, metric: Metric): string {
  return metric === "price" ? v.toFixed(1) : `${(v / 10000).toFixed(1)} 万円`;
}

/**
 * 月 × (食料品の値段の指数 | 1 世帯あたりの得の累計) の折れ線グラフ。
 * 2 系列を同じ軸で比べ、減税が終わる 2029 年 4 月に縦線を引く。
 */
export function TimeChart({
  series,
  metric,
  onMetricChange,
}: {
  series: ChartSeries[];
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);

  const [yMin, yMax] = useMemo(() => {
    if (metric === "gain") {
      let m = 0;
      for (const s of series) for (const p of s.points) m = Math.max(m, p.gain);
      return [0, Math.max(10000, Math.ceil(m / 20000) * 20000)];
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const p of s.points) {
      lo = Math.min(lo, p.price);
      hi = Math.max(hi, p.price);
    }
    if (!Number.isFinite(lo)) return [90, 110];
    return [Math.floor(Math.min(lo, 100) / 2) * 2 - 2, Math.ceil(Math.max(hi, 100) / 2) * 2 + 2];
  }, [series, metric]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / TOTAL_MONTHS) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // 値段は減税の終わりで段差になるので、段差をそのまま描く
  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(" "),
  );

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks = [0, 12, 24, 36];

  const hover =
    hoverT === null
      ? null
      : series.map((s) => {
          let best = s.points[0];
          for (const p of s.points) if (Math.abs(p.t - hoverT) < Math.abs(best.t - hoverT)) best = p;
          return best;
        });

  const metricLabel = metric === "price" ? "食料品の値段 (2027 年 3 月 = 100、税込み)" : "1 世帯あたりの得の累計 (平均)";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{metricLabel}</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["price", "gain"] as const).map((m) => (
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
              {m === "price" ? "値段" : "得の累計"}
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
          const t = ((px - PAD.left) / plotW) * TOTAL_MONTHS;
          setHoverT(Math.max(0, Math.min(TOTAL_MONTHS, t)));
        }}
        onMouseLeave={() => setHoverT(null)}
      >
        <title id={`${id}-title`}>
          {metricLabel}の推移。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {metric === "price" ? v.toFixed(0) : `${(v / 10000).toFixed(0)}万`}
            </text>
          </g>
        ))}
        {metric === "price" && yMin < 100 && yMax > 100 && (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(100)} y2={y(100)} stroke="var(--muted)" strokeDasharray="2 4" />
        )}
        <line x1={x(CUT_MONTHS)} x2={x(CUT_MONTHS)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border)" strokeDasharray="4 3" />
        <text x={x(CUT_MONTHS) + 4} y={PAD.top + 10} fontSize={10} fill="var(--muted)">
          減税おわり
        </text>
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {t === 36 ? "2030年4月" : monthLabel(t)}
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name + i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hoverT !== null && hover && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted)" strokeDasharray="3 3" />
            {hover.map((p, i) =>
              p ? <circle key={i} cx={x(p.t)} cy={y(p[metric])} r={4} fill={series[i].color} stroke="var(--card)" strokeWidth={2} /> : null,
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
                {monthLabel(Math.min(hover[i].t, 35.99))}: {fmtValue(hover[i][metric], metric)}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
