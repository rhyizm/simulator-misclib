"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  fmtClockMin,
  getStats,
  isFinished,
  START_MIN,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { PARTICIPATION_OPTIONS, getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
type Speed = 60 | 180 | 480;

const WORLD_COLOR: Record<World, string> = { a: "var(--series-1)", b: "var(--series-2)" };

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    jam: v("--series-8"),
    shifted: v("--series-3"),
    rebound: v("--series-4"),
    capacity: v("--foreground"),
  };
}

function policyName(p: number): string {
  if (p === 0) return "時差出勤なし";
  return `ピークの ${Math.round(p * 100)}% がずらす`;
}

function policyNote(p: number): string {
  if (p === 0) return "いつもどおり、みんなが行きたい時刻に出る";
  if (p === 0.01) return "鹿児島市の登録 約 400 人 (10 月 6 日時点) に近い割合";
  if (p === 0.1) return "鹿児島市の目標「朝ピーク交通量の 1 割削減」";
  return `7:30〜8:30 に交差点を通るつもりだった車の ${Math.round(p * 100)}%`;
}

function fmtMin(m: number): string {
  if (!Number.isFinite(m)) return "–";
  if (m < 1) return `${Math.round(m * 60)} 秒`;
  return `${m.toFixed(1)} 分`;
}

function fmtClock(min: number): string {
  return min < 0 ? "渋滞なし" : fmtClockMin(min);
}

