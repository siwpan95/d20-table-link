# d20-table-link —— d20（TRPG 规则内核）× Cordis 表格应用（载体）的联动适配器

把两个各自独立的项目接起来，**不重复实现任何一侧**：

```
┌──────────────────────────┐          ┌────────────────────────────────┐
│  规则侧 siwpan/d20        │          │  载体侧 siwpan/cordis-table-app │
│  （薄 shim → 引擎 trpg）  │          │  （Cordis 内核 + OpenPyXL）     │
│  Character / 骰子 / 规则数据│          │  工作表 / VTT 地图 / DonJon JSON │
└────────────┬─────────────┘          └───────────────┬────────────────┘
             │  import d20                            │ 复用其 rpc_server.handle()
             └──────────────────┬─────────────────────┘
                                ▼
                   本仓：一个适配器进程，两个能力面
                   · 表格方法  —— 原样转发给 cordis-table-app 的处理器
                   · d20_* 方法 —— 角色卡 / 掷骰 / 遭遇生成
```

## 联动的语义

**载体给出房间 → 规则侧填充内容 → 回写同一张表 → 出图与互通往返。**

`cordis-table-app` 能程序化生成地牢（`Map`/`Rooms`/`Encounters`/`Loot` 四张表），
但房间里的「遭遇」只是占位文本；`d20` 有完整的角色/骰子/规则数据，却没有任何表格能力。
本仓把两者接上：读回 `Rooms` 的房间清单，逐间要 d20 产出遭遇（含真实掷骰结果），
写入新表 `D20遭遇`（**不改动上游表，保持可追溯**）。

## 架构

| 组件 | 职责 |
| --- | --- |
| `python/adapter_server.py` | JSON-RPC over stdio 适配器：**一个进程两个能力面**。表格方法原样转发给 `cordis-table-app/python/rpc_server.py`（以 `importlib` 按其文件路径加载，不要求它是可安装包）；`d20_*` 方法在本文件实现 |
| `python/smoke_adapter.py` | 适配器自检（15 项：两侧可用性 / 表格面 / 规则面 / 联动可复现 / 载体面），退出码即结论 |
| `src/rpc.mjs` | 最小 JSON-RPC stdio 桥（零依赖，沿用 cordis-table-app 的 `bridge.mjs` 协议约定） |
| `src/env.mjs` | 路径与解释器发现（**不写死盘符**；对 Python 3.14.x 扣分，见下） |
| `src/demo.mjs` | 端到端演示：角色卡 → 地牢 → d20 遭遇回写 → PNG → DonJon 往返 |
| `src/smoke.mjs` | Node 侧冒烟：用选定解释器跑适配器自检 |

## 运行

```bash
npm run smoke     # 先确认 Python 侧两侧都接上了
npm start         # 端到端联动演示
```

两侧位置默认按**同级目录**推断（`../cordis-table-app`、`../d20`），可用环境变量覆盖：

| 变量 | 用途 |
| --- | --- |
| `CTA_RPC_SERVER` | `cordis-table-app/python/rpc_server.py` 的绝对路径 |
| `D20_REPO` | `d20` 仓根（其包目录为 `<仓根>/d20`） |
| `ADAPTER_SERVER` | 本仓适配器脚本路径（一般不必设） |

## ⚠ Python 版本要求（本工作区实测，务必遵守）

**不要用 Python 3.14.x。** 实测 3.14.7 存在 CPython 缺陷：**包内失败的相对导入
（`from ..x import y`，目标不存在）会直接崩溃进程**，`exit 0xC0000005`，无 traceback。
官方对应 `gh-134100`，3.14.8 尚未发布。`openpyxl` 正踩此路（`from ..tests import KEEP_VBA`），
因此 3.14.7 环境下 `import openpyxl` 必然崩。

**用 Python 3.13.x**（本工作区实测 3.13.14 可用）。`src/env.mjs` 的发现顺序已把
项目级 `.venv` 排在最前，并对 3.14.x 的落点排在最后。

建议做法：

```powershell
# 用一个可用的 3.13 解释器建项目级 venv
<python3.13> -m venv .venv
.\.venv\Scripts\python.exe -m pip install openpyxl Pillow
# d20 需要它的规则内核：allin-engine（PyPI）
.\.venv\Scripts\python.exe -m pip install allin-engine
```

> `d20` 仓本身没有打包元数据（无 `pyproject.toml`/`setup.py`），故通过 `D20_REPO`
> 指向其仓根即可，不需要 pip 安装。

## 依赖

| 侧 | 依赖 | 说明 |
| --- | --- | --- |
| Python | `openpyxl` | 表格能力（`cordis-table-app` 的硬依赖） |
| Python | `Pillow` | `render_map_png` / `render_token` 需要；**不装则 PNG 步骤失败**（其余步骤不受影响） |
| Python | `allin-engine` + `d20` | 规则能力 |
| Node | 无 | 零三方依赖（`src/rpc.mjs` 只用 `node:child_process` / `node:readline`） |

## 许可

MIT，见 [LICENSE](./LICENSE)。

## 相关

- 规则侧：[`siwpan/d20`](https://gitee.com/siwpan/d20) —— D&D-GURPS 变体角色构建器（规则界面壳）
- 引擎侧：[`siwpan/an-engine`](https://gitee.com/siwpan/an-engine) —— 统一游戏引擎（PyPI `allin-engine`），规则内核在 `allin_engine/trpg`
- 载体侧：[`siwpan/cordis-table-app`](https://gitee.com/siwpan/cordis-table-app) —— Cordis + OpenPyXL 表格/地图应用
