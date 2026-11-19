"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOURS,
  aggregate,
  createSim,
  dayOf,
  fmtDate,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, getPolicy, getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
/** 1 秒に進める時間 */
type Speed = 12 | 36 | 96;

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
    fruit: v("--series-4"),
    habituated: v("--series-2"),
    injury: v("--series-8"),
    encounter: v("--series-4"),
  };
}

function mastLabel(m: number): string {
  if (m < 0.45) return "大凶作";
  if (m < 0.6) return "凶作";
  if (m < 0.9) return "並作";
  return "豊作";
}

export function BearSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(36);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, string>>({ a: "none", b: "all" });
  const [bearsOverride, setBearsOverride] = useState<number | null>(null);
  const [mastOverride, setMastOverride] = useState<number | null>(null);
  const [treesOverride, setTreesOverride] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("out");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(
    () => ({
      ...scenario.params,
      seed: scenario.params.seed + seedOffset,
      bears: bearsOverride ?? scenario.params.bears,
      mast: mastOverride ?? scenario.params.mast,
      trees: treesOverride ?? scenario.params.trees,
    }),
    [scenario, seedOffset, bearsOverride, mastOverride, treesOverride],
  );
  const policies = useMemo(
    () => ({ a: getPolicy(policyIds.a).policy, b: getPolicy(policyIds.b).policy }),
    [policyIds],
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
      while (accRef.current >= 1 && n < 500) {
        step(sims.a);
        step(sims.b);
        accRef.current -= 1;
        n++;
      }
      draw();
      if (ts - lastPublish > 200) {
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

  const finished = stats ? stats.a.h >= HOURS : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="クマの出没と対策のシミュレーション">
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
                setMastOverride(null);
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
            title="乱数の種を変えて、別の年の秋を試す"
          >
            別の秋で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">1 秒で</span>
            {([12, 36, 96] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp < 24 ? `${sp} 時間` : `${sp / 24} 日`}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            {stats ? fmtDate(dayOf(Math.min(stats.a.h, HOURS - 1))) : "9/1"} / 11/30
          </span>
          <span className="ml-3 text-muted">
            森の実り: {mastLabel(params.mast)} (並作の {Math.round((params.mast / 0.7) * 100)}%)
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">山にいるクマ（春の時点）{params.bears} 頭</span>
              <input
                type="range"
                min={20}
                max={60}
                step={5}
                value={params.bears}
                onChange={(e) => setBearsOverride(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                森の木の実の出来 {params.mast.toFixed(2)}（{mastLabel(params.mast)}）
              </span>
              <input
                type="range"
                min={0.2}
                max={1.2}
                step={0.05}
                value={params.mast}
                onChange={(e) => setMastOverride(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">畑や庭の柿・栗の木 {params.trees} 本</span>
              <input
                type="range"
                min={12}
                max={60}
                step={4}
                value={params.trees}
                onChange={(e) => setTreesOverride(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const opt = getPolicy(policyIds[w]);
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <h3 className="text-base font-bold">
                  {w === "a" ? "左" : "右"}: {opt.label}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label="対策">
                {POLICIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={policyIds[w] === p.id}
                    onClick={() => {
                      setPolicyIds((cur) => ({ ...cur, [w]: p.id }));
                      setPlaying(true);
                    }}
                    className={`rounded-md border px-2 py-1 ${
                      policyIds[w] === p.id
                        ? "border-accent bg-accent-soft"
                        : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 min-h-[2.5rem] text-xs text-muted">{opt.note}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[420px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${opt.label}の世界の地図。上が山、下が町。点がクマ`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <Stat label="里 (畑か町) に出た延べ" value={st ? `${st.farmBearDays} 頭・日` : "–"} />
                <Stat label="町に入った延べ" value={st ? `${st.townBearDays} 頭・日` : "–"} />
                <Stat label="人と出くわした" value={st ? `${st.encounters} 回` : "–"} />
                <Stat label="人身被害" value={st ? `${st.injuries} 人` : "–"} />
                <Stat label="柿・栗とごみを食べた" value={st ? `${st.treeMeals + st.garbageMeals} 回` : "–"} />
                <Stat label="里の味を覚えたクマ" value={st ? `${st.habituated} 頭` : "–"} />
                <Stat
                  label="捕獲 (春 + 秋)"
                  value={st ? `${st.springCulled} + ${st.captured} 頭` : "–"}
                />
                <Stat label="やせたクマ (蓄え 0.6 未満)" value={st ? `${Math.round(st.thinShare * 100)}%` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && <TimeChart series={chartSeries} metric={metric} onMetricChange={setMetric} />}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別の秋を 100 回ぶん回した平均</h3>
            <p className="text-xs text-muted">
              クマのなわばりや木の場所、人と出くわすかどうかは年によってぶれます。同じ条件で 100 回試して平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 回試す"}
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
                <AggRow label="里に出た延べ (頭・日)" a={agg.a.farmBearDays} b={agg.b.farmBearDays} fmt={(v) => v.toFixed(0)} />
                <AggRow label="町に入った延べ (頭・日)" a={agg.a.townBearDays} b={agg.b.townBearDays} fmt={(v) => v.toFixed(0)} />
                <AggRow label="町に入ったクマ" a={agg.a.townBears} b={agg.b.townBears} fmt={(v) => `${v.toFixed(1)} 頭`} />
                <AggRow label="人と出くわした" a={agg.a.encounters} b={agg.b.encounters} fmt={(v) => `${v.toFixed(1)} 回`} />
                <AggRow label="人身被害" a={agg.a.injuryExp} b={agg.b.injuryExp} fmt={(v) => `${v.toFixed(2)} 人`} />
                <AggRow
                  label="人身被害が出た秋"
                  a={agg.a.injuryYearShare}
                  b={agg.b.injuryYearShare}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                />
                <AggRow
                  label="捕獲 (春 + 秋)"
                  a={agg.a.springCulled + agg.a.captured}
                  b={agg.b.springCulled + agg.b.captured}
                  fmt={(v) => `${v.toFixed(1)} 頭`}
                />
                <AggRow label="冬眠に入るクマ" a={agg.a.alive} b={agg.b.alive} fmt={(v) => `${v.toFixed(1)} 頭`} />
                <AggRow
                  label="そのうち里の味を覚えたクマ"
                  a={agg.a.habituated}
                  b={agg.b.habituated}
                  fmt={(v) => `${v.toFixed(1)} 頭`}
                />
                <AggRow
                  label="そのうちやせたクマ"
                  a={agg.a.thinShare}
                  b={agg.b.thinShare}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              「人身被害」は出くわすたびのけがの確率を足し合わせた期待値で、くじのぶれを除いています。
              「里の味を覚えたクマ」は、来年の秋も空腹でなくても通ってくるクマです。
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
  const items: { color: string; label: string; round?: boolean }[] = [
    { color: "var(--foreground)", label: "クマ (薄い点は山で食べている)", round: true },
    { color: "var(--series-2)", label: "里の味を覚えたクマ", round: true },
    { color: "var(--series-4)", label: "実のなった柿・栗の木 / ごみ置き場", round: true },
    { color: "var(--series-8)", label: "赤い輪 = 人身被害、橙の輪 = 出くわした" },
    { color: "var(--muted)", label: "× = 捕獲・切った木、枠だけの四角 = 囲ったごみ置き場" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 ${it.round ? "rounded-full" : "rounded-sm"}`}
            style={{ background: it.color }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
