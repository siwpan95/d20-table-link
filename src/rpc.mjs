// rpc.mjs —— 最小 JSON-RPC stdio 桥（零依赖）
// 与 cordis-table-app 的 src/core/bridge.mjs 同一协议约定：
//   一行一个 JSON-RPC 2.0 对象；stdout 只承载协议；stderr 只承载日志。
// 这里不引第三方依赖，保证「拷走即可用」。
import { spawn } from 'node:child_process'
import readline from 'node:readline'

export class RpcBridge {
  constructor(pythonBin, scriptPath, env = {}) {
    this.pythonBin = pythonBin
    this.scriptPath = scriptPath
    this.env = env
    this.child = null
    this.pending = new Map()
    this.nextId = 1
    this.stderrLines = []
  }

  start() {
    if (this.child) return Promise.resolve(this.child.pid)
    this.child = spawn(this.pythonBin, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
    })
    this.child.stderr.on('data', (d) => {
      const s = d.toString()
      this.stderrLines.push(s)
      // 只透传适配器自己的日志行，避免噪音淹没结果
      for (const line of s.split('\n')) {
        if (line.trim() && !line.includes('tkinter')) process.stderr.write('[py] ' + line + '\n')
      }
    })
    this.child.on('error', (err) => {
      for (const [, { reject }] of this.pending) reject(err)
      this.pending.clear()
    })
    const rl = readline.createInterface({ input: this.child.stdout })
    rl.on('line', (line) => {
      line = line.trim()
      if (!line) return
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
    this.child.on('exit', (code) => {
      for (const [, { reject }] of this.pending) {
        reject(new Error('adapter exited (code ' + code + ')'))
      }
      this.pending.clear()
    })
    if (this.child.pid) return Promise.resolve(this.child.pid)
    return new Promise((r) => this.child.on('spawn', () => r(this.child.pid)))
  }

  call(method, params) {
    if (!this.child) this.start()
    const id = this.nextId++
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return p
  }

  async stop() {
    if (!this.child) return
    const c = this.child
    try {
      if (c.stdin && !c.stdin.destroyed) {
        c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }) + '\n')
        c.stdin.end()
      }
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300))
    try { if (!c.killed) c.kill() } catch { /* ignore */ }
  }
}
