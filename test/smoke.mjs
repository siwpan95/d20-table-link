// test/smoke.mjs —— d20-table-link 最小测试骨架（离线，不依赖 RPC 服务 / 解释器环境变量）
//
// 运行：node --test test/    （或 npm test）
// 只测纯本地可验证面：路径口径 / 适配器脚本存在 / 解释器发现 / RpcBridge 构造契约。
// 端到端联动（demo.mjs）需要 cordis-table-app 的 RPC 服务与 allin-engine，
// 属集成场景，不在本骨架范围（见 README 运行说明）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { REPO_ROOT, ADAPTER, OUTPUT, pythonCandidates, resolvePython } from '../src/env.mjs'
import { RpcBridge } from '../src/rpc.mjs'

test('env: REPO_ROOT / ADAPTER / OUTPUT 口径正确', () => {
  assert.match(REPO_ROOT, /d20-table-link$/)
  assert.match(ADAPTER, /adapter_server\.py$/)
  assert.match(OUTPUT, /output$/)
})

test('env: 适配器脚本真实存在', () => {
  assert.ok(existsSync(ADAPTER), `missing adapter: ${ADAPTER}`)
})

test('env: pythonCandidates 返回候选数组', () => {
  const c = pythonCandidates()
  assert.ok(Array.isArray(c) && c.length > 0, 'candidates 为空')
})

test('env: resolvePython 解析出可用解释器', () => {
  const p = resolvePython()
  assert.equal(typeof p, 'string')
  assert.ok(p.length > 0)
  // 本机硬约束：避开 CPython 3.14.x（env.mjs 头注释）
  assert.ok(!/3\.14/i.test(p), `不应选 3.14.x: ${p}`)
})

test('rpc: RpcBridge 构造为纯本地对象，不启动子进程', () => {
  const b = new RpcBridge('python', 'x.py')
  assert.equal(b.child, null)
  assert.equal(b.nextId, 1)
  assert.equal(typeof b.start, 'function')
  assert.equal(typeof b.call, 'function')
})
