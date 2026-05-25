import type { CognitiveAssetsDoc } from '@/types/cognitiveAssets';
import { DEFAULT_COGNITIVE_ASSET_CONTENT } from '@/lib/defaultCognitiveAsset';

type SectionBlueprint = {
  id: string;
  title: string;
  sourceTitle: string;
};

type CategoryBlueprint = {
  id: string;
  title: string;
  subtitle: string;
  intro: string;
  sourceTitle: string;
  sections: SectionBlueprint[];
};

const SOURCE = DEFAULT_COGNITIVE_ASSET_CONTENT.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function extractBody(sourceTitle: string, nextSourceTitle?: string): string {
  const currentMarker = `${sourceTitle}\n`;
  const start = SOURCE.lastIndexOf(currentMarker);
  if (start === -1) {
    throw new Error(`未能从默认认知资产中提取章节：${sourceTitle}`);
  }
  const bodyStart = start + currentMarker.length;
  const end = nextSourceTitle
    ? SOURCE.lastIndexOf(`\n${nextSourceTitle}\n`)
    : SOURCE.length;
  if (nextSourceTitle && end === -1) {
    throw new Error(`未能定位认知资产下一个章节：${nextSourceTitle}`);
  }
  return SOURCE.slice(bodyStart, end).trim();
}

