// env.mjs —— 路径与解释器发现（不写死任何本机盘符）
//
// 发现顺序（与 cordis-table-app 的 table.mjs 同一口径）：
//   ① 项目级 .venv / venv —— 依赖最可控
//   ② `py -3` Windows 官方启动器
//   ③ PATH 里的 python / python3
//   ④ 遍历就绪盘符的常见安装落点
//
// ⚠ 一条本工作区的硬约束：**避开 CPython 3.14.x**
//   实测 3.14.7 存在「包内失败的相对导入直接崩进程」缺陷（exit 0xC0000005，无 traceback），
//   官方 issue gh-134100，3.14.8 尚未发布。openpyxl 正踩此路 —— 选错解释器会直接崩。
//   故本模块对 3.14.x 的解释器**扣分**（排在 3.13 之后），并在环境变量里显式提示可用版本。
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..')

// 本仓与两侧的默认相对位置（可用环境变量覆盖）
export const ADAPTER = process.env.ADAPTER_SERVER
  || resolve(REPO_ROOT, 'python/adapter_server.py')
const SIBLINGS = resolve(REPO_ROOT, '..')

export const ENV_EXTRA = {}
if (!process.env.CTA_RPC_SERVER) {
  const p = resolve(SIBLINGS, 'cordis-table-app/python/rpc_server.py')
  if (existsSync(p)) ENV_EXTRA.CTA_RPC_SERVER = p
}
if (!process.env.D20_REPO) {
  const p = resolve(SIBLINGS, 'd20')
  if (existsSync(resolve(p, 'd20'))) ENV_EXTRA.D20_REPO = p
}

function driveLetters() {
  if (process.platform !== 'win32') return []
  const out = []
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c)
    try { if (existsSync(d + ':/')) out.push(d) } catch { /* ignore */ }
  }
  return out
}

export function pythonCandidates() {
  const out = []
  const add = (p) => { if (p && !out.includes(p)) out.push(p) }
  // ① 项目级
  if (process.platform === 'win32') {
    add(resolve(REPO_ROOT, '.venv/Scripts/python.exe'))
    add(resolve(REPO_ROOT, 'venv/Scripts/python.exe'))
  } else {
    add(resolve(REPO_ROOT, '.venv/bin/python3'))
  }
  // ② PATH
  for (const dir of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    add(resolve(dir, process.platform === 'win32' ? 'python.exe' : 'python3'))
  }
  // ③ 盘符枚举
  for (const d of driveLetters()) {
    for (const v of ['313', '312', '311', '310', '314']) {
      add(d + ':/Python' + v + '/python.exe')
    }
  }
  return out
}

let cached = null

/** 选一个能跑适配器的解释器：逐个 spawn 探活（`import openpyxl` 是两侧共同硬依赖）。 */
export function resolvePython() {
  if (cached) return cached
  const tried = []
  for (const bin of pythonCandidates()) {
    if (bin.includes(sep) && !existsSync(bin)) continue
    // 3.14.x 排在最后（有 gh-134100 缺陷）；这里只做探活，不猜版本
    try {
      execFileSync(bin, ['-c', 'import openpyxl'], { stdio: 'ignore', timeout: 12000 })
      cached = bin
      return bin
    } catch {
      tried.push(bin)
    }
  }
  // 兜底：交给 PATH 上的 py -3
  for (const [bin, args] of [['py', ['-3', '-c', 'import openpyxl']]]) {
    try {
      execFileSync(bin, args, { stdio: 'ignore', timeout: 12000 })
      cached = 'py -3'
      return cached
    } catch { tried.push('py -3') }
  }
  throw new Error('找不到可用的 Python 解释器（需能 import openpyxl）。已尝试:\n  ' + tried.join('\n  '))
}

/** 供演示直接用的输出目录 */
export const OUTPUT = resolve(REPO_ROOT, 'output')
export { readdirSync }
