// 临时校验脚本：直接执行 BatteryCard.tsx 里的 levelFromInfo / statusText / hintText
// 目的：确认「充电中拿不到百分比」不再显示成「等待数据 / 等待电量数据」。
// 用完即删，不留在仓库里。
const fs = require('node:fs')

const src = fs.readFileSync('src/components/BatteryCard.tsx', 'utf8')

// 从源文件里抠出三个纯函数 + 类型别名，去掉 TS 类型后执行。
function extract(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`找不到函数 ${name}`)
  // 从函数开头找到与之匹配的结束大括号（按括号深度扫描）
  let depth = 0
  let i = src.indexOf('{', start)
  const bodyStart = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`函数 ${name} 未闭合`)
}

// Web 端特有的 API 在这个脚本里用不到，去掉 TS 注解后直接执行。
// 参数签名可能跨行，所以先把「( ... )」之间的类型注解整段清掉，再清返回值类型。
const stripped = ['levelFromInfo', 'statusText', 'hintText']
  .map((name) => {
    let body = extract(name)
    // 清掉参数列表里的类型注解：形如 `info: BatteryInfo | null,` / `error: string | null,`
    body = body.replace(/:\s*[A-Za-z][\w.]*(\s*\|\s*(null|[A-Za-z][\w.]*))*/g, '')
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
  return { levelFromInfo, statusText, hintText, LEVEL_LABEL }`)
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
  if (!okLevel || !okStatus || !okHint) failed++
  console.log(`${okLevel && okStatus && okHint ? '✓' : '✗'} ${c.name}`)
  console.log(`    level=${c.level}(显示「${levelLabel}」) status=「${c.status}」`)
  console.log(`    hint=「${c.hint}」`)
  if (!okLevel) console.log(`    !! 期望 level=${c.expect.level}`)
  if (!okStatus) console.log(`    !! 期望 status=${c.expect.status}`)
  if (!okHint) console.log(`    !! hint 应包含「${c.hintMustContain}」`)
}

console.log(`\n结果：${cases.length - failed}/${cases.length} 通过`)
process.exit(failed === 0 ? 0 : 1)
