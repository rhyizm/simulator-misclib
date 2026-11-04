"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aggregate,
  createSim,
  generateMasts,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, MAST_LABEL, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
type Speed = 1 | 3 | 10;

/** ×1 で 1 週を 1/8 秒 (1 年 = 4 秒) で流す */
const WEEKS_PER_SEC = 8;

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
    forest: v("--series-3"),
    wild: v("--soft"),
    learned: v("--series-8"),
    fruit: v("--series-4"),
  };
}

function describePolicy(p: Policy, firstYear: number): string {
  const parts: string[] = [];
  parts.push(
    p.attractant < 0.6
      ? `放置された柿・栗を伐り、生ごみも片づける (集落で餌にありつける確率 ${Math.round(p.attractant * 100)}%)`
      : `集落の柿や生ごみはそのまま (餌にありつける確率 ${Math.round(p.attractant * 100)}%)`,
  );
  if (p.buffer < 1) parts.push("山際のやぶを刈って緩衝帯にする");
  parts.push(`出没したクマを ${Math.round(p.cullOnSight * 100)}% の確率で捕獲`);
  if (p.springCull > 0) parts.push(`春に頭数の ${Math.round(p.springCull * 100)}% を捕獲`);
  if (p.from > 0) parts.push(`${firstYear + p.from} 年から (それまではいまのまま)`);
  return parts.join("、");
}

