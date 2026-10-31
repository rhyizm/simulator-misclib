import type { ComponentType } from "react";
import { EscalatorSim } from "./escalator/EscalatorSim";
import { EscalatorArticle } from "./escalator/article";
import { TruckBerthSim } from "./truck-berth/TruckBerthSim";
import { TruckBerthArticle } from "./truck-berth/article";
import { QuakeAlertSim } from "./quake-alert/QuakeAlertSim";
import { QuakeAlertArticle } from "./quake-alert/article";
import { ToiletSim } from "./toilet/ToiletSim";
import { ToiletArticle } from "./toilet/article";
import { Speed30Sim } from "./speed30/Speed30Sim";
import { Speed30Article } from "./speed30/article";
import { KyotoBusSim } from "./kyoto-bus/KyotoBusSim";
import { KyotoBusArticle } from "./kyoto-bus/article";
import { StaggeredCommuteSim } from "./staggered-commute/StaggeredCommuteSim";
import { StaggeredCommuteArticle } from "./staggered-commute/article";

export interface SimModule {
  /** インタラクティブなシミュレーション本体 (client component) */
  Sim: ComponentType;
  /** 前提・考察などの記事本文 (server component) */
  Article: ComponentType;
}

export const simModules: Record<string, SimModule> = {
  escalator: { Sim: EscalatorSim, Article: EscalatorArticle },
  "truck-berth": { Sim: TruckBerthSim, Article: TruckBerthArticle },
  "quake-alert": { Sim: QuakeAlertSim, Article: QuakeAlertArticle },
  toilet: { Sim: ToiletSim, Article: ToiletArticle },
  speed30: { Sim: Speed30Sim, Article: Speed30Article },
  "kyoto-bus": { Sim: KyotoBusSim, Article: KyotoBusArticle },
  "staggered-commute": { Sim: StaggeredCommuteSim, Article: StaggeredCommuteArticle },
};
