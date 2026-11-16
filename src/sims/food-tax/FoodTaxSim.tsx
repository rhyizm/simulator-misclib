"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  getStats,
  isFinished,
  runToEnd,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme, type View } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
/** 1 秒あたりに進む月数 */
type Speed = 1 | 3 | 8;

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
    worker: v("--series-3"),
    pension: v("--series-4"),
    store: v("--series-8"),
  };
}

function fmtYen(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)} 万円`;
  return `${Math.round(v).toLocaleString("ja-JP")} 円`;
}

function fmtPct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function describePolicy(p: Policy, params: SimParams): string {
  const man = (v: number) => `${Math.round(v / 10000)} 万円`;
  switch (p.kind) {
    case "none":
      return "食料品の税は 8% のまま。何も配らない (比べるための基準)";
    case "cut":
      return p.workerSupport > 0
        ? `2 年間 1%。さらに年収 ${man(params.supportMin)}〜${man(params.supportMax)} の働く世帯に、減税の 14% ぶんを毎年 10 月に給付 (政府案に近い形)`
        : `2027 年 4 月から 2 年間、食料品の税を 1% に。店が ${fmtPct(params.passThrough)} を値下げに回す`;
    case "flat":
      return "減税で減るのと同じ税収を、1 人あたり同じ額で全員に配る (毎年 10 月)";
    case "targeted":
      return `減税で減るのと同じ税収を、年収 ${man(params.targetIncome)} 以下の世帯だけに 1 人あたり同じ額で配る (毎年 10 月)`;
  }
}

/** 両方の世界の最後の姿から、縦軸の上限を決める (上位 2% は枠の上にはみ出させる) */
function niceMax(values: number[], view: View): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const v = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
  if (view === "share") {
    const stepPct = v > 0.1 ? 0.05 : v > 0.04 ? 0.02 : 0.01;
    return Math.max(stepPct, Math.ceil(v / stepPct) * stepPct);
  }
  const stepYen = v > 200000 ? 100000 : 50000;
  return Math.max(stepYen, Math.ceil(v / stepYen) * stepYen);
}

export function FoodTaxSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [inflation, setInflation] = useState<number | null>(null);
  const [passThrough, setPassThrough] = useState<number | null>(null);
  const [targetIncome, setTargetIncome] = useState<number | null>(null);
  const [view, setView] = useState<View>("yen");
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
      inflation: inflation ?? base.inflation,
      passThrough: passThrough ?? base.passThrough,
      targetIncome: targetIncome ?? base.targetIncome,
    };
  }, [scenario, seedOffset, inflation, passThrough, targetIncome]);

  const ids = policyIds ?? { a: scenario.policies[0], b: scenario.policies[1] };
  const policies = useMemo<Record<World, Policy>>(
    () => ({ a: POLICIES[ids.a], b: POLICIES[ids.b] }),
    [ids.a, ids.b],
  );

  // 縦軸は 2 つの世界で共通にする (最後まで回した姿から決める)
  const yMax = useMemo(() => {
    const vals: number[] = [];
    for (const w of ["a", "b"] as const) {
      const s = runToEnd(createSim(params, policies[w]));
      s.gain.forEach((g, i) => vals.push(view === "yen" ? g : g / s.households[i].income));
      if (view === "yen") vals.push(s.leak / s.households.length);
    }
    return niceMax(vals, view);
  }, [params, policies, view]);

  const simsRef = useRef<Record<World, SimState> | null>(null);
  const canvasRefs = useRef<Record<World, HTMLCanvasElement | null>>({ a: null, b: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);
  const viewRef = useRef({ view, yMax });

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
      renderSim(ctx, sims[w], themeRef.current, viewRef.current.view, viewRef.current.yMax);
    }
  }, []);

  useEffect(() => {
    viewRef.current = { view, yMax };
    draw();
  }, [view, yMax, draw]);

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
      while (accRef.current >= DT && n < 100) {
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

  const finished = stats ? stats.a.t >= 36 - 1e-9 : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="食料品の消費税を 1% にしたときの家計のシミュレーション">
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
                setInflation(null);
                setPassThrough(null);
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
            title="乱数の種を変えて、別の 200 世帯の町で試す"
          >
            別の町で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([1, 3, 8] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp} か月/秒
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="棒の高さ">
          <span className="text-muted">棒の高さ</span>
          {(
            [
              ["yen", "得した金額 (円)"],
              ["share", "年収に対する割合"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md border px-2 py-1 ${
                view === v ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">食料品の値上がり 年 {fmtPct(params.inflation, 1)} (税抜き)</span>
              <input
                type="range"
                min={0}
                max={0.06}
                step={0.005}
                value={params.inflation}
                onChange={(e) => setInflation(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">店が減税分を値下げに回す割合 {fmtPct(params.passThrough)}</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={params.passThrough}
                onChange={(e) => setPassThrough(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">
                「年収 ○○ 万円以下に」の線 {Math.round(params.targetIncome / 10000)} 万円
                {policies.a.kind !== "targeted" && policies.b.kind !== "targeted" && " (この方針を選んだときだけ効く)"}
              </span>
              <input
                type="range"
                min={2_000_000}
                max={6_000_000}
                step={250_000}
                value={params.targetIncome}
                onChange={(e) => setTargetIncome(Number(e.target.value))}
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
              <p className="mt-1 text-xs text-muted">{describePolicy(policy, params)}。</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[420px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界で、年収順に並べた 200 世帯が得した金額`}
              />
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-xs text-muted">1 世帯あたりの得 (1 年)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.perYear) : "–"}</dd>
                <dt className="text-xs text-muted">お店に残った減税分 (1 世帯・1 年)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.leakPerYear) : "–"}</dd>
                <dt className="text-xs text-muted">国の負担 (1 世帯・1 年)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.costPerYear) : "–"}</dd>
                <dt className="text-xs text-muted">年収の低い 20% に届いた割合</dt>
                <dd className="text-right font-mono font-semibold">{st && st.perYear > 0 ? fmtPct(st.bottomShare) : "–"}</dd>
                <dt className="text-xs text-muted">年収の低い 20% の年金世帯の得 (1 年)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.lowPension) : "–"}</dd>
                <dt className="text-xs text-muted">何も受け取っていない世帯</dt>
                <dd className="text-right font-mono font-semibold">{st && st.t > 0 ? fmtPct(st.zeroShare) : "–"}</dd>
                <dt className="text-xs text-muted">2029 年 4 月に値段が跳ね上がる幅</dt>
                <dd className="text-right font-mono font-semibold">{st ? (st.cliff > 0.001 ? `+${fmtPct(st.cliff, 1)}` : "なし") : "–"}</dd>
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
            <h3 className="text-base font-bold">別の町 100 個で回した、年収の 5 段階ごとの平均</h3>
            <p className="text-xs text-muted">
              世帯の年収や食費は町ごとに乱数で変わるので、200 世帯の町を 100 個つくって 2 年分を回し、
              年収の低い順に 5 つに分けた 1 世帯あたり 1 年の得を平均します。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 の町で試す"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">年収の段階 (平均年収)</th>
                  <th className="py-1 pr-3 font-semibold">{policies.a.name}</th>
                  <th className="py-1 font-semibold">{policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {agg.a.stats.quintiles.map((q, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1 pr-3 font-sans">
                      {["低い 20%", "2 番目", "真ん中", "4 番目", "高い 20%"][i]}{" "}
                      <span className="text-xs text-muted">({Math.round(q.income / 10000)} 万円)</span>
                    </td>
                    <td className="py-1 pr-3">
                      {fmtYen(q.perYear)} <span className="text-xs text-muted">{fmtPct(q.ofIncome, 2)}</span>
                    </td>
                    <td className="py-1">
                      {fmtYen(agg.b.stats.quintiles[i].perYear)}{" "}
                      <span className="text-xs text-muted">{fmtPct(agg.b.stats.quintiles[i].ofIncome, 2)}</span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <td className="py-1 pr-3 font-sans">お店に残った分</td>
                  <td className="py-1 pr-3">{fmtYen(agg.a.stats.leakPerYear)}</td>
                  <td className="py-1">{fmtYen(agg.b.stats.leakPerYear)}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-3 font-sans">国の負担</td>
                  <td className="py-1 pr-3">{fmtYen(agg.a.stats.costPerYear)}</td>
                  <td className="py-1">{fmtYen(agg.b.stats.costPerYear)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-xs text-muted">金額は 1 世帯あたり 1 年。右の小さい数字は年収に対する割合。</p>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "var(--series-3)", label: "働く人のいる世帯" },
    { color: "var(--series-4)", label: "年金で暮らす世帯" },
    { color: "var(--series-8)", label: "値下げに回らずお店に残った減税分 (1 世帯あたり)" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
      <li>縦棒 1 本 = 1 世帯。高さは 8% のままと比べた得の累計</li>
    </ul>
  );
}
