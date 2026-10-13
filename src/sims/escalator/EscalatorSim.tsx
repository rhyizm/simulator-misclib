"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
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
import { getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";

type Region = "east" | "west";
type Speed = 1 | 3 | 10;

const POLICY_LABEL: Record<Policy, string> = {
  walkLane: "片側を空ける",
  standBoth: "両側に立つ",
};

const POLICY_DESC: Record<Policy, string> = {
  walkLane: "立つ人は片側に並び、もう片側は歩く人のために空けておく",
  standBoth: "歩かずに、左右どちらにも立って乗る",
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
    stander: v("--series-1"),
    walker: v("--series-2"),
    drunk: v("--series-7"),
    fallen: v("--series-8"),
    critical: v("--status-critical"),
  };
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "–";
  return `${s.toFixed(0)} 秒`;
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EscalatorSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [region, setRegion] = useState<Region>("east");
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [arrivalScale, setArrivalScale] = useState(1);
  const [walkerRatio, setWalkerRatio] = useState<number | null>(null);
  const [metric, setMetric] = useState<"queue" | "exited">("queue");
  const [stats, setStats] = useState<Record<Policy, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<Policy, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      walkerRatio: walkerRatio ?? base.walkerRatio,
      arrivals: base.arrivals.map((a) => ({ ...a, perMin: Math.round(a.perMin * arrivalScale) })),
    };
  }, [scenario, seedOffset, walkerRatio, arrivalScale]);

  const simsRef = useRef<Record<Policy, SimState> | null>(null);
  const canvasRefs = useRef<Record<Policy, HTMLCanvasElement | null>>({ walkLane: null, standBoth: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const regionRef = useRef(region);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const policy of ["walkLane", "standBoth"] as const) {
      const canvas = canvasRefs.current[policy];
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
      renderSim(ctx, sims[policy], themeRef.current, regionRef.current === "east" ? "right" : "left");
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ walkLane: getStats(sims.walkLane), standBoth: getStats(sims.standBoth) });
    setChartSeries([
      { name: POLICY_LABEL.walkLane, color: "var(--series-1)", points: sims.walkLane.series.slice() },
      { name: POLICY_LABEL.standBoth, color: "var(--series-2)", points: sims.standBoth.series.slice() },
    ]);
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = {
      walkLane: createSim(params, "walkLane"),
      standBoth: createSim(params, "standBoth"),
    };
    accRef.current = 0;
    lastTsRef.current = null;
    draw();
  }, [params, draw]);

  // 描画だけに関わる設定は ref に写す (描画ループから読む)
  useEffect(() => {
    regionRef.current = region;
    speedRef.current = speed;
    draw();
  }, [region, speed, draw]);

  // パラメータが変わったら最初から
  useEffect(() => {
    reset();
    const id = requestAnimationFrame(() => {
      setAgg(null);
      publish();
    });
    return () => cancelAnimationFrame(id);
  }, [reset, publish]);

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
      while (accRef.current >= DT && n < 200) {
        step(sims.walkLane, DT);
        step(sims.standBoth, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 120) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.walkLane) && isFinished(sims.standBoth)) {
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

  const finished = stats ? stats.walkLane.t >= params.durationSec : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({
        walkLane: aggregate(params, "walkLane", runs),
        standBoth: aggregate(params, "standBoth", runs),
      });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="エスカレーターのシミュレーション">
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
                setPlaying(false);
                setScenarioId(sc.id);
                setArrivalScale(1);
                setWalkerRatio(null);
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
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white"
          >
            {playing ? "一時停止" : finished ? "もう一度" : "再生"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              reset();
              setAgg(null);
              publish();
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
          >
            リセット
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setSeedOffset((s) => s + 1);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent"
            title="乱数の種を変えて、別の 1 回を試す"
          >
            別の乱数で
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

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-1" role="group" aria-label="歩く側">
            <span className="text-muted">歩く側</span>
            {(["east", "west"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={region === r}
                onClick={() => setRegion(r)}
                className={`rounded-md border px-2 py-1 ${
                  region === r ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {r === "east" ? "右 (関東など)" : "左 (関西など)"}
              </button>
            ))}
          </div>
          <span className="font-mono text-muted">
            経過 {stats ? fmtClock(stats.walkLane.t) : "0:00"} / {fmtClock(params.durationSec)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                到着する人数 ×{arrivalScale.toFixed(1)}（
                {params.arrivals.map((a) => `${a.perMin} 人/分`).join(" → ")}）
              </span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={arrivalScale}
                onChange={(e) => {
                  setPlaying(false);
                  setArrivalScale(Number(e.target.value));
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                歩きたい人の割合 {Math.round(params.walkerRatio * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.walkerRatio}
                onChange={(e) => {
                  setPlaying(false);
                  setWalkerRatio(Number(e.target.value));
                }}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["walkLane", "standBoth"] as const).map((policy) => {
          const st = stats?.[policy];
          const injuries = st?.injuries ?? [];
          const severe = injuries.filter((j) => j.severity === "severe").length;
          const moderate = injuries.filter((j) => j.severity === "moderate").length;
          const light = injuries.filter((j) => j.severity === "light").length;
          const color = policy === "walkLane" ? "var(--series-1)" : "var(--series-2)";
          return (
            <div key={policy} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} aria-hidden />
                <h3 className="text-base font-bold">{POLICY_LABEL[policy]}</h3>
              </div>
              <p className="text-xs text-muted">{POLICY_DESC[policy]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[policy] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[320px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${POLICY_LABEL[policy]}のエスカレーターの様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label="運んだ人数" value={st ? `${st.exited} 人` : "–"} />
                <Stat label="今の行列" value={st ? `${st.queue} 人` : "–"} />
                <Stat label="最大の行列" value={st ? `${st.maxQueue} 人` : "–"} />
                <Stat label="平均所要時間" value={st ? fmtSec(st.avgTrip) : "–"} hint="到着から降り口まで" />
                <Stat label="歩きたい人の平均" value={st ? fmtSec(st.avgTripWalkers) : "–"} />
                <Stat
                  label="負傷者"
                  value={st ? `${injuries.length} 人` : "–"}
                  hint={injuries.length ? `重 ${severe} / 中 ${moderate} / 軽 ${light}` : undefined}
                  critical={injuries.length > 0}
                />
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
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.walkLane}</th>
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.standBoth}</th>
                  <th className="py-1 font-semibold">差</th>
                </tr>
              </thead>
              <tbody>
                <AggRow label="運んだ人数" a={agg.walkLane.exited} b={agg.standBoth.exited} unit="人" better="high" />
                <AggRow label="最大の行列" a={agg.walkLane.maxQueue} b={agg.standBoth.maxQueue} unit="人" better="low" />
                <AggRow label="平均待ち時間" a={agg.walkLane.avgWait} b={agg.standBoth.avgWait} unit="秒" better="low" />
                <AggRow label="平均所要時間" a={agg.walkLane.avgTrip} b={agg.standBoth.avgTrip} unit="秒" better="low" />
                <AggRow
                  label="歩きたい人の所要時間"
                  a={agg.walkLane.avgTripWalkers}
                  b={agg.standBoth.avgTripWalkers}
                  unit="秒"
                  better="low"
                />
                {params.incident && (
                  <>
                    <AggRow label="負傷者 (1 回あたり)" a={agg.walkLane.injured} b={agg.standBoth.injured} unit="人" better="low" />
                    <AggRow label="うち重傷" a={agg.walkLane.severe} b={agg.standBoth.severe} unit="人" better="low" />
                    <AggRow label="転げ落ちた距離の平均" a={agg.walkLane.avgTumble} b={agg.standBoth.avgTumble} unit="段" better="low" />
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, critical }: { label: string; value: string; hint?: string; critical?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono font-semibold ${critical ? "text-[var(--status-critical)]" : ""}`}>
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

function AggRow({
  label,
  a,
  b,
  unit,
  better,
}: {
  label: string;
  a: number;
  b: number;
  unit: string;
  better: "high" | "low";
}) {
  const diff = b - a;
  const bWins = better === "high" ? diff > 0 : diff < 0;
  const same = Math.abs(diff) < 0.05;
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 font-mono">
        {a.toFixed(1)} {unit}
      </td>
      <td className="py-1 pr-3 font-mono">
        {b.toFixed(1)} {unit}
      </td>
      <td className="py-1 font-mono text-muted">
        {same ? "ほぼ同じ" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${unit}（${bWins ? "両側立ち" : "片側空け"}が有利）`}
      </td>
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string; mark?: string }[] = [
    { color: "var(--series-1)", label: "立つ人" },
    { color: "var(--series-2)", label: "歩く人 (∧ 印)" },
    { color: "var(--series-7)", label: "酔っ払い" },
    { color: "var(--series-8)", label: "転倒中 / 倒れている (× 印)" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
