/**
 * BatteryCard 状态文案校验
 *
 * 为什么要这个脚本：项目没有前端测试框架，而 `BatteryCard.tsx` 里的
 * `levelFromInfo` / `statusText` / `hintText` 是纯函数，它们的**判断顺序**直接决定
 * 用户看到什么。顺序写反过一次（先判 `percent == null` 再判 `charging`），
 * 导致插上充电线时显示「等待电量数据」，用户以为读不到电量。
 *
 * 做法：从 `BatteryCard.tsx` 源码里按名字抠出这三个函数，剥掉 TS 类型注解后
 * 直接执行并断言文案。**直接跑源码，不是复制一份副本**，所以源码改了这里会跟着变，
 * 不会出现「测试和实现不同步」。
 *
 * 用法：
 *   node scripts/check-battery-card.cjs        # 或 pnpm run check:card
 *
 * 退出码 0 = 全部通过；1 = 有场景不符（可用于 CI / 提交前检查）。
 *
 * 维护提示：改了这三个函数的判断顺序或文案，请同步更新下面的 `cases` 期望值。
 * 加新设备时如果引入了新的「无电量但有语义」的状态，也应在此补一个场景。
 */
const fs = require('node:fs')

const src = fs.readFileSync('src/components/BatteryCard.tsx', 'utf8')

// 按名字从源码里定位一个函数，用括号深度扫描找到与之匹配的结束大括号。
function extract(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0)
    throw new Error(`找不到函数 ${name}`)
  let depth = 0
  let i = src.indexOf('{', start)
  for (; i < src.length; i++) {
    if (src[i] === '{') {
      depth++
    }
    else if (src[i] === '}') {
      depth--
      if (depth === 0)
        return src.slice(start, i + 1)
    }
  }
  throw new Error(`函数 ${name} 未闭合`)
}

