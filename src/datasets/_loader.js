// ==============================================================================
// 🔌 src/datasets/_loader.js — 数据集插件装载器(故障隔离的中心)
// ==============================================================================
// 架构核心: 一国 = 一个自包含文件夹 src/datasets/<code>/,中心只负责【发现】与
// 【容错装载】,绝不含任何单国逻辑。加新国 = 放一个文件夹 + 在 REGISTRY 加一行,
// 中心代码零改动(解耦);任何数据集 import 失败/清单不合规 → 跳过并告警,其余照跑
// (故障隔离:AI 生成的新国坏了,不影响已有国家)。
//
// 为什么用显式 REGISTRY 而非扫目录: Workers/bundler 环境无法运行时列目录,
// 打包器也需要静态 import 才能把数据集打进 bundle。REGISTRY 是唯一的"目录"。

// ── 数据集注册表(加新国唯一需要动的中心行;懒加载 import 保证单个坏文件可隔离)──
const REGISTRY = {
  cn: () => import('./cn/index.js'),
  hk: () => import('./hk/index.js'),
  us: () => import('./us/index.js'),
  gb: () => import('./gb/index.js'),
  sg: () => import('./sg/index.js')
};

/**
 * 装载全部数据集清单,坏的自动丢弃。
 * @returns {{ manifests: Object<code,manifest>, errors: string[] }}
 * manifest 契约(每个 datasets/<code>/index.js 默认导出):
 *   {
 *     code:        'hk',                    // 两位小写,= 数据集 id 前缀,文件夹名
 *     regions:     [{ region:'HK', alpha3:'HKG', tz:'Asia/Hong_Kong',
 *                     names:{sc,tc,en}, defaultKind:'public',
 *                     kinds:{ public:{dataset:'HK'} } }],  // 一个文件夹可声明多 region(极少见)
 *     officialLangs:['sc','tc','en'],
 *     createProviders: () => ({ 'HK': <provider 实例> }),  // dataset id → provider
 *     fetch?:      async (fetchImpl) => ({ <datasetId>: {date:条目} }) | null  // 可选,在线/流水线共用
 *   }
 * 校验失败(缺 code/regions/createProviders,或 code 非两位)即视为坏数据集,丢弃。
 */
export async function loadDatasets(only = null) {
  const manifests = {}, errors = [];
  const codes = only || Object.keys(REGISTRY);
  await Promise.all(codes.map(async (code) => {
    try {
      const mod = await REGISTRY[code]();
      const m = mod.default || mod.MANIFEST;
      if (!m || typeof m !== 'object') throw new Error('清单缺省导出');
      if (!/^[a-z]{2}$/.test(m.code || '')) throw new Error(`code 非两位小写: ${m.code}`);
      if (!Array.isArray(m.regions) || !m.regions.length) throw new Error('regions 为空');
      if (typeof m.createProviders !== 'function') throw new Error('缺 createProviders');
      manifests[m.code] = m;
    } catch (e) {
      errors.push(`[dataset:${code}] 装载失败,已跳过 → ${e.message}`);
    }
  }));
  return { manifests, errors };
}

/** 已注册的数据集代码(供文档/调试) */
export function registeredCodes() {
  return Object.keys(REGISTRY);
}
