"use client";

import { useId, useMemo, useState } from "react";
import { SERVERS_PER_CELL, type SeriesPoint } from "./model";

export interface ChartSeries {
  name: string;
  color: string;
  points: SeriesPoint[];
  /** 気づいた日 (気づいていなければ null) */
  detectedDay: number | null;
}

export type Metric = "infected" | "reachable";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

function fmtServers(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")} 台`;
}

/**
 * 日数 × (マルウェアを入れられた | 鍵が届く) サーバー台数の折れ線グラフ。
 * 線が途切れたところが「気づいて止めた日」。
 */
export function TimeChart({
  series,
  horizonDays,
  metric,
  onMetricChange,
}: {
  series: ChartSeries[];
  horizonDays: number;
  metric: Metric;
  onMetricChange: (m: Metric) => void;
}) {
  const id = useId();
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const p of s.points) m = Math.max(m, p[metric] * SERVERS_PER_CELL);
    return Math.max(5000, Math.ceil(m / 5000) * 5000);
  }, [series, metric]);

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (d: number) => PAD.left + (d / horizonDays) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const val = (p: SeriesPoint) => p[metric] * SERVERS_PER_CELL;

  const paths = series.map((s) =>
    s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(val(p)).toFixed(1)}`).join(" "),
  );

  const yTicks = [0, yMax / 2, yMax];
  const xTicks = Array.from({ length: 5 }, (_, i) => (horizonDays * i) / 4);

  const hover =
    hoverDay === null
      ? null
      : series.map((s) => {
          let best: SeriesPoint | undefined;
          for (const p of s.points) if (p.day <= hoverDay) best = p;
          return best;
        });

  const metricLabel = metric === "infected" ? "マルウェアを入れられたサーバー" : "盗まれた鍵が届くサーバー";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">{metricLabel}の推移</div>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="指標">
          {(["infected", "reachable"] as const).map((m) => (
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
              {m === "infected" ? "入れられた" : "鍵が届く"}
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
          const d = ((px - PAD.left) / plotW) * horizonDays;
          setHoverDay(Math.max(0, Math.min(horizonDays, d)));
        }}
        onMouseLeave={() => setHoverDay(null)}
      >
        <title id={`${id}-title`}>
          {metricLabel}の日ごとの推移。{series.map((s) => s.name).join("と")}の比較。線が途切れたところで気づいて止めた。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v.toLocaleString("ja-JP")}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {Math.round(d)}日
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name + i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {series.map((s, i) => {
          if (s.detectedDay === null) return null;
          const last = s.points[s.points.length - 1];
          if (!last) return null;
          return (
            <g key={`d${i}`}>
              <line
                x1={x(s.detectedDay)}
                x2={x(s.detectedDay)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke={s.color}
                strokeDasharray="2 4"
                strokeWidth={1}
              />
              <circle cx={x(last.day)} cy={y(val(last))} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
            </g>
          );
        })}
        {hoverDay !== null && (
          <line x1={x(hoverDay)} x2={x(hoverDay)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted)" strokeDasharray="3 3" />
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <span key={s.name + i} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span>{s.name}</span>
            {hover && hover[i] ? (
              <span className="font-mono text-muted">
                {Math.floor(hover[i].day)}日目: {fmtServers(val(hover[i]))}
              </span>
            ) : s.detectedDay !== null ? (
              <span className="font-mono text-muted">{Math.floor(s.detectedDay)}日目に発覚</span>
            ) : null}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">点線と丸は、その世界で気づいて止めた日。</p>
    </div>
  );
}
