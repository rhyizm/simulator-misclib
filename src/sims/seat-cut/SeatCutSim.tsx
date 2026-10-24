"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CURRENT_PR,
  SMD_TOTAL,
  aggregate,
  buildRows,
  generateElection,
  worldResult,
  type AggregateWorld,
  type Mode,
  type Party,
  type WorldResult,
} from "./model";
import { PR_TOTALS, getScenario, scenarios } from "./scenarios";
import { CANVAS_W, PER_LINE, canvasHeight, renderSeats, type RenderTheme } from "./render";

type Speed = 1 | 3 | 8;

/** 党の色。最後の「その他」は灰色 */
const PARTY_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-7)",
  "var(--series-8)",
  "#4fb6c2",
  "#d46fb0",
];

function partyColor(p: Party, i: number): string {
  return p.minor ? "var(--muted)" : PARTY_COLORS[i % PARTY_COLORS.length];
}

function resolve(el: HTMLElement, c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c);
  return m ? getComputedStyle(el).getPropertyValue(m[1]).trim() : c;
}

function readTheme(el: HTMLElement, parties: Party[]): RenderTheme {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--card"),
    fg: v("--foreground"),
    muted: v("--muted"),
    border: v("--border"),
    grid: v("--grid"),
    cut: v("--foreground"),
    parties: parties.map((p, i) => resolve(el, partyColor(p, i))),
  };
}

function worldName(pr: number): string {
  return pr === CURRENT_PR ? `現行 (比例 ${pr})` : `${CURRENT_PR - pr} 減 (比例 ${pr})`;
}

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

/** 1 席ずつ配るアニメーションの、席あたりの秒数 (×1 のとき) */
const SEC_PER_SEAT = 0.45;
/** 配り終えてから、削られる席の印が濃くなるまでの秒数 */
const CUT_FADE_SEC = 1.5;

