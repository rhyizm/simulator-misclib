"use client";

import { useId, useMemo, useState } from "react";
import { START_HOUR, fmtClock, type SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
}

export type Metric = "out" | "roadCrews" | "repairCrews";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

const LABEL: Record<Metric, { title: string; unit: string; tab: string; step: number }> = {
  out: { title: "停電している家の数", unit: "戸", tab: "停電の戸数", step: 500 },
  roadCrews: { title: "道の倒木を片づけている作業班の数", unit: "班", tab: "道を片づける班", step: 2 },
  repairCrews: { title: "電線を直している作業班の数", unit: "班", tab: "電線を直す班", step: 2 },
};

/**
 * 時刻 × 停電の戸数 (または作業班の内訳) の折れ線グラフ。2 つの世界を同じ軸で比べる。
 */
export function TimeChart({
  series,
  durationH,
  metric,
  onMetricChange,
  nightBand,
}: {
  series: ChartSeries[];
  durationH: number;
  nightBand: boolean;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const label = LABEL[metric];

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric]);
    return Math.max(label.step * 2, Math.ceil(m / label.step) * label.step);
  }, [series, metric, label.step]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t / durationH) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[metric]).toFixed(1)}`).join(" "),
  );

  const yTicks = [0, yMax / 2, yMax];
  // 毎日 0:00 に目盛り
  const midnights: number[] = [];
  for (let t = 24 - START_HOUR; t < durationH; t += 24) midnights.push(t);
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
        <div className="text-sm font-semibold">{label.title}</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["out", "roadCrews", "repairCrews"] as const).map((m) => (
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
              {LABEL[m].tab}
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
          const t = ((px - PAD.left) / plotW) * durationH;
          setHoverT(Math.max(0, Math.min(durationH, t)));
        }}
        onMouseLeave={() => setHoverT(null)}
      >
        <title id={`${id}-title`}>
          {label.title}の時間推移。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {/* 夜 (18:00〜7:00) の帯 */}
        {nightBand && Array.from({ length: Math.ceil(durationH / 24) + 1 }, (_, d) => {
          const from = d * 24 + (18 - START_HOUR);
          const to = from + 13;
          if (from >= durationH) return null;
          return (
            <rect
              key={d}
              x={x(Math.max(0, from))}
              y={PAD.top}
              width={x(Math.min(durationH, to)) - x(Math.max(0, from))}
              height={plotH}
              fill="var(--grid)"
            />
          );
        })}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v.toLocaleString()}
              {label.unit}
            </text>
          </g>
        ))}
        {midnights.map((t) => (
          <text key={t} x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {fmtClock(t).split(" ")[0]}
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name + i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {hoverT !== null && hover && (
          <g>
            <line
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--muted)"
              strokeDasharray="3 3"
            />
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
                {fmtClock(hover[i].t)}: {hover[i][metric].toLocaleString()} {label.unit}
              </span>
            )}
          </span>
        ))}
        {nightBand && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--grid)" }} aria-hidden />
            夜 (山の中は作業できない)
          </span>
        )}
      </div>
    </div>
  );
}
