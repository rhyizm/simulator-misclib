"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  averageStats,
  createSim,
  getStats,
  isFinished,
  runTrial,
  step,
  type Policy,
  type PolicyId,
  type SimParams,
  type SimState,
  type SimStats,
} from "./model";
import { POLICIES, POLICY_ORDER, getScenario, scenarios } from "./scenarios";
import { CANVAS_H, CANVAS_W, renderSim, type RenderTheme } from "./render";
import { TimeChart, type ChartSeries, type Metric } from "./TimeChart";

type World = "a" | "b";
type Speed = 120 | 360 | 900;

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
    litter: v("--coral"),
    holding: v("--amber"),
    bin: v("--series-3"),
    patrol: v("--accent"),
  };
}

function fmtHour(startHour: number, t: number): string {
  const total = startHour * 60 + Math.floor(t / 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString();
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

interface Tuning {
  patrollers: number;
  emptyEveryHours: number;
}

/** 詳細設定の見回りの人数・回収間隔を反映した対策 */
function buildPolicy(id: PolicyId, tuning: Tuning): Policy {
  const p = POLICIES[id];
  if (id === "patrol") {
    return { ...p, patrollers: tuning.patrollers, name: `見回り ${tuning.patrollers} 人 + 過料` };
  }
  if (id === "bins") {
    const h = tuning.emptyEveryHours;
    return { ...p, emptyEverySec: h * 3600, name: `ごみ箱 ${p.bins} つ (${h} 時間おきに回収)` };
  }
  return p;
}

function describePolicy(p: Policy): string {
  switch (p.id) {
    case "none":
      return "ごみ箱は置かず、見回りもしない。営業時間中は掃除しない。";
    case "patrol":
      return `${p.patrollers} 人が通りを往復する。近く (±25 m) ではほとんど捨てず、見つかれば過料。制度が知られているので、ほかの場所でも捨てる人は 4 分の 3 に。`;
    case "bins":
      return `100 m おきに 1 つ、1 つに ${p.binCapacity} 個まで。満杯だと 6 割の人は横に置いていく。`;
    case "smart":
      return `圧縮して ${p.binCapacity} 個まで入る。8 割で通知が飛び、30 分で回収に来る。`;
    case "clean":
      return "ごみ箱も見回りもなし。2 時間おきに通り全体のごみを拾う。";
  }
}

export function LitterSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [pair, setPair] = useState<Record<World, PolicyId>>({ a: scenarios[0].pair[0], b: scenarios[0].pair[1] });
  const [speed, setSpeed] = useState<Speed>(360);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [arrivalScale, setArrivalScale] = useState(1);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [dump, setDump] = useState(0);
  const [tuning, setTuning] = useState<Tuning>({ patrollers: 4, emptyEveryHours: 3 });
  const [metric, setMetric] = useState<Metric>("street");
  const [stats, setStats] = useState<Record<World, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<World, SimStats> | null>(null);
  /** 計算中なら終わった試行の数、計算していなければ null */
  const [aggDone, setAggDone] = useState<number | null>(null);
  const aggJobRef = useRef(0);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      litterMultiplier: multiplier ?? base.litterMultiplier,
      dumpPerBinHour: dump,
      arrivals: base.arrivals.map((a) => ({ ...a, perHour: Math.round(a.perHour * arrivalScale) })),
    };
  }, [scenario, seedOffset, multiplier, dump, arrivalScale]);

  const policies = useMemo<Record<World, Policy>>(
    () => ({ a: buildPolicy(pair.a, tuning), b: buildPolicy(pair.b, tuning) }),
    [pair, tuning],
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
      // 計算中の試行は条件が古くなるので捨てる
      aggJobRef.current++;
      setAggDone(null);
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

  // 重い場面では 100 回で数秒かかるので、1 回ずつ区切って画面を止めない
  const RUNS = 100;
  const runAggregate = () => {
    const job = ++aggJobRef.current;
    const results: Record<World, SimStats[]> = { a: [], b: [] };
    setAggDone(0);
    const next = (i: number) => {
      if (job !== aggJobRef.current) return;
      if (i >= RUNS) {
        setAgg({ a: averageStats(results.a), b: averageStats(results.b) });
        setAggDone(null);
        return;
      }
      results.a.push(runTrial(params, policies.a, i));
      results.b.push(runTrial(params, policies.b, i));
      setAggDone(i + 1);
      setTimeout(() => next(i + 1), 0);
    };
    setTimeout(() => next(0), 20);
  };

  const peak = Math.max(...params.arrivals.map((a) => a.perHour));

  return (
    <section className="space-y-4" aria-label="繁華街のポイ捨てのシミュレーション">
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
                setPair({ a: sc.pair[0], b: sc.pair[1] });
                setArrivalScale(1);
                setMultiplier(null);
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
            title="乱数の種を変えて、別の 1 日を試す"
          >
            別の乱数で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
            {([120, 360, 900] as const).map((sp) => (
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
            {fmtHour(params.startHour, stats ? stats.a.t : 0)} / {fmtHour(params.startHour, params.durationSec)} まで
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                人出 ×{arrivalScale.toFixed(1)}（ピーク時 1 時間に {peak.toLocaleString()} 人がごみを出す）
              </span>
              <input
                type="range"
                min={0.3}
                max={1.5}
                step={0.1}
                value={arrivalScale}
                onChange={(e) => setArrivalScale(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                散らかった道で捨てやすくなる倍率 ×{params.litterMultiplier.toFixed(1)}（1 なら「ごみがごみを呼ぶ」効果なし）
              </span>
              <input
                type="range"
                min={1}
                max={5}
                step={0.5}
                value={params.litterMultiplier}
                onChange={(e) => setMultiplier(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">見回りの人数 {tuning.patrollers} 人（400 m あたり）</span>
              <input
                type="range"
                min={1}
                max={8}
                step={1}
                value={tuning.patrollers}
                onChange={(e) => setTuning((t) => ({ ...t, patrollers: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">ふつうのごみ箱の回収間隔 {tuning.emptyEveryHours} 時間</span>
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={tuning.emptyEveryHours}
                onChange={(e) => setTuning((t) => ({ ...t, emptyEveryHours: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-muted">
                家庭ごみなどの持ち込み: ごみ箱 1 つあたり 1 時間に {dump} 個
              </span>
              <input
                type="range"
                min={0}
                max={30}
                step={2}
                value={dump}
                onChange={(e) => setDump(Number(e.target.value))}
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
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: WORLD_COLOR[w] }} aria-hidden />
                <label className="sr-only" htmlFor={`policy-${w}`}>
                  {w === "a" ? "左" : "右"}の世界の対策
                </label>
                <select
                  id={`policy-${w}`}
                  value={pair[w]}
                  onChange={(e) => {
                    setPair((p) => ({ ...p, [w]: e.target.value as PolicyId }));
                    setPlaying(true);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm font-bold"
                >
                  {POLICY_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {buildPolicy(id, tuning).name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted md:min-h-[2.5rem]">{describePolicy(policy)}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[w] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[360px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${policy.name}の世界の通りの様子`}
              />
              <dl className="mt-3 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2">
                <Stat label="ごみを出した人" value={st ? `${fmtInt(st.produced)} 人` : "–"} />
                <Stat label="うち道に捨てた" value={st ? fmtPct(st.litterRate) : "–"} strong />
                <Stat label="ポイ捨ての累計" value={st ? `${fmtInt(st.littered)} 個` : "–"} />
                <Stat label="うちごみ箱からあふれた" value={st ? `${fmtInt(st.overflowed)} 個` : "–"} />
                <Stat label="ごみ箱に入った" value={st ? `${fmtInt(st.binned)} 個` : "–"} />
                <Stat label="過料を取られた人" value={st ? `${fmtInt(st.fined)} 人` : "–"} />
                <Stat label="いま道にあるごみ" value={st ? `${fmtInt(st.street)} 個` : "–"} strong />
                <Stat label="かかった手間" value={st ? `${st.laborHours.toFixed(1)} 人・時間` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart
          series={chartSeries}
          durationSec={params.durationSec}
          startHour={params.startHour}
          metric={metric}
          onMetricChange={setMetric}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">乱数を変えて 100 日ずつ回した平均</h3>
            <p className="text-xs text-muted">
              アニメーション 1 回だけでは偶然に左右されるので、同じ条件で 100 回試行して平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggDone !== null}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggDone !== null ? `計算中… ${aggDone} / ${RUNS}` : agg ? "もう一度計算" : "100 回試行する"}
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
                <AggRow label="道に捨てた人の割合" a={agg.a.litterRate} b={agg.b.litterRate} fmt={fmtPct} />
                <AggRow label="ポイ捨ての累計" a={agg.a.littered} b={agg.b.littered} fmt={(v) => `${fmtInt(v)} 個`} />
                <AggRow label="うちごみ箱からあふれた" a={agg.a.overflowed} b={agg.b.overflowed} fmt={(v) => `${fmtInt(v)} 個`} />
                <AggRow label="終わりに道にあるごみ" a={agg.a.street} b={agg.b.street} fmt={(v) => `${fmtInt(v)} 個`} />
                <AggRow label="道のごみが最も多いとき" a={agg.a.maxStreet} b={agg.b.maxStreet} fmt={(v) => `${fmtInt(v)} 個`} />
                <AggRow label="過料を取られた人" a={agg.a.fined} b={agg.b.fined} fmt={(v) => `${v.toFixed(1)} 人`} />
                <AggRow label="かかった手間" a={agg.a.laborHours} b={agg.b.laborHours} fmt={(v) => `${v.toFixed(1)} 人・時間`} />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-border py-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono ${strong ? "font-semibold" : ""}`}>{value}</dd>
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
  const items: { color: string; label: string; shape: string }[] = [
    { color: "var(--foreground)", label: "飲み食いしながら歩く人", shape: "rounded-full opacity-60" },
    { color: "var(--amber)", label: "ごみを手に持っている人", shape: "rounded-full" },
    { color: "var(--coral)", label: "道に落ちているごみ (多い区画は塗りつぶし)", shape: "rounded-sm" },
    { color: "var(--series-3)", label: "ごみ箱 (中の量。満杯で赤)", shape: "rounded-sm" },
    { color: "var(--accent)", label: "見回りの人とそのまわり ±25 m", shape: "rotate-45" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 ${it.shape}`} style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
