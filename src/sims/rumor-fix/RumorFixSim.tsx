"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  buildNetwork,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { getScenario, policies, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type Speed = 1 | 3 | 10;

/** ×1 で 1 時間を 1 秒で流す */
const HOURS_PER_SEC = 1;

// 住民の色 (赤・緑・青) と重ならないように、世界の色は黄・紫・白にする
const WORLD_COLOR = ["var(--series-4)", "var(--series-7)", "var(--foreground)"];

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    believer: v("--series-8"),
    corrected: v("--series-3"),
    informed: v("--series-1"),
    doubter: v("--muted"),
  };
}

function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–";
}

function fmtPeople(v: number): string {
  return `${Math.round(v)} 人`;
}

export function RumorFixSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [shareFix, setShareFix] = useState<number | null>(null);
  const [acceptStale, setAcceptStale] = useState<number | null>(null);
  const [reach, setReach] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("believers");
  const [stats, setStats] = useState<SimStats[] | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<AggregateStats[] | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      shareFixConvert: shareFix ?? base.shareFixConvert,
      shareFixBystander: shareFix !== null ? shareFix * 0.4 : base.shareFixBystander,
      acceptStale: acceptStale ?? base.acceptStale,
      officialReach: reach ?? base.officialReach,
    };
  }, [scenario, seedOffset, shareFix, acceptStale, reach]);

  const simsRef = useRef<SimState[] | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    sims.forEach((sim, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (!themeRef.current) themeRef.current = readTheme(canvas);
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== CANVAS_W * dpr) {
        canvas.width = CANVAS_W * dpr;
        canvas.height = CANVAS_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderSim(ctx, sim, themeRef.current);
    });
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats(sims.map(getStats));
    setChartSeries(
      sims.map((sim, i) => ({
        name: sim.policy.label,
        color: WORLD_COLOR[i],
        points: sim.series.slice(),
        fixAt: sim.policy.delay,
      })),
    );
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    const net = buildNetwork(params);
    simsRef.current = policies.map((pol) => createSim(params, pol, net));
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, draw]);

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
      accRef.current += real * HOURS_PER_SEC * speedRef.current;
      let n = 0;
      while (accRef.current >= DT && n < 200) {
        for (const sim of sims) step(sim, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 150) {
        lastPublish = ts;
        publish();
      }
      if (sims.every(isFinished)) {
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

  const finished = stats ? stats[0].t >= params.hours : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      setAgg(aggregate(params, policies, 100));
      setAggBusy(false);
    }, 20);
  };

  const resetSettings = () => {
    setShareFix(null);
    setAcceptStale(null);
    setReach(null);
  };

  return (
    <section className="space-y-4" aria-label="デマと訂正のシミュレーション">
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
                resetSettings();
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
            title="乱数の種を変えて、別のつながりとデマで試す"
          >
            別の町で
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
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                考えを改めた人が訂正を広める {Math.round(params.shareFixConvert * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={params.shareFixConvert}
                onChange={(e) => setShareFix(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                時間が経ってから考えを改める {Math.round(params.acceptStale * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.75}
                step={0.05}
                value={params.acceptStale}
                onChange={(e) => setAcceptStale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                公式の発表を直接見る人 {Math.round(params.officialReach * 100)}%
              </span>
              <input
                type="range"
                min={0.02}
                max={0.3}
                step={0.01}
                value={params.officialReach}
                onChange={(e) => setReach(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 3 つの世界 */}
      <div className="grid gap-4 md:grid-cols-3">
        {policies.map((pol, i) => {
          const st = stats?.[i];
          return (
            <div key={pol.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[i] }} aria-hidden />
                <h3 className="text-base font-bold">{pol.label}</h3>
              </div>
              <p className="text-xs text-muted">{pol.desc}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[i] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[320px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${pol.label}の世界の 400 人`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <Stat label="いま信じている" value={st ? fmtPeople(st.believers) : "–"} />
                <Stat label="一度でも信じた" value={st ? fmtPeople(st.everBelieved) : "–"} />
                <Stat label="信じた人の最多" value={st ? fmtPeople(st.peakBelievers) : "–"} />
                <Stat label="考えを改めた" value={st ? fmtPct(st.correctedShare) : "–"} hint="信じた人のうち" />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          hours={params.hours}
          population={params.side * params.side}
          metric={metric}
          onMetricChange={setMetric}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別々の町で 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              デマは最初の数人が誰に届くかで、大きく広がったりすぐ消えたりします。つながりと乱数を変えて 100 回試行し、平均を取ります。
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
                  <th className="py-1 pr-3 font-semibold">指標 (400 人のうち)</th>
                  {policies.map((pol) => (
                    <th key={pol.id} className="py-1 pr-3 font-semibold">
                      {pol.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AggRow label="一度でも信じた人" values={agg.map((a) => a.everBelieved)} fmt={fmtPeople} better="low" />
                <AggRow label="同時に信じていた人の最多" values={agg.map((a) => a.peakBelievers)} fmt={fmtPeople} better="low" />
                <AggRow
                  label={`${params.hours} 時間後も信じている人`}
                  values={agg.map((a) => a.believers)}
                  fmt={fmtPeople}
                  better="low"
                />
                <AggRow label="信じた人のうち考えを改めた" values={agg.map((a) => a.correctedShare)} fmt={fmtPct} better="high" />
                <AggRow label="訂正を知っている人" values={agg.map((a) => a.informed)} fmt={fmtPeople} better="high" />
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
  const items: { color: string; label: string; shape: "dot" | "square" | "ring" }[] = [
    { color: "var(--series-8)", label: "デマを信じている", shape: "dot" },
    { color: "var(--series-3)", label: "信じたが、訂正で考えを改めた", shape: "dot" },
    { color: "var(--series-1)", label: "デマより先に訂正を知った", shape: "dot" },
    { color: "var(--muted)", label: "デマを見たが信じなかった", shape: "dot" },
    { color: "var(--grid)", label: "まだ何も知らない", shape: "dot" },
    { color: "var(--muted)", label: "輪: いま広めている", shape: "ring" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 ${it.shape === "square" ? "rounded-[2px]" : "rounded-full"}`}
            style={it.shape === "ring" ? { border: `2px solid ${it.color}` } : { background: it.color }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
