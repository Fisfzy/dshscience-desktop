# danus execution / orchestration 精确行为规格（Python→TypeScript 移植依据）

> 依据以下源码逐行提取（非推断）：
> - `danus/execution/{README, layout, scaffold, loop, __main__, __init__}.py` 与 `danus/execution/tests/{conftest, test_execution, test_loop}.py`
> - `danus/orchestration/{README, cli, __main__}.py` 与 `danus/orchestration/tests/{__init__, conftest, test_cli_verbs, test_orchestration}.py`
> - `agents/contracts/worker.md`, `agents/contracts/main_agent.md`
> - `danus/write_paper/assemble.py` 的 `_terminal_facts / write_target_fact_ids / _is_default_paper / _validate_paper_id`（被 `finalize` 复用）
> - `danus/codex.py`（`resolve_bin / model / effort / exec_cmd / subprocess_env / project_worker_config_args`，loop 与 write_codex_config 依赖）
> - `danus/core/factgraph.py` 的 `add/exists/list/predecessors`（finalize 依赖）

---

## 0. 模块分层与两层真相

`danus.execution` 是**库层**（磁盘 layout + worker 脚手架 + 每 worker 外循环），`danus.orchestration` 是**薄 UX 壳**（CLI 动词，调用 execution 作为库）。二者共享同一套路径/名称来源 `layout.py`，不会漂移。

- 布局与工人循环的"唯一真相"在 `execution/layout.py`（所有文件名、根目录、roles 解析）。
- `execution/scaffold.py` 写脚手架 + 分离式启动 loop。
- `execution/loop.py` 是自驱动外循环司机。
- `orchestration/cli.py` 仅是动词，读/写只在项目目录下，从不直接写 truth stores（global_memory / fact_graph）。`new` 只创建空的 `global_memory/` `fact_graph/` 目录，由 core 首次写时惰性填充。

---

## 1. 完整磁盘布局

### 1.1 控制文件名常量（layout.py 单一出处）

```
TASK_FILE       = "TASK.md"
ROLE_FILE       = ".role"
PID_FILE        = ".pid"
LOCK_FILE       = ".pid.lock"
STOP_FILE       = ".stop"
STATUS_FILE     = ".status.json"
LOGS_DIR        = "logs"
DEADLINE_FILE   = ".run_deadline"
```

### 1.2 根目录解析（均 env 在「调用时」读取，非 import 时）

| 函数 | 逻辑 | 默认 |
|---|---|---|
| `repo_root()` | `Path(__file__).resolve().parents[2]`（`<repo>/danus/execution/layout.py` 上溯两级 = `<repo>`） | — |
| `agents_root()` | `DANUS_AGENTS_ROOT` env 若存在 → `Path(env).resolve()`，否则 `(Path.cwd()/ "runtime" / "projects").resolve()` | `<cwd>/runtime/projects` |
| `worker_md()` | `DANUS_WORKER_CONTRACT` env 若存在 → resolve，否则 `repo_root()/"agents"/"contracts"/"worker.md"` | `<repo>/agents/contracts/worker.md` |
| `worker_skills_dir()` | `DANUS_WORKER_SKILLS` env → resolve，否则 `repo_root()/"agents"/"skills"/"worker"` | `<repo>/agents/skills/worker` |

### 1.3 项目/worker 目录（全部派生自 agents_root）

```
project_dir(p)   = agents_root()/p                       # 共享项目根 = DANUS_PROJECT_DIR
workers_dir(p)   = project_dir(p)/"workers"
worker_dir(p,w)  = workers_dir(p)/w
```

`list_workers(project)`：`workers/` 下所有 `is_dir()` 的条目名，`sorted()` 返回；目录不存在返回 `[]`。
`list_projects()`：`agents_root()` 下所有 `(p/"workers").is_dir()` 的条目名，`sorted()`；root 不存在返回 `[]`。

### 1.4 一棵完整项目树（精确名称与内容格式）

```
<agents_root>/<project>/                 # = DANUS_PROJECT_DIR（共享）
  global_memory/  fact_graph/            # new 时仅建空目录，core 首次写时惰性填充
  project.json                           # 花名册 + 元数据（见 1.5）
  .run_deadline                          # 可选 epoch 上限（浮点秒，一行文本）
  TARGET.md                              # 默认 paper 的最终目标事实（finalize 写入；见 1.7）
  paper/                                 # 默认 paper 的工作区（assemble.paper_workspace 默认）
  workers/<worker>/                      # worker 家目录 = codex cwd = LocalMemory 根
    AGENTS.md -> agents/contracts/worker.md      # 符号链接（静态合同，codex 读）
    .agents/skills -> agents/skills/worker       # 符号链接（worker 技能）
    .codex/config.toml                            # MCP = danus.gateway，role=worker
    TASK.md                                       # 每轮任务（danus assign 写）
    local_memory/                                 # worker 私有（codex 写）
    .role  .pid  .pid.lock  .stop  .status.json  logs/
```

### 1.5 `project.json` 精确内容（do_new 写入，`ensure_ascii=False, indent=2`）

```json
{
  "name": "P",
  "model": "gpt-5.6-sol",
  "roles": "high:3,xhigh:4",
  "workers": ["high", "high2", "high3", "xhigh", "xhigh2", "xhigh3", "xhigh4"]
}
```

- `name` = 项目名；`model` = 传入 `--model` 或 `codex.model("DANUS_WORKER_MODEL")`；`roles` = 原始 roles 字符串（**未改写**）；`workers` = 实际创建的 worker 名列表（有序，至少 1 个）。
- CLI `do_list` 读取失败（JSONDecodeError/OSError）时 fallback 为空 dict → model 显示 `—`。

