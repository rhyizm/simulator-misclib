"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  POLICIES,
  POLICY_IDS,
  aggregate,
  createSim,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type PolicyId,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
type Speed = 3 | 8 | 20;

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
    water: v("--series-1"),
    accent: v("--accent"),
    warn: v("--amber"),
    danger: v("--status-critical"),
  };
}

function fmtClock(t: number): string {
  const h = Math.floor(t / 60);
  const m = Math.floor(t % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtCm(m: number): string {
  return `${(m * 100).toFixed(0)} cm`;
}

function fmtMin(m: number): string {
  if (m < 0) return "達しない";
  if (m < 60) return `${m.toFixed(0)} 分`;
  return `${Math.floor(m / 60)} 時間 ${String(Math.round(m % 60)).padStart(2, "0")} 分`;
}

function describePolicy(p: Policy): string {
  const parts = [`下水道 ${p.capacityMm} mm/h`];
  parts.push(p.tankM3 > 0 ? `貯留槽 ${(p.tankM3 / 10000).toFixed(0)} 万 m³` : "貯留槽なし");
  parts.push(p.runoffCoef < 0.8 ? `流れ込む雨 ${Math.round(p.runoffCoef * 100)}%` : "流れ込む雨 80%");
  parts.push(p.closure === "auto" ? "センサーで即通行止め + カーナビ警告" : "通行止めは職員が現地へ (40 分)");
  return parts.join("・");
}

export function UrbanFloodSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [policyIds, setPolicyIds] = useState<Record<string, Record<World, PolicyId>>>({});
  const [speed, setSpeed] = useState<Speed>(8);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [rainScale, setRainScale] = useState(1);
  const [compliance, setCompliance] = useState(0.4);
  const [metric, setMetric] = useState<Metric>("hollow");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const ids: Record<World, PolicyId> = policyIds[scenarioId] ?? {
    a: scenario.policies[0],
    b: scenario.policies[1],
  };
  const policies = useMemo<Record<World, Policy>>(
    () => ({ a: POLICIES[ids.a], b: POLICIES[ids.b] }),
    [ids.a, ids.b],
  );
  const params = useMemo<SimParams>(
    () => ({
      ...scenario.params,
      seed: scenario.params.seed + seedOffset,
      rainScale,
      warningCompliance: compliance,
    }),
    [scenario, seedOffset, rainScale, compliance],
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

  useEffect(() => {
    reset();
    const id = requestAnimationFrame(() => {
      setAgg(null);
      publish();
    });
    return () => cancelAnimationFrame(id);
  }, [reset, publish]);

  useEffect(() => {
    if (autoStarted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => {
      setAutoStarted(true);
      if (!reduced) setPlaying(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStarted]);

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
      while (accRef.current >= 1 && n < 200) {
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

  const finished = stats ? stats.a.t >= params.durationMin : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  const guide =
    metric === "rain"
      ? { value: Math.min(policies.a.capacityMm, policies.b.capacityMm), label: "下水道の能力 (左右で低いほう)" }
      : metric === "under"
        ? { value: 30, label: "車が止まる 30 cm" }
        : undefined;

  return (
    <section className="space-y-4" aria-label="都市型水害のシミュレーション">
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
            title="乱数の種を変えて、別の雨・別の車の流れを試す"
          >
            別の乱数で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([3, 8, 20] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                1 秒で {sp} 分
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            経過 {stats ? fmtClock(stats.a.t) : "0:00"} / {fmtClock(params.durationMin)}　降った雨{" "}
            {stats ? stats.a.rainTotal.toFixed(0) : 0} mm
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">雨の強さ ×{rainScale.toFixed(1)}</span>
              <input
                type="range"
                min={0.6}
                max={1.5}
                step={0.1}
                value={rainScale}
                onChange={(e) => setRainScale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                カーナビの警告で迂回する人 {Math.round(compliance * 100)}%（警告がある世界だけ）
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={compliance}
                onChange={(e) => setCompliance(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const policy = policies[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <label className="sr-only" htmlFor={`flood-policy-${w}`}>
                  {w === "a" ? "左" : "右"}の世界の対策
                </label>
                <select
                  id={`flood-policy-${w}`}
                  value={ids[w]}
                  onChange={(e) => {
                    setPolicyIds({ ...policyIds, [scenarioId]: { ...ids, [w]: e.target.value as PolicyId } });
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
              <p className="mt-1 text-xs text-muted">{describePolicy(policy)}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[400px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の町の断面。左に住宅街のくぼ地と下水道、右にアンダーパス`}
              />
              <table className="mt-3 w-full text-sm">
                <tbody className="font-mono">
                  <StatRow label="床上浸水 (累計)" value={st ? `${st.aboveFloor} 戸` : "–"} />
                  <StatRow label="床下浸水 (累計)" value={st ? `${st.belowFloor} 戸` : "–"} />
                  <StatRow label="くぼ地の最大水深" value={st ? fmtCm(st.maxHollow) : "–"} />
                  <StatRow
                    label="下水道からあふれた水"
                    value={st ? `${Math.round(st.overflowM3).toLocaleString()} m³` : "–"}
                  />
                  <StatRow label="アンダーパスの最大水深" value={st ? fmtCm(st.maxUnder) : "–"} />
                  <StatRow label="水の中で止まった車" value={st ? `${st.stalled} 台` : "–"} />
                  <StatRow label="車に閉じ込められた人" value={st ? `${st.trapped} 人` : "–"} strong />
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          durationMin={params.durationMin}
          metric={metric}
          onMetricChange={setMetric}
          guide={guide}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">雨と車の流れを変えて 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              強い雨の強さと時刻を毎回少しずつ変えます。左右の世界にはいつも同じ雨と同じ車が来ます。
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
                  <th className="py-1 pr-3 font-semibold">{policies.a.name}</th>
                  <th className="py-1 font-semibold">{policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="床上浸水" a={agg.a.aboveFloor} b={agg.b.aboveFloor} fmt={(v) => `${v.toFixed(0)} 戸`} />
                <AggRow label="床下浸水" a={agg.a.belowFloor} b={agg.b.belowFloor} fmt={(v) => `${v.toFixed(0)} 戸`} />
                <AggRow label="くぼ地の最大水深" a={agg.a.maxHollow} b={agg.b.maxHollow} fmt={fmtCm} />
                <AggRow label="くぼ地が水につかっていた時間" a={agg.a.floodMinutes} b={agg.b.floodMinutes} fmt={fmtMin} />
                <AggRow
                  label="下水道からあふれた水"
                  a={agg.a.overflowM3}
                  b={agg.b.overflowM3}
                  fmt={(v) => `${Math.round(v).toLocaleString()} m³`}
                />
                <AggRow
                  label="貯留槽が最も埋まったとき"
                  a={agg.a.tankFill}
                  b={agg.b.tankFill}
                  fmt={(v) => (v > 0 ? `${Math.round(v * 100)}%` : "–")}
                />
                <AggRow label="アンダーパスの最大水深" a={agg.a.maxUnder} b={agg.b.maxUnder} fmt={fmtCm} />
                <AggRow
                  label="降り始めから 30 cm まで"
                  a={agg.a.minutesTo30}
                  b={agg.b.minutesTo30}
                  fmt={fmtMin}
                />
                <AggRow label="水の中で止まった車" a={agg.a.stalled} b={agg.b.stalled} fmt={(v) => `${v.toFixed(1)} 台`} />
                <AggRow label="車に閉じ込められた人" a={agg.a.trapped} b={agg.b.trapped} fmt={(v) => `${v.toFixed(2)} 人`} />
                <AggRow
                  label="閉じ込めが 1 人でも出た回"
                  a={agg.a.anyTrappedRate}
                  b={agg.b.anyTrappedRate}
                  fmt={(v) => `${Math.round(v * 100)}%`}
                />
                <AggRow label="迂回した車" a={agg.a.detoured} b={agg.b.detoured} fmt={(v) => `${v.toFixed(0)} 台`} />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function StatRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className="border-t border-border">
      <td className="py-0.5 pr-2 font-sans text-xs text-muted">{label}</td>
      <td className={`py-0.5 text-right ${strong ? "font-bold" : "font-semibold"}`}>{value}</td>
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
  const items: { color: string; label: string }[] = [
    { color: "var(--series-1)", label: "水" },
    { color: "var(--amber)", label: "床下浸水の家 / 人が乗ったまま止まった車" },
    { color: "var(--status-critical)", label: "床上浸水の家 / 閉じ込められた人がいる車 / 通行止め" },
    { color: "var(--muted)", label: "人が降りた車。点線 = 車が止まる 30 cm" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
