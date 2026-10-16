# Deep dig（原 Deep RSA）

> 2026-10-16 按用户要求改名并删减：「按照特征值来做成目录（目前我只关注多空博弈均衡点漂移速度这一个特征值），每个特征值又可以分成 3 个模块：描述统计、推断统计、规律提取」。
> 入口：复盘中心 → Deep dig（`/journal/deep-dig`；旧网址 `/journal/deep-rsa` 自动跳转）。

## 结构

- **目录**（`/journal/deep-dig`）：特征值列表，每项下面是三个模块的入口和一行摘要。目前只有一项。
- **特征值页**（`/journal/deep-dig/drift-speed`）：`?tab=` 选模块，`?g=` 选数据分组，`?all=1` 展开全部数据，都在网址上，所以从战役返回后能回到原来的位置。

| 模块 | 内容 |
|---|---|
| 描述统计 | 分组（实验组 / 对照组 / 其他战役 / 随机时点）的 n、均值、标准差、中位数、四分位、V > 0 占比；点阵图（橘黄虚线 = 0）；细节说明；逐场数据（点一行打开战役） |
| 推断统计 | ① Welch t 检验（实验组 vs 对照组）② Mann–Whitney 排名比较（AUC）③ Spearman 相关：V 与之后 24h 期末收益 / 最大涨幅 / 最大跌幅，月内置换 + Holm，控制波动率的偏相关，确认集复核 ④ 五分位分档 |
| 规律提取 | 默认按这次运行的统计结果自动写出（`driftRules`）；可以手动修改，存在 `usePersistedState('deep_dig_notes_v1')`，跟账号同步；可「恢复为统计结果」 |

## 特征值：多空博弈均衡点漂移速度 V

进场前最后一根已收盘 5m K 线上的动态谢林点 Vₜ（指标定义见 `docs/indicators/dynamic-schelling-point.md`），半衰期 6 小时，按基点 / 根显示。
事件与 24h 客观行情沿用原 Deep RSA 流水线（同币 48h 去重成簇、每簇一个代表、加随机时点；发现集前 80%、确认集最后 20%）。
代码：`src/lib/deepDig/driftSpeed.ts`（统计调用 `src/lib/deepRsa/deepDive.ts` 的 `DRIFT_STUDY`）、`src/hooks/useDriftSpeed.ts`、`src/components/journal/deepDig/DriftSpeedView.tsx`、`src/pages/JournalDeepDigPage.tsx`。

**注意**：现在只检验 V 一项，不再与主动买方优势 A、现价偏离 DSP 一起做多重校正，所以 V 的 p 值会比第 7 步（`../deep-rsa/13-results-dsp-2026-10-16.md`，三项 Holm 后 0.144）小。V 是看过三项结果后单独挑出来的，p 值偏乐观；独立的确认要用之后新产生的战役。

## 删掉的部分

原页面的研究进度、暂定分组总表、第 3–5 步 RSA 运行、第 6 步特征深挖（失衡 / 偏移 / 谢林候选）、特征清单、结论、还缺什么，以及它们在本机的结果缓存。
计算代码（`src/lib/deepRsa/`）和研究记录（`docs/deep-rsa/`）保留，需要时可以再接回目录。