export function BearSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [learnedShare, setLearnedShare] = useState<number | null>(null);
  const [leftover, setLeftover] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("sightings");
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
      initialLearnedShare: learnedShare ?? base.initialLearnedShare,
    };
  }, [scenario, seedOffset, learnedShare]);

  const ids = policyIds ?? { a: scenario.policies[0], b: scenario.policies[1] };
  const policies = useMemo<Record<World, Policy>>(() => {
    // 「伐る」方針の集落に残る餌の量だけはスライダーで変えられる
    const adjust = (p: Policy): Policy =>
      leftover !== null && p.attractant < 0.6 ? { ...p, attractant: leftover } : p;
    return { a: adjust(POLICIES[ids.a]), b: adjust(POLICIES[ids.b]) };
  }, [ids.a, ids.b, leftover]);

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

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    const masts = generateMasts(params);
    simsRef.current = { a: createSim(params, policies.a, masts), b: createSim(params, policies.b, masts) };
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
      accRef.current += real * WEEKS_PER_SEC * speedRef.current;
      let n = 0;
      while (accRef.current >= 1 && n < 100) {
        step(sims.a);
        step(sims.b);
        accRef.current -= 1;
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

  const finished = stats ? stats.a.t >= params.years : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const [a, b] = aggregate(params, [policies.a, policies.b], 100);
      setAgg({ a, b });
      setAggBusy(false);
    }, 20);
  };

  const effectiveLeftover = leftover ?? 0.15;

  return (
    <section className="space-y-4" aria-label="クマの出没のシミュレーション">
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
                setLearnedShare(null);
                setLeftover(null);
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
            title="乱数の種を変えて、別の 10 年を試す (2026 年の豊作と 2027 年の凶作は固定)"
          >
            別の 10 年で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([1, 3, 10] as const).map((sp) => (
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

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                はじめから人里の味を覚えているクマ {Math.round(params.initialLearnedShare * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={params.initialLearnedShare}
                onChange={(e) => setLearnedShare(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                「伐る」方針で集落に残る餌 {Math.round(effectiveLeftover * 100)}% (いまのままは 60%)
              </span>
              <input
                type="range"
                min={0}
                max={0.6}
                step={0.05}
                value={effectiveLeftover}
                onChange={(e) => setLeftover(Number(e.target.value))}
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
                  className="max-w-full rounded-md border border-border bg-card px-2 py-1 text-base font-bold"
                >
                  {POLICY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {POLICIES[id].name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted">{describePolicy(policy, params.firstYear)}。</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[380px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の山と集落とクマの様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <Stat label="今年の出没" value={st ? `${st.sightingsThisYear} 件` : "–"} hint={st ? `秋は${MAST_LABEL[st.mast]}` : undefined} />
                <Stat label="出没の累計" value={st ? `${st.sightings} 件` : "–"} />
                <Stat label="クマの頭数" value={st ? `${st.bears} 頭` : "–"} />
                <Stat label="人里を覚えたクマ" value={st ? `${st.learned} 頭` : "–"} />
                <Stat label="捕獲の累計" value={st ? `${st.culled} 頭` : "–"} />
                <Stat label="人身被害 (期待値)" value={st ? `${st.injuries.toFixed(1)} 人` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          years={params.years}
          firstYear={params.firstYear}
          metric={metric}
          onMetricChange={setMetric}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別々の 10 年を 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              2028 年からの実りは毎回違い、凶作が何回来るかで出没は大きく変わります。実りの筋書きとクマの動きを変えて 100 回試行し、平均を取ります。
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
                  <th className="py-1 pr-3 font-semibold" style={{ color: WORLD_COLOR.a }}>
                    左: {policies.a.name}
                  </th>
                  <th className="py-1 pr-3 font-semibold" style={{ color: WORLD_COLOR.b }}>
                    右: {policies.b.name}
                  </th>
                </tr>
              </thead>
              <tbody>
                <AggRow label="10 年間の出没" values={[agg.a.sightings, agg.b.sightings]} fmt={(v) => `${Math.round(v)} 件`} better="low" />
                <AggRow
                  label={`${params.firstYear + 1} 年 (凶作) の出没`}
                  values={[agg.a.sightingsYear2, agg.b.sightingsYear2]}
                  fmt={(v) => `${Math.round(v)} 件`}
                  better="low"
                />
                <AggRow
                  label="凶作の年 1 年あたり"
                  values={[agg.a.sightingsPoorYear, agg.b.sightingsPoorYear]}
                  fmt={(v) => `${Math.round(v)} 件`}
                  better="low"
                />
                <AggRow
                  label="豊作・並作の年 1 年あたり"
                  values={[agg.a.sightingsOtherYear, agg.b.sightingsOtherYear]}
                  fmt={(v) => `${Math.round(v)} 件`}
                  better="low"
                />
                <AggRow label="人身被害 (期待値)" values={[agg.a.injuries, agg.b.injuries]} fmt={(v) => `${v.toFixed(1)} 人`} better="low" />
                <AggRow label="捕獲した頭数" values={[agg.a.culled, agg.b.culled]} fmt={(v) => `${Math.round(v)} 頭`} />
                <AggRow label="10 年後のクマの頭数" values={[agg.a.finalBears, agg.b.finalBears]} fmt={(v) => `${Math.round(v)} 頭`} />
                <AggRow
                  label="10 年後に人里を覚えているクマ"
                  values={[agg.a.finalLearned, agg.b.finalLearned]}
                  fmt={(v) => `${v.toFixed(1)} 頭`}
                  better="low"
                />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">
        {label}
        {hint && <span className="ml-1">({hint})</span>}
      </dt>
      <dd className="font-mono font-semibold">{value}</dd>
    </div>
  );
}

function AggRow({
  label,
  values,
  fmt,
  better,
}: {
  label: string;
  values: number[];
  fmt: (v: number) => string;
  better?: "high" | "low";
}) {
  const best = better
    ? values.reduce((bi, v, i) => ((better === "high" ? v > values[bi] : v < values[bi]) ? i : bi), 0)
    : -1;
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3">{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`py-1 pr-3 font-mono ${i === best ? "font-bold text-foreground" : "text-soft"}`}>
          {fmt(v)}
        </td>
      ))}
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string; shape: "dot" | "ring" | "cross" | "stub" }[] = [
    { color: "var(--soft)", label: "人里を知らないクマ", shape: "dot" },
    { color: "var(--series-8)", label: "人里の味を覚えたクマ", shape: "dot" },
    { color: "var(--series-4)", label: "柿の木 / 集落で餌にありつけた (輪)", shape: "ring" },
    { color: "var(--foreground)", label: "捕獲された", shape: "cross" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          {it.shape === "cross" ? (
            <span className="inline-block w-3 text-center font-bold leading-none" style={{ color: it.color }} aria-hidden>
              ×
            </span>
          ) : (
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={it.shape === "ring" ? { border: `2px solid ${it.color}` } : { background: it.color }}
              aria-hidden
            />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}
