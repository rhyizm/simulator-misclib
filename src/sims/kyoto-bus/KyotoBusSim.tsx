"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  effectiveRates,
  expressPerHour,
  getStats,
  isFinished,
  regularPerHour,
  step,
  type AggregateStats,
  type KindStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";

type World = "a" | "b";
type Speed = 30 | 90 | 240;

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
    resident: v("--series-3"),
    tourist: v("--series-4"),
    express: v("--series-8"),
  };
}

function fmtWait(s: number): string {
  if (!Number.isFinite(s)) return "–";
  if (s < 60) return `${s.toFixed(0)} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, "0")} 秒`;
}

function fmtMin(s: number): string {
  return `${(s / 60).toFixed(1)} 分`;
}

function fmtClock(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function fmtYen(v: number): string {
  return `${(v / 10000).toFixed(1)} 万円`;
}

function describePolicy(p: Policy): string {
  const parts: string[] = [];
  parts.push(p.dualFare ? "市民 200 円・市民以外 400 円" : "全員 230 円");
  if (p.expressDrivers > 0) parts.push(`普通 ${p.expressDrivers} 台分を観光特急 (500 円) 1 時間 ${expressPerHour(p)} 台に`);
  if (p.originFill < 1) parts.push(`京都駅では定員の ${Math.round(p.originFill * 100)}% まで乗せる`);
  return parts.join("、");
}

export function KyotoBusSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(90);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [elasticity, setElasticity] = useState(-0.3);
  const [touristScale, setTouristScale] = useState(1);
  const [buses, setBuses] = useState<number | null>(null);
  const [metric, setMetric] = useState<"resident" | "tourist">("resident");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      elasticity,
      touristPerHour: Math.round(base.touristPerHour * touristScale),
      busesPerHour: buses ?? base.busesPerHour,
    };
  }, [scenario, seedOffset, elasticity, touristScale, buses]);

  const ids = policyIds ?? { a: scenario.policies[0], b: scenario.policies[1] };
  const policies = useMemo<Record<World, Policy>>(
    () => ({ a: POLICIES[ids.a], b: POLICIES[ids.b] }),
    [ids.a, ids.b],
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
      { name: sims.a.policy.name, color: WORLD_COLOR.a, points: sims.a.series.slice() },
      { name: sims.b.policy.name, color: WORLD_COLOR.b, points: sims.b.series.slice() },
    ]);
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
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
      while (accRef.current >= DT && n < 400) {
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

  const dualRates = effectiveRates(params, POLICIES.dual);
  const touristDrop = 1 - dualRates.tourist / params.touristPerHour;

  return (
    <section className="space-y-4" aria-label="京都の市バスの混雑対策のシミュレーション">
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
                setPolicyIds(null);
                setTouristScale(1);
                setBuses(null);
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
            title="乱数の種を変えて、別の 1 回を試す"
          >
            別の乱数で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([30, 90, 240] as const).map((sp) => (
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
            経過 {stats ? fmtClock(stats.a.t) : "0:00"} / {fmtClock(params.durationSec)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">
                観光客の運賃への反応 (弾力性) {elasticity.toFixed(1)}: 400 円にすると観光客のバス利用が{" "}
                {(touristDrop * 100).toFixed(0)}% 減る
              </span>
              <input
                type="range"
                min={-1}
                max={0}
                step={0.1}
                value={elasticity}
                onChange={(e) => setElasticity(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                観光客の人数 ×{touristScale.toFixed(1)}（1 時間 {params.touristPerHour} 人）
              </span>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.1}
                value={touristScale}
                onChange={(e) => setTouristScale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">1 時間に京都駅を出るバス {params.busesPerHour} 台</span>
              <input
                type="range"
                min={6}
                max={16}
                step={1}
                value={params.busesPerHour}
                onChange={(e) => setBuses(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const policy = policies[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <label className="sr-only" htmlFor={`policy-${w}`}>
                  {w === "a" ? "左" : "右"}の世界の方針
                </label>
                <select
                  id={`policy-${w}`}
                  value={ids[w]}
                  onChange={(e) => {
                    setPolicyIds({ ...ids, [w]: e.target.value as PolicyId });
                    setPlaying(true);
                  }}
                  className="rounded-md border border-border bg-card px-2 py-1 text-base font-bold"
                >
                  {POLICY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {POLICIES[id].name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted">
                {describePolicy(policy)}。普通のバス 1 時間 {regularPerHour(params, policy)} 台。
              </p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[380px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の路線とバスの様子`}
              />
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-0.5 font-normal" />
                    <th className="py-0.5 font-semibold" style={{ color: "var(--series-3)" }}>市民</th>
                    <th className="py-0.5 font-semibold" style={{ color: "var(--series-4)" }}>観光客</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <StatRow label="平均待ち時間" st={st} pick={(k) => fmtWait(k.avgWait)} />
                  <StatRow label="満員で乗れなかった人" st={st} pick={(k) => fmtPct(k.leftBehindRate)} />
                  <StatRow label="いま待っている人" st={st} pick={(k) => `${k.waiting} 人`} />
                  <StatRow label="乗れた人" st={st} pick={(k) => `${k.boarded} 人`} />
                </tbody>
              </table>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-muted">あきらめて歩いた市民</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${st.resident.gaveUp} 人` : "–"}</dd>
                <dt className="text-muted">運賃が上がってバスをやめた観光客</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${Math.round(st.touristShifted)} 人` : "–"}</dd>
                <dt className="text-muted">運賃収入 (1 時間あたり)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.revenuePerHour) : "–"}</dd>
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
            <h3 className="text-base font-bold">乱数を変えて 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              アニメーション 1 回だけでは偶然に左右されるので、同じ条件で 2 時間を 100 回試行して平均を取ります。
            </p>
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
                  <th className="py-1 pr-3 font-semibold">{policies.a.name}</th>
                  <th className="py-1 font-semibold">{policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="市民の平均待ち時間" a={agg.a.stats.resident.avgWait} b={agg.b.stats.resident.avgWait} fmt={fmtWait} />
                <AggRow
                  label="満員で乗れなかった市民"
                  a={agg.a.stats.resident.leftBehindRate}
                  b={agg.b.stats.resident.leftBehindRate}
                  fmt={fmtPct}
                />
                <AggRow
                  label="あきらめて歩いた市民"
                  a={agg.a.stats.resident.gaveUp}
                  b={agg.b.stats.resident.gaveUp}
                  fmt={(v) => `${v.toFixed(1)} 人`}
                />
                <AggRow label="観光客の平均待ち時間" a={agg.a.stats.tourist.avgWait} b={agg.b.stats.tourist.avgWait} fmt={fmtWait} />
                <AggRow
                  label="満員で乗れなかった観光客"
                  a={agg.a.stats.tourist.leftBehindRate}
                  b={agg.b.stats.tourist.leftBehindRate}
                  fmt={fmtPct}
                />
                <AggRow
                  label="バスをやめた観光客 (2 時間)"
                  a={agg.a.stats.touristShifted}
                  b={agg.b.stats.touristShifted}
                  fmt={(v) => `${v.toFixed(0)} 人`}
                />
                <AggRow label="運賃収入 (1 時間)" a={agg.a.stats.revenuePerHour} b={agg.b.stats.revenuePerHour} fmt={fmtYen} />
                <AggRow label="普通のバスの所要 (京都駅→祇園)" a={agg.a.stats.avgTripSec} b={agg.b.stats.avgTripSec} fmt={fmtMin} />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function StatRow({
  label,
  st,
  pick,
}: {
  label: string;
  st: SimStats | undefined;
  pick: (k: KindStats) => string;
}) {
  return (
    <tr className="border-t border-border">
      <td className="py-0.5 pr-2 font-sans text-xs text-muted">{label}</td>
      <td className="py-0.5 pr-2 font-semibold">{st ? pick(st.resident) : "–"}</td>
      <td className="py-0.5 font-semibold">{st ? pick(st.tourist) : "–"}</td>
    </tr>
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
  const items: { color: string; label: string; shape: string }[] = [
    { color: "var(--series-3)", label: "市民", shape: "rounded-full" },
    { color: "var(--series-4)", label: "観光客", shape: "rounded-full" },
    { color: "var(--series-8)", label: "観光特急 (「特」) と特急が止まる停留所", shape: "rounded-sm" },
    { color: "var(--muted)", label: "四角 = バス (中の色 = 乗っている人の内訳、満員で上まで埋まる)", shape: "rounded-sm" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 ${it.shape}`} style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
