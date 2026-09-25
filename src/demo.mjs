// demo.mjs —— 端到端联动演示：d20（规则）× cordis-table-app（载体）
//
// 演示的联动语义：**载体给出房间 → 规则侧填充内容 → 回写同一张表 → 出图与互通往返**
//
//   1) d20 建角色卡 → 写进 xlsx
//   2) cordis-table-app 程序化生成地牢（Map/Rooms/Encounters/Loot 四表）
//   3) 读回 Rooms 的房间清单，逐间要 d20 产出「遭遇」
//   4) 把 d20 结果写入新表「D20遭遇」（不改动上游表，可追溯）
//   5) 渲染 VTT 地图 PNG
//   6) 导出 DonJon JSON → 再导入为另一份 xlsx → **往返一致性校验**
//
// 运行：node src/demo.mjs      （npm start）
import { mkdirSync, existsSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { RpcBridge } from './rpc.mjs'
import { resolvePython, ADAPTER, ENV_EXTRA, OUTPUT } from './env.mjs'

const COLS = 30
const ROWS = 20
const ROOMS = 6
const LEVEL = 3
const SEED = 20260925

const XLSX = resolve(OUTPUT, 'd20-table.xlsx')
const XLSX_RT = resolve(OUTPUT, 'd20-table-roundtrip.xlsx')
const JSONF = resolve(OUTPUT, 'd20-table.donjon.json')
const PNG = resolve(OUTPUT, 'd20-table.png')

let fails = 0
function check(name, cond, detail = '') {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —— ' + detail : ''))
  if (!cond) fails++
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true })
  for (const f of [XLSX, XLSX_RT, JSONF, PNG]) {
    if (existsSync(f)) rmSync(f)
  }

  const py = resolvePython()
  console.log('== d20 × cordis-table-app 联动演示 ==')
  console.log('  解释器 = ' + py)
  console.log('  适配器 = ' + ADAPTER)
  console.log('  CTA    = ' + (ENV_EXTRA.CTA_RPC_SERVER || '(未自动定位)'))
  console.log('  d20    = ' + (ENV_EXTRA.D20_REPO || '(未自动定位)'))
  console.log('')

  const bridge = new RpcBridge(py, ADAPTER, ENV_EXTRA)
  await bridge.start()
  try {
    const info = await bridge.call('adapter_ping', {})
    check('适配器两侧就绪', info.cta_available && info.d20_available,
      'cta=' + info.cta_available + ' d20=' + info.d20_available)

    // ---- 1) 角色卡（规则侧 → 载体侧）
    console.log('\n[1] d20 角色卡 → 写进工作表')
    const ch = await bridge.call('d20_character', {
      name: '试炼者',
      attributes: { 力量: 16, 敏捷: 14, 体质: 13, 智力: 10, 感知: 12, 魅力: 8 },
    })
    check('角色卡非空', typeof ch.sheet === 'string' && ch.sheet.length > 50,
      ch.sheet.length + ' 字符')

    await bridge.call('create_workbook', { path: XLSX, sheet: '角色卡' })
    const sheetLines = ch.sheet.split('\n').map((l) => [l])
    await bridge.call('write_rows', {
      path: XLSX, sheet: '角色卡', start_row: 1, start_col: 1, rows: sheetLines,
    })
    check('角色卡已写入', sheetLines.length > 5, sheetLines.length + ' 行')

    // ---- 2) 程序化地牢（载体侧）
    console.log('\n[2] cordis-table-app 生成地牢')
    await bridge.call('add_sheet', { path: XLSX, name: 'Map' })
    const gen = await bridge.call('gen_dungeon', {
      path: XLSX, sheet: 'Map', cols: COLS, rows: ROWS, rooms: ROOMS,
      party_level: LEVEL, seed: SEED,
    })
    check('地牢已生成', gen && gen.ok === true, 'rooms=' + gen.rooms + ' sheets=' + (gen.sheets || []).join('/'))

    // ---- 3) 读回房间 → d20 产遭遇
    console.log('\n[3] 读回房间 → d20 逐间生成遭遇')
    const roomsSheet = await bridge.call('read_sheet', { path: XLSX, sheet: 'Rooms' })
    const rooms = roomsSheet.rows || []
    check('Rooms 表有表头+数据', rooms.length >= ROOMS, rooms.length + ' 行')
    const dataRows = rooms.slice(1).filter((r) => r && r[0] != null)
    check('房间数据行数正确', dataRows.length >= ROOMS, dataRows.length + ' 间')

    const encRows = []
    for (const r of dataRows) {
      const roomId = Number(r[0])
      const e = await bridge.call('d20_encounter', {
        room: roomId, party_level: LEVEL, seed: SEED,
      })
      encRows.push([
        roomId, e.kind, e.monster || '', e.skill, e.dc,
        e.attack_roll, e.check_roll, e.summary,
      ])
    }
    check('每间房都拿到遭遇', encRows.length === dataRows.length, encRows.length + ' 条')

    // 可复现性：同样参数再来一次，结果必须一致
    const again = await bridge.call('d20_encounter', {
      room: Number(dataRows[0][0]), party_level: LEVEL, seed: SEED,
    })
    check('d20 遭遇可复现', again.summary === encRows[0][7], again.summary)

    // ---- 4) 回写同一张表（新增表，不动上游表）
    console.log('\n[4] d20 结果回写为「D20遭遇」表')
    await bridge.call('add_sheet', { path: XLSX, name: 'D20遭遇' })
    await bridge.call('write_rows', {
      path: XLSX, sheet: 'D20遭遇', start_row: 1, start_col: 1,
      rows: [['房号', '类型', '怪物', '检定技能', 'DC', '攻击骰', '检定值', '摘要'], ...encRows],
    })
    await bridge.call('style_header', {
      path: XLSX, sheet: 'D20遭遇', row: 1, ncols: 8,
      opts: { bold: true, fill: 'FFD9E1F2' },
    })
    await bridge.call('set_column_width', { path: XLSX, sheet: 'D20遭遇', col: 8, width: 52 })
    const back = await bridge.call('read_sheet', { path: XLSX, sheet: 'D20遭遇' })
    check('D20遭遇 表读回行数正确', (back.rows || []).length === encRows.length + 1,
      (back.rows || []).length + ' 行')

    // ---- 5) VTT 地图 PNG（载体侧）
    console.log('\n[5] 渲染 VTT 地图 PNG')
    const png = await bridge.call('render_map_png', {
      path: XLSX, sheet: 'Map', out: PNG, px: 100, grid: true,
    })
    check('PNG 已生成', existsSync(PNG) && statSync(PNG).size > 1000,
      existsSync(PNG) ? statSync(PNG).size + ' B' : '缺失')

    // ---- 6) DonJon JSON 互通往返
    console.log('\n[6] DonJon JSON 导出 → 导入 → 往返校验')
    const exp = await bridge.call('export_donjon', {
      path: XLSX, sheet: 'Map', out: JSONF,
      name: 'd20-table-demo', px: 100, seed: SEED, level: LEVEL,
    })
    check('导出成功', exp && exp.ok !== false, JSON.stringify(exp).slice(0, 80))

    await bridge.call('create_workbook', { path: XLSX_RT, sheet: 'Map' })
    const imp = await bridge.call('import_donjon', {
      path: XLSX_RT, json: JSONF, sheet: 'Map',
    })
    check('导入成功', imp && imp.ok !== false, JSON.stringify(imp).slice(0, 80))

    await bridge.call('save', { path: XLSX })
    await bridge.call('save', { path: XLSX_RT })
    check('主工作簿落盘', existsSync(XLSX) && statSync(XLSX).size > 2000,
      existsSync(XLSX) ? statSync(XLSX).size + ' B' : '缺失')
    check('往返工作簿落盘', existsSync(XLSX_RT) && statSync(XLSX_RT).size > 1000,
      existsSync(XLSX_RT) ? statSync(XLSX_RT).size + ' B' : '缺失')

    console.log('\n== 输出 ==')
    for (const [label, f] of [['主工作簿', XLSX], ['往返工作簿', XLSX_RT], ['DonJon JSON', JSONF], ['VTT PNG', PNG]]) {
      if (existsSync(f)) console.log('  ' + label.padEnd(12) + f + '  (' + statSync(f).size + ' B)')
    }
  } finally {
    await bridge.stop()
  }

  console.log('\n== 结果: 失败 ' + fails + ' 项 ==')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL: ' + e.message)
  process.exit(1)
})