const BLUEPRINTS: CategoryBlueprint[] = [
  {
    id: 'dao',
    title: '【道】：底层基石',
    subtitle: '交易的数学与物理学本质',
    intro: '本部分旨在阐述交易系统的底层世界观，通过界定风险与收益的基础理论方程，确立在非平稳市场中建立稳定正向预期的理论基石。',
    sourceTitle: '【道】：底层基石（交易的数学与物理学本质）',
    sections: [
      { id: 'dao_1_1', title: '1.1 期望值公式的三维坐标 (E, P, Q, L 的解耦)', sourceTitle: '期望值公式的三维坐标 (E, P, Q, L的解耦)' },
      { id: 'dao_1_2', title: '1.2 交易的唯一"支点"（L）', sourceTitle: '交易的唯一“支点”（L）' },
      { id: 'dao_1_3', title: '1.3 胜率（P）与赔率（Q）的连续性', sourceTitle: '胜率（P）与赔率（Q）的连续性' },
      { id: 'dao_1_4', title: '1.4 向量纯净度', sourceTitle: '向量纯净度' },
    ],
  },
  {
    id: 'fa',
    title: '【法】：实操 SOP 与资金管理',
    subtitle: '交易的执行标准',
    intro: '本部分旨在将底层的期望值理论转化为极其严密的、可执行的交易流水线。通过建立严格的进出场标准与负面清单，确保交易系统的每一次风险暴露均处于绝对的物理与数学控制之下。',
    sourceTitle: '【法】：实操SOP与资金管理（交易的执行标准）',
    sections: [
      { id: 'fa_2_1_0', title: '2.1.1 阶段 0 — 绝对红线：一票否决的负面清单体系', sourceTitle: '阶段0 绝对红线：一票否决的负面清单体系' },
      { id: 'fa_2_1_1', title: '2.1.2 阶段 1 — 准入原则：非对称优势的确认', sourceTitle: '阶段1 准入原则：非对称优势的确认' },
      { id: 'fa_2_1_2', title: '2.1.3 阶段 2 — 复盘机制：盘后偏差捕捉与系统降维', sourceTitle: '阶段2 复盘机制：盘后偏差捕捉与系统降维' },
      { id: 'fa_2_2_1', title: '2.2.1 第一轨（物理底线）：极限本金的计算与生存边界', sourceTitle: '第一轨（物理底线）：极限本金的计算与生存边界（投入多少）' },
      { id: 'fa_2_2_2', title: '2.2.2 第二轨（期望值阀门）：减震器与大油门', sourceTitle: '第二轨（期望值阀门）：正交化控制下的减震器与大油门（高波动高期望值）' },
    ],
  },
  {
    id: 'shou',
    title: '【防守术】：动态风控与防守',
    subtitle: '证伪体系的建立',
    intro: '本部分旨在构建一个从空间到时间、层次分明的动态风控网络。',
    sourceTitle: '【防守术】：动态风控与防守（证伪体系的建立）',
    sections: [
      { id: 'shou_3_1', title: '3.1 从"点"到"过程"的逻辑证伪：逻辑的衰退', sourceTitle: '从“点”到“过程”的逻辑证伪：逻辑的衰退' },
      { id: 'shou_3_2', title: '3.2 预证伪机制（分级预警）：小周期触发后的时间验证与"战术减半"', sourceTitle: '预证伪机制（分级预警）：小周期触发后的时间验证与“战术减半”' },
      { id: 'shou_3_3_1', title: '3.3.1 拆解对冲的底层困境', sourceTitle: '拆解对冲的底层困境' },
      { id: 'shou_3_3_2', title: '3.3.2 对冲触发后的三大物理走势与应对 SOP', sourceTitle: '对冲触发后的三大物理走势与应对SOP' },
      { id: 'shou_3_3_3', title: '3.3.3 拆除对冲的结构性劣势', sourceTitle: '拆除对冲的结构性劣势' },
      { id: 'shou_3_4_1', title: '3.4.1 极窄止损的物理学灾难（死于布朗运动）', sourceTitle: '极窄止损的物理学灾难（死于布朗运动）' },
      { id: 'shou_3_4_2', title: '3.4.2 波动率隔离技术：用空间购买时间，用仓位购买胜率', sourceTitle: '波动率隔离技术：用空间购买时间，用仓位购买胜率' },
    ],
  },
  {
    id: 'gong',
    title: '【进攻术】：进阶进攻',
    subtitle: '利润最大化与期望值核裂变',
    intro: '本部分将原本隐藏在防守策略背后的"攻击性武器"单列。在构建了严密的风控底盘后，系统的终极目标是利用市场的趋势延展，抓住右尾的正面黑天鹅，实现利润的最大化。',
    sourceTitle: '【进攻术】：进阶进攻（利润最大化与期望值核裂变）',
    sections: [
      { id: 'gong_4_1', title: '4.1 滚仓（浮盈加仓）的核裂变：头仓探测器与利润资本化', sourceTitle: '滚仓（浮盈加仓）的核裂变：头仓探测器与利润资本化' },
      { id: 'gong_4_2', title: '4.2 抽离本金：1:1 位置时的半仓剥离与物理不败态的构建', sourceTitle: '抽离本金：1:1位置时的半仓剥离与物理不败态的构建' },
    ],
  },
  {
    id: 'xin',
    title: '【心】：认知工程学',
    subtitle: '对抗人性与知行合一',
    intro: '交易系统的终极护城河不在于数学模型的精妙，而在于纪律执行中的认知工程学。在金融交易中，人的大脑在面对跳动的浮动盈亏（PnL）时，极易受到多巴胺与皮质醇的强烈刺激，从而丧失高级理性的计算能力。因此，必须将心理博弈与人类认知弱点单独提炼，构建抵御人性本能的防御体系，以确保知行合一。',
    sourceTitle: '【心】：认知工程学（对抗人性与知行合一）',
    sections: [
      { id: 'xin_5_1', title: '5.1 逻辑漂移的三大重灾区', sourceTitle: '逻辑漂移的三大重灾区' },
      { id: 'xin_5_2', title: '5.2 认知静默期与信息消化：进场后的聋瞎模式', sourceTitle: '认知静默期与信息消化：进场后的聋瞎模式' },
      { id: 'xin_5_3', title: '5.3 静默还是衍化：破局点指南', sourceTitle: '静默还是衍化：破局点指南' },
    ],
  },
];

export const INITIAL_COGNITIVE_ASSETS: CognitiveAssetsDoc = {
  meta: {
    title: '认知资产',
    subtitle: '交易底层认知体系 · 道-法-术-心',
  },
  categories: BLUEPRINTS.map((categoryBlueprint, categoryIndex, categories) => {
    const nextCategory = categories[categoryIndex + 1];
    return {
      id: categoryBlueprint.id,
      title: categoryBlueprint.title,
      subtitle: categoryBlueprint.subtitle,
      intro: categoryBlueprint.intro,
      sections: categoryBlueprint.sections.map((sectionBlueprint, sectionIndex, sections) => {
        const nextSection = sections[sectionIndex + 1];
        const nextTitle = nextSection?.sourceTitle ?? nextCategory?.sourceTitle;
        return {
          id: sectionBlueprint.id,
          title: sectionBlueprint.title,
          content: extractBody(sectionBlueprint.sourceTitle, nextTitle),
        };
      }),
    };
  }),
};