export function StaggeredCommuteSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(180);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [participation, setParticipation] = useState<Record<World, number>>({ a: 0, b: 0.1 });
  const [earlyShare, setEarlyShare] = useState(0.5);
  const [rebound, setRebound] = useState(0);
  const [demandScale, setDemandScale] = useState(1);
  const [metric, setMetric] = useState<Metric>("waitMin");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(
    () => ({
      ...scenario.params,
      seed: scenario.params.seed + seedOffset,
      earlyShare,
      rebound,
      totalCars: Math.round(scenario.params.totalCars * demandScale),
    }),
    [scenario, seedOffset, earlyShare, rebound, demandScale],
  );
  const policies = useMemo<Record<World, Policy>>(
    () => ({
      a: { name: policyName(participation.a), participation: participation.a },
      b: { name: policyName(participation.b), participation: participation.b },
    }),
    [participation],
  );

  const simsRef = useRef<Record<World, SimState> | null>(null);
  const canvasRefs = useRef<Record<World, HTMLCanvasElement | null>>({ a: null, b: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const w of ["a", "b"] as const) {
      const canvas = canvasRefs.current[w];
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
      renderSim(ctx, sims[w], themeRef.current);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ a: getStats(sims.a), b: getStats(sims.b) });
    setChartSeries([
      { name: `左: ${sims.a.policy.name}`, color: WORLD_COLOR.a, points: sims.a.series.slice() },
      { name: `右: ${sims.b.policy.name}`, color: WORLD_COLOR.b, points: sims.b.series.slice() },
    ]);
  }, []);

  const reset = useCallback(() => {
    simsRef.current = { a: createSim(params, policies.a), b: createSim(params, policies.b) };
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
      while (accRef.current >= DT && n < 2000) {
        step(sims.a, DT);
        step(sims.b, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 150) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.a) && isFinished(sims.b)) {
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

  const finished = stats ? stats.a.t >= params.durationSec : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="時差出勤と朝の渋滞のシミュレーション">
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
                setAgg(null);
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
              setAgg(null);
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
            title="乱数の種を変えて、別の日を試す"
          >
            別の日で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([60, 180, 480] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                ×{sp}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            {stats ? fmtClockMin(START_MIN + stats.a.t / 60) : "6:30"} / {fmtClockMin(START_MIN + params.durationSec / 60)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                ずらす人のうち「早めに出る」{Math.round(earlyShare * 100)}%・「遅めに出る」{Math.round((1 - earlyShare) * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={earlyShare}
                onChange={(e) => setEarlyShare(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                空いた分を埋めに来る車: ずらした台数の {Math.round(rebound * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={rebound}
                onChange={(e) => setRebound(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                来る車の台数 ×{demandScale.toFixed(2)}（{params.totalCars.toLocaleString()} 台）
              </span>
              <input
                type="range"
                min={0.85}
                max={1.1}
                step={0.05}
                value={demandScale}
                onChange={(e) => setDemandScale(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const p = participation[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <h3 className="text-base font-bold">
                  {w === "a" ? "左" : "右"}: {policyName(p)}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label="時間をずらす人の割合">
                {PARTICIPATION_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={p === opt}
                    onClick={() => {
                      setParticipation((cur) => ({ ...cur, [w]: opt }));
                      setPlaying(true);
                    }}
                    className={`rounded-md border px-2 py-1 ${
                      p === opt ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {opt === 0 ? "なし" : `${Math.round(opt * 100)}%`}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{policyNote(p)}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[420px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policyName(p)}の世界の道路と、5 分ごとに来た台数`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <Stat label="通り抜けた車の平均の待ち" value={st ? fmtMin(st.avgWaitMin) : "–"} />
                <Stat label="いちばん長く待った車" value={st ? fmtMin(st.maxWaitMin) : "–"} />
                <Stat label="いちばん長い行列" value={st ? `${st.maxQueueKm.toFixed(1)} km` : "–"} />
                <Stat label="10 分以上待った車" value={st ? `${Math.round(st.over10Share * 100)}%` : "–"} />
                <Stat label="7:30〜8:30 に来た台数" value={st ? `${st.peakArrived.toLocaleString()} 台` : "–"} />
                <Stat label="7:30〜8:30 に通った台数" value={st ? `${st.peakPassed.toLocaleString()} 台` : "–"} />
                <Stat label="時間をずらした車" value={st ? `${st.shifted} 台` : "–"} />
                <Stat label="空いた分を埋めに来た車" value={st ? `${st.reboundCars} 台` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} durationSec={params.durationSec} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別の日を 100 日ぶん回した平均</h3>
            <p className="text-xs text-muted">
              来る車の台数や時刻、交差点の流れは日によってぶれます。同じ条件で 100 日試して平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 日試す"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  <th className="py-1 pr-3 font-semibold">左: {policies.a.name}</th>
                  <th className="py-1 font-semibold">右: {policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="平均の待ち" a={agg.a.avgWaitMin} b={agg.b.avgWaitMin} fmt={fmtMin} />
                <AggRow label="いちばん長く待った車" a={agg.a.maxWaitMin} b={agg.b.maxWaitMin} fmt={fmtMin} />
                <AggRow label="いちばん長い行列" a={agg.a.maxQueueKm} b={agg.b.maxQueueKm} fmt={(v) => `${v.toFixed(1)} km`} />
                <AggRow
                  label="10 分以上待った車"
                  a={agg.a.over10Share}
                  b={agg.b.over10Share}
                  fmt={(v) => `${(v * 100).toFixed(0)}%`}
                />
                <AggRow label="待ちの合計 (台・時間)" a={agg.a.waitHours} b={agg.b.waitHours} fmt={(v) => `${v.toFixed(0)} 時間`} />
                <AggRow
                  label="ずらした人が動かした時間の合計"
                  a={(agg.a.shifted * agg.a.avgShiftMin) / 60}
                  b={(agg.b.shifted * agg.b.avgShiftMin) / 60}
                  fmt={(v) => `${v.toFixed(0)} 時間`}
                />
                <AggRow label="7:30〜8:30 に来た台数" a={agg.a.peakArrived} b={agg.b.peakArrived} fmt={(v) => `${v.toFixed(0)} 台`} />
                <AggRow
                  label="7:30〜8:30 に通った台数 (交通量)"
                  a={agg.a.peakPassed}
                  b={agg.b.peakPassed}
                  fmt={(v) => `${v.toFixed(0)} 台`}
                />
                <AggRow label="渋滞が消えた時刻" a={agg.a.jamEndMin} b={agg.b.jamEndMin} fmt={fmtClock} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              「渋滞が消えた時刻」は、最後尾に着いてから 1 分以上待つ行列が最後になくなった時刻。
              「交通量」は交差点を通り抜けた台数で、渋滞している間は交差点が通せる台数で頭打ちになります。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col border-t border-border pt-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono font-semibold">{value}</dd>
    </div>
  );
}

function AggRow({ label, a, b, fmt }: { label: string; a: number; b: number; fmt: (v: number) => string }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3 font-sans">{label}</td>
      <td className="py-1 pr-3">{fmt(a)}</td>
      <td className="py-1">{fmt(b)}</td>
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "var(--series-8)", label: "行列 (2 車線、1 台 7 m)" },
    { color: "var(--muted)", label: "いつもの車" },
    { color: "var(--series-3)", label: "時間をずらした車" },
    { color: "var(--series-4)", label: "空いた分を埋めに来た車" },
    { color: "var(--foreground)", label: "点線 = 交差点が 5 分に通せる台数" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
