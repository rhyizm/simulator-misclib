"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  LONG_H,
  aggregate,
  createSim,
  fmtClock,
  fmtDuration,
  getStats,
  isFinished,
  step,
  type AggregateStats,
  type Policy,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, getPolicy, getPolicyNote, getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
/** 1 秒あたりに進む時間 (時間) */
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
    lit: v("--amber"),
    fault: v("--series-8"),
    tree: v("--series-3"),
    crew: v("--series-1"),
    road: v("--series-7"),
    gen: v("--series-2"),
  };
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function SnowOutageSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [policyIds, setPolicyIds] = useState<Record<World, string>>({ a: "now", b: "crews" });
  const [crews, setCrews] = useState(6);
  const [nightWork, setNightWork] = useState(false);
  const [severity, setSeverity] = useState(1);
  const [metric, setMetric] = useState<Metric>("out");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(
    () => ({
      ...scenario.params,
      seed: scenario.params.seed + seedOffset,
      severity,
      workFromHour: nightWork ? 0 : scenario.params.workFromHour,
      workToHour: nightWork ? 24 : scenario.params.workToHour,
    }),
    [scenario, seedOffset, severity, nightWork],
  );
  const policies = useMemo<Record<World, Policy>>(
    () => ({
      a: { ...getPolicy(policyIds.a), crews },
      b: { ...getPolicy(policyIds.b), crews },
    }),
    [policyIds, crews],
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
      while (accRef.current >= DT && n < 500) {
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

  const finished = stats ? stats.a.t >= params.durationH - 1e-6 : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({ a: aggregate(params, policies.a, runs), b: aggregate(params, policies.b, runs) });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="大雪の停電と復旧のシミュレーション">
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
            title="乱数の種を変えて、別の木が倒れる雪を試す"
          >
            別の雪で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">1 秒で</span>
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
                {sp} 時間
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            {fmtClock(stats ? stats.a.t : 0)} / {fmtClock(params.durationH)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">地元の作業班: {crews} 班 (両方の世界)</span>
              <input type="range" min={3} max={12} step={1} value={crews} onChange={(e) => setCrews(Number(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">雪の重さ ×{severity.toFixed(1)} (倒れる木の数)</span>
              <input
                type="range"
                min={0.6}
                max={1.4}
                step={0.1}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-2 self-end">
              <input type="checkbox" checked={nightWork} onChange={(e) => setNightWork(e.target.checked)} />
              <span className="text-xs text-muted">山の中でも夜通し作業できるとしたら</span>
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((w) => {
          const st = stats?.[w];
          const pid = policyIds[w];
          return (
            <div key={w} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <h3 className="text-base font-bold">
                  {w === "a" ? "左" : "右"}: {policies[w].name}
                </h3>
              </div>
              <div className="mt-2 flex flex-wrap gap-1 text-xs" role="group" aria-label="対策">
                {POLICIES.map(({ policy }) => (
                  <button
                    key={policy.id}
                    type="button"
                    aria-pressed={pid === policy.id}
                    onClick={() => {
                      setPolicyIds((cur) => ({ ...cur, [w]: policy.id }));
                      setPlaying(true);
                    }}
                    className={`rounded-md border px-2 py-1 ${
                      pid === policy.id ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                    }`}
                  >
                    {policy.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">{getPolicyNote(pid)}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[460px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policies[w].name}の世界の配電線の地図。集落ごとの停電と、倒木、作業班の位置`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <Stat label="いま停電している家" value={st ? `${st.out.toLocaleString()} 戸` : "–"} />
                <Stat label="いちばん多いとき" value={st ? `${st.peakOut.toLocaleString()} 戸` : "–"} />
                <Stat label="停電の合計" value={st ? `${Math.round(st.homeHours).toLocaleString()} 戸・時間` : "–"} />
                <Stat label="いちばん長い停電" value={st ? fmtDuration(st.longestH) : "–"} />
                <Stat label="停電が 1 日を超えた家" value={st ? `${st.over24.toLocaleString()} 戸` : "–"} />
                <Stat label={`停電が ${LONG_H / 24} 日を超えた家`} value={st ? `${st.over72.toLocaleString()} 戸` : "–"} />
                <Stat label="倒れた木 (電線 / 道)" value={st ? `${st.lines} / ${st.roads} か所` : "–"} />
                <Stat
                  label="作業班の時間 (道 / 修理 / 移動)"
                  value={st ? `${pct(st.roadShare)} / ${pct(st.repairShare)} / ${pct(st.moveShare)}` : "–"}
                />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          durationH={params.durationH}
          metric={metric}
          onMetricChange={setMetric}
          nightBand={!nightWork}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別の雪を 100 回降らせた平均</h3>
            <p className="text-xs text-muted">
              どの木がいつ倒れるかは雪ごとに違います。同じ条件で 100 回試して平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 回試す"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  <th className="py-1 pr-3 font-semibold">左: {policies.a.name}</th>
                  <th className="py-1 font-semibold">右: {policies.b.name}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="いちばん多いときの停電" a={agg.a.peakOut} b={agg.b.peakOut} fmt={(v) => `${v.toFixed(0)} 戸`} />
                <AggRow label="停電の合計" a={agg.a.homeHours} b={agg.b.homeHours} fmt={(v) => `${(v / 1000).toFixed(1)} 千戸・時間`} />
                <AggRow label="停電が 1 日を超えた家" a={agg.a.over24} b={agg.b.over24} fmt={(v) => `${v.toFixed(0)} 戸`} />
                <AggRow label="停電が 3 日を超えた家" a={agg.a.over72} b={agg.b.over72} fmt={(v) => `${v.toFixed(0)} 戸`} />
                <AggRow label="いちばん長い停電" a={agg.a.longestH} b={agg.b.longestH} fmt={fmtDuration} />
                <AggRow
                  label="最後の家に電気が戻るまで"
                  a={agg.a.lastRestoreH}
                  b={agg.b.lastRestoreH}
                  fmt={(v) => (v < 0 ? "–" : fmtDuration(v))}
                />
                <AggRow label="7 日で戻りきらなかった回" a={agg.a.unfinishedShare} b={agg.b.unfinishedShare} fmt={pct} />
                <AggRow label="電線が切れた所" a={agg.a.lines} b={agg.b.lines} fmt={(v) => `${v.toFixed(1)} か所`} />
                <AggRow label="道をふさいだ倒木" a={agg.a.roads} b={agg.b.roads} fmt={(v) => `${v.toFixed(1)} か所`} />
                <AggRow label="作業班が道を片づけていた割合" a={agg.a.roadShare} b={agg.b.roadShare} fmt={pct} />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              「停電の合計」は停電していた家の数 × 時間。「最後の家に電気が戻るまで」は降り始め (11/20 12:00) からの時間で、
              7 日のうちに戻りきらなかった回を除いた平均です。電源車で電気を送っている家は停電に数えません。
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
  const items: { color: string; label: string; shape?: "circle" | "diamond" }[] = [
    { color: "var(--amber)", label: "集落 (電気が来ている。丸の大きさ = 家の数)", shape: "circle" },
    { color: "var(--muted)", label: "点線 = 電気が来ていない線" },
    { color: "var(--series-8)", label: "× 切れた電線" },
    { color: "var(--series-3)", label: "▲ 道をふさぐ倒木" },
    { color: "var(--series-1)", label: "作業班" },
    { color: "var(--series-7)", label: "道の倒木を片づける部隊", shape: "diamond" },
    { color: "var(--series-2)", label: "電源車 (送っている集落は輪で囲む)", shape: "circle" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-3 ${it.shape === "circle" ? "rounded-full" : "rounded-sm"} ${it.shape === "diamond" ? "rotate-45 scale-75" : ""}`}
            style={{ background: it.color }}
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
