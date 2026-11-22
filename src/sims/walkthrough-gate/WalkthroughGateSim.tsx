"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  POLICIES,
  aggregate,
  createSim,
  getPolicy,
  getStats,
  isFinished,
  step,
  sweepShare,
  type AggregateStats,
  type PolicyId,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";
import { SweepChart, type SweepSeries } from "./SweepChart";

type Side = "left" | "right";
type Speed = 1 | 3 | 10;

const SIDE_COLOR: Record<Side, string> = { left: "var(--series-1)", right: "var(--series-2)" };
const SWEEP_SHARES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    touch: v("--series-1"),
    wt: v("--series-4"),
    ticket: v("--series-7"),
    stop: v("--series-8"),
  };
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "–";
  return `${s.toFixed(1)} 秒`;
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function WalkthroughGateSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [policies, setPolicies] = useState<Record<Side, PolicyId>>({
    left: scenarios[0].left,
    right: scenarios[0].right,
  });
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [wtShare, setWtShare] = useState<number | null>(null);
  const [lanes, setLanes] = useState<number | null>(null);
  const [wrongLane, setWrongLane] = useState<number | null>(null);
  const [wtHeadway, setWtHeadway] = useState<number | null>(null);
  const [metric, setMetric] = useState<"queue" | "passed">("queue");
  const [stats, setStats] = useState<Record<Side, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<Side, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);
  const [sweep, setSweep] = useState<SweepSeries[] | null>(null);
  const [sweepBusy, setSweepBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const b = scenario.params;
    return {
      ...b,
      seed: b.seed + seedOffset,
      wtShare: wtShare ?? b.wtShare,
      lanes: lanes ?? b.lanes,
      wrongLaneRate: wrongLane ?? b.wrongLaneRate,
      wtHeadway: wtHeadway ?? b.wtHeadway,
    };
  }, [scenario, seedOffset, wtShare, lanes, wrongLane, wtHeadway]);

  const simsRef = useRef<Record<Side, SimState> | null>(null);
  const canvasRefs = useRef<Record<Side, HTMLCanvasElement | null>>({ left: null, right: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const label = useCallback((side: Side) => getPolicy(policies[side]).label, [policies]);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const side of ["left", "right"] as const) {
      const canvas = canvasRefs.current[side];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      if (!themeRef.current) themeRef.current = readTheme(canvas);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== CANVAS_W * dpr) {
        canvas.width = CANVAS_W * dpr;
        canvas.height = CANVAS_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderSim(ctx, sims[side], themeRef.current);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ left: getStats(sims.left), right: getStats(sims.right) });
    setChartSeries([
      { name: `左: ${getPolicy(sims.left.policy).label}`, color: SIDE_COLOR.left, points: sims.left.series.slice() },
      { name: `右: ${getPolicy(sims.right.policy).label}`, color: SIDE_COLOR.right, points: sims.right.series.slice() },
    ]);
  }, []);

  const reset = useCallback(() => {
    simsRef.current = {
      left: createSim(params, policies.left),
      right: createSim(params, policies.right),
    };
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, policies, draw]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // パラメータが変わったら最初から
  useEffect(() => {
    reset();
    const id = requestAnimationFrame(() => {
      setAgg(null);
      setSweep(null);
      publish();
    });
    return () => cancelAnimationFrame(id);
  }, [reset, publish]);

  // ページを開いたら自動で再生する (動きを減らす設定の人は除く)
  useEffect(() => {
    if (autoStarted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => {
      setAutoStarted(true);
      if (!reduced) setPlaying(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStarted]);

  // ダークモード切替に追従
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      themeRef.current = null;
      draw();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [draw]);

  // アニメーションループ
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }
    let lastPublish = 0;
    const loop = (ts: number) => {
      const sims = simsRef.current;
      if (!sims) return;
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const real = Math.min(0.1, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      accRef.current += real * speedRef.current;
      let n = 0;
      while (accRef.current >= DT && n < 200) {
        step(sims.left, DT);
        step(sims.right, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 120) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.left) && isFinished(sims.right)) {
        publish();
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, draw, publish]);

  const finished = stats ? stats.left.t >= params.durationSec : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      setAgg({ left: aggregate(params, policies.left, 100), right: aggregate(params, policies.right, 100) });
      setAggBusy(false);
    }, 20);
  };

  const runSweep = () => {
    setSweepBusy(true);
    setTimeout(() => {
      setSweep(
        (["left", "right"] as const).map((side) => ({
          name: `${side === "left" ? "左" : "右"}: ${label(side)}`,
          color: SIDE_COLOR[side],
          points: sweepShare(params, policies[side], SWEEP_SHARES, 20),
        })),
      );
      setSweepBusy(false);
    }, 20);
  };

  const btn = (active: boolean) =>
    `rounded-md border px-2 py-1 ${active ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"}`;

  return (
    <section className="space-y-4" aria-label="ウォークスルー改札のシミュレーション">
      {/* シナリオ選択 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="シナリオ">
          {scenarios.map((sc) => (
            <button
              key={sc.id}
              type="button"
              role="tab"
              aria-selected={sc.id === scenarioId}
              onClick={() => {
                setScenarioId(sc.id);
                setPolicies({ left: sc.left, right: sc.right });
                setWtShare(null);
                setLanes(null);
                setWrongLane(null);
                setWtHeadway(null);
                setPlaying(true);
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                sc.id === scenarioId
                  ? "border-accent bg-accent-soft font-semibold"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {sc.name}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">{scenario.description}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (finished) {
                reset();
                publish();
              }
              setPlaying((p) => !p);
            }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90"
          >
            {playing ? "一時停止" : finished ? "もう一度" : "再生"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              publish();
              setPlaying(true);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
          >
            最初から
          </button>
          <button
            type="button"
            onClick={() => {
              setSeedOffset((s) => s + 1);
              setPlaying(true);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
            title="乱数の種を変えて、別の 1 回を試す"
          >
            別の乱数で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([1, 3, 10] as const).map((sp) => (
              <button key={sp} type="button" aria-pressed={speed === sp} onClick={() => setSpeed(sp)} className={btn(speed === sp)}>
                ×{sp}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-sm">
            ウォークスルー対応のスマホを持つ人{" "}
            <strong className="font-mono">{Math.round(params.wtShare * 100)}%</strong>
            <span className="ml-1 text-xs text-muted">(IC・スマホで乗る人のうち)</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.wtShare}
            onChange={(e) => setWtShare(Number(e.target.value))}
          />
        </label>

        <div className="mt-2 font-mono text-xs text-muted">
          経過 {stats ? fmtClock(stats.left.t) : "0:00"} / {fmtClock(params.durationSec)}
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">改札の通路の数 {params.lanes} 通路</span>
              <input type="range" min={3} max={10} step={1} value={params.lanes} onChange={(e) => setLanes(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                専用通路に間違えて入る人 {(params.wrongLaneRate * 100).toFixed(0)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.15}
                step={0.01}
                value={params.wrongLaneRate}
                onChange={(e) => setWrongLane(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                ウォークスルーで通る間隔 {params.wtHeadway.toFixed(2)} 秒 (タッチは {params.touchHeadway.toFixed(2)} 秒)
              </span>
              <input
                type="range"
                min={0.5}
                max={1.2}
                step={0.05}
                value={params.wtHeadway}
                onChange={(e) => setWtHeadway(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["left", "right"] as const).map((side) => {
          const st = stats?.[side];
          const pol = getPolicy(policies[side]);
          return (
            <div key={side} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: SIDE_COLOR[side] }} aria-hidden />
                <h3 className="text-base font-bold">
                  {side === "left" ? "左" : "右"}: {pol.label}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label={`${side === "left" ? "左" : "右"}の改札`}>
                {POLICIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={policies[side] === p.id}
                    onClick={() => {
                      setPolicies((cur) => ({ ...cur, [side]: p.id }));
                      setPlaying(true);
                    }}
                    className={btn(policies[side] === p.id)}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">{pol.description}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[side] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[340px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${pol.label}の改札口の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label="通った人数" value={st ? `${st.passed} 人` : "–"} />
                <Stat label="今の行列" value={st ? `${st.queue} 人` : "–"} />
                <Stat label="最大の行列" value={st ? `${st.maxQueue} 人` : "–"} />
                <Stat label="平均待ち" value={st ? fmtSec(st.avgWait) : "–"} />
                <Stat label="対応の人の平均" value={st ? fmtSec(st.avgWaitWt) : "–"} />
                <Stat label="それ以外の平均" value={st ? fmtSec(st.avgWaitOther) : "–"} />
                <Stat label="扉が閉まった" value={st ? `${st.gateStops} 回` : "–"} />
                <Stat
                  label="歩いて通れた"
                  value={st && st.wtUsedShare > 0 ? `${Math.round(st.wtUsedShare * 100)}%` : "–"}
                  hint="対応の人のうち"
                />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} durationSec={params.durationSec} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 100 回試行 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">乱数を変えて 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">1 回だけでは偶然に左右されるので、同じ条件で 100 回試行して平均を取ります。</p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 回試行する"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  <th className="py-1 pr-3 font-semibold">左: {label("left")}</th>
                  <th className="py-1 pr-3 font-semibold">右: {label("right")}</th>
                  <th className="py-1 font-semibold">右 − 左</th>
                </tr>
              </thead>
              <tbody>
                <AggRow label="平均待ち" a={agg.left.avgWait} b={agg.right.avgWait} unit="秒" better="low" />
                <AggRow label="9 割の人が通れるまで" a={agg.left.p90Wait} b={agg.right.p90Wait} unit="秒" better="low" />
                <AggRow label="対応の人の平均待ち" a={agg.left.avgWaitWt} b={agg.right.avgWaitWt} unit="秒" better="low" />
                <AggRow label="それ以外の人の平均待ち" a={agg.left.avgWaitOther} b={agg.right.avgWaitOther} unit="秒" better="low" />
                <AggRow label="最大の行列" a={agg.left.maxQueue} b={agg.right.maxQueue} unit="人" better="low" />
                <AggRow label="扉が閉まった回数" a={agg.left.gateStops} b={agg.right.gateStops} unit="回" better="low" />
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 普及率を変えて比べる */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">対応のスマホが何割まで増えれば効くのか</h3>
            <p className="text-xs text-muted">
              左右の改札で、ウォークスルー対応の人の割合を 0% から 100% まで 10% ずつ変え、それぞれ 20 回試行した平均待ちを描きます。
            </p>
          </div>
          <button
            type="button"
            onClick={runSweep}
            disabled={sweepBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {sweepBusy ? "計算中…" : sweep ? "もう一度計算" : "割合を変えて比べる"}
          </button>
        </div>
        {sweep && (
          <div className="mt-3">
            <SweepChart series={sweep} currentShare={params.wtShare} />
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono font-semibold">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

function AggRow({
  label,
  a,
  b,
  unit,
  better,
}: {
  label: string;
  a: number;
  b: number;
  unit: string;
  better: "high" | "low";
}) {
  const diff = b - a;
  const same = Math.abs(diff) < 0.05 || (a > 0 && Math.abs(diff / a) < 0.01);
  const bWins = better === "high" ? diff > 0 : diff < 0;
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 font-mono">
        {a.toFixed(1)} {unit}
      </td>
      <td className="py-1 pr-3 font-mono">
        {b.toFixed(1)} {unit}
      </td>
      <td className="py-1 font-mono text-muted">
        {same ? "ほぼ同じ" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${unit}（${bWins ? "右" : "左"}が有利）`}
      </td>
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string; square?: boolean }[] = [
    { color: "var(--series-1)", label: "IC・スマホをタッチする人" },
    { color: "var(--series-4)", label: "ウォークスルー対応の人" },
    { color: "var(--series-7)", label: "切符・QR の人" },
    { color: "var(--series-1)", label: "四角 = 大きな荷物・ベビーカー", square: true },
    { color: "var(--series-8)", label: "赤い棒 = 扉が閉まった通路" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 ${it.square ? "rounded-[2px]" : "rounded-full"}`}
            style={{ background: it.color }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
