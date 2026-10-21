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
import { EncounterChart, type EncounterSeries } from "./EncounterChart";

type Speed = 1 | 3 | 10;

const POLICIES: Policy[] = ["limit60", "limit30"];

const POLICY_LABEL: Record<Policy, string> = {
  limit60: "上限 60 km/h",
  limit30: "上限 30 km/h",
};

const POLICY_DESC: Record<Policy, string> = {
  limit60: "2026 年 8 月まで。中央線のない道でも、標識がなければ法定速度は 60 km/h",
  limit30: "2026 年 9 月から。中央線のない一般道の法定速度は 30 km/h",
};

const POLICY_COLOR: Record<Policy, string> = {
  limit60: "var(--series-2)",
  limit30: "var(--series-1)",
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
    pedestrian: v("--amber"),
    hit: v("--status-critical"),
    safe: v("--series-3"),
  };
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "–";
  return `${s.toFixed(1)} 秒`;
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Speed30Sim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [speed, setSpeed] = useState<Speed>(3);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [seedOffset, setSeedOffset] = useState(0);
  const [compliance, setCompliance] = useState(1);
  const [comfortKmh, setComfortKmh] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<Policy, SimStats> | null>(null);
  const [chartSeries, setChartSeries] = useState<EncounterSeries[]>([]);
  const [agg, setAgg] = useState<Record<Policy, AggregateStats> | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const params = useMemo<SimParams>(() => {
    const base = scenario.params;
    return {
      ...base,
      seed: base.seed + seedOffset,
      compliance,
      comfortKmh: comfortKmh ?? base.comfortKmh,
    };
  }, [scenario, seedOffset, compliance, comfortKmh]);

  const simsRef = useRef<Record<Policy, SimState> | null>(null);
  const canvasRefs = useRef<Record<Policy, HTMLCanvasElement | null>>({ limit60: null, limit30: null });
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
      const width = Math.round(canvas.clientWidth) || CANVAS_W;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(CANVAS_H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const color = getComputedStyle(canvas).getPropertyValue(policy === "limit60" ? "--series-2" : "--series-1").trim();
      renderSim(ctx, sims[policy], themeRef.current, color, width);
    }
  }, []);

  const publish = useCallback(() => {
    const sims = simsRef.current;
    if (!sims) return;
    setStats({ limit60: getStats(sims.limit60), limit30: getStats(sims.limit30) });
    setChartSeries(
      POLICIES.map((p) => ({ name: POLICY_LABEL[p], color: POLICY_COLOR[p], encounters: sims[p].encounters.slice() })),
    );
  }, []);

  /** シミュレーションを作り直して描画する (React の state は触らない) */
  const reset = useCallback(() => {
    simsRef.current = {
      limit60: createSim(params, "limit60"),
      limit30: createSim(params, "limit30"),
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

  // 画面幅が変わったら描き直す
  useEffect(() => {
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

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
        step(sims.limit60, DT);
        step(sims.limit30, DT);
        accRef.current -= DT;
        n++;
      }
      draw();
      if (ts - lastPublish > 150) {
        lastPublish = ts;
        publish();
      }
      if (isFinished(sims.limit60) && isFinished(sims.limit30)) {
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

  const finished = stats ? stats.limit60.t >= params.durationSec : false;

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      const runs = 100;
      setAgg({
        limit60: aggregate(params, "limit60", runs),
        limit30: aggregate(params, "limit30", runs),
      });
      setAggBusy(false);
    }, 20);
  };

  return (
    <section className="space-y-4" aria-label="生活道路の速度上限のシミュレーション">
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
                setComfortKmh(null);
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

        <div className="mt-3 text-xs">
          <span className="font-mono text-muted">
            経過 {stats ? fmtClock(stats.limit60.t) : "0:00"} / {fmtClock(params.durationSec)}
          </span>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                上限がなくても出す速度 {params.comfortKmh} km/h（道幅や見通しで決まる。人によって ±15%）
              </span>
              <input
                type="range"
                min={20}
                max={70}
                step={1}
                value={params.comfortKmh}
                onChange={(e) => setComfortKmh(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">
                30 km/h を守る人の割合 {Math.round(compliance * 100)}%（守らない人は 60 km/h を上限に走る）
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={compliance}
                onChange={(e) => setCompliance(Number(e.target.value))}
              />
            </label>
          </div>
        </details>
      </div>

      {/* 2 つの世界 */}
      <div className="grid gap-4">
        {POLICIES.map((policy) => {
          const st = stats?.[policy];
          return (
            <div key={policy} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: POLICY_COLOR[policy] }} aria-hidden />
                <h3 className="text-base font-bold">{POLICY_LABEL[policy]}</h3>
              </div>
              <p className="text-xs text-muted">{POLICY_DESC[policy]}</p>
              <canvas
                ref={(el) => {
                  canvasRefs.current[policy] = el;
                }}
                className="mt-2 block w-full"
                style={{ height: CANVAS_H }}
                role="img"
                aria-label={`${POLICY_LABEL[policy]}の世界の道路の様子`}
              />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <Stat label="平均所要時間" value={st ? fmtSec(st.avgTrip) : "–"} hint={`${params.roadLengthM} m`} />
                <Stat label="平均速度" value={st && st.avgSpeedKmh > 0 ? `${st.avgSpeedKmh.toFixed(1)} km/h` : "–"} />
                <Stat label="ぶつかった" value={st ? `${st.hits} / ${st.encounters} 回` : "–"} />
                <Stat
                  label="亡くなる人 (期待値)"
                  value={st ? `${st.expectedDeaths.toFixed(2)} 人` : "–"}
                  hint={st && st.hits > 0 ? `平均 ${st.avgImpactKmh.toFixed(0)} km/h で衝突` : undefined}
                />
              </dl>
            </div>
          );
        })}
      </div>

      <Legend />

      {chartSeries.length > 0 && (
        <EncounterChart
          series={chartSeries}
          sightMax={params.sightMax}
          reactionMin={params.reactionMin}
          reactionMax={params.reactionMax}
          decel={params.emergencyDecel}
        />
      )}

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">乱数を変えて 100 回ずつ回した合計</h3>
            <p className="text-xs text-muted">
              飛び出しは偶然に大きく左右されるので、同じ条件で 100 回試行して合計します。
              飛び出しの回数は見やすくするために現実よりずっと多くしてあるので、比べるのは 2 つの世界の「比」です。
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
        {agg && <AggTable a={agg.limit60} b={agg.limit30} />}
      </div>
    </section>
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

function AggTable({ a, b }: { a: AggregateStats; b: AggregateStats }) {
  const hitRate = (x: AggregateStats) => (x.encounters > 0 ? (x.hits / x.encounters) * 100 : 0);
  const deathsPer100 = (x: AggregateStats) => (x.encounters > 0 ? (x.expectedDeaths / x.encounters) * 100 : 0);
  const pct = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
  const rows: { label: string; a: string; b: string; diff: string }[] = [
    {
      label: "1 台あたりの所要時間",
      a: `${a.avgTrip.toFixed(1)} 秒`,
      b: `${b.avgTrip.toFixed(1)} 秒`,
      diff: `${b.avgTrip - a.avgTrip >= 0 ? "+" : ""}${(b.avgTrip - a.avgTrip).toFixed(1)} 秒`,
    },
    {
      label: "飛び出し 100 回のうち、ぶつかった回数",
      a: `${hitRate(a).toFixed(1)} 回`,
      b: `${hitRate(b).toFixed(1)} 回`,
      diff: `${pct(hitRate(a), hitRate(b)).toFixed(0)}%`,
    },
    {
      label: "ぶつかったときの平均速度",
      a: a.hits > 0 ? `${a.avgImpactKmh.toFixed(1)} km/h` : "–",
      b: b.hits > 0 ? `${b.avgImpactKmh.toFixed(1)} km/h` : "–",
      diff: a.hits > 0 && b.hits > 0 ? `${(b.avgImpactKmh - a.avgImpactKmh).toFixed(1)} km/h` : "–",
    },
    {
      label: "飛び出し 100 回あたり、亡くなる人 (期待値)",
      a: `${deathsPer100(a).toFixed(2)} 人`,
      b: `${deathsPer100(b).toFixed(2)} 人`,
      diff: `${pct(deathsPer100(a), deathsPer100(b)).toFixed(0)}%`,
    },
  ];
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3 font-semibold">指標</th>
            <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.limit60}</th>
            <th className="py-1 pr-3 font-semibold">{POLICY_LABEL.limit30}</th>
            <th className="py-1 font-semibold">30 km/h にすると</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-1 pr-3">{r.label}</td>
              <td className="py-1 pr-3 font-mono">{r.a}</td>
              <td className="py-1 pr-3 font-mono">{r.b}</td>
              <td className="py-1 font-mono text-muted">{r.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">
        試行 {a.runs} 回で、幹線道路まで走りきった車は {a.trips} 台 / {b.trips} 台、出会った飛び出しは {a.encounters} 回 / {b.encounters} 回。
      </p>
    </div>
  );
}

function Legend() {
  const items: { color: string; label: string; round?: boolean }[] = [
    { color: "var(--series-2)", label: "上限 60 km/h の世界の車" },
    { color: "var(--series-1)", label: "上限 30 km/h の世界の車" },
    { color: "var(--amber)", label: "飛び出した人", round: true },
    { color: "var(--status-critical)", label: "ぶつかった場所 (濃いほど致死率が高い)" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 ${it.round ? "rounded-full" : "rounded-sm"}`} style={{ background: it.color }} aria-hidden />
          {it.label}
        </li>
      ))}
      <li>車の上の数字は今の速度 (km/h)</li>
    </ul>
  );
}
