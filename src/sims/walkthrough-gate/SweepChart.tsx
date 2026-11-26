"use client";

import { useId } from "react";
import type { SweepPoint } from "./model";

export interface SweepSeries {
  name: string;
  color: string;
  points: SweepPoint[];
}

const W = 640;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 32, left: 44 };

/**
 * ウォークスルー対応の人の割合 (横軸) × 平均待ち (縦軸)。
 * 実線 = 全員の平均、点線 = ウォークスルー対応の人だけの平均。
 */
export function SweepChart({ series, currentShare }: { series: SweepSeries[]; currentShare: number }) {
  const id = useId();
  let m = 0;
  for (const s of series) for (const p of s.points) m = Math.max(m, p.avgWait, p.avgWaitWt);
  const yMax = Math.max(10, Math.ceil(m / 10) * 10);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (share: number) => PAD.left + share * plotW;
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const line = (pts: SweepPoint[], key: "avgWait" | "avgWaitWt") =>
    pts
      .filter((p) => key === "avgWait" || p.share > 0)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.share).toFixed(1)},${y(p[key]).toFixed(1)}`)
      .join(" ");
  const yTicks = [0, yMax / 2, yMax];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>
          ウォークスルー対応の人の割合を 0% から 100% まで変えたときの平均待ち時間。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v}秒
            </text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={x(s)} y={H - 10} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {Math.round(s * 100)}%
          </text>
        ))}
        <line
          x1={x(currentShare)}
          x2={x(currentShare)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke="var(--muted)"
          strokeDasharray="3 3"
        />
        <text x={x(currentShare) + 4} y={PAD.top + 10} fontSize={10} fill="var(--muted)">
          いまの設定
        </text>
        {series.map((s) => (
          <g key={s.name}>
            <path d={line(s.points, "avgWaitWt")} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.8} />
            <path d={line(s.points, "avgWait")} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />
            {s.points.map((p) => (
              <circle key={p.share} cx={x(p.share)} cy={y(p.avgWait)} r={3} fill={s.color} stroke="var(--card)" strokeWidth={1.5}>
                <title>
                  {s.name} {Math.round(p.share * 100)}%: 全員 {p.avgWait.toFixed(1)} 秒 / 対応の人 {p.avgWaitWt.toFixed(1)} 秒 / それ以外 {p.avgWaitOther.toFixed(1)} 秒
                </title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.name}
          </span>
        ))}
        <span>実線 = 全員の平均待ち / 点線 = ウォークスルー対応の人だけ</span>
      </div>
    </div>
  );
}
