"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  fmtClock,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICY_NOTE, getPolicy, getScenario, policies, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
type Speed = 300 | 900 | 2400;

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
    red: v("--series-8"),
    amber: v("--series-4"),
    blue: v("--series-1"),
    purple: v("--series-7"),
    green: v("--series-3"),
  };
}

function fmtMin(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "–";
  return `${m.toFixed(1)} 分`;
}

function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function AmbulanceFeeSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(900);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, string>>({ a: "free", b: "fee" });
  const [deter, setDeter] = useState(0.42);
  const [misjudge, setMisjudge] = useState(0.12);
  const [demandScale, setDemandScale] = useState(1);
  const [metric, setMetric] = useState<Metric>("busy");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const pl = scenario.params.perceiveLow;
    return {
      ...scenario.params,
      seed: scenario.params.seed + seedOffset,
      deter,
      perceiveLow: [pl[0], misjudge, misjudge * 0.4, 0],
      dailyDemand: Math.round(scenario.params.dailyDemand * demandScale),
    };
  }, [scenario, seedOffset, deter, misjudge, demandScale]);
  const pols = useMemo<Record<World, Policy>>(
    () => ({ a: getPolicy(policyIds.a), b: getPolicy(policyIds.b) }),
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
    simsRef.current = { a: createSim(params, pols.a), b: createSim(params, pols.b) };
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, pols, draw]);

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
      setAgg({ a: aggregate(params, pols.a, runs), b: aggregate(params, pols.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="救急車の選定療養費のシミュレーション">
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
            {([300, 900, 2400] as const).map((sp) => (
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
          <span className="font-mono text-muted">{stats ? fmtClock(stats.a.t) : "0:00"} / 24:00</span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                「たぶん軽い」と思う人のうち、費用を気にして呼ぶのをやめる人 {Math.round(deter * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.02}
                value={deter}
                onChange={(e) => setDeter(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                本当は中等症なのに「たぶん軽い」と思う人 {Math.round(misjudge * 100)}% (重症はその 4 割)
              </span>
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.02}
                value={misjudge}
                onChange={(e) => setMisjudge(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                救急車が必要になる人 ×{demandScale.toFixed(2)}（1 日 {params.dailyDemand} 人）
              </span>
              <input
                type="range"
                min={0.7}
                max={1.3}
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
          const pol = pols[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <h3 className="text-base font-bold">
                  {w === "a" ? "左" : "右"}: {pol.name}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label="救急車のルール">
                {policies.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={pol.id === opt.id}
                    onClick={() => {
                      setPolicyIds((cur) => ({ ...cur, [w]: opt.id }));
                      setPlaying(true);
                    }}
                    className={`rounded-md border px-2 py-1 ${
                      pol.id === opt.id ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{POLICY_NOTE[pol.id]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[420px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${pol.name}の世界の地図と、1 時間ごとの 119 番の件数`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <Stat label="119 番 (うち軽症)" value={st ? `${st.calls} 件 (${st.callsMild})` : "–"} />
                <Stat label="救急車を使わなかった軽症" value={st ? `${st.selfMild} 人` : "–"} />
                <Stat label="費用を払った人" value={st ? `${st.charged} 人` : "–"} />
                <Stat label="ためらって遅れた中等症以上" value={st ? `${st.delayedSevere} 人` : "–"} />
                <Stat label="119 番から到着 (平均)" value={st ? fmtMin(st.avgResponseMin) : "–"} />
                <Stat label="重症・心肺停止の到着 (平均)" value={st ? fmtMin(st.severeResponseMin) : "–"} />
                <Stat label="ほかの署から来た" value={st ? pct(st.fromFarShare) : "–"} />
                <Stat label="搬送困難 (問い合わせ 4 回以上)" value={st ? `${st.difficult} 件` : "–"} />
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
              具合が悪くなる人の数や場所、時刻は日によってぶれます。同じ条件で 100 日試して、1 日あたりの平均を取ります。
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
                  <th className="py-1 pr-3 font-semibold">1 日あたり</th>
                  <th className="py-1 pr-3 font-semibold">左: {pols.a.name}</th>
                  <th className="py-1 font-semibold">右: {pols.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="119 番" a={agg.a.calls} b={agg.b.calls} fmt={(v) => `${v.toFixed(1)} 件`} />
                <AggRow label="うち軽症" a={agg.a.callsMild} b={agg.b.callsMild} fmt={(v) => `${v.toFixed(1)} 件`} />
                <AggRow label="救急車を使わなかった軽症" a={agg.a.selfMild} b={agg.b.selfMild} fmt={(v) => `${v.toFixed(1)} 人`} />
                <AggRow label="費用を払った人" a={agg.a.charged} b={agg.b.charged} fmt={(v) => `${v.toFixed(1)} 人`} />
                <AggRow label="119 番から到着 (平均)" a={agg.a.avgResponseMin} b={agg.b.avgResponseMin} fmt={fmtMin} />
                <AggRow
                  label="重症・心肺停止の到着 (平均)"
                  a={agg.a.severeResponseMin}
                  b={agg.b.severeResponseMin}
                  fmt={fmtMin}
                />
                <AggRow
                  label="重症・心肺停止で 13 分超え"
                  a={agg.a.severeLateShare}
                  b={agg.b.severeLateShare}
                  fmt={(v) => pct(v, 1)}
                />
                <AggRow label="空いた救急車を待った 119 番" a={agg.a.queued} b={agg.b.queued} fmt={(v) => `${v.toFixed(2)} 件`} />
                <AggRow label="搬送困難" a={agg.a.difficult} b={agg.b.difficult} fmt={(v) => `${v.toFixed(2)} 件`} />
                <AggRow
                  label="ためらって遅れた中等症以上"
                  a={agg.a.delayedSevere}
                  b={agg.b.delayedSevere}
                  fmt={(v) => `${v.toFixed(2)} 人`}
                />
                <AggRow label="その遅れの合計" a={agg.a.delayHours} b={agg.b.delayHours} fmt={(v) => `${v.toFixed(1)} 時間`} />
                <AggRow
                  label="中等症以上: 具合が悪くなってから到着"
                  a={agg.a.severeOnsetToArriveMin}
                  b={agg.b.severeOnsetToArriveMin}
                  fmt={fmtMin}
                />
                <AggRow
                  label="心肺停止 100 日の合計 / 助かる見込み"
                  a={agg.a.arrestSaved}
                  b={agg.b.arrestSaved}
                  fmt={(v) => `${agg.a.arrests} 人 / ${v.toFixed(1)} 人`}
                />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              「搬送困難」は、病院への受け入れの問い合わせが 4 回以上かつ現場に 30 分以上いた件数 (総務省消防庁の定義)。
              「具合が悪くなってから到着」には、ためらって 119 番が遅れた時間も含みます。
              心肺停止の「助かる見込み」は、到着が 1 分遅れるごとに 1 割ほど下がる単純な目安の合計です。
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
    { color: "var(--series-8)", label: "現場へ向かう救急車 / 119 番を待つ重い人" },
    { color: "var(--series-4)", label: "現場で処置・病院へ問い合わせ中 / 中等症" },
    { color: "var(--series-1)", label: "病院へ運んでいる / 大きな病院 (□ は救急外来の空き)" },
    { color: "var(--series-7)", label: "病院で引き継ぎ" },
    { color: "var(--muted)", label: "署にいる・帰り道 (すぐ出られる)" },
    { color: "var(--series-3)", label: "× = 救急車を使わなかった軽症" },
  ];
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
        {items.map((it) => (
          <li key={it.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
            {it.label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        △ = 具合が悪いのに 119 番をためらっている人 (赤は様子見、橙は #7119 に相談中)。● のまわりの輪は救急車を待っている時間。
      </p>
    </div>
  );
}
