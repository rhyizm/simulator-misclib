"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  femaleMaleRatio,
  getStats,
  isFinished,
  splitLayout,
  step,
  type AggregateStats,
  type GenderStats,
  type Layout,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { TOTAL, getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";

type World = "a" | "b";
type Speed = 5 | 15 | 40;

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
    female: v("--series-7"),
    male: v("--series-3"),
  };
}

function fmtWait(s: number): string {
  if (!Number.isFinite(s)) return "–";
  if (s < 60) return `${s.toFixed(0)} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, "0")} 秒`;
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function describeLayout(l: Layout): string {
  const male = l.maleStalls + l.urinals;
  const flex = l.flexStalls > 0 ? `、可変 ${l.flexStalls}` : "";
  return `女性 ${l.femaleStalls} : 男性 ${male}${flex}（女性 ÷ 男性 = ${femaleMaleRatio(l).toFixed(2)}）`;
}

export function ToiletSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(15);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [arrivalScale, setArrivalScale] = useState(1);
  const [femaleSec, setFemaleSec] = useState<number | null>(null);
  const [customFemale, setCustomFemale] = useState<number | null>(null);
  const [metric, setMetric] = useState<"female" | "male">("female");
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
      femaleStallSec: femaleSec ?? base.femaleStallSec,
      arrivals: base.arrivals.map((a) => ({ ...a, perMin: Math.round(a.perMin * arrivalScale * 10) / 10 })),
    };
  }, [scenario, seedOffset, femaleSec, arrivalScale]);

  // 右の世界は、可変トイレのシナリオ以外ではスライダーで配分を変えられる
  const canCustomize = scenario.layouts[1].flexStalls === 0;
  const layouts = useMemo<Record<World, Layout>>(() => {
    const [a, b] = scenario.layouts;
    if (!canCustomize || customFemale === null) return { a, b };
    return { a, b: splitLayout(customFemale === b.femaleStalls ? b.name : "試しの配分", TOTAL, customFemale) };
  }, [scenario, canCustomize, customFemale]);

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
      { name: sims.a.layout.name, color: WORLD_COLOR.a, points: sims.a.series.slice() },
      { name: sims.b.layout.name, color: WORLD_COLOR.b, points: sims.b.series.slice() },
    ]);
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = { a: createSim(params, layouts.a), b: createSim(params, layouts.b) };
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, layouts, draw]);

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
      setAgg({ a: aggregate(params, layouts.a, runs), b: aggregate(params, layouts.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  const sliderFemale = customFemale ?? scenario.layouts[1].femaleStalls;

  return (
    <section className="space-y-4" aria-label="トイレの便器数の配分のシミュレーション">
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
                setArrivalScale(1);
                setFemaleSec(null);
                setCustomFemale(null);
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
            {([5, 15, 40] as const).map((sp) => (
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
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                来る人数 ×{arrivalScale.toFixed(1)}（
                {params.arrivals
                  .filter((a, i, arr) => arr.findIndex((b) => b.perMin === a.perMin) === i)
                  .map((a) => `${a.perMin} 人/分`)
                  .join(" / ")}
                ）
              </span>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.1}
                value={arrivalScale}
                onChange={(e) => setArrivalScale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">女性が個室を使う平均時間 {params.femaleStallSec} 秒</span>
              <input
                type="range"
                min={60}
                max={150}
                step={5}
                value={params.femaleStallSec}
                onChange={(e) => setFemaleSec(Number(e.target.value))}
              />
            </label>
            {canCustomize && (
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted">
                  右の世界の配分: 16 個のうち女性用 {sliderFemale} 個 / 男性用 {TOTAL - sliderFemale} 個
                </span>
                <input
                  type="range"
                  min={4}
                  max={12}
                  step={1}
                  value={sliderFemale}
                  onChange={(e) => setCustomFemale(Number(e.target.value))}
                />
              </label>
            )}
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const layout = layouts[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <h3 className="text-base font-bold">{layout.name}</h3>
              </div>
              <p className="text-xs text-muted">{describeLayout(layout)}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[360px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${layout.name}のトイレの様子`}
              />
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-0.5 font-normal" />
                    <th className="py-0.5 font-semibold" style={{ color: "var(--series-7)" }}>女性</th>
                    <th className="py-0.5 font-semibold" style={{ color: "var(--series-3)" }}>男性</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <StatRow label="平均待ち時間" st={st} pick={(g) => fmtWait(g.avgWait)} />
                  <StatRow label="最も長く待った人" st={st} pick={(g) => fmtWait(g.maxWait)} />
                  <StatRow label="最大の行列" st={st} pick={(g) => `${g.maxQueue} 人`} />
                  <StatRow label="済ませた人" st={st} pick={(g) => `${g.served} 人`} />
                </tbody>
              </table>
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
              アニメーション 1 回だけでは偶然に左右されるので、同じ条件で 100 回試行して平均を取ります。
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
                  <th className="py-1 pr-3 font-semibold">{layouts.a.name}</th>
                  <th className="py-1 font-semibold">{layouts.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="女性の平均待ち時間" a={agg.a.female.avgWait} b={agg.b.female.avgWait} fmt={fmtWait} />
                <AggRow label="男性の平均待ち時間" a={agg.a.male.avgWait} b={agg.b.male.avgWait} fmt={fmtWait} />
                <AggRow
                  label="男女の差 (女性 − 男性)"
                  a={agg.a.female.avgWait - agg.a.male.avgWait}
                  b={agg.b.female.avgWait - agg.b.male.avgWait}
                  fmt={(v) => `${v >= 0 ? "+" : "−"}${fmtWait(Math.abs(v))}`}
                />
                <AggRow
                  label="全員の平均待ち時間"
                  a={avgAll(agg.a)}
                  b={avgAll(agg.b)}
                  fmt={fmtWait}
                />
                <AggRow
                  label="終了時にまだ並んでいる人"
                  a={agg.a.female.queue + agg.a.male.queue}
                  b={agg.b.female.queue + agg.b.male.queue}
                  fmt={(v) => `${v.toFixed(1)} 人`}
                />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function avgAll(a: AggregateStats): number {
  const n = a.female.arrived + a.male.arrived;
  return n > 0 ? (a.female.avgWait * a.female.arrived + a.male.avgWait * a.male.arrived) / n : 0;
}

function StatRow({
  label,
  st,
  pick,
}: {
  label: string;
  st: SimStats | undefined;
  pick: (g: GenderStats) => string;
}) {
  return (
    <tr className="border-t border-border">
      <td className="py-0.5 pr-2 font-sans text-xs text-muted">{label}</td>
      <td className="py-0.5 pr-2 font-semibold">{st ? pick(st.female) : "–"}</td>
      <td className="py-0.5 font-semibold">{st ? pick(st.male) : "–"}</td>
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
    { color: "var(--series-7)", label: "女性 (使用中の個室・行列)", shape: "rounded-full" },
    { color: "var(--series-3)", label: "男性", shape: "rounded-full" },
    { color: "var(--muted)", label: "細い枠 = 小便器、点線の枠 = 可変トイレ、下のバー = 残り時間", shape: "rounded-sm" },
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
