"use client";

import { useId } from "react";
import { impactAfterBlind, safeBlindSec, type Encounter } from "./model";

export interface BlindSeries {
  name: string;
  color: string;
  encounters: Encounter[];
}

const W = 640;
const H = 300;
const PAD = { top: 28, right: 16, bottom: 36, left: 44 };
const X_MAX = 16;
const Y_MAX = 120;
/** 新名神の事故で認定された、スマホを見ていた時間 (秒) */
const SHIN_MEISHIN_SEC = 13;

/**
 * 最後尾 (または前の車のブレーキ) が見えてから気づくまで前を見ていなかった時間と、追突した速度の散布図。
 * 曲線は「その速さで走っていたら、何秒見ていなかったら何 km/h でぶつかるか」の理論値。
 */
export function BlindChart({
  series,
  sightM,
  truckKmh,
  carKmh,
  reaction,
  truckDecel,
  carDecel,
}: {
  series: BlindSeries[];
  sightM: number;
  truckKmh: number;
  carKmh: number;
  reaction: number;
  truckDecel: number;
  carDecel: number;
}) {
  const id = useId();
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (sec: number) => PAD.left + (Math.min(sec, X_MAX) / X_MAX) * plotW;
  const y = (k: number) => PAD.top + plotH - (Math.min(k, Y_MAX) / Y_MAX) * plotH;

  const curve = (vKmh: number, decel: number) => {
    const pts: string[] = [];
    for (let t = 0; t <= X_MAX + 1e-6; t += 0.1) pts.push(`${x(t).toFixed(1)},${y(impactAfterBlind(vKmh, sightM, t, reaction, decel)).toFixed(1)}`);
    return `M${pts.join(" L")}`;
  };
  const lines = [
    { label: `トラック ${truckKmh} km/h`, v: truckKmh, d: truckDecel },
    { label: `乗用車 ${carKmh} km/h`, v: carKmh, d: carDecel },
  ];
  const truckSafe = safeBlindSec(truckKmh, sightM, reaction, truckDecel);

  const xTicks = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  const yTicks = [0, 40, 80, 120];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 text-sm font-semibold">前を見ていなかった時間と、追突した速さ</div>
      <p className="mb-2 text-xs text-muted">
        横軸は、最後尾 (または前の車のブレーキ) が見えてから目を戻すまでの秒数。線は見通し {sightM} m での理論値で、
        トラックは <span className="font-mono">{truckSafe.toFixed(1)}</span> 秒を超えたところから急に立ち上がります。
        点はこの 1 回で最後尾に着いた車 (● 追突 ○ 止まれた)。
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>
          前を見ていなかった時間と追突速度の散布図。{series.map((s) => s.name).join("と")}の比較。見通し {sightM} m。
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.left - 6} y={PAD.top - 14} fontSize={10} textAnchor="end" fill="var(--muted)">
          km/h
        </text>
        {xTicks.map((v) => (
          <text key={v} x={x(v)} y={H - 18} fontSize={11} textAnchor="middle" fill="var(--muted)">
            {v}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={H - 3} fontSize={11} textAnchor="middle" fill="var(--muted)">
          前を見ていなかった時間 (秒)
        </text>
        <line
          x1={x(SHIN_MEISHIN_SEC)}
          x2={x(SHIN_MEISHIN_SEC)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke="var(--muted)"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
        <text x={x(SHIN_MEISHIN_SEC) - 4} y={PAD.top + 12} fontSize={10} textAnchor="end" fill="var(--muted)">
          新名神の事故 (約 13 秒)
        </text>
        {lines.map((l, i) => (
          <g key={l.label}>
            <path
              d={curve(l.v, l.d)}
              fill="none"
              stroke="var(--series-8)"
              strokeOpacity={i === 0 ? 0.85 : 0.5}
              strokeWidth={2}
              strokeDasharray={i === 0 ? undefined : "5 4"}
            />
            <text x={x(X_MAX) - 2} y={y(l.v) - 6 - i * 12} fontSize={10} textAnchor="end" fill="var(--series-8)">
              {l.label}
            </text>
          </g>
        ))}
        {series.map((s) =>
          s.encounters.map((e, i) =>
            e.crash ? (
              <circle key={`${s.name}-${i}`} cx={x(e.blind)} cy={y(e.impactKmh)} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={1} />
            ) : (
              <circle key={`${s.name}-${i}`} cx={x(e.blind)} cy={y(0) - 3} r={3} fill="none" stroke={s.color} strokeWidth={1.2} strokeOpacity={0.7} />
            ),
          ),
        )}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.map((s) => {
          const crashes = s.encounters.filter((e) => e.crash).length;
          return (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              <span>{s.name}</span>
              <span className="font-mono text-muted">
                追突 {crashes} / {s.encounters.length}
              </span>
            </span>
          );
        })}
        <span className="text-muted">前の車のブレーキが近くで見えた場面は、線より上に出ることがあります</span>
      </div>
    </div>
  );
}
