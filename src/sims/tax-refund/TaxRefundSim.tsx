"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  aggregate,
  createSim,
  expectedRedShare,
  getStats,
  inspectorsFor,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries } from "./TimeChart";

type World = "a" | "b";
type Speed = 60 | 180 | 480;

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
    wait: v("--series-1"),
    urgent: v("--series-4"),
    red: v("--series-8"),
    done: v("--series-3"),
  };
}

function fmtWait(s: number): string {
  if (!Number.isFinite(s)) return "–";
  if (s < 60) return `${s.toFixed(0)} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, "0")} 秒`;
}

function fmtMin(s: number): string {
  return `${(s / 60).toFixed(1)} 分`;
}

function fmtClock(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtYen(v: number): string {
  return `${(v / 10000).toFixed(1)} 万円`;
}

function describePolicy(p: Policy, params: SimParams): string {
  const parts: string[] = [];
  if (p.targeted) parts.push(`購入額 10 万円以上は全員、ほかは 2% を検査 (計 ${Math.round(expectedRedShare(p) * 100)}% 前後)`);
  else parts.push(`端末が無作為に ${Math.round(p.redRate * 100)}% を赤判定`);
  if (p.onlineShare > 0) parts.push(`${Math.round(p.onlineShare * 100)}% は端末に並ばない`);
  parts.push(`検査員 ${inspectorsFor(params, p)} 人`);
  return parts.join("、");
}

export function TaxRefundSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(180);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [inspectors, setInspectors] = useState<number | null>(null);
  const [kiosks, setKiosks] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [metric, setMetric] = useState<"kiosk" | "inspect">("inspect");
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
      arrivalsPerHour: Math.round(base.arrivalsPerHour * scale),
      inspectors: inspectors ?? base.inspectors,
      kiosks: kiosks ?? base.kiosks,
    };
  }, [scenario, seedOffset, scale, inspectors, kiosks]);

  const ids = policyIds ?? { a: scenario.policies[0], b: scenario.policies[1] };
  const policies = useMemo<Record<World, Policy>>(
    () => ({ a: POLICIES[ids.a], b: POLICIES[ids.b] }),
    [ids.a, ids.b],
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
      while (accRef.current >= DT && n < 600) {
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
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="免税のリファンド方式の空港の手続きのシミュレーション">
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
                setScale(1);
                setInspectors(null);
                setKiosks(null);
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
            {([60, 180, 480] as const).map((sp) => (
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
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">税関の検査員 {params.inspectors} 人 (方針で足す分は別)</span>
              <input
                type="range"
                min={2}
                max={14}
                step={1}
                value={params.inspectors}
                onChange={(e) => setInspectors(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">端末 {params.kiosks} 台</span>
              <input
                type="range"
                min={8}
                max={40}
                step={2}
                value={params.kiosks}
                onChange={(e) => setKiosks(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                免税で出国する人 ×{scale.toFixed(1)}（1 時間 {params.arrivalsPerHour} 人）
              </span>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.1}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
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
                className="mx-auto mt-2 block h-auto w-full max-w-[380px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の端末と検査台の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                <dt className="text-xs text-muted">端末の前の平均待ち</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtWait(st.avgKioskWait) : "–"}</dd>
                <dt className="text-xs text-muted">検査の前の平均待ち (赤判定の人)</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtWait(st.avgInspectWait) : "–"}</dd>
                <dt className="text-xs text-muted">赤判定になった人</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtPct(st.redShare) : "–"}</dd>
                <dt className="text-xs text-muted">返金をあきらめて搭乗した人</dt>
                <dd className="text-right font-mono font-semibold" style={{ color: st && st.gaveUp > 0 ? "var(--series-4)" : undefined }}>
                  {st ? `${st.gaveUp} 人` : "–"}
                </dd>
                <dt className="text-xs text-muted">戻らなかった消費税</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtYen(st.lostRefund) : "–"}</dd>
                <dt className="text-xs text-muted">検査で確かめた購入額の割合</dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtPct(st.inspectedValueShare) : "–"}</dd>
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
              アニメーション 1 回だけでは偶然に左右されるので、同じ条件で 4 時間を 100 回試行して平均を取ります。
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
                <AggRow label="端末の前の平均待ち" a={agg.a.stats.avgKioskWait} b={agg.b.stats.avgKioskWait} fmt={fmtWait} />
                <AggRow label="検査の前の平均待ち" a={agg.a.stats.avgInspectWait} b={agg.b.stats.avgInspectWait} fmt={fmtWait} />
                <AggRow label="赤判定の人が終わるまで" a={agg.a.stats.avgRedTotal} b={agg.b.stats.avgRedTotal} fmt={fmtMin} />
                <AggRow label="検査の列の最長" a={agg.a.stats.maxInspectQueue} b={agg.b.stats.maxInspectQueue} fmt={(v) => `${v.toFixed(0)} 人`} />
                <AggRow label="赤判定の割合" a={agg.a.stats.redShare} b={agg.b.stats.redShare} fmt={fmtPct} />
                <AggRow label="返金をあきらめた人 (4 時間)" a={agg.a.stats.gaveUp} b={agg.b.stats.gaveUp} fmt={(v) => `${v.toFixed(1)} 人`} />
                <AggRow label="戻らなかった消費税" a={agg.a.stats.lostRefund} b={agg.b.stats.lostRefund} fmt={fmtYen} />
                <AggRow
                  label="検査で確かめた購入額の割合"
                  a={agg.a.stats.inspectedValueShare}
                  b={agg.b.stats.inspectedValueShare}
                  fmt={fmtPct}
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
    { color: "var(--series-1)", label: "端末を待つ人", shape: "rounded-full" },
    { color: "var(--series-8)", label: "赤判定で検査を待つ人 / 検査台", shape: "rounded-full" },
    { color: "var(--series-4)", label: "チェックインの締め切りまで 10 分を切った人", shape: "rounded-full" },
    { color: "var(--muted)", label: "四角 = 端末・検査台 (下から塗られていくのが進み具合)", shape: "rounded-sm" },
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