export function SeatCutSim() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [mode, setMode] = useState<Mode>("block");
  const [thirdPr, setThirdPr] = useState<number>(PR_TOTALS[2]);
  const [speed, setSpeed] = useState<Speed>(3);
  const [seedOffset, setSeedOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [agg, setAgg] = useState<AggregateWorld[] | null>(null);
  const [aggBusy, setAggBusy] = useState(false);

  const scenario = getScenario(scenarioId);
  const parties = scenario.params.parties;
  const prTotals = useMemo(() => [CURRENT_PR, PR_TOTALS[1], thirdPr], [thirdPr]);
  const names = useMemo(() => prTotals.map(worldName), [prTotals]);
  const params = useMemo(() => ({ ...scenario.params, seed: scenario.params.seed + seedOffset }), [scenario, seedOffset]);

  const election = useMemo(() => generateElection(params), [params]);
  const rows = useMemo(() => buildRows(election, parties, mode, prTotals), [election, parties, mode, prTotals]);
  const results = useMemo<WorldResult[]>(
    () => prTotals.map((_, w) => worldResult(election, rows, w, mode)),
    [election, rows, prTotals, mode],
  );
  const maxLen = Math.max(...rows.map((r) => r.order.length));
  // 全国 1 区のときは 1 行ぶん (PER_LINE 席) ずつ同時に配って、ブロックのときと同じくらいの時間で終える
  const seatsPerStep = Math.ceil(maxLen / PER_LINE);
  const revealSec = Math.ceil(maxLen / seatsPerStep) * SEC_PER_SEAT;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef<RenderTheme | null>(null);
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const speedRef = useRef(speed);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!themeRef.current) themeRef.current = readTheme(canvas, parties);
    const H = canvasHeight(rows);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== CANVAS_W * dpr || canvas.height !== H * dpr) {
      canvas.width = CANVAS_W * dpr;
      canvas.height = H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = progressRef.current;
    const revealed = Math.floor(t / SEC_PER_SEAT) * seatsPerStep;
    const cutAlpha = Math.max(0, Math.min(1, (t - revealSec) / CUT_FADE_SEC));
    renderSeats(ctx, rows, themeRef.current, revealed, cutAlpha, names);
  }, [rows, parties, seatsPerStep, revealSec, names]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // 党の顔ぶれが変わったら色を読み直す
  useEffect(() => {
    themeRef.current = null;
  }, [parties]);

  // 票や区割りが変わったら最初から
  useEffect(() => {
    progressRef.current = 0;
    draw();
    const id = requestAnimationFrame(() => {
      setDone(false);
      setAgg(null);
    });
    return () => cancelAnimationFrame(id);
  }, [rows, draw]);

  // ページを開いたら自動で再生する (動きを減らす設定の人は最後の状態を見せる)
  useEffect(() => {
    if (autoStarted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = requestAnimationFrame(() => {
      setAutoStarted(true);
      if (reduced) {
        progressRef.current = revealSec + CUT_FADE_SEC;
        draw();
        setDone(true);
      } else setPlaying(true);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStarted, revealSec, draw]);

  // アニメーションループ
  useEffect(() => {
    if (!playing) return;
    let last: number | null = null;
    const end = revealSec + CUT_FADE_SEC;
    const loop = (ts: number) => {
      if (last === null) last = ts;
      const real = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      progressRef.current = Math.min(end, progressRef.current + real * speedRef.current);
      draw();
      if (progressRef.current >= end) {
        setPlaying(false);
        setDone(true);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, draw, revealSec]);

  const restart = () => {
    progressRef.current = 0;
    draw();
    setDone(false);
    setPlaying(true);
  };

  const runAggregate = () => {
    setAggBusy(true);
    setTimeout(() => {
      setAgg(aggregate(params, mode, prTotals, 200));
      setAggBusy(false);
    }, 20);
  };

  const majorParties = parties.map((p, i) => ({ p, i })).filter(({ p }) => !p.minor);

  return (
    <section className="space-y-4" aria-label="衆院の比例代表の定数削減のシミュレーション">
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
                setSeedOffset(0);
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

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="比例の区割り">
          <span className="text-xs text-muted">比例の区割り</span>
          {(
            [
              ["block", "11 ブロック (今の制度)"],
              ["national", "全国 1 区にしたら"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setPlaying(true);
              }}
              className={`rounded-md border px-2 py-1 text-xs ${
                mode === m ? "border-accent bg-accent-soft" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (done) restart();
              else setPlaying((p) => !p);
            }}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90"
          >
            {playing ? "一時停止" : done ? "もう一度" : "再生"}
          </button>
          <button
            type="button"
            onClick={restart}
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
            title="票の出方を変えて、別の 1 回の選挙を試す"
          >
            別の選挙で
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="再生速度">
            <span className="text-muted">速度</span>
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
                ×{sp}
              </button>
            ))}
          </div>
        </div>

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">詳細設定</summary>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-xs text-muted">
              3 つ目の世界の比例定数 {thirdPr} (削減 {CURRENT_PR - thirdPr})。2 つ目の世界 (比例 {PR_TOTALS[1]}) より多くはできない
            </span>
            <input
              type="range"
              min={50}
              max={PR_TOTALS[1]}
              step={1}
              value={thirdPr}
              onChange={(e) => setThirdPr(Number(e.target.value))}
            />
          </label>
        </details>
      </div>

      {/* 議席が配られる順 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-base font-bold">比例の議席が配られる順番</h3>
        <p className="text-xs text-muted">
          {mode === "block"
            ? "ブロックごとに、ドント方式で 1 席ずつ配っていきます。名前の下の数字は「現行 / 31 減 / 3 つ目」の定数。定数を減らすと、後ろの席から消えます。"
            : "全国を 1 つの区にして、ドント方式で 1 席ずつ配っていきます。縦線より後ろの席が、削減で消える席です。"}
        </p>
        <div className="mt-2 overflow-x-auto">
          <canvas
            ref={canvasRef}
            className="block h-auto w-full min-w-[520px]"
            style={{ aspectRatio: `${CANVAS_W} / ${canvasHeight(rows)}` }}
            role="img"
            aria-label="比例ブロックごとに、議席が配られる順番と、定数削減で消える席"
          />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="凡例">
          {majorParties.map(({ p, i }) => (
            <li key={p.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: partyColor(p, i) }} aria-hidden />
              {p.name}
            </li>
          ))}
          <li>✕ = {names[1].split(" (")[0]}でも{names[2].split(" (")[0]}でも消える席</li>
          <li>／ = {names[2].split(" (")[0]}だけで消える席</li>
        </ul>
      </div>

      {/* 3 つの世界の結果 */}
      <HouseBars parties={parties} results={results} names={names} />

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-base font-bold">この 1 回の選挙の議席 (小選挙区 + 比例)</h3>
        <p className="text-xs text-muted">小選挙区 {SMD_TOTAL} はどの世界でも同じ結果です。括弧の中は比例の議席。</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-semibold">党</th>
                <th className="py-1 pr-3 font-semibold">比例の得票率</th>
                <th className="py-1 pr-3 font-semibold">小選挙区</th>
                {names.map((n) => (
                  <th key={n} className="py-1 pr-3 font-semibold">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {majorParties.map(({ p, i }) => (
                <tr key={p.name} className="border-t border-border">
                  <td className="py-1 pr-3 font-sans">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: partyColor(p, i) }} aria-hidden />
                    {p.name}
                  </td>
                  <td className="py-1 pr-3">{pct(election.national[i])}</td>
                  <td className="py-1 pr-3">{election.smd[i]}</td>
                  {results.map((r, w) => (
                    <td key={w} className="py-1 pr-3">
                      {r.total[i]} <span className="text-muted">({r.pr[i]})</span>
                      {w > 0 && r.pr[i] < results[0].pr[i] && (
                        <span className="ml-1 text-xs text-coral">−{results[0].pr[i] - r.pr[i]}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1 pr-3 font-sans text-muted">過半数ライン</td>
                <td />
                <td />
                {results.map((r, w) => (
                  <td key={w} className="py-1 pr-3">
                    {r.majority} <span className="text-muted">/ {r.house}</span>
                  </td>
                ))}
              </tr>
              <tr className="border-t border-border">
                <td className="py-1 pr-3 font-sans text-muted" colSpan={3}>
                  比例で議席に結びつかなかった票
                </td>
                {results.map((r, w) => (
                  <td key={w} className="py-1 pr-3">
                    {pct(r.wasted)}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-border">
                <td className="py-1 pr-3 font-sans text-muted" colSpan={3}>
                  得票と議席のずれ (ギャラガー指数)
                </td>
                {results.map((r, w) => (
                  <td key={w} className="py-1 pr-3">
                    {r.gallagher.toFixed(1)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 統計 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">票の出方を変えて 200 回選挙をした平均</h3>
            <p className="text-xs text-muted">
              1 回の選挙だけでは偶然に左右されるので、全国の風やブロックごとの差を変えて 200 回繰り返します。
            </p>
          </div>
          <button
            type="button"
            onClick={runAggregate}
            disabled={aggBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          >
            {aggBusy ? "計算中…" : agg ? "もう一度計算" : "200 回試行する"}
          </button>
        </div>
        {agg && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-semibold">指標</th>
                  {names.map((n) => (
                    <th key={n} className="py-1 pr-3 font-semibold">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                <AggRow label="第 1 党が単独で過半数を取った割合" values={agg.map((a) => pct(a.majorityRate, 0))} />
                <AggRow label="比例で議席に結びつかなかった票" values={agg.map((a) => pct(a.wasted))} />
                <AggRow label="得票と議席のずれ (ギャラガー指数)" values={agg.map((a) => a.gallagher.toFixed(1))} />
                {majorParties.map(({ p, i }) => (
                  <AggRow
                    key={p.name}
                    label={`${p.name} の比例の議席`}
                    color={partyColor(p, i)}
                    values={agg.map((a, w) => {
                      const base = agg[0].pr[i];
                      const change = base > 0 && w > 0 ? ` (${(((a.pr[i] - base) / base) * 100).toFixed(0)}%)` : "";
                      const zero = a.zeroRate[i] > 0.005 ? `・0 席 ${pct(a.zeroRate[i], 0)}` : "";
                      return `${a.pr[i].toFixed(1)}${change}${zero}`;
                    })}
                  />
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              括弧の中は現行からの増減率。「0 席」は比例で 1 席も取れなかった回の割合。比例の議席全体は 31 減で −18%、
              {CURRENT_PR - thirdPr} 減で −{(((CURRENT_PR - thirdPr) / CURRENT_PR) * 100).toFixed(0)}% なので、それより大きく減る党が「削減の重さを多めに背負う党」です。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function AggRow({ label, values, color }: { label: string; values: string[]; color?: string }) {
  return (
    <tr className="border-t border-border">
      <td className="py-1 pr-3 font-sans">
        {color && <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />}
        {label}
      </td>
      {values.map((v, i) => (
        <td key={i} className="py-1 pr-3">
          {v}
        </td>
      ))}
    </tr>
  );
}

/** 世界ごとに、議席の内訳を横棒で並べる。縦線は過半数 */
function HouseBars({ parties, results, names }: { parties: Party[]; results: WorldResult[]; names: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-base font-bold">衆議院全体の議席の内訳</h3>
      <p className="text-xs text-muted">棒の長さは議席率。白い縦線が過半数です。</p>
      <div className="mt-3 space-y-3">
        {results.map((r, w) => {
          const top = r.total.indexOf(Math.max(...r.total));
          const gap = r.total[top] - r.majority;
          return (
            <div key={names[w]}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-semibold">{names[w]}</span>
                <span className="font-mono text-xs text-muted">
                  定数 {r.house}・{parties[top].name} {r.total[top]} 席・過半数まで{" "}
                  {gap >= 0 ? <span className="text-foreground">単独過半数 (+{gap})</span> : <span>あと {-gap}</span>}
                </span>
              </div>
              <div className="relative mt-1 flex h-6 w-full overflow-hidden rounded-sm" role="img" aria-label={`${names[w]}の議席の内訳`}>
                {r.total.map((s, i) =>
                  s > 0 ? (
                    <div
                      key={i}
                      style={{ width: `${(s / r.house) * 100}%`, background: partyColor(parties[i], i) }}
                      title={`${parties[i].name} ${s} 席`}
                    />
                  ) : null,
                )}
                <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(r.majority / r.house) * 100}%` }} aria-hidden />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
