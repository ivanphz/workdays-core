// 🇺🇸 US 人工例外层(算法覆盖)——总统哀悼日、NYSE 因灾休市等【无机读源、不可预测】的假期。
// 算法型数据集的标准可选件: 罕见事件发生时手工加一行(或让 AI 加),发 patch。
// 频率约几年一次(总统去世/重大灾害)。字段: date, scope('bank'|'market'|'both'), isOpen(false=休市/闭)。
// isOpen:false 表示"该口径这天关闭/休息"(覆盖算法判定的工作日)。
// 例(历史,注释保留供格式参考,已过期不影响判定):
//   { date: '2018-12-05', scope: 'bank',   isOpen: false, name: 'National Day of Mourning (G.H.W. Bush)' },
//   { date: '2018-12-05', scope: 'market', isOpen: false, name: 'National Day of Mourning (G.H.W. Bush)' },
//   { date: '2025-01-09', scope: 'both',   isOpen: false, name: 'National Day of Mourning (Carter)' },
//   { date: '2012-10-30', scope: 'market', isOpen: false, name: 'Hurricane Sandy' }
export const US_EXCEPTIONS = [
  // 目前为空: 未来罕见事件在此追加。names 可选,缺省用占位。
];

/** 供 provider 查询: 某日某口径是否被例外标记为关闭。scope 'both' 命中 bank 与 market。 */
export function exceptionClosed(dateStr, wantScope) {
  for (const e of US_EXCEPTIONS) {
    if (e.date !== dateStr) continue;
    if (e.isOpen === false && (e.scope === 'both' || e.scope === wantScope)) {
      return { name: e.name ?? null };
    }
  }
  return null;
}
