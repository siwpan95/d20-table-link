#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""adapter_server.py —— d20 × Cordis 表格应用的联动适配器（JSON-RPC over stdio）

定位
----
把两个已有的东西接起来，**不重复实现任何一侧**：

    ┌────────────────────────┐        ┌──────────────────────────────┐
    │  规则侧：siwpan/d20     │        │  载体侧：siwpan/cordis-table-app │
    │  （薄 shim → 引擎 trpg）│        │  （Cordis 内核 + OpenPyXL）    │
    │  Character / 骰子 / 数据 │        │  工作表 / VTT 地图 / DonJon JSON │
    └───────────┬────────────┘        └───────────────┬──────────────┘
                │   import d20                        │  复用其 rpc_server.handle()
                └──────────────┬──────────────────────┘
                               ▼
                  本适配器：一个进程，两个能力面
                   · 表格方法（**原样转发**给 cordis-table-app 的 handler）
                   · d20_* 方法（本文件实现：角色 / 骰子 / 遭遇）

协议纪律（沿用 cordis-table-app 已验证的约定）
--------------------------------------------
· stdout **只承载**「一行一个 JSON-RPC 2.0 对象」；日志与异常栈一律走 stderr；
· 每个方法 try/except 兜住，返回 JSON-RPC error，**保证子进程不死**；
· stdin/stdout/stderr 统一 UTF-8 —— 中文 Windows 默认 GBK，不设会在中文落盘时崩
  （cordis-table-app 的 rpc_server.py 踩过：见其 `_setup_stdio_utf8` 注释）。

路径发现（不写死本机盘符）
------------------------
按顺序取，命中即停：
  1) 环境变量 `CTA_RPC_SERVER` / `D20_REPO`
  2) 与本仓同级目录（`../cordis-table-app/python/rpc_server.py`、`../d20`）
