# d20-table-link —— allin_engine（TRPG 规则内核）× Cordis 表格应用（载体）的联动适配器

## 仓库角色定位（投资组合分级 ①）

> 本仓在 siwpan 投资组合（D:/projects/repos，共 133 仓）中定级为 **① 核心推进**，领域 **跑团/TRPG**，定位 **TRPG+本地AI收敛点**。
> **角色**：allin_engine TRPG × cordis-table-app 适配器，随 TRPG 栈维护。
> **维护策略**：① 核心推进——持续投入、不允许冻结；随所属收敛点 / 流水线长期演进。
> 投资组合统一分级索引（多机可查）：[组合分级决策索引 · allin 事实源](https://gitee.com/siwpan/allin/blob/master/docs/事实源/组合分级决策索引.md)。

> **规则侧依赖已于 2026-10-20 上溯**：原先接 `siwpan/d20`（它自 R2 起只是转发
> `allin_engine.trpg` 的薄 shim），现直接依赖内核 `allin_engine.trpg`；
> siwpan/d20 仓确诊冗余后删除，其界面壳并入 `an-engine`。RPC 方法名 `d20_*` 保持不变。

把两个各自独立的项目接起来，**不重复实现任何一侧**：

```
┌──────────────────────────┐          ┌────────────────────────────────┐
│  规则侧 allin_engine.trpg  │          │  载体侧 siwpan/cordis-table-app │
│  （PyPI allin-engine）    │          │  （Cordis 内核 + OpenPyXL）     │
│  Character / 骰子 / 规则数据│          │  工作表 / VTT 地图 / DonJon JSON │
└────────────┬─────────────┘          └───────────────┬────────────────┘
             │  import allin_engine.trpg              │ 复用其 rpc_server.handle()
             └──────────────────┬─────────────────────┘
                                ▼
                   本仓：一个适配器进程，两个能力面
                   · 表格方法  —— 原样转发给 cordis-table-app 的处理器
                   · d20_* 方法 —— 角色卡 / 掷骰 / 遭遇生成
```

## 联动的语义

**载体给出房间 → 规则侧填充内容 → 回写同一张表 → 出图与互通往返。**

`cordis-table-app` 能程序化生成地牢（`Map`/`Rooms`/`Encounters`/`Loot` 四张表），
但房间里的「遭遇」只是占位文本；`allin_engine.trpg` 有完整的角色/骰子/规则数据，却没有任何表格能力。
本仓把两者接上：读回 `Rooms` 的房间清单，逐间要规则内核产出遭遇（含真实掷骰结果），
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

载体侧位置默认按**同级目录**推断（`../cordis-table-app`）；规则侧不再探测目录——
`allin_engine` 是 PyPI 上的正式发行包，直接 import。可用环境变量覆盖：

| 变量 | 用途 |
| --- | --- |
| `CTA_RPC_SERVER` | `cordis-table-app/python/rpc_server.py` 的绝对路径 |
| ~~`D20_REPO`~~ | **已下线**：随 siwpan/d20 仓删除，规则侧改为 `pip install allin-engine` |
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
# 规则侧：allin-engine（PyPI），提供 allin_engine.trpg
.\.venv\Scripts\python.exe -m pip install allin-engine
```

> 旧版 README 里「`d20` 仓没有打包元数据，用 `D20_REPO` 指向仓根」的做法已废止：
> 规则侧现在是 PyPI 上的 `allin-engine`，pip 安装即可，与目录布局无关。

## 依赖

| 侧 | 依赖 | 说明 |
| --- | --- | --- |
| Python | `openpyxl` | 表格能力（`cordis-table-app` 的硬依赖） |
| Python | `Pillow` | `render_map_png` / `render_token` 需要；**不装则 PNG 步骤失败**（其余步骤不受影响） |
| Python | `allin-engine` | 规则能力（子系统 `allin_engine.trpg`） |
| Node | 无 | 零三方依赖（`src/rpc.mjs` 只用 `node:child_process` / `node:readline`） |

## 许可

MIT，见 [LICENSE](./LICENSE)。

## 相关

- 规则侧：[`siwpan/an-engine`](https://gitee.com/siwpan/an-engine) —— 规则内核 `allin_engine.trpg`（D&D-GURPS 变体角色构建器）
  （原 `siwpan/d20` 仓：自 R2 起仅为转发该内核的薄 shim，2026-10-20 确诊冗余后删除，界面壳已并入 an-engine）
- 引擎侧：[`siwpan/an-engine`](https://gitee.com/siwpan/an-engine) —— 统一游戏引擎（PyPI `allin-engine`），规则内核在 `allin_engine/trpg`
- 载体侧：[`siwpan/cordis-table-app`](https://gitee.com/siwpan/cordis-table-app) —— Cordis + OpenPyXL 表格/地图应用