### 1.6 `.role` 文件精确内容（do_new 写入）

```
MODEL=gpt-5.6-sol
REASONING_EFFORT=high
ROLE=high
DANUS_AUTHOR=high
```

- 每个 worker 一行一条 `KEY=VALUE`，`\n` 结尾。`REASONING_EFFORT` 与 `ROLE` 都是 **base role**（去掉数字后缀），`DANUS_AUTHOR` 是 **worker 全名**（带后缀，如 `high2`/`xhigh4`）。
- 解析侧（`_read_role`）：逐行 `strip()`，跳过空行与以 `#` 开头的行，含 `=` 才拆 `k,v = line.split("=", 1)`，`k.strip()=v.strip()`。

### 1.7 `TARGET.md`（finalize 写入；assemble.write_target_fact_ids）

- 默认 paper（paper_id=None/`""`/`"main"`）路径 = `<project>/TARGET.md`。
- 非默认 paper 路径 = `<project>/papers/<paper_id>/TARGET.md`。
- 精确内容（`\n` 拼接 + 末尾 `\n`；**不** 校验每个 id 是否存在于图——由调用方 `danus finalize` 先校验）：

```
# TARGET — the finalized target theorem(s) for this project
#
# Written by `danus finalize <project> <fact_id> ...`; read by write-paper
# (assemble.resolve_headline). One fact id per line.
#
<fact_id>
<fact_id>
```

- 读取侧（`target_fact_ids`）：逐行，跳过空行与 `#` 行；去前缀正则 `^\s*target(_fact_ids)?\s*:\s*`（忽略大小写）；对 `_TARGET_ID_RE = r"fact_[A-Za-z0-9_]+|\b[0-9a-f]{8,}\b"` 取 token 去重保序。

### 1.8 `.status.json` 字段

- **do_new 初始**（`atomic_write` 直接写，非 write_status）：`{"worker": w, "state": "created", "round": 0}`，`indent=2`，无 pid/updated_at。
- **loop 运行时**（`write_status`）：总是合并旧值，然后强制盖上三个字段：
  - `worker` = wl.name
  - `pid` = `os.getpid()`
  - `updated_at` = `time.time()`
  - 其余为本次传入的 `**fields`（state/round/started_at/last_round_at/last_rc/last_fact_id/round_started_at/error…）。
  - 原子写：先写 `<path>.tmp`，再 `os.replace`。合并（merge）而非覆盖——第二次写入保留先前字段（测试固化）。

### 1.9 `.run_deadline`

- 位于 `<project>/.run_deadline`。文本内容 = 一个浮点 epoch 秒（如 `1`）。
- `_deadline_passed(project_dir)`：文件不存在 → False；`float(file.strip()) >= time.time()` → True；`ValueError`/`OSError` → False。即文件为垃圾内容时按「未过期」处理。

### 1.10 `logs/`、`local_memory/`、`workers/` 命名

- 每 worker 家目录下：
  - `logs/`：`loop.log`（spawn_loop 以 `a` 模式追加）+ 每轮 `round_<N>.log`（循环以 `w` 覆盖写）。
  - `local_memory/`：worker 私有，codex 直接写（`notes.jsonl`/`events.jsonl` 约定见 worker.md）。
  - `workers/`：每 worker 一个子目录，名 = worker 名（见 §2 命名规则）。
- **worker 名生成规则**：见 §2。worker 名唯一，字母开头（`[A-Za-z][A-Za-z0-9_]*` 去掉 `:N`）。

### 1.11 WorkerLayout typed view（worker 家目录的便捷视图）

`@dataclass(frozen=True)`，仅 `dir: Path`。属性均为派生：

- `name` = dir.name；`project_dir` = `dir.parents[1]`（`<project>/workers/<worker>` 上溯两级 = `<project>`）；`project` = project_dir.name。
- `task`=dir/TASK.md；`role`=dir/.role；`pid`=dir/.pid；`lock`=dir/.pid.lock；`stop`=dir/.stop；`status`=dir/.status.json；`logs`=dir/logs；`local_memory`=dir/local_memory；`codex_config`=dir/.codex/config.toml。

---

## 2. scaffold.do_new 完整行为

签名：`do_new(project: str, roles: str = "high:3,xhigh:4", model: Optional[str] = None) -> Dict`

### 2.1 roles 解析（`parse_roles`）

- 正则 `_ROLE_RE = r"^([A-Za-z][A-Za-z0-9_]*?):(\d+)$"`。按逗号切分每个 `part`（去空白，跳过空），`base, count = re.match(...)`；`int(count)`。
- 每个 part 生成 `count` 个 worker，命名：第 1 个用裸名 `base`，其余 `base+i`（`i` 从 2 到 count）。所有 worker 的 base role（去掉数字）都一样，如 `"high:3"` → `[("high","high"),("high2","high"),("high3","high")]`；`"high:3,xhigh:4"` → `[("high","high"),("high2","high"),("high3","high"),("xhigh","xhigh"),("xhigh2","xhigh"),("xhigh3","xhigh"),("xhigh4","xhigh")]`。
- **拒绝**：空 spec（`""`、空白）、count<1（`high:0`）、无冒号（`high`）、非数字 count（`high:abc`）、无 base（`:3`）、base 非字母开头（`3:high`）→ 抛 `ValueError`。空 spec 单独抛 `ValueError("empty role spec")`。

### 2.2 拒绝覆盖已有项目

