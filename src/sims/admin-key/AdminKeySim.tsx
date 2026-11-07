"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  SEGMENT_OPTIONS,
  aggregate,
  createSim,
  getStats,
  isFinished,
  segmentCount,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_IDS, getScenario, scenarios, type PolicyId } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
/** 1 秒あたりに進める時間 (h) */
type Speed = 24 | 72 | 240;

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
    reach: v("--series-4"),
    infected: v("--series-8"),
    detect: v("--series-3"),
  };
}

function fmtServers(v: number): string {
  return `${Math.round(v).toLocaleString("ja-JP")} 台`;
}

function fmtDays(v: number): string {
  return `${v.toFixed(0)} 日`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function describePolicy(p: Policy, k: number): string {
  const parts: string[] = [];
  parts.push(p.split ? `管理者の鍵を ${k} 区画に分ける (1 本で ${Math.round(100 / k)}% に届く)` : "1 本の管理者の鍵で全サーバーに届く");
  parts.push(p.mfa ? "多要素認証あり" : "パスワードだけ");
  parts.push(p.monitor ? "管理ログインを見張る" : "見張りなし (顧客の問い合わせで気づく)");
  return parts.join("、");
}

export function AdminKeySim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(72);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, PolicyId> | null>(null);
  const [segments, setSegments] = useState(10);
  const [jumpDays, setJumpDays] = useState<number | null>(null);
  const [monitorDays, setMonitorDays] = useState<number | null>(null);
  const [metric, setMetric] = useState<Metric>("infected");
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
      segments,
      jumpDays: jumpDays ?? base.jumpDays,
      monitorDays: monitorDays ?? base.monitorDays,
    };
  }, [scenario, seedOffset, segments, jumpDays, monitorDays]);

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
    setChartSeries(
      (["a", "b"] as const).map((w) => ({
        name: sims[w].policy.name,
        color: WORLD_COLOR[w],
        points: sims[w].series.slice(),
        detectedDay: sims[w].detectedAt >= 0 ? sims[w].detectedAt / 24 : null,
      })),
    );
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

  const doneOf = (st: SimStats) => st.detected || st.day >= params.horizonDays;
  const finished = stats ? doneOf(stats.a) && doneOf(stats.b) : false;
  const maxDay = stats ? Math.max(stats.a.day, stats.b.day) : 0;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  const segIdx = Math.max(0, SEGMENT_OPTIONS.indexOf(segments as (typeof SEGMENT_OPTIONS)[number]));

  return (
    <section className="space-y-4" aria-label="管理者の鍵を盗まれたときの被害の広がりのシミュレーション">
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
                setJumpDays(null);
                setMonitorDays(null);
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
            <span className="text-muted">1 秒で</span>
            {([24, 72, 240] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp / 24} 日
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            経過 {Math.floor(maxDay)} 日 / {params.horizonDays} 日
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">
                区画分けするときの区画の数 {segments} (鍵 1 本で全体の {(100 / segments).toFixed(1)}% に届く)
              </span>
              <input
                type="range"
                min={0}
                max={SEGMENT_OPTIONS.length - 1}
                step={1}
                value={segIdx}
                onChange={(e) => setSegments(SEGMENT_OPTIONS[Number(e.target.value)])}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">区画の壁の厚さ: 別の区画の鍵を盗むまで平均 {params.jumpDays} 日</span>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={params.jumpDays}
                onChange={(e) => setJumpDays(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">見張りの目: 鍵の不正利用に気づくまで平均 {params.monitorDays} 日</span>
              <input
                type="range"
                min={3}
                max={90}
                step={1}
                value={params.monitorDays}
                onChange={(e) => setMonitorDays(Number(e.target.value))}
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
              <p className="mt-1 text-xs text-muted">{describePolicy(policy, segmentCount(params, policy))}。</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[380px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の顧客サーバーの様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-xs text-muted">入り込まれてから</dt>
                <dd className="text-right font-mono font-semibold">
                  {st ? (st.detected ? `${fmtDays(st.dwellDays)}で発覚` : `${fmtDays(st.dwellDays)} 気づかず`) : "–"}
                </dd>
                <dt className="text-xs text-muted" style={{ color: "var(--series-8)" }}>
                  マルウェアを入れられた
                </dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtServers(st.infectedServers) : "–"}</dd>
                <dt className="text-xs text-muted" style={{ color: "var(--series-4)" }}>
                  鍵が届く (止めて調べる範囲)
                </dt>
                <dd className="text-right font-mono font-semibold">{st ? fmtServers(st.reachableServers) : "–"}</dd>
                <dt className="text-xs text-muted">盗まれた管理者の鍵</dt>
                <dd className="text-right font-mono font-semibold">{st ? `${st.keysStolen} / ${st.keys} 本` : "–"}</dd>
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} horizonDays={params.horizonDays} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">乱数を変えて 100 回ずつ回した平均</h3>
            <p className="text-xs text-muted">
              アニメーション 1 回だけでは、いつ鍵を盗まれ、いつ気づくかの偶然に左右されます。同じ条件で {params.horizonDays} 日を 100 回試行します。
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
                <AggRow label="マルウェアを入れられた (平均)" a={agg.a.mean.infectedServers} b={agg.b.mean.infectedServers} fmt={fmtServers} />
                <AggRow label="同 (悪いほうから 1 割の回)" a={agg.a.infectedP90} b={agg.b.infectedP90} fmt={fmtServers} />
                <AggRow label="1 台も入れられずに済んだ回" a={agg.a.zeroInfectedRate} b={agg.b.zeroInfectedRate} fmt={fmtPct} />
                <AggRow label="鍵が届く (止めて調べる範囲)" a={agg.a.mean.reachableServers} b={agg.b.mean.reachableServers} fmt={fmtServers} />
                <AggRow label={`${params.horizonDays} 日以内に気づいた回`} a={agg.a.detectedRate} b={agg.b.detectedRate} fmt={fmtPct} />
                <AggRow label="入り込まれてから気づくまで" a={agg.a.mean.dwellDays} b={agg.b.mean.dwellDays} fmt={fmtDays} />
                <AggRow label="盗まれた鍵の数" a={agg.a.mean.keysStolen} b={agg.b.mean.keysStolen} fmt={(v) => `${v.toFixed(1)} 本`} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              気づかないまま {params.horizonDays} 日を過ぎた回は {params.horizonDays} 日として数えています。その先も被害は広がり続けるので、
              気づかない回が多い方針ほど、実際の数字はこれより悪くなります。
            </p>
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
  const items: { color: string; label: string; alpha?: number }[] = [
    { color: "var(--grid)", label: "顧客サーバー (1 マス ≈ 67 台)" },
    { color: "var(--series-4)", label: "盗まれた鍵が届く (中を見られる)", alpha: 0.45 },
    { color: "var(--series-8)", label: "マルウェアを入れられた" },
    { color: "var(--foreground)", label: "太線 = 区画の境目 (鍵 1 本が届く範囲)" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: it.color, opacity: it.alpha ?? 1 }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
