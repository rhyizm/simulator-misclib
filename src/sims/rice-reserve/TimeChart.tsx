"use client";

import { useId, useMemo, useState } from "react";
import { CRISIS_RATIO, LOW_RATIO, MONTHS, type SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

export type Metric = "price" | "gov" | "priv";

const METRIC_LABEL: Record<Metric, string> = {
  price: "店頭の値段 (円 / 5 kg)",
  gov: "政府備蓄 (万 t)",
  priv: "民間在庫 (万 t)",
};

const METRIC_TAB: Record<Metric, string> = { price: "値段", gov: "政府備蓄", priv: "民間在庫" };

const W = 640;
const H = 230;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function fmtMonth(m: number): string {
  const y = Math.floor(Math.max(0, m - 1) / 12);
  const mo = MONTHS[Math.max(0, m - 1) % 12];
  return `${y + 1}年目${mo}月`;
}

/**
 * 30 年間 × (値段 | 政府備蓄 | 民間在庫) の折れ線グラフ。2 つの世界を同じ軸で比べる。
 * 値段のときは「米騒動」と「安すぎ」の線を引く。
 */
export function TimeChart({
  series,
  months,
  refPrice,
  metric,
  onMetricChange,
}: {
  series: ChartSeries[];
  months: number;
  refPrice: number;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverM, setHoverM] = useState<number | null>(null);

  const yMax = useMemo(() => {
    let m = metric === "price" ? refPrice * 1.6 : 0;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric]);
    const unit = metric === "price" ? 1000 : 50;
    return Math.max(unit, Math.ceil(m / unit) * unit);
  }, [series, metric, refPrice]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / months) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.m).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(" "),
  );

  const yTicks = [0, yMax / 2, yMax];
  const years = months / 12;
  const xTicks = Array.from({ length: Math.floor(years / 5) + 1 }, (_, i) => i * 60);

  const hover =
    hoverM === null ? null : series.map((s) => s.points[Math.min(s.points.length - 1, Math.round(hoverM))]);

  const fmtV = (v: number) =>
    metric === "price" ? `${Math.round(v).toLocaleString("ja-JP")} 円` : `${Math.round(v)} 万t`;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{METRIC_LABEL[metric]}の推移</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["price", "gov", "priv"] as const).map((m) => (
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
              {METRIC_TAB[m]}
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
          const m = ((px - PAD.left) / plotW) * months;
          setHoverM(Math.max(0, Math.min(months, m)));
        }}
        onMouseLeave={() => setHoverM(null)}
      >
        <title id={`${id}-title`}>
          {METRIC_LABEL[metric]}の 30 年間の推移。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {Math.round(v).toLocaleString("ja-JP")}
            </text>
          </g>
        ))}
        {metric === "price" &&
          [
            { r: CRISIS_RATIO, color: "var(--series-8)", label: "米騒動" },
            { r: LOW_RATIO, color: "var(--series-7)", label: "安すぎ" },
          ].map((l) => (
            <g key={l.label}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(refPrice * l.r)}
                y2={y(refPrice * l.r)}
                stroke={l.color}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <text x={W - PAD.right - 2} y={y(refPrice * l.r) - 4} fontSize={10} textAnchor="end" fill={l.color}>
                {l.label}
              </text>
            </g>
          ))}
        {xTicks.map((m) => (
          <text key={m} x={x(m)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {m / 12}年
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name + i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" />
        ))}
        {hoverM !== null && hover && (
          <g>
            <line
              x1={x(hoverM)}
              x2={x(hoverM)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--muted)"
              strokeDasharray="3 3"
            />
            {hover.map((p, i) =>
              p ? (
                <circle key={i} cx={x(p.m)} cy={y(p[metric])} r={4} fill={series[i].color} stroke="var(--card)" strokeWidth={2} />
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
                {fmtMonth(hover[i].m)}: {fmtV(hover[i][metric])}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