`pdir = project_dir(project)`，若 `pdir.exists()` → `raise SystemExit(f"project already exists: {pdir} (pick another name or remove it)")`（绝不静默覆盖活的事实图）。

### 2.3 目录创建 + worker 脚手架

```
model = model or _default_model()          # _default_model() = codex.model("DANUS_WORKER_MODEL")
workers_dir(project).mkdir(parents=True, exist_ok=True)
(pdir/"global_memory").mkdir(exist_ok=True)
(pdir/"fact_graph").mkdir(exist_ok=True)
# 每个 worker：
wl = WorkerLayout(worker_dir(project, worker))
wl.local_memory.mkdir(parents=True, exist_ok=True)
wl.logs.mkdir(exist_ok=True)
symlink(worker_md(), wl.dir/"AGENTS.md")            # 符号链接
(wl.dir/".agents").mkdir(exist_ok=True)
symlink(worker_skills_dir(), wl.dir/".agents"/"skills")
write_codex_config(wl)
atomic_write(wl.task, _TASK_PLACEHOLDER)
atomic_write(wl.role, f"MODEL={model}\nREASONING_EFFORT={base}\nROLE={base}\nDANUS_AUTHOR={worker}\n")
atomic_write(wl.status, json.dumps({"worker": worker, "state": "created", "round": 0}, indent=2))
```

- `_TASK_PLACEHOLDER` 精确内容：
  ```
  # Task

  (unassigned — the main agent writes your assignment here via `danus assign`; you read this file at the start of every round)
  ```
- `atomic_write(path, text)`：`path.parent.mkdir(parents=True, exist_ok=True)`，写 `path.with_suffix(path.suffix + ".tmp")`（`.tmp` 后缀），再 `os.replace(tmp, path)`。
- `symlink(target, link)`：若 `link.is_symlink()` 或 `link.exists()` → 直接返回（不覆盖）；否则 `os.symlink(target, link)`，捕获 `OSError` 静默（在符号链接不支持的平台上，codex config 仍指向 repo，worker 不坏）。

### 2.4 `write_codex_config` 精确输出

模板 `_CODEX_CONFIG`，`.format(python=..., project_dir=..., author=..., verify_url=...)`，每个值经 `_toml_str`（`"` + 反斜杠 `\`→`\\`、`"`→`\"` + `"`）。`command` = `sys.executable`（运行 danus 的那个 Python，每次 loop 启动重写，venv 移动/重建自动跟上；绝不解析成 PATH 上别的 `python3`）。

逐字输出（对 worker `high`、项目根 `<agents_root>/P`、验证默认 URL）：

```toml
# Auto-generated by danus (rewritten each time the worker loop starts); do not hand-edit.
[mcp_servers.danus]
command = "<sys.executable>"
args = ["-m", "danus.gateway"]
# fact_submit blocks on the verify service (a cold-started codex that can reason
# for minutes on a hard proof); codex's default tool-call timeout is 120s, which
# would abort those legitimate long verifications. Match the verify HTTP timeout.
tool_timeout_sec = 3600

[mcp_servers.danus.env]
DANUS_PROJECT_DIR = "<agents_root>/P"
DANUS_AUTHOR = "high"
DANUS_ROLE = "worker"
DANUS_VERIFY_URL = "http://127.0.0.1:8091/verify"
```

- `DANUS_PROJECT_DIR` = `wl.project_dir`（**共享**项目根，不是 worker 家目录）。
- `DANUS_AUTHOR` = `wl.name`（worker 名）。
- `DANUS_VERIFY_URL` = `_verify_url()` = `os.environ.get("DANUS_VERIFY_URL", "http://127.0.0.1:8091/verify")`。
- 注意：config 中**不含** model 字段；model/effort 是通过 loop 启动的 codex `exec --model/--config` 传入，不走 config.toml（该文件只含 MCP 接线）。

### 2.5 返回值

`{"project_dir": str(pdir), "workers": created}`（created 为 worker 名列表，有序）。

### 2.6 spawn_loop（分离式启动，§5 详述）

---

## 3. loop.py 外循环完整语义

### 3.1 kickoff prompt 全文（`kickoff(project, worker)` 逐字）

```
You are worker '{worker}' on project '{project}'. Continue solving the problem (this is a continuation round, not a fresh start).
1. Read TASK.md — your current assignment (which direction/subgoal is yours).
2. Follow AGENTS.md (worker.md) exactly — your standing contract (the adaptive control loop, memory discipline, the fact_submit gate). Drive toward a full verified result.
3. Resume from state: gm_search relevant findings + dead ends, read the fact graph and the latest master_guidance — DO NOT restart from zero; build on what is already there.
4. Keep going: assess -> pick skills adaptively -> act -> persist, repeatedly. An open problem is not a reason to stop. Do NOT finalize prematurely.
5. Persist as you go: rough progress to local memory; shareable findings via gm_add; any verified result via fact_submit.
```

（`{project}`/`{worker}` 为实际项目名/worker 名。）

### 3.2 配置 env（全部在 CALL 时间读取；测试注入这些）

| env | 默认 | 用途 |
|---|---|---|
| `DANUS_ROUND_BEAT` | `"5"` | 轮与轮之间睡眠秒数（`float`） |
| `DANUS_ROUND_HARD_TIMEOUT` | `"14400"`（4h） | 单轮硬超时秒数（`int`）；0=不超时 |
| `DANUS_MAX_ROUNDS` | `"0"` | 轮数后限；0=不限 |
| `DANUS_MAX_CONSEC_FAILURES` | `"5"` | 连续失败后退出；0=不限 |
| `DANUS_CODEX_BIN` / 别名 `CODEX_BIN` | `"codex"` | codex 二进制（经 `codex.resolve_bin`） |
| `DANUS_WORKER_MODEL` | 见 `codex.model` | worker 模型（.role MODEL 优先于 env？见 3.3） |
| `DANUS_PROJECT_<TOKEN>_WORKER_API_*` | 无 | 可选的按项目 worker-only provider（`project_worker_config_args`） |
| `DANUS_VERIFY_URL` | `http://127.0.0.1:8091/verify` | gateway/verify 端点（由 config.toml 引用） |

