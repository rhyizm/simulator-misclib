"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DT,
  QUICK_MIN,
  aggregate,
  clock,
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

/** 実時間 1 秒あたりに進むシミュレーション上の分数 */
type Speed = 10 | 30 | 90;

const POLICIES = ["noLimit", "cap"] as const;

const POLICY_LABEL: Record<Policy, string> = {
  noLimit: "納得するまで切らない",
  cap: "上限の時間で切る",
};

const POLICY_COLOR: Record<Policy, string> = {
  noLimit: "var(--series-2)",
  cap: "var(--series-7)",
};

type Override = Partial<
  Pick<SimParams, "calls" | "operators" | "harassRatio" | "capMin" | "callbackProb" | "recoverMin">
>;

function readTheme(el: HTMLElement): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    ok: v("--series-1"),
    warn: v("--amber"),
    crit: v("--status-critical"),
    work: v("--series-3"),
  };
}

function fmtMin(m: number): string {
  if (!Number.isFinite(m)) return "–";
  if (m < 10) return `${m.toFixed(1)} 分`;
  return `${Math.round(m)} 分`;
}

function fmtPct(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export function KasuharaCallSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(30);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [override, setOverride] = useState<Override>({});
  const [metric, setMetric] = useState<"waiting" | "abandoned">("abandoned");
  const [stats, setStats] = useState<(Record<Policy, SimStats> & { finished: boolean }) | null>(null);
  const [chartSeries, setChartSeries] = useState<ChartSeries[]>([]);
  const [agg, setAgg] = useState<Record<Policy, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(
    () => ({ ...scenario.params, ...override, seed: scenario.params.seed + seedOffset }),
    [scenario, override, seedOffset],
  );

  const policyDesc: Record<Policy, string> = {
    noLimit: "相手が納得して切るまで付き合う。終わったら 1 人で席を離れて落ち着く",
    cap: `${params.capMin} 分で方針を伝えて切り、記録して上長に引き継ぐ。${fmtPct(params.callbackProb)}は掛け直してくる`,
  };

  const simsRef = useRef<Record<Policy, SimState> | null>(null);
  const canvasRefs = useRef<Record<Policy, HTMLCanvasElement | null>>({ noLimit: null, cap: null });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const speedRef = useRef(speed);
  const themeRef = useRef<RenderTheme | null>(null);

  const draw = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    for (const policy of POLICIES) {
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
      renderSim(ctx, sims[policy], themeRef.current);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({
      noLimit: getStats(sims.noLimit),
      cap: getStats(sims.cap),
      finished: isFinished(sims.noLimit) && isFinished(sims.cap),
    });
    setChartSeries(
      POLICIES.map((policy) => ({
        name: POLICY_LABEL[policy],
        color: POLICY_COLOR[policy],
        points: sims[policy].series.slice(),
      })),
    );
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = {
      noLimit: createSim(params, "noLimit"),
      cap: createSim(params, "cap"),
    };
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
      accRef.current += real * speedRef.current;
      let n = 0;
      while (accRef.current >= DT && n < 400) {
        step(sims.noLimit, DT);
        step(sims.cap, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 120) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.noLimit) && isFinished(sims.cap)) {
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

  const finished = stats?.finished ?? false;
  const nowT = stats ? Math.max(stats.noLimit.t, stats.cap.t) : 0;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({
        noLimit: aggregate(params, "noLimit", runs),
        cap: aggregate(params, "cap", runs),
      });
      setAggBusy(false);
    }, 20);
  };

  const setParam = (key: keyof Override, value: number) => setOverride((o) => ({ ...o, [key]: value }));

  return (
    <section className="space-y-4" aria-label="カスハラ電話とコールセンターのシミュレーション">
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
                setOverride({});
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
            別の日で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">1 秒 =</span>
            {([10, 30, 90] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                aria-pressed={speed === sp}
                onClick={() => setSpeed(sp)}
                className={`rounded-md border px-2 py-1 ${
                  speed === sp ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {sp} 分
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 font-mono text-xs text-muted">
          時刻 {clock(nowT)} / 受付は {clock(params.closeAt)} まで
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Slider
              label={`右の世界で切る上限 ${params.capMin} 分`}
              min={10}
              max={90}
              step={5}
              value={params.capMin}
              onChange={(v) => setParam("capMin", v)}
            />
            <Slider
              label={`切られたあと掛け直してくる確率 ${fmtPct(params.callbackProb)}`}
              min={0}
              max={1}
              step={0.05}
              value={params.callbackProb}
              onChange={(v) => setParam("callbackProb", v)}
            />
            <Slider
              label={`カスハラの電話の割合 ${(params.harassRatio * 100).toFixed(1)}%`}
              min={0}
              max={0.06}
              step={0.005}
              value={params.harassRatio}
              onChange={(v) => setParam("harassRatio", v)}
            />
            <Slider
              label={`オペレーターの人数 ${params.operators} 人`}
              min={2}
              max={12}
              step={1}
              value={params.operators}
              onChange={(v) => setParam("operators", v)}
            />
            <Slider
              label={`1 日の電話の本数 ${params.calls} 本`}
              min={60}
              max={600}
              step={10}
              value={params.calls}
              onChange={(v) => setParam("calls", v)}
            />
            <Slider
              label={`カスハラ対応のあとの休憩 ${params.recoverMin} 分`}
              min={0}
              max={30}
              step={5}
              value={params.recoverMin}
              onChange={(v) => setParam("recoverMin", v)}
            />
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4 md:grid-cols-2">
        {POLICIES.map((policy) => {
          const st = stats?.[policy];
          return (
            <div key={policy} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: POLICY_COLOR[policy] }} aria-hidden />
                <h3 className="text-base font-bold">{POLICY_LABEL[policy]}</h3>
              </div>
              <p className="text-xs text-muted">{policyDesc[policy]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[policy] = el;
                }}
                className="mx-auto mt-2 block h-auto w-full max-w-[360px]"
                style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
                role="img"
                aria-label={`${POLICY_LABEL[policy]}窓口の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Stat label="あきらめた客" value={st ? fmtPct(st.abandonRate) : "–"} hint={st ? `${st.abandoned} 人` : undefined} />
                <Stat label={`${QUICK_MIN} 分以内に応答`} value={st ? fmtPct(st.within3) : "–"} />
                <Stat label="平均の保留" value={st ? fmtMin(st.avgWait) : "–"} />
                <Stat label="カスハラ電話" value={st ? `${st.harassCalls} 本` : "–"} hint="掛け直し含む" />
                <Stat label="カスハラ対応" value={st ? fmtMin(st.harassMin) : "–"} hint={st ? fmtPct(st.harassShare) : undefined} />
                <Stat label="早退" value={st ? `${st.leftOps} 人` : "–"} />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <TimeChart series={chartSeries} durationMin={params.durationMin} metric={metric} onMetricChange={setMetric} />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">別の日を 100 日ずつ回した平均</h3>
            <p className="text-xs text-muted">
              カスハラの電話は 1 日に数本しかないので、1 日だけでは偶然に大きく左右されます。かかってくる電話を変えた 100 日の平均を取ります。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "100 日試行する"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.noLimit}</th>
                  <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.cap}</th>
                  <th className="py-1 font-semibold">差</th>
                </tr>
              </thead>
              <tbody>
                <AggRow label="待ちきれずに切った客" a={agg.noLimit.abandonRate * 100} b={agg.cap.abandonRate * 100} unit="%" />
                <AggRow
                  label={`${QUICK_MIN} 分以内に応答できた客`}
                  a={agg.noLimit.within3 * 100}
                  b={agg.cap.within3 * 100}
                  unit="%"
                  higherIsBetter
                />
                <AggRow label="平均の保留" a={agg.noLimit.avgWait} b={agg.cap.avgWait} unit="分" digits={2} />
                <AggRow label="カスハラの電話 (掛け直し含む)" a={agg.noLimit.harassCalls} b={agg.cap.harassCalls} unit="本" />
                <AggRow label="カスハラ対応に使った時間" a={agg.noLimit.harassMin} b={agg.cap.harassMin} unit="分" />
                <AggRow label="誰かが早退した日" a={agg.noLimit.leftDays * 100} b={agg.cap.leftDays * 100} unit="%" />
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              「カスハラ対応に使った時間」は通話のあとに席を離れて落ち着く時間を含みます。「早退」は、その日のうちにカスハラ対応の負担が限界を超え、電話に出られなくなった人です。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-mono font-semibold">
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
  digits = 1,
  higherIsBetter = false,
}: {
  label: string;
  a: number;
  b: number;
  unit: string;
  digits?: number;
  /** 大きいほうが良い指標 (省略時は小さいほうが良い) */
  higherIsBetter?: boolean;
}) {
  const show = (v: number) => `${v.toFixed(digits)} ${unit}`;
  const diff = b - a;
  const same = Math.abs(diff) < 0.5 * 10 ** -digits;
  const capWins = higherIsBetter ? diff > 0 : diff < 0;
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 pr-3 font-mono">{show(a)}</td>
      <td className="py-1 pr-3 font-mono">{show(b)}</td>
      <td className="py-1 font-mono text-muted">
        {same
          ? "ほぼ同じ"
          : `${diff > 0 ? "+" : ""}${diff.toFixed(digits)} ${unit}（${capWins ? "切る" : "切らない"}ほうが有利）`}
      </td>
    </tr>
  );
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "var(--series-1)", label: `保留 ${QUICK_MIN} 分以内` },
    { color: "var(--amber)", label: "あきらめはじめる頃" },
    { color: "var(--status-critical)", label: "長く待っている / カスハラ対応中" },
    { color: "var(--series-3)", label: "普通の通話の進み具合" },
  ];
  return (
    <div className="space-y-1 text-xs text-muted">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="凡例">
        {items.map((it) => (
          <li key={it.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: it.color }} aria-hidden />
            {it.label}
          </li>
        ))}
      </ul>
      <p>
        保留中の丸は普通の客、縁取りの三角はカスハラの電話。席の赤いバーは 2 時間を全幅としたカスハラ対応の長さで、縦線が打ち切りの上限。
        その下の細いバーは、その人にたまった負担 (いっぱいになると、その電話のあとで早退)。
      </p>
    </div>
  );
}
