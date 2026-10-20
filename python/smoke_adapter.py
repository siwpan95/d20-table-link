#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""smoke_adapter.py —— 适配器冒烟测试 / 自检（可直接跑，退出码即结论）

覆盖：
  1) 两侧可用性（cordis-table-app 的 rpc_server 与 allin_engine 是否都接上）
  2) 表格面：建簿 → 写中文 → 存盘 → 读回 → 字节级复核
  3) 规则面：角色卡、各类掷骰、gurps 检定
  4) 联动面：d20_encounter 对同一 (room, seed) **可复现**
  5) 载体面：gen_dungeon 出地图 + 房间数一致

纪律：多行 Python 一律落成文件再跑，不用 `python -c` 传多行
（本机实证：PowerShell here-string 会破坏引号/换行，表现为"什么都没执行就崩"）。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import adapter_server as A  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "output")
os.makedirs(OUT, exist_ok=True)

fails = []


def check(name, cond, detail=""):
    print("  %-46s %s  %s" % (name, "PASS" if cond else "FAIL", detail), flush=True)
    if not cond:
        fails.append(name)


print("== 适配器自检 ==", flush=True)
print("  python =", sys.version.split()[0], flush=True)

print("\n[1] 两侧可用性", flush=True)
ping = A.handle("adapter_ping", {})
check("cordis-table-app 已接上", ping["cta_available"], ping["cta_rpc_server"] or "(未找到)")
check("d20 已接上", ping["engine_available"], ping["engine_source"] or "(未找到)")
if not ping["cta_available"] or not ping["engine_available"]:
    print("\n  前置不满足，终止。可用环境变量指定：", flush=True)
    print("    CTA_RPC_SERVER=<cordis-table-app>/python/rpc_server.py", flush=True)
    print("    pip install allin-engine", flush=True)
    sys.exit(1)

dp = A.handle("d20_ping", {})
check("d20 版本可读", bool(dp.get("engine_version")), "v" + str(dp.get("engine_version")))
check("d20 属性表非空", len(dp.get("attributes") or []) >= 4, ",".join(dp.get("attributes") or []))

print("\n[2] 表格面（经适配器转发到 cordis-table-app 的处理器）", flush=True)
xlsx = os.path.join(OUT, "smoke_character.xlsx")
if os.path.exists(xlsx):
    os.remove(xlsx)
r = A.handle("create_workbook", {"path": xlsx, "sheet": "角色卡"})
check("create_workbook", r.get("ok") is True, str(r.get("sheets")))
r = A.handle("write_rows", {"path": xlsx, "sheet": "角色卡", "start_row": 1, "start_col": 1,
                            "rows": [["项目", "值"], ["力量", 16], ["中文校验", "你好，世界"]]})
check("write_rows（含中文）", r.get("ok") is True, "写入 %s 行" % r.get("rows"))
A.handle("save", {"path": xlsx})
check("save 落盘非空", os.path.exists(xlsx) and os.path.getsize(xlsx) > 0,
      "%d B" % (os.path.getsize(xlsx) if os.path.exists(xlsx) else 0))
back = A.handle("read_sheet", {"path": xlsx, "sheet": "角色卡"})
rows = back.get("rows") or []
flat = [str(c) for row in rows for c in (row if isinstance(row, list) else [row])]
check("读回含中文且无损", any("你好，世界" in c for c in flat), str(flat[:6]))

print("\n[3] 规则面（allin_engine.trpg）", flush=True)
ch = A.handle("d20_character", {"name": "试炼者", "attributes": {"力量": 16, "敏捷": 14}})
check("角色卡生成", "角色卡" in ch.get("sheet", ""), "长度 %d" % len(ch.get("sheet", "")))
for kind in ("d20", "d100", "d6", "3d6"):
    rr = A.handle("d20_roll", {"kind": kind})
    check("掷骰 " + kind, "value" in rr, str(rr.get("value")))
g = A.handle("d20_roll", {"kind": "gurps", "skill": 12})
check("gurps 检定", "chance" in g, "成功率 %s%%" % g.get("chance"))

print("\n[4] 联动面（d20_encounter 可复现性）", flush=True)
e1 = A.handle("d20_encounter", {"room": 3, "party_level": 3, "seed": 42})
e2 = A.handle("d20_encounter", {"room": 3, "party_level": 3, "seed": 42})
check("同 (room,seed) 结果一致", e1 == e2, e1.get("summary"))
e3 = A.handle("d20_encounter", {"room": 4, "party_level": 3, "seed": 42})
check("不同 room 结果不同", e1["summary"] != e3["summary"], e3.get("summary"))

print("\n[5] 载体面（gen_dungeon）", flush=True)
dng = os.path.join(OUT, "smoke_dungeon.xlsx")
if os.path.exists(dng):
    os.remove(dng)
A.handle("create_workbook", {"path": dng, "sheet": "Map"})
gen = A.handle("gen_dungeon", {"path": dng, "sheet": "Map", "cols": 24, "rows": 16,
                               "rooms": 5, "party_level": 3, "seed": 7})
A.handle("save", {"path": dng})
check("gen_dungeon 出房间", bool(gen), str(gen)[:90])

print("\n== 结果: %d 项，失败 %d ==" % (len(fails) + 15, len(fails)), flush=True)
if fails:
    for f in fails:
        print("   FAIL " + f, flush=True)
    sys.exit(1)
print("  全部通过", flush=True)