**优先级**（`codex.model`）：per-service override env（此场景 `DANUS_WORKER_MODEL`）→ `DANUS_MAIN_MODEL`（back-compat 别名 `DANUS_CODEX_MODEL`）→ `DEFAULT_MODEL="gpt-5.6-sol"`。
**codex 解析**（`codex.resolve_bin`）：`DANUS_CODEX_BIN` 覆盖（绝对路径用之；否则 `shutil.which` 解析，解析不到 fallback 原串）→ `<repo>/bin/codex` wrapper（存在用之）→ `shutil.which("codex")` → 裸串 `"codex"`。

### 3.3 `_read_role(wl)` —— `.role` 读取

- 默认 `{"MODEL": codex.model("DANUS_WORKER_MODEL"), "REASONING_EFFORT": "high", "ROLE": "high", "DANUS_AUTHOR": wl.name}`。
- `.role` 存在则逐行解析（同 1.6），用文件值覆盖默认。因此 `.role` 中的 `REASONING_EFFORT`/`ROLE`（base role）/`MODEL`/`DANUS_AUTHOR` 覆盖默认。

### 3.4 `run_round(wl, role, prompt, log_path, hard_timeout) -> int`

- `codex_bin = codex.resolve_bin()`；`cmd = codex.exec_cmd(codex_bin, role["MODEL"], role["REASONING_EFFORT"], *codex.project_worker_config_args(wl.project), "-C", str(wdir), "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", prompt)`。
- `exec_cmd` 返回 `[codex_bin, "exec", "--model", MODEL, "--config", f'model_reasoning_effort="{effort}"', *tail]`。所以最终 cmd：
  ```
  <codex> exec --model <MODEL> --config 'model_reasoning_effort="<EFFORT>"' [..project worker config args..] -C <wdir> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <prompt>
  ```
- 打开 `log_path` 为 `"w"`；`Popen(cmd, stdout=logf, stderr=STDOUT, stdin=DEVNULL, cwd=str(wdir), env=codex.subprocess_env(codex_bin, worker_project=wl.project))`；`_Child.proc = Popen(...)`。
- `FileNotFoundError` → 写 `[worker_loop] codex binary not found: <cmd[0]>` 到日志，返回 **127**。
- `proc.wait(timeout=hard_timeout if hard_timeout > 0 else None)`：
  - 正常返回 = codex 的 rc。
  - `TimeoutExpired` → `proc.terminate()` → `wait(timeout=10)`；仍超时 → `proc.kill()`；写 `\n[worker_loop] round hard-timeout after <hard_timeout>s`；返回 **124**。
- `finally`：`_Child.proc = None`。
- `subprocess_env`：copy os.environ；若 `codex_bin` 有目录分量则该目录 **前缀** 到 `PATH`；若 `worker_project` 配置了 per-project worker API profile 则注入 `DANUS_PROJECT_WORKER_API_KEY`。

### 3.5 main 外循环（`main(worker_dir) -> int`）

1. `wdir` 解析 resolve；非目录 → 打印 `worker dir not found: <wdir>` 到 stderr，返回 **2**。
2. `wl=WorkerLayout(wdir)`；`project_dir/project/worker`；`role=_read_role(wl)`。
3. `scaffold.write_codex_config(wl)`（每次启动重写 gateway 的 command，见 §2.4）。
4. 读 env（默认值见 3.2）；`wl.logs.mkdir(parents=True, exist_ok=True)`；`prompt = kickoff(project, worker)`。
5. 安装 SIGTERM 处理器 `_on_term`（见 3.7）。
6. `write_status(wl, state="running", round=0, started_at=time.time())`；`rnd=0`；`consec_fail=0`。

逐轮（`while True`，检查顺序**固定**）：

```
若 wl.stop.exists():
    wl.stop.unlink(missing_ok=True)     # 消费 .stop
    write_status(state="stopped"); break
若 _deadline_passed(project_dir):
    write_status(state="deadline"); break
若 max_rounds 且 rnd >= max_rounds:
    write_status(state="max_rounds"); break

rnd += 1
log_path = wl.logs / f"round_{rnd}.log"
write_status(state="running", round=rnd, round_started_at=time.time())
rc = run_round(wl, role, prompt, log_path, hard_timeout)
write_status(state="idle", round=rnd, last_round_at=time.time(), last_rc=rc,
             last_fact_id=_parse_last_fact_id(log_path))

if rc == 127:                       # codex 缺失，不空转
    write_status(state="error", error="codex binary not found"); return 127
consec_fail = consec_fail + 1 if rc not in (0,124) else 0
if max_fail and consec_fail >= max_fail:
    write_status(state="error", error=f"{consec_fail} consecutive failed rounds"); return 1
if beat > 0:
    time.sleep(beat)
```

finally：`_cleanup_pid(wl)`；返回 **0**。

**rc 处理规则**：
- `0`：成功，不增 `consec_fail`。
- `124`：硬超时，**视为中性**，重置 `consec_fail`（不当作失败）。
- `127`：codex 二进制缺失，短路由 `return 127`（写 error 状态）。
- 其他任何 rc（如 1/2/3/5…）：算失败，`consec_fail += 1`；达到 `max_fail` → error 状态、`return 1`。

