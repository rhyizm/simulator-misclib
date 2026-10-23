import type { KindParams, Policy, SimParams, SiteKind } from "./model";

export interface Scenario {
  id: string;
  name: string;
  short: string;
  description: string;
  params: SimParams;
}

/** 対応だけが違う 3 つの世界 */
export const policies: Policy[] = [
  {
    id: "wait",
    label: "修正版を待って当てる",
    desc: "サイトは動かしたまま。修正版が出たら、それぞれの速さで当てる",
    stop: false,
    waf: false,
  },
  {
    id: "stop",
    label: "気づいたら止める",
    desc: "気づいたサイトは、修正版を当てるまで公開を止める",
    stop: true,
    waf: false,
  },
  {
    id: "waf",
    label: "WAF で守りながら当てる",
    desc: "止めずに WAF で攻撃をはじく。CDN の後ろのサイトは自動で守られる",
    stop: false,
    waf: true,
  },
];

export const KIND_LABEL: Record<SiteKind, string> = {
  ops: "運用チームあり",
  small: "小さな会社・個人",
  legacy: "古い PHP・放置",
};

const kinds: Record<SiteKind, KindParams> = {
  // 大手サービスなど。数時間で気づき、修正版が出ればすぐ当てる
  ops: { share: 0.25, noticeProb: 1, noticeMean: 4, patchMean: 3, autoPatchMean: 24, cdnProb: 0.7 },
  // 中小企業や個人のサイト。気づくのも当てるのも遅く、レンタルサーバー任せのところもある
  small: { share: 0.55, noticeProb: 0.8, noticeMean: 16, patchMean: 36, autoPatchMean: 72, cdnProb: 0.35 },
  // サポートの切れた PHP 8.1 以前や、更新されていないサイト。公式の修正版がない
  legacy: { share: 0.2, noticeProb: 0.4, noticeMean: 30, patchMean: 240, autoPatchMean: Infinity, cdnProb: 0.2 },
};

const base: SimParams = {
  hours: 168,
  sites: 400,
  kinds,
  // 0 時間目 = 10 月 21 日 0 時 (CVE 番号などが漏れた時刻)。修正版は 21 日 23 時
  patchAt: 23,
  // CDN が WAF で既定の防御を始めたのが 21 日 12 時ごろ
  wafAt: 12,
  wafSetup: 2,
  wafBlock: 0.9,
  probeRate: 0.001,
  // 出回りきると、守りのないサイトは 1 日で 6 割ほどが乗っ取られる強さ
  attackMax: 0.035,
  // 修正版の差分から攻撃コードが作られ、公開の数時間後に本格化する
  attackMid: 28,
  attackWidth: 3,
  seed: 20261021,
};

export const scenarios: Scenario[] = [
  {
    id: "actual",
    name: "今回に近い 1 週間",
    short: "今回",
    description:
      "21 日 0 時に穴の情報が漏れ、修正版は 24 時間前倒しの 21 日 23 時に公開。攻撃は修正版の公開から数時間で本格化する。CDN の WAF は 21 日 12 時から。",
    params: base,
  },
  {
    id: "planned",
    name: "予定どおり 22 日 23 時の公開だったら",
    short: "前倒しなし",
    description:
      "情報は同じように漏れて攻撃も同じ時刻に始まるのに、修正版の公開だけが当初の予定どおり 24 時間遅い世界。攻撃が修正版より先に来る。",
    params: { ...base, patchAt: 47 },
  },
  {
    id: "legacy",
    name: "古い PHP が多い",
    short: "古い PHP",
    description:
      "サポートの切れた PHP で動き、公式の修正版がないサイトが全体の 4 割を占める世界。気づいても移行には何日もかかる。",
    params: {
      ...base,
      kinds: {
        ops: { ...kinds.ops, share: 0.2 },
        small: { ...kinds.small, share: 0.4 },
        legacy: { ...kinds.legacy, share: 0.4 },
      },
    },
  },
  {
    id: "hosting",
    name: "レンタルサーバーが一斉に更新",
    short: "一斉更新",
    description:
      "小さなサイトの多くが同じレンタルサーバーに載っていて、事業者が修正版の公開から半日ほどでまとめて更新してくれる世界。",
    params: {
      ...base,
      kinds: { ...kinds, small: { ...kinds.small, patchMean: 6, autoPatchMean: 10 } },
    },
  },
];

export function getScenario(id: string): Scenario {
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
