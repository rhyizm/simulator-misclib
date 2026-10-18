"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  generateQuakes,
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

/** ×1 で 1 年を 2 秒で流す */
const YEARS_PER_SEC = 0.5;

const WORLD_COLOR = ["var(--series-1)", "var(--series-2)", "var(--series-7)"];

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    resident: v("--accent"),
    hit: v("--series-3"),
    falseAlarm: v("--series-4"),
    miss: v("--status-critical"),
  };
}

function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–";
}

export function QuakeAlertSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [sigma, setSigma] = useState<number | null>(null);
  const [penalty, setPenalty] = useState<number | null>(null);
  const [glitch, setGlitch] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("trust");
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
      estimateSigma: sigma ?? base.estimateSigma,
      falseAlarmPenalty: penalty ?? base.falseAlarmPenalty,
      glitchProb: glitch ?? base.glitchProb,
    };
  }, [scenario, seedOffset, sigma, penalty, glitch]);

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
      sims.map((sim, i) => ({ name: sim.policy.label, color: WORLD_COLOR[i], points: sim.series.slice() })),
    );
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    const quakes = generateQuakes(params);
    simsRef.current = policies.map((pol) => createSim(params, pol, quakes));
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
      accRef.current += real * YEARS_PER_SEC * speedRef.current;
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

  const finished = stats ? stats[0].t >= params.years : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      setAgg(aggregate(params, policies, 100));
      setAggBusy(false);
    }, 20);
  };

  const resetSettings = () => {
    setSigma(null);
    setPenalty(null);
    setGlitch(null);
  };

  return (
    <section className="space-y-4" aria-label="地震の警報のシミュレーション">
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
            title="乱数の種を変えて、別の 30 年を試す"
          >
            別の 30 年で
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
              <span className="text-xs text-muted">推定震度の誤差 ±{params.estimateSigma.toFixed(1)}</span>
              <input
                type="range"
                min={0.2}
                max={1.2}
                step={0.1}
                value={params.estimateSigma}
                onChange={(e) => setSigma(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                空振り 1 回で減る信頼 {Math.round(params.falseAlarmPenalty * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.01}
                value={params.falseAlarmPenalty}
                onChange={(e) => setPenalty(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                誤作動 30 年で約 {(params.glitchProb * params.quakesPerYear * params.years).toFixed(0)} 回
              </span>
              <input
                type="range"
                min={0}
                max={0.06}
                step={0.002}
                value={params.glitchProb}
                onChange={(e) => setGlitch(Number(e.target.value))}
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
                aria-label={`${pol.label}の町の 400 人と 30 年の年表`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <Stat label="警報" value={st ? `${st.alerts} 回` : "–"} />
                <Stat label="強い揺れ" value={st ? `${st.strong} 回` : "–"} />
                <Stat label="的中 / 空振り" value={st ? `${st.hits} / ${st.falseAlarms}` : "–"} />
                <Stat label="見逃し" value={st ? `${st.misses} 回` : "–"} />
                <Stat label="今の信頼" value={st ? fmtPct(st.trust) : "–"} />
                <Stat label="身を守れた人" value={st ? fmtPct(st.protectedShare) : "–"} hint="強い揺れのとき" />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} years={params.years} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別々の 30 年を 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              大きな地震は 30 年に十数回しか来ないので、1 回の 30 年は運に大きく左右されます。地震の筋書きを変えて 100 回試行し、平均を取ります。
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
                  {policies.map((pol) => (
                    <th key={pol.id} className="py-1 pr-3 font-semibold">
                      {pol.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AggRow label="警報の回数" values={agg.map((a) => a.alerts)} fmt={(v) => `${v.toFixed(1)} 回`} />
                <AggRow label="空振り" values={agg.map((a) => a.falseAlarms)} fmt={(v) => `${v.toFixed(1)} 回`} better="low" />
                <AggRow label="見逃し" values={agg.map((a) => a.misses)} fmt={(v) => `${v.toFixed(1)} 回`} better="low" />
                <AggRow label="30 年後の信頼" values={agg.map((a) => a.trust)} fmt={fmtPct} better="high" />
                <AggRow
                  label="強い揺れで身を守れた人"
                  values={agg.map((a) => a.protectedShare)}
                  fmt={fmtPct}
                  better="high"
                />
                <AggRow
                  label="身を守れなかった延べ人数"
                  values={agg.map((a) => a.unprotected)}
                  fmt={(v) => `${Math.round(v).toLocaleString()} 人`}
                  better="low"
                />
                <AggRow
                  label="空振りで身構えた延べ人数"
                  values={agg.map((a) => a.falseActions)}
                  fmt={(v) => `${Math.round(v).toLocaleString()} 人`}
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
  const items: { color: string; label: string; shape: "dot" | "square" | "ring" }[] = [
    { color: "var(--accent)", label: "住民 (濃いほど警報を信じている)", shape: "dot" },
    { color: "var(--series-3)", label: "的中: 警報で身を守れた", shape: "square" },
    { color: "var(--series-4)", label: "空振り: 警報で身構えたが揺れなかった", shape: "square" },
    { color: "var(--status-critical)", label: "強い揺れで身を守れなかった (見逃し・警報を無視)", shape: "ring" },
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