两侧都可被环境变量覆盖，便于换机/换布局。
"""
import importlib.util
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _setup_stdio_utf8():
    """三条标准流统一 UTF-8（中文 Windows 默认 GBK，不设会导致中文落盘崩）。"""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)          # 本仓根
PARENT = os.path.dirname(REPO)        # 仓的父目录（通常是 G:\repos）


def _locate_cta_rpc():
    """定位 cordis-table-app 的 rpc_server.py（表格能力的来源）。"""
    env = os.environ.get("CTA_RPC_SERVER")
    if env and os.path.isfile(env):
        return env
    cand = os.path.join(PARENT, "cordis-table-app", "python", "rpc_server.py")
    return cand if os.path.isfile(cand) else None


def _locate_d20_repo():
    """定位 d20 仓根（其包目录是 <仓根>/d20）。"""
    env = os.environ.get("D20_REPO")
    if env and os.path.isdir(os.path.join(env, "d20")):
        return env
    cand = os.path.join(PARENT, "d20")
    return cand if os.path.isdir(os.path.join(cand, "d20")) else None


# ---------------------------------------------------------------- 载入两侧

CTA = None
CTA_PATH = _locate_cta_rpc()
if CTA_PATH:
    try:
        _spec = importlib.util.spec_from_file_location("cta_rpc_server", CTA_PATH)
        CTA = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(CTA)
    except BaseException:
        print("[adapter] 载入 cordis-table-app 的 rpc_server 失败:\n" + traceback.format_exc(),
              file=sys.stderr)
        CTA = None

D20 = None
D20_PATH = _locate_d20_repo()
if D20_PATH and D20_PATH not in sys.path:
    sys.path.insert(0, D20_PATH)
try:
    import d20 as D20  # noqa: N816
except BaseException:
    print("[adapter] 载入 d20 失败（可用 D20_REPO 指定仓根）:\n" + traceback.format_exc(),
          file=sys.stderr)
    D20 = None


# ---------------------------------------------------------------- 表格面转发

TABLE_METHODS = {
    "ping", "create_workbook", "add_sheet", "write_rows", "write_cell",
    "style_header", "set_column_width", "read_sheet", "save", "close",
    "set_cell_fill", "merge_cells", "set_cell_text", "set_comment",
    "set_borders", "read_map", "render_map_png", "render_token",
    "gen_dungeon", "export_donjon", "import_donjon",
}


def _table(method, params):
    if CTA is None:
        raise RuntimeError(
            "表格能力不可用：未找到 cordis-table-app 的 rpc_server.py。"
            "用环境变量 CTA_RPC_SERVER 指定其绝对路径。")
    return CTA.handle(method, params)


# ---------------------------------------------------------------- d20 面

def _d20_ping(_p):
    return {
        "available": D20 is not None,
        "d20_version": getattr(D20, "__version__", None) if D20 else None,
        "d20_repo": D20_PATH,
        "attributes": list(D20.ATTRIBUTES) if D20 else [],
    }


def _d20_character(p):
    """建角色并可选设属性，返回角色卡文本与结构化摘要。"""
    if D20 is None:
        raise RuntimeError("d20 不可用（用 D20_REPO 指定其仓根）")
    c = D20.Character()
    for name, val in (p.get("attributes") or {}).items():
        c.set_attribute(name, int(val))
    for item in (p.get("equip") or []):
        try:
            c.equip_item(item)
        except BaseException:
            pass
    sheet = c.show_sheet()
    return {
        "name": p.get("name") or "未命名角色",
        "sheet": sheet if isinstance(sheet, str) else str(sheet),
        "attributes": dict(p.get("attributes") or {}),
    }


def _d20_roll(p):
    """掷骰。

    签名取自 d20 实际探测（2026-09-25，不靠猜）：
        roll_d20(rng=random)                 -> int
        roll_d100(rng=random)                -> int
        roll_d6(num, mod=0, rng=random)      -> (dice: list[int], total: int)
        roll_3d6(rng=random)                 -> (dice: list[int], total: int)
        gurps_success_chance(skill_level)    -> int
    所有掷骰都接受 `rng`，故「可复现」直接由 d20 自己保证（传一个 seeded Random 即可），
    不需要在外层另造随机源。
    """
    if D20 is None:
        raise RuntimeError("d20 不可用（用 D20_REPO 指定其仓根）")
    import random as _random
    rng = _random.Random(int(p["seed"])) if p.get("seed") is not None else _random

    kind = (p.get("kind") or "d20").lower()
    if kind == "d20":
        return {"kind": kind, "value": D20.roll_d20(rng)}
    if kind == "d100":
        return {"kind": kind, "value": D20.roll_d100(rng)}
    if kind == "d6":
        n = int(p.get("n", 1))
        mod = int(p.get("mod", 0))
        dice, total = D20.roll_d6(n, mod, rng)
        return {"kind": "d6", "n": n, "mod": mod, "dice": list(dice), "value": total}
    if kind == "3d6":
        dice, total = D20.roll_3d6(rng)
        return {"kind": kind, "dice": list(dice), "value": total}
    if kind in ("gurps", "success"):
        skill = int(p.get("skill", 12))
        return {"kind": "gurps", "skill": skill, "chance": D20.gurps_success_chance(skill)}
    raise ValueError("未知掷骰类型: " + kind)


def _d20_encounter(p):
    """为地牢房间生成一段「遭遇」，内容全部由 d20 的骰子与数据产生。

    这是联动的核心：**载体给出房间 → 规则侧填充内容**。
    可复现：`seed` 决定全部掷骰（经 d20 的 rng 参数传入），同参数必然同结果。
    """
    if D20 is None:
        raise RuntimeError("d20 不可用（用 D20_REPO 指定其仓根）")
    import random as _random

    room = int(p.get("room", 0))
    level = int(p.get("party_level", 3))
    seed = int(p.get("seed", 0)) + room * 977
    rng = _random.Random(seed)           # 本函数内的选型用
    drng = _random.Random(seed)          # 交给 d20 的掷骰用（两者分开，互不干扰取数顺序）

    attack = D20.roll_d20(drng)
    check_dice, check_total = D20.roll_3d6(drng)
    dc = 10 + level + rng.randint(-2, 3)

    skills = list((getattr(D20, "SKILL_LIBRARY", {}) or {}).keys())
    skill = skills[rng.randrange(len(skills))] if skills else "通用"
    monsters = ["地精", "骷髅兵", "巨鼠", "石像鬼", "暗影狼", "腐化树精", "食人魔", "幽魂"]
    monster = monsters[rng.randrange(len(monsters))]
    kind = ["战斗", "陷阱", "谜题", "宝藏", "社交"][rng.randrange(5)]

    return {
        "room": room,
        "kind": kind,
        "monster": monster if kind == "战斗" else None,
        "skill": skill,
        "dc": dc,
        "attack_roll": attack,
        "check_dice": list(check_dice),
        "check_roll": check_total,
        "party_level": level,
        "seed": seed,
        "summary": "房%d %s｜%s检定 %s（DC %d，检定值 %d）" % (
            room, kind, ("遭遇 " + monster + "，" if kind == "战斗" else ""),
            skill, dc, check_total),
    }


D20_METHODS = {
    "d20_ping": _d20_ping,
    "d20_character": _d20_character,
    "d20_roll": _d20_roll,
    "d20_encounter": _d20_encounter,
}


# ---------------------------------------------------------------- 统一分发

def handle(method, params):
    params = params or {}
    if method in TABLE_METHODS:
        return _table(method, params)
    if method == "adapter_ping":
        return {
            "adapter": "d20-table-link",
            "cta_rpc_server": CTA_PATH,
            "cta_available": CTA is not None,
            "d20_repo": D20_PATH,
            "d20_available": D20 is not None,
        }
    if method in D20_METHODS:
        return D20_METHODS[method](params)
    raise ValueError("unknown method: " + str(method))


def main():
    _setup_stdio_utf8()
    print("[adapter] cordis-table-app = %s | d20 = %s" % (CTA_PATH, D20_PATH), file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            import json
            req = json.loads(line)
        except Exception:
            continue
        msgid = req.get("id")
        method = req.get("method")
        params = req.get("params")
        if method == "exit":
            break
        try:
            import contextlib
            with contextlib.redirect_stdout(sys.stderr):
                result = handle(method, params)
            resp = {"jsonrpc": "2.0", "id": msgid, "result": result}
        except Exception as e:
            resp = {"jsonrpc": "2.0", "id": msgid,
                    "error": {"code": -32000, "message": str(e), "data": traceback.format_exc()}}
        import json as _json
        sys.stdout.write(_json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
