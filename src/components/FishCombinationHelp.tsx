import {FishQualityInfo} from './FishQualityModule';

export function FishCombinationHelp({workspace=false}:{workspace?:boolean}){
  return <FishQualityInfo label="组合表说明">
    <p className="font-medium">组合表 · 来源、条件与结果对照</p>
    <p>把同一记录的入场信息、买前过滤和持仓监测放在一起核对。完整说明见使用指南 3.3.4.4；表格不会替你自动启动研究。</p>
    <ol className="list-decimal space-y-2 pl-4">
      <li>{workspace?<><b>先导入，再勾选。</b>从「来源」选择记录导入。表内删除只移除本表行。手动筛选和监测完成后，可分别保存到运行库。</>:<><b>先选范围，再勾选。</b>来源、目录、月份、探测算法和标的共同决定当前表格。表外保留的勾选不算本轮处理或下载行；开始前看“本轮处理”数量。</>}</li>
      <li><b>分清原信号与实际入场。</b>动态入选采用首次满足时间等实际入场口径；信号时间保留溯源。排除过程、加仓和卖出明细用于核对证据。</li>
      <li><b>读状态后再读数值。</b>“—”可能是未启用、未完成、缺数据或不适用，不能当成 0。信号条数、展开行数和交易次数也不一定相同。</li>
      <li><b>点星评分会保存。</b>同一具体信号在活动来源保持一致；再次点同一星级可取消。评分不修改策略、不重新计算，历史归档只读。</li>
      <li><b>只导出当前表内已选行。</b>“导出数据”按点击时的排序、展开和选择生成一个“组合表”子表，一行对应一行；未选行与当前筛选外的行不下载。没有选中行时不可导出。</li>
    </ol>
    <p className="text-muted-foreground">排序、显示和展开不改变算法条件。下载用于保存表格，不能代替完整研究状态备份。模拟结果与实际账户收益分开阅读。</p>
  </FishQualityInfo>;
}