**状态机 state 值全集**：`created`（do_new 初始）、`running`（每轮开始/round 0）、`idle`（每轮结束）、`stopped`（.stop 消费）、`deadline`（超 .run_deadline）、`max_rounds`（round 上限）、`error`（127 或 consec_fail）、`terminated`（SIGTERM）。

### 3.6 `write_status`（原子写）

- 读现有 `.status.json`（`json.JSONDecodeError`/`OSError` → `{}`）。
- `cur.update(fields)`；强制 `cur["worker"]=wl.name`、`cur["pid"]=os.getpid()`、`cur["updated_at"]=time.time()`。
- 写 `path.with_suffix(".tmp")`，`os.replace`。合并（非覆盖）。

### 3.7 SIGTERM 处理（`_on_term(signum, _frame)`）

```
if _Child.proc is not None:
    _Child.proc.terminate()
write_status(wl, state="terminated")
_cleanup_pid(wl)
sys.exit(0)
```

- 终止在飞的 codex 子进程、写 `terminated` 状态、清自己的 `.pid`（若指向自己）、`sys.exit(0)`。
- `signal.signal(SIGTERM, _on_term)` 装在 main 里。

### 3.8 `_cleanup_pid(wl)`

- `.pid` 存在且内容 `== str(os.getpid())` → `unlink(missing_ok=True)`；否则保留（非自己 pid 不动）；`OSError` 静默。

### 3.9 `_parse_last_fact_id(log_path)`

- 读日志（`errors="replace"`）；`OSError` → None。
- 正则 `_FACT_ID_RE = r'"?fact_id"?\s*[:=]\s*"?([0-9a-f]{16})?"?'`，取所有匹配的**最后一个**。

### 3.10 worker.md 关键轮次合同要点（loop 的"续轮"语义来源，供移植参考）

- 一轮 = 一次 `codex exec` 会话，**从持久化存储续写**（不是一次增量）。`TASK.md` + `master_guidance` 每轮开头读；`TASK.md` 空/未分配则自行向主问题最高杠杆方向推进。
- 三记忆：local（私有，直接文件 `notes.jsonl`/`events.jsonl`）、global（`gm_add`/`gm_search`，含 dead ends；`verification` 结果自动记录）、fact graph（唯一正确性源，只能 `fact_submit` 写入，且硬性 `fact_search` 先查再证明）。
- 唯一正确性权威 = verifier；global memory 只是 awareness，永远不能当砖块。
- 铁律：全文本数学，禁止一切可执行计算（无小计算例外）；`fact_submit` 即 glossary 检查 + 产生事实；`external_refs` 传递引用。
- 边界：只读自己工作目录 + 共享项目 stores；禁止读父目录/其他 worker 的 local_memory/其他项目。

### 3.11 main_agent.md 关键点（loop 的操纵者侧，供移植参考）

- main 不能创建事实（无 fact_submit）；跑持久 Codex Goal；30 分钟控制回拍 + 4 小时宏观审计；`master_guidance` 通过 gateway 写；子代理 lane=speculative、worker lane=evidentiary；同样全文本铁律；最终化/发布是 operator 决定。

---

## 4. CLI 每个动词的精确语义

### 4.1 通用读助手

- `_read_pid(wl)`：`.pid` 不存在 → None；`int(read_text().strip())`；`ValueError`/`OSError` → None。
- `_alive(pid)`（**zombie 感知**）：
  - `pid` 为 falsy（None/0）→ False。
  - `os.kill(pid,0)`：`ProcessLookupError` → False；`PermissionError` → True（存在但不属我们）。
  - 否则读 `f"/proc/{pid}/stat"`，state = `stat.rsplit(")", 1)[1].split()[0]`（comm 右括号之后的第一个字段）；返回 `state != "Z"`（zombie 视为死）。`OSError`/`IndexError` → True（保守）。
- `_read_status(wl)`：`.status.json` 不存在 → `{}`；`JSONDecodeError`/`OSError` → `{}`。

### 4.2 `list [--json]`（`do_list`）

- 每项目一行：`{"project", "workers": len(list_workers), "live": 活跃数, "model": project.json 的 model 或 "—"}`。
- `live` = `_alive(_read_pid(worker))` 为真的 worker 计数（用 `worker_dir(project, w)`）。
- 文本输出 `_fmt_list(rows)`（见 4.8）。`--json` → `json.dumps(rows, ensure_ascii=False, indent=2)`。

### 4.3 `new <p> [--roles high:3,xhigh:4] [--model M]`

- 直接 `do_new(project, roles=args.roles, model=args.model)`（见 §2）。
- 输出 `created {project} with {len(workers)} workers: {', '.join(workers)}\n  {project_dir}`。

### 4.4 `assign <p>/<w> (--task "…" | --file P | --stdin)`（`do_assign`）

- `resolve_target`；无 worker → `SystemExit("assign needs a specific worker: <project>/<worker>")`。
- worker 目录不存在 → `SystemExit(f"no such worker: {project}/{worker}")`。
- 空任务（`task.strip()` 为空）→ `SystemExit("refusing to assign an empty task")`。
- **覆盖写**（replace，不 append）：`atomic_write(wl.task, task if task.endswith("\n") else task+"\n")`。
- 返回 `{"worker": f"{project}/{worker}", "task_file": str(wl.task)}`。
- `_task_from_args`：`--task` 优先级最高；否则 `--file`（读文件文本）；否则 `--stdin`；否则 `SystemExit("assign needs one of --task, --file, or --stdin")`。

