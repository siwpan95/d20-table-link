// smoke.mjs —— Node 侧冒烟：用选定的解释器跑适配器自检（不依赖 Cordis 内核）
// 目的：在拉起完整演示前，先确认「Python 侧两侧都接上了」。
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePython, ENV_EXTRA, REPO_ROOT } from './env.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT = resolve(REPO_ROOT, 'python/smoke_adapter.py')

let bin
try {
  bin = resolvePython()
} catch (e) {
  console.error('FATAL: ' + e.message)
  process.exit(1)
}

console.log('== Node 侧冒烟 ==')
console.log('  解释器 = ' + bin)
console.log('  脚本   = ' + SCRIPT)
console.log('')

const isLauncher = bin === 'py -3'
const cmd = isLauncher ? 'py' : bin
const args = (isLauncher ? ['-3'] : []).concat(['-u', SCRIPT])

const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...ENV_EXTRA } })
process.exit(r.status == null ? 1 : r.status)
