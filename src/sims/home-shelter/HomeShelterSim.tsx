"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  generateTown,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type LeaveReason,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { getScenario, policies, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type Speed = 1 | 3 | 10;

/** ×1 で 1 日を 1.5 秒で流す */
const DAYS_PER_SEC = 2 / 3;

const WORLD_COLOR = ["var(--series-1)", "var(--series-2)", "var(--series-7)"];

const REASON_LABEL: Record<LeaveReason, string> = {
  damage: "家の損壊",
  water: "水",
  food: "食料",
  toilet: "トイレ",
};

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    home: v("--accent"),
    low: v("--series-4"),
    shelter: v("--series-2"),
    overflow: v("--status-critical"),
  };
}

function fmtPct(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–";
}

function fmtPeople(v: number): string {
  return `${Math.round(v).toLocaleString()} 人`;
}

export function HomeShelterSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [shelterRate, setShelterRate] = useState<number | null>(null);
  const [fetchRate, setFetchRate] = useState<number | null>(null);
  const [toiletTol, setToiletTol] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("evacuees");
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
      shelterRate: shelterRate ?? base.shelterRate,
      fetchRate: fetchRate ?? base.fetchRate,
      tolerance: { ...base.tolerance, toilet: toiletTol ?? base.tolerance.toilet },
    };
  }, [scenario, seedOffset, shelterRate, fetchRate, toiletTol]);

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
    const town = generateTown(params);
    simsRef.current = policies.map((pol) => createSim(params, pol, town));
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
      accRef.current += real * DAYS_PER_SEC * speedRef.current;
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

  const finished = stats ? stats[0].t >= params.days : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      setAgg(aggregate(params, policies, 100));
      setAggBusy(false);
    }, 20);
  };

  const resetSettings = () => {
    setShelterRate(null);
    setFetchRate(null);
    setToiletTol(null);
  };

  return (
    <section className="space-y-4" aria-label="在宅避難のシミュレーション">
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
            title="乱数の種を変えて、別の町・別の復旧日程で試す"
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
              <span className="text-xs text-muted">避難所の定員 人口の {Math.round(params.shelterRate * 100)}%</span>
              <input
                type="range"
                min={0.04}
                max={0.4}
                step={0.01}
                value={params.shelterRate}
                onChange={(e) => setShelterRate(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                給水所や避難所まで通える世帯 {Math.round(params.fetchRate * 100)}%
              </span>
              <input
                type="range"
                min={0.2}
                max={0.94}
                step={0.02}
                value={params.fetchRate}
                onChange={(e) => setFetchRate(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                トイレなしで我慢できる日数 {params.tolerance.toilet.toFixed(1)} 日
              </span>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.5}
                value={params.tolerance.toilet}
                onChange={(e) => setToiletTol(Number(e.target.value))}
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
                aria-label={`${pol.label}の町の 400 世帯と避難所の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <Stat label="家にいる人" value={st ? fmtPct(st.home / st.population) : "–"} />
                <Stat label="避難所に入れない人" value={st ? fmtPeople(st.overflow) : "–"} />
                <Stat
                  label="家を離れた人のピーク"
                  value={st ? `${fmtPeople(st.peakEvacuees)}` : "–"}
                  hint={st ? `定員 ${st.capacity}` : undefined}
                />
                <Stat label="入れなかった延べ" value={st ? `${Math.round(st.overflowPersonDays).toLocaleString()} 人日` : "–"} />
                <div className="col-span-2">
                  <dt className="text-xs text-muted">家を出た理由 (人)</dt>
                  <dd className="font-mono text-xs">
                    {st
                      ? (Object.keys(REASON_LABEL) as LeaveReason[])
                          .map((k) => `${REASON_LABEL[k]} ${st.reasons[k]}`)
                          .join(" / ")
                      : "–"}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && stats && (
        <TimeChart
          series={chartSeries}
          days={params.days}
          capacity={stats[0].capacity}
          population={stats[0].population}
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
              どの街区が断水するか、いつ水道が戻るかで結果は大きく揺れます。町と復旧の日程を変えて 100 回試行し、平均を取ります。
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
                  <th className="py-1 pr-3 font-semibold">指標 ({params.days} 日間、町の人口 約 {Math.round(agg[0].population)} 人)</th>
                  {policies.map((pol) => (
                    <th key={pol.id} className="py-1 pr-3 font-semibold">
                      {pol.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AggRow
                  label={`家を離れた人のピーク (定員 約 ${Math.round(agg[0].capacity)} 人)`}
                  values={agg.map((a) => a.peakEvacuees)}
                  fmt={fmtPeople}
                  better="low"
                />
                <AggRow
                  label="定員を超えた回"
                  values={agg.map((a) => a.overCapacityShare)}
                  fmt={fmtPct}
                  better="low"
                />
                <AggRow
                  label="一度でも家を出た人"
                  values={agg.map((a) => a.everLeft)}
                  fmt={fmtPeople}
                  better="low"
                />
                <AggRow
                  label="うち トイレが理由"
                  values={agg.map((a) => a.reasons.toilet)}
                  fmt={fmtPeople}
                  better="low"
                />
                <AggRow
                  label="うち 水が理由"
                  values={agg.map((a) => a.reasons.water)}
                  fmt={fmtPeople}
                  better="low"
                />
                <AggRow
                  label="避難所で過ごした延べ"
                  values={agg.map((a) => a.shelterPersonDays)}
                  fmt={(v) => `${Math.round(v).toLocaleString()} 人日`}
                  better="low"
                />
                <AggRow
                  label="避難所に入れなかった延べ"
                  values={agg.map((a) => a.overflowPersonDays)}
                  fmt={(v) => `${Math.round(v).toLocaleString()} 人日`}
                  better="low"
                />
                <AggRow
                  label="最終日に家で暮らせている人"
                  values={agg.map((a) => a.homeAtEnd)}
                  fmt={fmtPct}
                  better="high"
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
  const items: { color: string; label: string; shape: "fill" | "ring" | "cross" }[] = [
    { color: "var(--accent)", label: "家で暮らせている", shape: "fill" },
    { color: "var(--series-4)", label: "家にいるが備蓄が残り 1 日を切った・尽きた", shape: "fill" },
    { color: "var(--series-2)", label: "避難所にいる", shape: "fill" },
    { color: "var(--status-critical)", label: "避難所に入れない (車中泊・軒先など)", shape: "ring" },
    { color: "var(--muted)", label: "家が壊れた (避難所へ)", shape: "cross" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-[2px] text-center text-[10px] leading-3"
            style={
              it.shape === "ring"
                ? { border: `2px solid ${it.color}` }
                : it.shape === "cross"
                  ? { color: it.color }
                  : { background: it.color }
            }
            aria-hidden
          >
            {it.shape === "cross" ? "×" : null}
          </span>
          {it.label}
        </li>
      ))}
      <li>四角の大きさ = 世帯の人数 (1〜4 人)</li>
    </ul>
  );
}