### 4.5 `finalize <p> [--paper <paper_id>] [<fact_id>...]`（`do_finalize`）

- `pdir = project_dir(project)`；目录不存在 → `SystemExit(f"no such project: {project}")`。
- `fg = FactGraph(pdir)`。
- **无 fact_ids（建议模式）**：返回 `{"project", "paper_id", "suggested": assemble._terminal_facts(fg)}`，**不写任何文件**。
  - `_terminal_facts(fg)`：`all_ids = fg.list()`（`fact_graph/facts/*.md` 的 stem，`sorted()`）；构造 `is_predecessor` 集合（对每个 id，收集其 `fg.predecessors(fid)` 的所有元素）；返回 `[fid for fid in all_ids if fid not in is_predecessor]`。即「最深终端事实——不成为任何其他事实的前驱」，DAG 里的候选目标。
- **有 fact_ids**：
  - `unknown = [fid for fid in fact_ids if not fg.exists(fid)]`（`exists` = `fact_graph/facts/<id>.md` 存在）；非空 → `SystemExit(f"cannot finalize: unknown fact id(s) in {project}: {', '.join(unknown)} (a target must be a verified fact in the project's graph)")`。
  - 若 `--paper` 非默认：`if not assemble._is_default_paper(paper_id): assemble._validate_paper_id(paper_id)`；`ValueError` → `SystemExit(f"cannot finalize: {e}")`。
    - `_is_default_paper(paper_id)` = `not paper_id or paper_id == "main"`。
    - `_validate_paper_id(paper_id)` = `PROJECT_NAME_RE = r"^[A-Za-z0-9][A-Za-z0-9._-]*$"`，不匹配 → `ValueError`。
  - **去重保序**：`seen` set 过滤，保留首次出现顺序。
  - `path = assemble.write_target_fact_ids(pdir, ids, paper_id)`（内容见 1.7）。
  - 返回 `{"project", "paper_id", "target_file": str(path), "target_fact_ids": ids}`。
- main 输出：建议模式若有 suggested → 打印每个 `fid` 及 `run: danus finalize {project}{paper_flag} <fact_id> [...]`；无 → `no candidate terminal facts in {project} (is the fact graph empty?); nothing recorded`。有目标 → `finalized target for {project}{paper_note}: ', '.join(target_ids)\n  wrote {target_file}`。

### 4.6 `start <p>[/<w>]`（`do_start(target, stagger=0.2)`）

- `dirs = L.target_worker_dirs(target)`（`resolve_target`：`"proj"`→全部 worker；`"proj/worker"`→单个；去首尾 `/`；`split("/",1)`，worker 为空则视为项目级）。`dirs` 为空 → `SystemExit(f"no workers for target {target!r}")`。
- 逐 worker：`if i and stagger: time.sleep(stagger)`（默认 0.2s；stagger=0 不睡）。`out.append({"worker": wdir.name, "result": _start_one(WorkerLayout(wdir))})`。
- `_start_one(wl)`（**flock 幂等**）：
  ```
  wl.dir.mkdir(parents=True, exist_ok=True); wl.logs.mkdir(exist_ok=True)
  lock = open(wl.lock, "w")
  try:
      try: fcntl.flock(lock, LOCK_EX|LOCK_NB)
      except BlockingIOError: return "locked"
      if _alive(_read_pid(wl)): return "already-running"
      wl.stop.unlink(missing_ok=True)          # 清残留 stop
      pid = spawn_loop(wl.dir)
      atomic_write(wl.pid, str(pid))
      return "started"
  finally:
      flock(lock, LOCK_UN); lock.close()
  ```
- main 输出：每个 `{worker}: {result}`。

### 4.7 `status <p>[/<w>] [--json]` 与 `worker_status(wl)` label 判定

- `worker_status(wl)`：
  ```
  pid = _read_pid(wl); alive = _alive(pid); st = _read_status(wl)
  state = st.get("state", "—")
  now = time.time()
  last = st.get("last_round_at") or st.get("round_started_at") or st.get("updated_at")
  age = (now - last) if isinstance(last,(int,float)) else None
  if alive:
      rs = st.get("round_started_at")
      hard = int(os.environ.get("DANUS_ROUND_HARD_TIMEOUT", "14400"))
      if state == "running" and isinstance(rs,(int,float)) and (now - rs) > hard * 1.5:
          label = "stuck?"
      else:
          label = "working"
  else:
      label = state if state in ("stopped","deadline","max_rounds","error","terminated","created") else "dead"
  return {"worker": wl.name, "pid": pid, "alive": alive, "state": state,
          "round": st.get("round", 0),
          "age_s": round(age,1) if age is not None else None,
          "last_fact_id": st.get("last_fact_id"), "label": label}
  ```
- **threshold 公式**：`stuck?` 当且仅当 `alive && state=="running" && (now - round_started_at) > (DANUS_ROUND_HARD_TIMEOUT 默认 14400) * 1.5`（轮可合法跑数小时；只有「running 且 round_started_at 距今超过 1.5× 硬超时」才标 `stuck?`）。
- label 取值集：`working` / `stuck?`（存活时）；`stopped` / `deadline` / `max_rounds` / `error` / `terminated` / `created` / `dead`（不存活、state 不在上述白名单时为 `dead`）。
- `do_status(target)`：`dirs` 为空 → `SystemExit("no workers for target ...")`；返回 `[worker_status(...)]`。`--json` → json dumps；否则 `_fmt_status`。

### 4.8 文本格式化（`_fmt_list` / `_fmt_status`）

