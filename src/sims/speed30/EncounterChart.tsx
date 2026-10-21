"use client";

import { useId } from "react";
import { kmh, stoppingDistance, type Encounter } from "./model";

export interface EncounterSeries {
  name: string;
  color: string;
  encounters: Encounter[];
}

const W = 640;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 36, left: 44 };
const X_MAX = 70;

/**
 * 人が見えた瞬間の「車の速さ × 人までの距離」の散布図。
 * 停止距離の帯より下に落ちた点がぶつかった場面。
 */
export function EncounterChart({
  series,
  sightMax,
  reactionMin,
  reactionMax,
  decel,
}: {
  series: EncounterSeries[];
  sightMax: number;
  reactionMin: number;
  reactionMax: number;
  decel: number;
}) {
  const id = useId();
  const yMax = Math.max(40, Math.ceil(sightMax / 10) * 10);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (v / X_MAX) * plotW;
  const y = (d: number) => PAD.top + plotH - (Math.min(d, yMax) / yMax) * plotH;

  // 停止距離の帯 (反応が速い人〜遅い人)
  const band = (() => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let v = 0; v <= X_MAX; v += 1) {
      top.push(`${x(v).toFixed(1)},${y(stoppingDistance(v, reactionMax, decel)).toFixed(1)}`);
      bottom.push(`${x(v).toFixed(1)},${y(stoppingDistance(v, reactionMin, decel)).toFixed(1)}`);
    }
    return `M${top.join(" L")} L${bottom.reverse().join(" L")} Z`;
  })();

  const xTicks = [0, 10, 20, 30, 40, 50, 60, 70];
  const yTicks = [0, yMax / 2, yMax];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 text-sm font-semibold">飛び出しが見えた瞬間の、車の速さと人までの距離</div>
      <p className="mb-2 text-xs text-muted">
        帯は停止距離 (反応が速い人〜遅い人)。帯より下の点は止まりきれずにぶつかった場面、上の点は止まれた場面です。
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>
          飛び出しに出会った場面の散布図。横軸は車の速度、縦軸は人が見えたときの距離。{series.map((s) => s.name).join("と")}の比較。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v}m
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - 18} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {v}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 3} fontSize={11} textAnchor="middle" fill="var(--muted)">
          人が見えた瞬間の速度 (km/h)
        </text>
        {[30, 60].map((v) => (
          <line
            key={v}
            x1={x(v)}
            x2={x(v)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="var(--muted)"
            strokeDasharray="3 4"
            strokeWidth={1}
          />
        ))}
        <path d={band} fill="var(--series-8)" fillOpacity={0.16} stroke="var(--series-8)" strokeOpacity={0.5} />
        <text x={x(62)} y={y(stoppingDistance(62, reactionMax, decel)) + 14} fontSize={11} fill="var(--series-8)" textAnchor="end">
          停止距離
        </text>
        {series.map((s) =>
          s.encounters.map((e, i) =>
            e.hit ? (
              <circle key={`${s.name}-${i}`} cx={x(kmh(e.v0))} cy={y(e.sight)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={1} />
            ) : (
              <circle key={`${s.name}-${i}`} cx={x(kmh(e.v0))} cy={y(e.sight)} r={3.5} fill="none" stroke={s.color} strokeWidth={1.5} />
            ),
          ),
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s) => {
          const hits = s.encounters.filter((e) => e.hit).length;
          return (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              <span>{s.name}</span>
              <span className="font-mono text-muted">
                ぶつかった {hits} / {s.encounters.length}
              </span>
            </span>
          );
        })}
        <span className="text-muted">● ぶつかった　○ 止まれた</span>
      </div>
    </div>
  );
}