// Web 端特有的 API 在这个脚本里用不到，去掉 TS 注解后直接执行。
// 参数签名可能跨行，所以先把「( ... )」之间的类型注解整段清掉，再清返回值类型。
const stripped = ['levelFromInfo', 'statusText', 'hintText', 'modelUncertainText']
  .map((name) => {
    let body = extract(name)
    // 清掉参数列表里的类型注解：形如 `info: BatteryInfo | null,` / `error: string | null,`
    // 第二个分支只需匹配标识符；`null` 已被 [A-Za-z][\w.]* 覆盖，不再单列（否则会重复回溯）
    body = body.replace(/:\s*[A-Z][\w.]*(\s*\|\s*[A-Z][\w.]*)*/gi, '')
    // 上面会把三元里的 `? 'x' : 'y'` 也误伤成 `? 'x' 'y'`，这里补回来
    body = body.replace(/\?\s*('[^']*'|"[^"]*")\s+('[^']*'|"[^"]*")/g, `? $1 : $2`)
    return body
  })
  .join('\n')

// LEVEL_LABEL 直接从源文件解析，避免脚本里再手抄一份（抄一份就会和源码不同步）。
// 形如：  high: '电量充足',
const labelBlock = src.slice(
  src.indexOf('const LEVEL_LABEL'),
  src.indexOf('}', src.indexOf('const LEVEL_LABEL')),
)
const LEVEL_LABEL = {}
for (const m of labelBlock.matchAll(/(\w+):\s*'([^']*)'/g))
  LEVEL_LABEL[m[1]] = m[2]

if (Object.keys(LEVEL_LABEL).length === 0)
  throw new Error('没能从源文件解析出 LEVEL_LABEL')

// eslint-disable-next-line no-new-func
const factory = new Function(`${stripped}
  const LEVEL_LABEL = ${JSON.stringify(LEVEL_LABEL)}
  return { levelFromInfo, statusText, hintText, modelUncertainText, LEVEL_LABEL }`)
const fn = factory()

// 前行者 S9 Pro 充电时的真实形态：charging=true，percent=null（0xE4 哨兵值）
const chargingNoPercent = { connected: true, charging: true, percent: null }
// 普通充电且能读到电量
const chargingWithPercent = { connected: true, charging: true, percent: 80 }
// 正常未充电
const normal = { connected: true, charging: null, percent: 80 }
// 已连接但读不到电量且未充电（读失败）
const connectedNoPercent = { connected: true, charging: null, percent: null }
// 未连接
const offline = { connected: false, charging: null, percent: null }
// 型号不受支持（插上 S9 Ultra / Max 或 IPI 自家机型时的形态）
const unsupportedModel = {
  connected: true,
  charging: null,
  percent: null,
  unsupported: true,
  detail: '检测到 S9 Ultra（有线 PID 0x1027），本版只适配 S9 Pro，暂不读取电量。',
}
// 型号认不出来（2.4G 共用接收器 PID，本机最常见路径）：电量能读，但型号说不得死
const uncertainModel = {
  connected: true,
  charging: null,
  percent: 52,
  model_uncertain: true,
}
// 有线 PID 唯一确认 Pro：不该显示型号说明
const confirmedPro = {
  connected: true,
  charging: null,
  percent: 52,
  model_uncertain: false,
}

const cases = [
  {
    name: '型号不受支持（插上 Ultra/Max 等）',
    level: fn.levelFromInfo(unsupportedModel),
    status: fn.statusText(unsupportedModel, false, null),
    hint: fn.hintText(unsupportedModel, false, null, true),
    expect: { level: 'unsupported', status: '该型号暂不支持' },
    hintMustContain: 'S9 Ultra',
  },
  {
    name: '型号认不出来（共用 2.4G 接收器）：主界面要有可见说明',
    level: fn.levelFromInfo(uncertainModel),
    status: fn.statusText(uncertainModel, false, null),
    hint: fn.hintText(uncertainModel, false, null, true),
    expect: { level: 'high', status: '运行正常' },
    badge: fn.modelUncertainText(uncertainModel),
    expectBadge: '型号按 S9 系列处理',
  },
  {
    name: '有线 PID 确认 Pro：不该出现型号说明',
    level: fn.levelFromInfo(confirmedPro),
    status: fn.statusText(confirmedPro, false, null),
    hint: fn.hintText(confirmedPro, false, null, true),
    expect: { level: 'high', status: '运行正常' },
    badge: fn.modelUncertainText(confirmedPro),
    expectBadge: null,
  },
  {
    name: '充电中且拿不到百分比（S9 Pro 真机形态）',
    level: fn.levelFromInfo(chargingNoPercent),
    status: fn.statusText(chargingNoPercent, false, null),
    hint: fn.hintText(chargingNoPercent, false, null, true),
    expect: { level: 'charging', status: '充电中' },
  },
  {
    name: '充电中且能读到电量',
    level: fn.levelFromInfo(chargingWithPercent),
    status: fn.statusText(chargingWithPercent, false, null),
    hint: fn.hintText(chargingWithPercent, false, null, true),
    expect: { level: 'charging', status: '充电中' },
  },
  {
    name: '未充电 80%',
    level: fn.levelFromInfo(normal),
    status: fn.statusText(normal, false, null),
    hint: fn.hintText(normal, false, null, true),
    expect: { level: 'high', status: '运行正常' },
  },
  {
    name: '已连接但读不到电量、未充电（应仍是等待数据）',
    level: fn.levelFromInfo(connectedNoPercent),
    status: fn.statusText(connectedNoPercent, false, null),
    hint: fn.hintText(connectedNoPercent, false, null, true),
    expect: { level: 'unknown', status: '等待电量数据' },
  },
  {
    name: '未连接',
    level: fn.levelFromInfo(offline),
    status: fn.statusText(offline, false, null),
    hint: fn.hintText(offline, false, null, true),
    expect: { level: 'empty', status: '设备未连接' },
  },
]

let failed = 0
console.log('=== BatteryCard 状态文案校验 ===')
for (const c of cases) {
  const levelLabel = fn.LEVEL_LABEL[c.level]
  const okLevel = c.level === c.expect.level
  const okStatus = c.status === c.expect.status
  const okHint = !c.hintMustContain || c.hint.includes(c.hintMustContain)
  // badge 只在用例声明了 expectBadge 时才校验（undefined 表示该场景不关心徽章）
  const okBadge = !('expectBadge' in c) || c.badge === c.expectBadge
  const ok = okLevel && okStatus && okHint && okBadge
  if (!ok)
    failed++
  console.log(`${ok ? '✓' : '✗'} ${c.name}`)
  console.log(`    level=${c.level}(显示「${levelLabel}」) status=「${c.status}」`)
  console.log(`    hint=「${c.hint}」`)
  if ('expectBadge' in c)
    console.log(`    主界面徽章=${c.badge === null ? '(不显示)' : `「${c.badge}」`}`)
  if (!okLevel)
    console.log(`    !! 期望 level=${c.expect.level}`)
  if (!okStatus)
    console.log(`    !! 期望 status=${c.expect.status}`)
  if (!okHint)
    console.log(`    !! hint 应包含「${c.hintMustContain}」`)
  if (!okBadge)
    console.log(`    !! 期望徽章=${c.expectBadge === null ? '(不显示)' : `「${c.expectBadge}」`}`)
}

console.log(`\n结果：${cases.length - failed}/${cases.length} 通过`)
require('node:process').exit(failed === 0 ? 0 : 1)