`_fmt_list(rows)`：
```
head = f"{'PROJECT':<24}{'WORKERS':>8}{'LIVE':>6}  {'MODEL':<12}"
lines = [head, "-"*len(head)]
for r in rows:
    lines.append(f"{r['project']:<24}{r['workers']:>8}{r['live']:>6}  {str(r['model']):<12}")
return "\n".join(lines) if rows else "(no projects under the agents root)"
```
列宽：PROJECT 左对齐 24；WORKERS 右对齐 8；LIVE 右对齐 6；两个空格；MODEL 左对齐 12。空 → 单个提示串。

`_fmt_status(rows)`：
```
head = f"{'WORKER':<14}{'LABEL':<12}{'STATE':<13}{'ROUND':>6}  {'AGE':>7}  {'LAST_FACT':<16}"
lines = [head, "-"*len(head)]
for r in rows:
    age = f"{r['age_s']:.0f}s" if r["age_s"] is not None else "—"
    lines.append(f"{r['worker']:<14}{r['label']:<12}{r['state']:<13}{r['round']:>6}  {age:>7}  {str(r['last_fact_id'] or '—'):<16}")
return "\n".join(lines)
```
列宽：WORKER 左 14；LABEL 左 12；STATE 左 13；ROUND 右 6；两个空格；AGE 右 7（`N s` 整数秒或 `—`）；两个空格；LAST_FACT 左 16（`—` 占位）。**无空行 fallback**（空输入仍打印表头）。

### 4.9 `stop <p>[/<w>] [--force]`（`do_stop(target, force=False)` / `_stop_one`）

- `dirs` 为空 → `SystemExit("no workers for target ...")`。
- `_stop_one(wl, force)`：
  - `pid = _read_pid(wl)`。
  - **非 force**：`if not _alive(pid): return "not-running"`；`wl.stop.touch()`；`return "stopping (graceful)"`（优雅——loop 在轮边界退出，见 §3.5 轮首次检查 .stop）。
  - **force**：
    - `if not _alive(pid): wl.pid.unlink(missing_ok=True); return "not-running"`。
    - `try: pgid = os.getpgid(pid); os.killpg(pgid, SIGTERM)`；`except (ProcessLookupError, PermissionError): pass`。
    - 循环最多 50 次（每次 `time.sleep(0.1)` ≈ 至多 ~5s）等待干净退出：`if not _alive(pid): break`。
    - `if _alive(pid): try: os.killpg(os.getpgid(pid), SIGKILL)`；`except (ProcessLookupError, PermissionError): pass`。
    - `wl.pid.unlink(missing_ok=True)`；`return "killed"`。
- `do_stop` 返回 `[{"worker": d.name, "result": _stop_one(...)}]`；main 打印每 `{worker}: {result}`。

> killpg 语义：loop 以 `start_new_session=True` 启动，形成**自己的进程组**（pgid = loop pid），因此 `killpg` 可以同时杀掉 loop 与其在飞的 codex 子进程。

### 4.10 argparse / main dispatch（`build_parser` / `main`）

- 子命令（`required=True`）：list / new / assign / finalize / start / status / stop。
- `finalize --paper` 默认 None；`fact_ids` = `nargs="*"`（空 = suggestion）。
- `main` 返回值恒 0（正常）；`SystemExit` 用于各拒绝路径（非零退出）。

---

## 5. spawn_loop 的精确 detach 方式

```
def spawn_loop(wdir: Path) -> int:
    wl = WorkerLayout(wdir)
    wl.logs.mkdir(parents=True, exist_ok=True)
    logf = open(wl.logs/"loop.log", "a", encoding="utf-8")
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "danus.execution", str(wdir)],
            stdout=logf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    finally:
        logf.close()
    return proc.pid
```

- **`start_new_session=True`** = 新进程组 + 新会话（detach 自调用 shell；loop 存活于 shell 之外；`stop --force` 的 `killpg` 可命中 loop + 其 codex 子进程）。
- `sys.executable`（运行 danus 的 Python）作为解释器；`-m danus.execution` 作为入口；`<wdir>` 为唯一位置参数。
- 刷新 `stdout`（appended 到 logs/loop.log）用 `"a"`，`stderr` 合并到 stdout，`stdin` 用 DEVNULL。
- launch 结果 pid 立即关闭文件句柄（Popen 已完成 fd 重定向）。

---

## 6. 测试固化的边界行为（移植需保持的语义）

### 6.1 layout / 名称
- `parse_roles("high:3,xhigh:4")` names 恰为 `["high","high2","high3","xhigh","xhigh2","xhigh3","xhigh4"]`；base 列表 `["high"]*3+["xhigh"]*4`。
- 拒绝 `["", "   ", "high:0", "high", "high:abc", ":3", "3:high"]`。
- `WorkerLayout` 属性名：`name/project/project_dir/task(role/pid/lock/stop/status/logs/codex_config)`。
- `resolve_target`：`"proj"`→`("proj",None)`；`"proj/high"`→`("proj","high")`；`"/proj/high/"`→`("proj","high")`。
- 默认 layout（无 env）：`worker_md()==repo_root()/"agents"/"contracts"/"worker.md"`；`worker_skills_dir()==repo_root()/"agents"/"skills"/"worker"`；`agents_root()==(cwd/"runtime"/"projects").resolve()`。`list_workers`/`list_projects` 对不存在的 root 返回 `[]`。

