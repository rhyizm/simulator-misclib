"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MONTHS,
  aggregate,
  createSim,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, describePolicy, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
/** 1 秒に進む月数 */
type Speed = 2 | 6 | 18;

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
    gov: v("--series-4"),
    priv: v("--series-3"),
    crisis: v("--series-8"),
    low: v("--series-7"),
  };
}

function fmtYen(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")} 円`;
}

function fmtOku(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")} 億円`;
}

function fmtWhen(m: number): string {
  const mm = Math.max(0, m - 1);
  return `${Math.floor(mm / 12) + 1} 年目 ${MONTHS[mm % 12]} 月`;
}

export function RiceReserveSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(6);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [badScale, setBadScale] = useState(1);
  const [bTarget, setBTarget] = useState<number | null>(null);
  const [bLag, setBLag] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("price");
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
      badYearProb: Math.min(0.5, base.badYearProb * badScale),
      disasterProb: Math.min(0.2, base.disasterProb * badScale),
    };
  }, [scenario, seedOffset, badScale]);

  const ids = policyIds ?? { a: scenario.policies[0], b: scenario.policies[1] };
  const policies = useMemo<Record<World, Policy>>(() => {
    const b = POLICIES[ids.b];
    const tuned = bTarget !== null || bLag !== null;
    const target = bTarget ?? b.target;
    const lag = bLag ?? b.decisionLag;
    const bPolicy: Policy = tuned
      ? {
          ...b,
          name: `${b.name} (調整)`,
          target,
          annualBuy: Math.round((target * b.annualBuy) / b.target),
          holdCap: Math.max(target, b.holdCap - b.target + target),
          decisionLag: lag,
        }
      : b;
    return { a: POLICIES[ids.a], b: bPolicy };
  }, [ids.a, ids.b, bTarget, bLag]);

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

  // アニメーションループ (1 か月ずつ進める)
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
      let stepped = false;
      while (accRef.current >= 1) {
        step(sims.a);
        step(sims.b);
        accRef.current -= 1;
        stepped = true;
      }
      if (stepped) draw();
      if (stepped && ts - lastPublish > 150) {
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

  const totalMonths = params.years * 12;
  const finished = stats ? stats.a.month >= totalMonths : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  const yields = useMemo(() => createSim(params, policies.a).yields, [params, policies.a]);

  return (
    <section className="space-y-4" aria-label="政府備蓄米の方針のシミュレーション">
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
                setSeedOffset(0);
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
            title="乱数の種を変えて、別の 30 年を試す"
          >
            別の 30 年で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">1 秒に</span>
            {([2, 6, 18] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp} か月
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            {stats && stats.a.month > 0 ? fmtWhen(stats.a.month) : "1 年目 7 月"} / {params.years} 年
          </span>
          <span className="ml-3 text-muted">
            この 30 年の作況:{" "}
            <span className="font-mono">
              {yields.map((v, i) => (
                <span key={i} className={v < 97 ? "font-bold text-[var(--series-8)]" : ""}>
                  {v}
                  {i < yields.length - 1 ? " " : ""}
                </span>
              ))}
            </span>
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">
                不作の起こりやすさ ×{badScale.toFixed(1)}（不作 {Math.round(params.badYearProb * 100)}% /
                年、大凶作 {(params.disasterProb * 100).toFixed(1)}% / 年。温暖化で高温障害が増える世界を試す）
              </span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={badScale}
                onChange={(e) => setBadScale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">右の世界の備蓄目標 {policies.b.target} 万 t</span>
              <input
                type="range"
                min={0}
                max={180}
                step={10}
                value={policies.b.target}
                onChange={(e) => setBTarget(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">右の世界: 高値が {policies.b.decisionLag} か月続いたら放出を決める</span>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={policies.b.decisionLag}
                onChange={(e) => setBLag(Number(e.target.value))}
              />
            </label>
            {(bTarget !== null || bLag !== null) && (
              <button
                type="button"
                onClick={() => {
                  setBTarget(null);
                  setBLag(null);
                }}
                className="justify-self-start rounded-md border border-border px-2 py-1 text-xs hover:border-accent"
              >
                右の世界の調整を戻す
              </button>
            )}
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
                    if (w === "b") {
                      setBTarget(null);
                      setBLag(null);
                    }
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
              <p className="mt-1 text-xs text-muted">{describePolicy(policy)}。</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[400px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の政府備蓄・民間在庫・値段の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-xs text-muted">米騒動 (4,200 円超) の月数</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${st.crisisMonths} か月` : "–"}</dd>
                <dt className="text-xs text-muted">いちばん高かった値段</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.peakPrice) : "–"}</dd>
                <dt className="text-xs text-muted">品薄 (在庫 1 か月分未満) の月数</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${st.emptyMonths} か月` : "–"}</dd>
                <dt className="text-xs text-muted">安すぎて農家が苦しい (2,400 円未満) 月数</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${st.lowMonths} か月` : "–"}</dd>
                <dt className="text-xs text-muted">放出した量 / 買い戻した量</dt>
                <dd className="text-right font-mono font-semibold">
                  {st ? `${Math.round(st.released)} / ${Math.round(st.boughtBack)} 万t` : "–"}
                </dd>
                <dt className="text-xs text-muted">財政負担 (1 年あたり)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtOku(st.fiscalPerYear) : "–"}</dd>
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          months={totalMonths}
          refPrice={params.refPrice}
          metric={metric}
          onMetricChange={setMetric}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">天気を変えて 30 年を 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              1 回の 30 年は天気の巡り合わせに左右されるので、同じ条件で作況と需要の揺れを 100 通りに変えて平均を取ります。
              シナリオで決めた年の天気はそのままです。
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
                  <th className="py-1 pr-3 font-semibold">指標 (30 年あたり)</th>
                  <th className="py-1 pr-3 font-semibold">{policies.a.name}</th>
                  <th className="py-1 font-semibold">{policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow
                  label="米騒動の月数"
                  a={agg.a.stats.crisisMonths}
                  b={agg.b.stats.crisisMonths}
                  fmt={(v) => `${v.toFixed(1)} か月`}
                />
                <AggRow
                  label="米騒動が一度でも起きた割合"
                  a={agg.a.anyCrisis}
                  b={agg.b.anyCrisis}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                />
                <AggRow label="いちばん高かった値段" a={agg.a.stats.peakPrice} b={agg.b.stats.peakPrice} fmt={fmtYen} />
                <AggRow
                  label="品薄 (在庫 1 か月分未満) の月数"
                  a={agg.a.stats.emptyMonths}
                  b={agg.b.stats.emptyMonths}
                  fmt={(v) => `${v.toFixed(1)} か月`}
                />
                <AggRow
                  label="安すぎて農家が苦しい月数"
                  a={agg.a.stats.lowMonths}
                  b={agg.b.stats.lowMonths}
                  fmt={(v) => `${v.toFixed(1)} か月`}
                />
                <AggRow
                  label="放出した量"
                  a={agg.a.stats.released}
                  b={agg.b.stats.released}
                  fmt={(v) => `${Math.round(v)} 万t`}
                />
                <AggRow
                  label="備蓄がいちばん減ったとき"
                  a={agg.a.stats.minGov}
                  b={agg.b.stats.minGov}
                  fmt={(v) => `${Math.round(v)} 万t`}
                />
                <AggRow
                  label="財政負担 (1 年あたり)"
                  a={agg.a.stats.fiscalPerYear}
                  b={agg.b.stats.fiscalPerYear}
                  fmt={fmtOku}
                />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
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
    { color: "var(--series-4)", label: "政府の倉庫 (1 マス = 5 万 t、薄いほど古い米)", shape: "rounded-sm" },
    { color: "var(--series-3)", label: "民間在庫 (卸や JA、店にある米)", shape: "rounded-sm" },
    { color: "var(--series-8)", label: "米騒動 (いつもの 1.4 倍) / 品薄", shape: "rounded-sm" },
    { color: "var(--series-7)", label: "安すぎ (いつもの 0.8 倍)", shape: "rounded-sm" },
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