### 6.2 do_new 内容
- `do_new("P", roles="high:2,xhigh:1", model="gpt-5.5")` → `{"workers":["high","high2","xhigh"]}`；`global_memory/` `fact_graph/` 存在；`project.json` 的 `workers`/`model` 正确。
- 每 worker：`local_memory/` `logs/` 存在；`AGENTS.md` resolve == worker_md；`.agents/skills` resolve == worker_skills_dir；config 含 `DANUS_ROLE = "worker"`、`args = ["-m", "danus.gateway"]`、`tool_timeout_sec = 3600`、`DANUS_AUTHOR = "<w>"`、`str(pdir)`；`.role` 含 `REASONING_EFFORT=<eff>` 与 `MODEL=gpt-5.5`；`TASK.md` 含 `(unassigned`；`.status.json` state==`created`。
- 重复 `do_new` 同名项目 → `SystemExit`。
- `DANUS_VERIFY_URL` env 透传到 config 的 `DANUS_VERIFY_URL`。

### 6.3 run_round / 子进程
- rc 透传：codex 退出码 n → 返回 n；`_Child.proc` 在 `finally` 清 None。
- `hard_timeout=0` → 无限等待（`wait(None)`）。
- 硬超时 → `terminate` → `wait(10)` → 仍超时 `kill` → 124；日志含 `round hard-timeout after Ns`。
- 缺失二进制 → 127，日志含 `codex binary not found`。
- 不响应 terminate 的子进程（wait(10) 又超时）→ `terminate` 与 `kill` 都被调用 → 124。

### 6.4 main 外循环
- 预置 `.stop` → 消费后返回 0，state==`stopped`。
- `.run_deadline` 写 `"1"` → state==`deadline`。
- `DANUS_MAX_ROUNDS=2` → 恰好跑 2 轮，state==`max_rounds`，`round==2`，`last_rc==0`。
- `DANUS_MAX_CONSEC_FAILURES` + 失败 rc(5) → 返回 1，state==`error`，`error` 含 `consecutive failed rounds`；`last_fact_id` 从 round log 解析进状态。
- rc=124 **不**计失败（连续 124 不触发失败上限，由 max_rounds 兜底）。
- rc=127 → 返回 127，state==`error`，`error=="codex binary not found"`。
- 坏 worker dir → 返回 2。
- SIGTERM → terminate 在飞 child、写 `terminated`、`sys.exit(0)`。
- 正 `DANUS_ROUND_BEAT` → 轮间 sleep（stub time.sleep 验证触发一次）。
- `kickoff` 包含 project/worker/TASK.md 字样。
- `write_status` 对损坏旧文件（`{not json`）恢复为有效 JSON。

### 6.5 CLI 动词
- `_read_pid`/`_read_status` 对缺失/垃圾正确回退（None / `{}`）。
- `_alive`：None/0 → False；自身 pid → True；不存在 pid（如 2_000_000_000）→ False；`PermissionError`（如 pid 1，非 root）→ True；zombie（`true` 未 wait）→ False；`/proc` 读失败 → True。
- `worker_status`：alive+running+陈旧 `round_started_at` → `stuck?`；alive+running+新鲜 → `working`；not alive + 未知 state → `dead`；not alive + node `deadline` → label=`deadline`。
- `do_start`：伪造 spawn 记录调用、返回自身 pid → `started`，再 start → `already-running`；`flock` 锁定 → `locked`；`do_start` 清残留 `.stop`；项目级 + `stagger=0` 无 sleep（`{"high","high2"}`）。
- `do_stop` force：真实 sleep 子进程被 `killed`；SIGTERM 忽略的子进程走 SIGKILL 兜底（等待 ≥ ~4.5s）；`getpgid`/`killpg` 抛 `ProcessLookupError` 仍 `killed`；非运行 force → `not-running` 且清 `.pid`。
- `do_finalize`：写入并让 `assemble.target_fact_ids` 读到同一 id；去重保序 `[f1,f2]`；未知 id → `unknown fact id`；未知项目 → `no such project`；suggestion 只返回终端事实且**不写文件**。
- `_fmt_list` 空 → 一句提示；`_fmt_list`/`_fmt_status` 表头列名与宽度（见 4.8）。
- `_task_from_args`：`--task`/`--file`/`--stdin` 优先级，无 → `one of --task`。
- `build_parser`：所有子命令可解析；`finalize P` → `fact_ids==[]`；空 argv → argparse 要求子命令（SystemExit）。
- `main` 各分支输出：`new` `created P with N workers`、`list` `PROJECT`/`--json`、`assign` `assigned P/high`、`status` `WORKER`、`stop` `graceful`/`not-running`、`start` `high: started`。
- `python -m danus.orchestration`：`__main__` 调 `main()` 并 `sys.exit(main())`。

---

## 附：关键常量速查

- `DEFAULT_PAPER_ID = "main"`；`PROJECT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")`。
- `DEFAULT_MODEL = "gpt-5.6-sol"`；`DEFAULT_EFFORT = "xhigh"`。
- `codex.exec_cmd` 前缀：`[bin, "exec", "--model", model, "--config", f'model_reasoning_effort="{effort}"', *tail]`。
- `spawn_loop` 入口 `python -m danus.execution <wdir>`；`loop.main` argv 长度 != 2 → usage 打印 + exit 2。
- `_FACT_ID_RE`（loop 抓取）`= r'"?fact_id"?\s*[:=]\s*"?([0-9a-f]{16})?"?'`。
- `_TARGET_ID_RE`（assemble 读取）`= r"fact_[A-Za-z0-9_]+|\b[0-9a-f]{8,}\b"`。
- `stuck?` 阈值 = `DANUS_ROUND_HARD_TIMEOUT(默认14400) * 1.5` 秒。
