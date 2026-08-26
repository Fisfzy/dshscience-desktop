# Danus 作者侧产物精确行为规格（Python→TypeScript 移植蓝本）

> 本规格从 `Danus/danus/authoring`、`Danus/danus/write_paper`、`Danus/danus/human_summary`、
> `Danus/danus/integrations/matlas.py`、`Danus/danus/observability`、`Danus/agents/skills/write-paper`
> 与 `Danus/.agents/skills/*/SKILL.md` 逐文件读出并固化。目标是：**不看原码即可据此重写**。
> 所有路径/环境变量/常量/分隔符/状态串均为原文值，可直接照抄。

---

## 0. 总览与共享约定

- 代码基座：`danus` Python 包，位于 repo 根下的 `danus/`。repo 根 = `danus/codex.py` 的 `parents[1]`；
  `danus/write_paper/assemble.py` 的 repo 根是 `parents[2]`；`danus/authoring/common.py` 等是 `parents[2]`。
- 统一 codex 启动器：`danus/codex.py`。唯一存放 codex 二进制解析、模型、推理量、子进程 env、exec 前缀的地方。
- 全系统角色门控：`danus/gateway/roles.py` 的 `ROLE_TOOLS`——`worker`/`main`/`verifier`/`all`。
  `verifier` 只暴露 `search_arxiv_theorems`（只读）；`main` 无 `fact_submit`。
- 所有"运行 codex 一次"的入口都遵守同一套"诚实性"判定：**非零退出、超时、缺二进制、空 stdout 一律不算成功**。

---

## 1. authoring driver：隔离的一次性 codex

`danus/authoring/common.py`（纯函数、无网络/无 codex）+ `danus/authoring/driver.py`（一次性驱动）。

### 1.1 common.py —— 共享纯原语

- `PROJECT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")` —— 单个安全路径段（项目名/paper_id 共用）。
- `_STDERR_TAIL_CHARS = 2000`。
- **`resolve_project(project=None) -> Path`**（env 在调用时读，非 import 时）：
  - 若给 `project` 名：`DANUS_AGENTS_ROOT` 必须已设置（否则 `RuntimeError("DANUS_AGENTS_ROOT is not set; cannot resolve a project by name")`）；
    名字必须匹配 `PROJECT_NAME_RE`（否则 `RuntimeError("invalid project name: ...")`）；
    路径 `<agents_root>/<project>` 必须 `is_dir()`（否则 `RuntimeError("no such project: ...")`）。
  - 若未给 `project`：用 `DANUS_PROJECT_DIR`；若也空 -> `RuntimeError("DANUS_PROJECT_DIR is not set and no project was given")`。
- **`section(name, body) -> str`**：`"\n\n===== BEGIN {name} =====\n{body}\n===== END {name} =====\n"` —— 测试用 BEGIN/END 断言与 codex 导航。
- **`read_fixed(skill_dir, rel)`**：读 `skill_dir/rel` 全文；缺文件 -> `FileNotFoundError("required fixed file is missing: {path} (skill_dir={skill_dir})")`。
- **`read_project(project_dir, rel)`**：读 `project_dir/rel` 全文；缺文件 -> `FileNotFoundError("required project file is missing: {path}")`。
- **`body_sections(raw) -> str`**：**frontmatter 擦洗**。
  - 找第一行 `line.lstrip().startswith("## ")`；有 -> 返回从那行起的全部内容，`rstrip()+"\n"`。
  - 无正文标题：若 `lines[0].strip()=="---"`，找闭 fence（第 2 行起第一个 `strip()=="---"`）；找到 -> 返回闭 fence 之后内容，`strip()+"\n"`。找不到闭 fence -> 落回 `raw.strip()+"\n"`。
  - 完全无 frontmatter -> `raw.strip()+"\n"`。
  - 作用：把 `fact_id/author/problem_id/predecessors/glossary_introduces/external_refs` 从 codex 看到的输入中剔除，只保留数学正文。
- **`classify_outcome(cp_or_exc, *, artifact_noun="artifact") -> dict`**：对 `CompletedProcess` 或异常做诚实分类，返回 `{status,returncode,stdout,stderr_tail}`，非 ok 另带 `error`。
  - `TimeoutExpired` -> `{"status":"timeout","returncode":None,"stdout":"","stderr_tail":"","error":"codex timed out after {cp.timeout}s"}`。
  - `FileNotFoundError` -> `{"status":"error",...,"error":"codex binary not found: {cp}"}`。
  - 正常 `cp`：`stdout=cp.stdout or ""`；`stderr_tail=(cp.stderr or "")[-2000:]`。
    - `returncode != 0` -> `{"status":"error",...,"error":"codex exited with nonzero code {rc}"}`。
    - `not stdout.strip()` -> `{"status":"error","stdout":"","error":"codex produced empty stdout (no {artifact_noun})"}`。
    - 否则 -> `{"status":"ok", ...}`。
- **`leak_findings(text, patterns) -> List[str]`**：对每个 `(regex,label)` 做 `re.search`，命中 -> `"{label}: matched {m.group(0)!r}"`；空列表=干净。只扫描调用方提供的 pattern。

### 1.2 driver.py —— 一次性隔离 codex 运行

- 常量：`DEFAULT_MODEL=codex.DEFAULT_MODEL`（"gpt-5.6-sol"）、`DEFAULT_EFFORT=codex.DEFAULT_EFFORT`（"xhigh"）、`DEFAULT_TIMEOUT=7200`。
- `_gateway_config_arg(gateway_role) -> str`：`'mcp_servers.danus={command="python3",args=["-m","danus.gateway"],env={DANUS_ROLE="<gateway_role>"}}'`（`-c` 注入串，镜像 verify launcher）。
- `default_model()` -> `codex.model()`；`default_effort()` -> `codex.effort()`。
- **`run_codex(prompt, *, model=DEFAULT_MODEL, effort=DEFAULT_EFFORT, timeout=DEFAULT_TIMEOUT, networked=False, gateway_role="verifier") -> CompletedProcess`**：
  - `codex_bin = codex.resolve_bin()`。
  - `networked=True` 尾部参数：`("-c", _gateway_config_arg(gateway_role), "--config", "tools.web_search=true", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-")`。
  - `networked=False`（默认）尾部：`("--sandbox","read-only","--skip-git-repo-check","-")`。
  - `cmd = codex.exec_cmd(codex_bin, model, effort, *tail)`。
  - **隔离关键**：`with tempfile.TemporaryDirectory(prefix="danus-authoring-codex-") as empty_cwd:`，`subprocess.run(cmd, input=prompt, cwd=empty_cwd, env=codex.subprocess_env(codex_bin), capture_output=True, text=True, timeout=timeout if timeout and timeout>0 else None)`。
    - **prompt 走 stdin**（argv 以 `-` 结尾），因此 argv 不含 prompt、不含密钥。
    - **stdout 即产物**（模型输出文档，驱动捕获）。
    - 无 cwd 之外任何可读文件；空 cwd + 全嵌入 prompt = 真正隔离。
  - 抛 `TimeoutExpired` / `FileNotFoundError`，由上层转成诚实非 ok。

### 1.3 codex.py —— 唯一 codex 启动器

- `_REPO_ROOT = Path(__file__).resolve().parents[1]`；部署的 `bin/codex` wrapper 在 `<repo>/bin/codex`。
- `DEFAULT_MODEL="gpt-5.6-sol"`，`DEFAULT_EFFORT="xhigh"`。
- **`resolve_bin() -> str`**（调用时解析）：① `DANUS_CODEX_BIN` env（绝对路径原样；裸/相对名用 `shutil.which` 解析成绝对，找不到则返回原裸名）；② `<repo>/bin/codex` 存在则用；③ `shutil.which("codex")`；④ 裸 `"codex"`。
- **`model(*override_env_names, default=DEFAULT_MODEL)`**：按顺序取第一个非空 override env；否则 `DANUS_MAIN_MODEL` 或（back-compat）`DANUS_CODEX_MODEL`；否则 `default`。
- **`effort(...)`**：同构，`DANUS_MAIN_EFFORT` / `DANUS_CODEX_EFFORT` / `default`。
- **`subprocess_env(codex_bin, *, worker_project=None)`**：`os.environ.copy()`；仅当 `codex_bin` 有目录成分时，把该目录前置到 `PATH`（裸名 `"codex"` 绝不把 CWD 注入 PATH）；`worker_project` 有配置时注入 `DANUS_PROJECT_WORKER_API_KEY`。
- **`exec_cmd(codex_bin, model, effort, *tail)`**：`[codex_bin,"exec","--model",model,"--config",f'model_reasoning_effort="{effort}"',*tail]`（使用带引号的 effort 配置形式）。

---

## 2. write_paper 服务

### 2.1 MCP 工具清单与参数（`server._TOOLS`，全部 main-agent 动词，无角色拆分）

`build_app()` 建 `FastMCP("write-paper")`，注册 6 个工具。工具返回**小而诚实**：路径+状态+标志，绝不返回整份 `.tex`。

| 工具 | 参数（默认值含义） | 返回关键字段 |
|---|---|---|
| `paper_subgraph` | `project?`, `headline?`, `paper_id?` | `{status, headline, headline_source, count, facts:[{id,statement,predecessors,dependents,glossary_introduces}], paper_id}`；unset->`needs_target` |
| `paper_write` | `project?`, `headline?`, `stop_workers=False`, `paper_id?`, `fact_ids?`, `instructions?` | `{tex_path,status,returncode,headline,headline_source,swarm_stop,selected_facts,fact_id_warnings,gaps,leak_findings,stderr_tail,log_path}`；亦 `needs_target`/`bad_fact_ids`/`leak`/`chunk_failed` |
| `reference_audit` | `project?`, `paper_id?` | `{findings, ledger_path, status, returncode, stderr_tail, log_path}`；不写 main.tex |
| `reference_verify` | `project?`, `findings?`, `paper_id?` | `{verdicts, ledger_path, status, returncode, stderr_tail, log_path}`；就地写 REFERENCE_LEDGER，绝不写 main.tex |
| `paper_revise` | `project?`, `compile_log?`, `notes?`, `citation_fixes?`, `verifier_feedback?`, `add_facts?`, `paper_id?` | `{tex_path,status,returncode,revision_log_path,leak_findings,compile,compile_attempts,stderr_tail,log_path, gap_fill_facts?}` |
| `paper_verify_math` | `project?`, `paper_id?` | `{status,units_total,correct,wrong,verdict,repair_hints,must_fix,ignorable,ignorable_findings,body_chars,ledger_path,log_path,deliver_ok,blockers}` |

config（调用时读）：`DANUS_AGENTS_ROOT`/`DANUS_PROJECT_DIR`；`DANUS_WRITE_PAPER_SKILL_DIR`；
`DANUS_CODEX_BIN`；`DANUS_WRITE_PAPER_MODEL`/`_EFFORT`（回退 `DANUS_CODEX_MODEL`/`_EFFORT`）；
`DANUS_WRITE_PAPER_RUN_LOG`（默认 1；`0/false/no` 关 -> log_path None）；
`DANUS_WRITE_PAPER_COMPILE_ATTEMPTS`（默认 3）；`DANUS_WRITE_PAPER_COMPILE_EFFORT`（默认 `low`）；
`DANUS_KEEP_SWARM_ON_WRITE`（默认关）；`DANUS_PAPER_WRITE_CHUNK_CHARS`（默认 800000）。

### 2.2 assemble.py —— 确切流程与多 paper / TARGET.md / brief / log

- 常量：`ROLES=("writer","auditor","reviser","verifier")`；`TARGET_FILE="TARGET.md"`；
  `HEADLINE_SOURCES=("arg","brief","target","unset")`；`DEFAULT_PAPER_ID="main"`；
  repo 根 = `parents[2]`，默认 skill 目录 = `<repo>/agents/skills/write-paper`。
- **多 paper 支持**：
  - `_is_default_paper(paper_id)`：`None`/`""`/`"main"` -> True（legacy 路径）。
  - `_validate_paper_id(paper_id)`：必须匹配 `PROJECT_NAME_RE` 单段，否则 `ValueError`。
  - `paper_workspace(project_dir, paper_id)`：默认 -> `<project>/paper/`；否则 -> `<project>/papers/<paper_id>/`。
  - `paper_target_path(project_dir, paper_id)`：默认 -> `<project>/TARGET.md`；否则 -> `<project>/papers/<paper_id>/TARGET.md`。
  - **闭包数学不变**：paper 的事实 = 其 headline 集的传递前驱闭包（复用同一个 `_toposort_with_predecessors`）。
- **TARGET.md 读取**：`target_fact_ids(project_dir, paper_id)` 解析 `paper_target_path`；跳过 `#` 注释与空行；
  剥掉前导 `target`/`target_fact_ids:` 标签；用 `_TARGET_ID_RE = fact_[A-Za-z0-9_]+|\b[0-9a-f]{8,}\b` 收集（兼收可读 slug 与 16-hex 内容寻址 id），去重；缺文件/空 -> `[]`。
  `write_target_fact_ids(project_dir, fact_ids, paper_id)` 写 TARGET.md（头部注释 + 每行一个 id），建父目录；由 `danus finalize` 在写前校验（本身不查存在性）。
- **PROJECT_BRIEF 结构化字段**（`field: value` 独立行）：
  - `headline_fact_ids`：`brief_headline_fact_ids()` 用 `_HEADLINE_FIELD_RE` 匹配，`_TARGET_ID_RE.findall` 取列表；空/占位（`<...>`）-> `[]`。
  - `structural_exemplar`：`brief_structural_exemplar()` 返回锚点文件夹名；空或以 `<` 开头 -> `None`。
- **`resolve_headline(project_dir, headline, paper_id) -> (ids, source)`**（**绝不猜测**）：
  (a) 显式 `headline` arg -> `("arg")`；(b) brief 的 `headline_fact_ids` 非空 -> `("brief")`；(c) 已终态化 `<paper>/TARGET.md` 非空 -> `("target")`；(d) 否则 -> `([], "unset")`。`unset` 时上游必须拒绝（`TargetUnsetError`，`paper_write` 返回 `needs_target`）。
- **`_terminal_facts(fg)`**：不是任何事实的前驱的最深终端事实（`danus finalize` 建议），**不是** resolve 的回退。
- **`_toposort_with_predecessors(fg, seeds)`**：`seeds=None` -> 全部事实；否则 seeds+传递前驱（未知 id -> `ValueError`）。Kahn 稳定拓扑（前驱先行），同层按 `fg.list()` 的 sorted-id 顺序破平；有环时把剩余节点确定性追加，不丢事实。
- **事实块格式**：
  - `_fact_block`：`"[source_fact: <id>]\npredecessors (DAG): <pred line>\n" + body_sections(raw)`（frontmatter 剥掉，正文逐字保留；前驱 DAG 行保留供内部 `\ref`）。
  - `_statement_block`：同样的 `[source_fact]` + 前驱 DAG 行，但只嵌 `## statement` 单行（`statement_of(raw).strip()`，空则 `(empty statement)`）。
- **content 函数**：
  - `fact_graph_content`：目标闭包完整正文（statement/proof/intuition + DAG），拓扑序；空 -> `"_(no verified facts found in the project fact graph)_\n"`；unset -> `TargetUnsetError`（拒绝猜）。
  - `statements_only_content` / `closure_order` / `full_bodies_for` / `statements_for` / `section_ref_context_ids` / `selected_partition` / `subgraph_skeleton` / `citation_map`：见各自语义。
  - `selected_partition(project_dir, fact_ids)`：把 main-agent 选中的事实集分成 `(ordered_selected, referenced_ids)`；`referenced_ids` = 选中集的直接前驱但未被选中者，按全局拓扑序；未知 id -> `ValueError`。
  - `subgraph_skeleton`：闭包紧凑骨架（statement 单行 + 闭包内前驱/依赖度/glossary_introduces），供 main-agent 选择；unset -> `TargetUnsetError`。
- **逐角色 prompt**（每个角色最小、不相交输入集；均逐字嵌入 `roles/AGENTS.md`）：
  - `build_writer_prompt`：AGENTS.md + PAPER_WRITER_PROMPT + STYLE_GUIDE + PAPER_STRUCTURE + acknowledgement boilerplate + PROJECT_BRIEF + 可选 MAIN_AGENT_INSTRUCTIONS + REFERENCE_LEDGER + （`fact_ids`? `SELECTED_FACTS` 完整正文 + `PUBLISHED_CITATIONS` : `FACT_GRAPH_CONTENT` 全闭包）+ 可选 `STRUCTURAL_EXEMPLAR`。
  - `build_auditor_prompt`：AGENTS.md + REFERENCE_AUDITOR_PROMPT + `main.tex` + `REFERENCE_LEDGER`（**无事实/无风格/无结构**）。
  - `build_verifier_prompt`：AGENTS.md + REFERENCE_VERIFIER_PROMPT + `main.tex` + `REFERENCE_LEDGER` + `AUDITOR_FINDINGS`（**无事实/无风格/无结构**）。
  - `build_paper_math_verifier_prompt`：AGENTS.md + PAPER_MATH_VERIFIER_PROMPT + REFERENCE_LEDGER（`verified-by: verifier` 行可信）+ 整份 `main.tex`（**无事实/无风格/无结构**）。
  - `build_reviser_prompt`：AGENTS.md + PAPER_REVISER_PROMPT + STYLE_GUIDE + `main.tex` + `REVISION_LOG` tail + `TRIGGER` 块（**无事实图**，除非 gap-fill）。
  - `build_planner_prompt` / `build_section_writer_prompt`：chunked 用。
  - `build_prompt(role, ...)`：按 role 分发；未知 role -> `ValueError`。
  - `_reviser_trigger(compile_log, notes, citation_fixes, gap_fill)`：构造 `MODE: <mode>` 行 + 各触发块。
    MODE 取值：`gap-fill+compile-fix`（gap_fill+compile_log），`gap-fill`，`compile-fix+targeted`（compile_log+notes/citation_fixes），`compile-fix`（仅 compile_log），`targeted-notes`（notes/citation_fixes），`style-audit-pass`（无触发）。
  - `_revision_log_tail(project_dir, paper_id, max_chars=8000)`：读最近 8000 字符；缺文件返回 `"_(no REVISION_LOG.md yet — this is an early round)_"`；超长截断加 `"… (truncated)\n"`。
  - `_anchor_block(anchor)`：读 `style/anchors/<anchor>` 下文本文件逐字；二进制文件仅命名 `"--- <rel> (binary; not embedded) ---"`；无 anchor/目录缺/空 -> `None`。

### 2.3 server.py —— 关键行为

- `_GAP_RE = re.compile(r"\[GAP:[^\]]*\]")`；`_gaps(tex)` 提取全部 `[GAP: ...]`。
- **paper 专用 leak 集 `_LEAK_PATTERNS`**（5 项）：16-hex、`^\s*author:`、`fact_`、`master_guidance`、`fact_submit`。
  **注意**：不禁止 `predecessors`/`worker`/`verifier`（真论文/计算机论文里合法出现，且 paper 保留前驱 DAG 注释）。
- `_drive(prompt, effort=None)`：`driver.run_codex(model=_model(), effort=effort or _effort())`；捕获 `TimeoutExpired/FileNotFoundError`；`_attach_raw(classify_outcome(cp,"artifact"),cp)`（附 `stderr_full` + argv `cmd`）。
- `_drive_networked(prompt)`：`networked=True, gateway_role="verifier"`，`classify_outcome(...,"verdicts")`——**唯一联网工具**。
- **run log** `_write_run_log(tool, project_dir, prompt, res, decisions, envelope, paper_id)`：写 `<paper workspace>/.runs/<utc(:->-)/>-<tool>/log.md`；含 Header/INPUT prompt/OUTPUT stdout/FULL stderr/RESULT/TOOL DECISIONS/RETURNED ENVELOPE。**failure-isolated**：任何异常返回 `None`，绝不破坏工具主功能。`DANUS_WRITE_PAPER_RUN_LOG=0` 关闭 -> `log_path=None`。
- **`paper_write`**：
  1. `pdir=resolve_project`；`ws=paper_workspace`；`tex_path=ws/main.tex`。
  2. `resolve_headline`；`unset` -> `needs_target` envelope（含 `candidates=_terminal_facts`）+ 不写 main.tex。
  3. 校验 `fact_ids`：未知 id -> `bad_fact_ids`（不写）；闭包外 id -> `fact_id_warnings`（保留）。
  4. swarm 停：`stop_workers and not DANUS_KEEP_SWARM_ON_WRITE` -> `_ensure_swarm_stopped`(graceful, failure-isolated)；否则 `{skipped: ...}`。`needs_target` 时不触发停。
  5. `should_chunk` -> 超预算则 `_paper_write_chunked`；否则 `build_writer_prompt` + `_drive`。
  6. ok 后：`tex, provenance = _split_provenance(_strip_code_fence(res["stdout"]))`；leak 门：命中 -> 隔离 `main.leaky.tex`、删除旧 main.tex、`status=leak`；干净 -> 写 main.tex、`gaps=_gaps(tex)`、`_write_provenance` 写 `.provenance.json`。
  - `_strip_code_fence`：剥外层单层 ```lang 包裹。
  - `_split_provenance`：按 `%%%PROVENANCE%%%` 分割 -> `(tex, json map or None)`；无标记/坏 JSON/非 dict -> `(stdout, None)`。
  - **注意**：本工具不编译（编译门在 `compile_verify.sh`）。
- **`reference_verify`**（联网）：`_drive_networked`；解析 verdict；`ok` 且 verdicts 非空 -> `_apply_ledger_verdicts` **就地**更新 REFERENCE_LEDGER（单一当前表，一个 `## <key>` 行；`verified/corrected` 且带 `source_url` -> 置 `verified-by: verifier` + 元数据 + source_url；其它 verdict -> `verified-by: unverified (<verdict>)`；`note` 记录）。非 ok -> 不碰 ledger。**绝不写 main.tex**。
  - `_VALID_VERDICTS = {"verified","corrected","rejected","unverifiable","retarget-internal"}`。
  - `_parse_verdicts`：先 JSON（整段或均衡 `{}` span），再 YAML-ish 标签块（`_parse_labelled_blocks`，无 PyYAML）。
- **`paper_revise`**：
  - gap-fill 组装：`verifier_feedback` / `add_facts` -> 组装 `gap_fill_text`（VERIFIER FEEDBACK + PUBLISHED CITATIONS AVAILABLE + FACTS TO ADD）；返回 `gap_fill_facts`。
  - 输出契约：stdout 为 `%%%MAIN_TEX%%%\n<tex>\n%%%REVISION_SUMMARY%%%\n<summary>`；`_split_reviser_output` 拆分。
  - **PATCH 契约**：默认输出 `%%%PATCH%%%` 块（`<<<<<<< FIND\n...\n=======\n...\n>>>>>>> REPLACE`）；`_apply_reviser_patch` 把每个 FIND **恰好一次**替换（0 次或多次则跳过并报 `patch_errors`），按序应用。
  - 退化收缩防护：`orig_tex_len>2000 and len(tex)<0.6*orig_tex_len` -> `main.shrunk.tex` + `status=degenerate_revision`。
  - leak 门同 paper_write（`main.leaky.tex`，不覆盖，不进 log）。
  - **工具内编译重试环**：`_compile_check` 在 codex 外编译；失败且剩余次数 -> 用 `_compile_fix_prompt`（低 effort `low`）+ 携带同一 notes/citation_fixes 重新驱动；成功 -> 写 main.tex + `compile="ok"`；引擎缺 -> 写一次、`compile="skipped: no engine"`、不循环；次数尽 -> 隔离 `main.uncompiled.tex` + `compile_failed`。
  - `_append_revision_log`：REVISION_LOG.md 正文 = reviser 的 `%%%REVISION_SUMMARY%%%`（缺则 `[degraded: ...]`），Header 由工具写（mode/trigger/compile-status）；追加（`# REVISION_LOG` 头只一次）。
- **`paper_verify_math`**（全文档数学复验）：见 §2.5。

### 2.4 paper_chunked.py —— 分块策略

- 触发：`should_chunk(pdir, headline, paper_id, fact_ids, instructions)` 用 **真实的 single-pass prompt**（`build_writer_prompt`，selection-aware）测字符数；超过 `chunk_char_budget()`（`DANUS_PAPER_WRITE_CHUNK_CHARS`，默认 800000）才分块；**预算内走单遍路径完全不变**。
- 三阶段（全部非 agentic 隔离 codex，空 cwd + 全嵌入，输出即文本）：
  1. **PLAN**（`build_planner_prompt`）：闭包仅 STATEMENT -> 固定 preamble + front matter + 为每个闭包事实恰好分配一个 section 的 section plan + bibliography。输出按 `%%%PREAMBLE%%% / %%%FRONTMATTER%%% / %%%SECTIONS%%% / %%%BIBLIOGRAPHY%%%` 分隔。
  2. **FILL**（每 section 一调 `build_section_writer_prompt`）：本节事实完整正文 + 其它闭包事实 STATEMENT-only（`\ref` 语境，`section_ref_context_ids` 只取本节的直接前驱，**有界本地**）+ 固定 preamble/front matter + 整份 section plan + 本节 title/label。输出本节 LaTeX + `%%%PROVENANCE%%%`。
  3. **STITCH**（确定性 Python）：preamble + front matter + 各 section body（按 plan 序）+ bibliography + `\end{document}`；逐节 provenance 合并（`setdefault`，后节不覆盖前节 label）。
- 分区：`fact_ids` 给定 -> `selected_partition`（此时覆盖集=选中子集；`referenced_ids` 作为 `\ref` 语境加入每节）；否则整闭包。
- **`normalize_coverage`**：修复不完美 plan（同事实多节保留首节去重；闭包外 id 丢弃；未分配闭包事实扫入末尾 `Additional results` 节，label `sec:additional[-N]`）。
- **`check_coverage`**（严格）：每个闭包事实恰好一次；否则 `ChunkError("plan", ...)`。
- `generate` 返回：成功 `{ok:True, tex, provenance, sections, phase_logs, plan_res, section_res}`；失败 `{ok:False, phase:"plan"|"section:<label>", error, phase_logs, res, prompt}`（**无 main.tex**，诚实不产出半成品）。真正的写盘/日志在 server（与单遍共用下游）。

### 2.5 paper_math_verify.py —— 全文档复验（第三验证器，独立于 fact 验证器与 reference 验证器）

- **为什么**：facts 各自被验证，但 paper 是重渲染/重拼接的另一产物（"it suffices…"、"WLOG…"、删步），接缝处才可能出错。故须**按写作原样**整体复验。
- **`document_body(tex)`**：取 `\begin{document}(.*)\end{document}`；无环境则整体。
- **`whole_doc_budget()`**：`DANUS_PAPER_VERIFY_WHOLE_DOC_CAP`（默认 700000 ≈ 175K tokens）；非正/不可解析回退默认。prompt 超此 -> **不拆分**、记 `too_large`；按结果分解是 main-agent 的职责。
- **`deliver_ok(path) -> (ok, blockers)`**：ledger 必须存在且每行 `status in ("correct","trusted","overridden")`；无 ledger -> `False, ["no ledger (run paper_verify_math first)"]`；否则 blockers 列 `<unit_id> [<label>] (<status>)`。
- `LedgerRow` dataclass：`unit_id,label,source_fact,status,last_verdict,repair_hints,ignorable,attempts,last_checked_utc`。
- `read_ledger/write_ledger/merge_attempts`；`LEDGER_STATUSES`：pending/correct/wrong/unresolved-context/oversized/uncovered/overridden/trusted。
- server 端 `_parse_paper_verdict(stdout)`：取最后一个带 `findings` 列表的 JSON（balanced scan 用 `raw_decode`，容忍 LaTeX 大括号）；每个 finding 按 `class` 分类，`class=="ignorable"` -> ignorable，否则（含缺失/未知 class）-> must-fix；**无 must-fix 即 correct**，有 must-fix 即 wrong。向后兼容旧 `{verdict: correct|wrong, repair_hints}`。
- `paper_verify_math` 流程：无 main.tex -> `no_paper`；正文超预算 -> `too_large`（写 ledger `oversized` 行）；否则 `_drive`；非 ok -> `verify_error`（**不是通过**）；parse 成功 -> 写 `whole-paper` 行（`correct`/`wrong`，ignorable 记 `ignorable` 字段不 block）；`deliver_ok` 判定 status `passed`/`blocked`。
- contract：`status`：`passed`（实际全清，零 must-fix）/`blocked`（有 must-fix 或过不了门）/`verify_error`（run 失败）/`too_large`/`no_paper`/`passed`。

---

## 3. human_summary 服务

### 3.1 工具与输入

- `build_app()` -> `FastMCP("human-summary")`，注册 **唯一工具** `summary_write`。
- `summary_write(project=None, language=None)`：`lang = language or _operator_language() or "English"`；`report_path = pdir/report/report.md`；`build_prompt` + `_drive`（`classify_outcome(..., "report")`）。
- 返回 `{report_md_path, language, status, returncode, leak_findings, stderr_tail}`。**`status="ok"` 仅在零退出且非空输出且零 leak**；非 ok 不保留干净 report，泄漏输出隔离到 `report.leaky.md` 并删除旧 report.md。
- 渲染流程：干净 `report.md` -> `bash render_pdf.sh <report.md> <out.pdf> "Title"`（headless Chrome 渲染 markdown+KaTeX 为自包含 HTML 再 print-to-PDF，无需 LaTeX）；交付 PDF 路径，绝不粘贴 `$...$`/`\boxed{}` 到聊天。
  - 前置：headless Chrome/Chromium（`DANUS_CHROME_BIN` 或 PATH 的 google-chrome）；node + 固定依赖（markdown-it、katex）在 `package.json`；`render_pdf.sh` 一次性安装。
  - 背手检查：`grep -E '[0-9a-f]{16}' <report.md>` 必须无输出。

### 3.2 assemble.py —— scrubbing 指什么

- `skill_dir()`：`DANUS_HUMAN_SUMMARY_SKILL_DIR` env 否则 `<repo_root>/agents/skills/human-summary`；`WRITER_PROMPT_REL="REPORT_WRITER_PROMPT.md"`。
- **scrubbing（擦洗）**：对每个选中事实只嵌入 `body_sections(raw)`（`## statement`/`## proof`/`## intuition`），**整段 YAML frontmatter 全部剥掉**（`fact_id`/`author`/`problem_id`/`predecessors`/`glossary_introduces`/`external_refs` 一个不留），**任何 fact id / slug 都不出现**。writer 从纯数学角度工作。正文逐字保留，绝不总结证明。
- **`_ordered_load_bearing(fg)`**：全部已验证事实，拓扑序（前驱先于依赖者）；同一拓扑层内按 `(-depth, -in_degree, id)` 破平，使 load-bearing 的脊柱自然靠前；环则确定性排剩余（`_depth` 用 memo + visiting-set 防环，back-edge 视 depth 0）。
- `fact_bundle(project_dir)`：每个事实标 `--- Result {n} ---\n{body_sections}`；空图 -> `"_(no verified results are available for this project yet)_\n"`。
- `build_prompt(project_dir, language="English")`：preamble（"You are the REPORT WRITER… no filesystem… no identifiers…"）+ `"Report language: {lang}..."`（register 规则：叙事用该语言，所有标准数学术语保持英文）+ `section(REPORT_WRITER_PROMPT, _read_fixed(...))` + `section("PROBLEM.md (verbatim goal)", read_project PROBLEM.md)` + `section("VERIFIED_RESULTS (scrubbed, id-free)", fact_bundle)`。

### 3.3 server.py —— 其它

- 每服务 model/effort：`DANUS_HUMAN_SUMMARY_MODEL`/`_EFFORT` -> `DANUS_CODEX_MODEL`/`_EFFORT` -> 默认。
- `_operator_language()`：读 repo 根 `OPERATOR.md` 的 `**Language:**` 字段；找不到文件/无该行/值为 `_( ... )_`（模板占位）-> `None`。
- **human-summary 专用更严 leak 集**（9 项）：16-hex、`^\s*author:`、`predecessors`、`fact_`、`master_guidance`、`fact_submit`、`verifier`、`worker`、`global memory`。
- config：`DANUS_AGENTS_ROOT`/`DANUS_PROJECT_DIR`/`DANUS_HUMAN_SUMMARY_SKILL_DIR`/`DANUS_CODEX_BIN`。

---

## 4. integrations/matlas —— arXiv 定理搜索

- **API**：`POST {MATLAS_URL}`（`MATLAS_URL` env，默认 `https://leansearch.net/thm/search`），无 auth。
- **请求体**：`{"query": str, "task": str, "num_results": int}`；`_TASK = "Given a math statement, retrieve useful references, such as theorems, lemmas, and definitions, that are useful for solving the given problem."`。
- **请求头**：`Content-Type: application/json`、`Accept: application/json`、`User-Agent: "danus/1.0 (+https://frenzymath.com)"`（Cloudflare 需要显式 UA 才不 403）。
- **返回**：`search(query, num_results=10, timeout=30)` -> `{"query", "count", "results": [{title, theorem, arxiv_id, theorem_id}, ...], "endpoint"}`；空 query -> `{"count":0,"results":[],"error":"empty query"}`；`num_results` 非正 -> clamp 到 10；非 dict item 丢弃；非 list body -> `error`。
- **返回结构**：结果归一化为恰好 4 个字段 `title / theorem / arxiv_id / theorem_id`（按 published 原文，保留 fidelity）。
- **绝不抛出**：`HTTPError` -> `"http {code}: {reason}"`；`URLError` -> `"network: {reason}"`；`TimeoutError/JSONDecodeError/ValueError` -> `"{Type}: {msg}"`，均返回带 `error` + `results: []`。
- 顶点 `search_arxiv_theorems` = gateway `verifier` 角色唯一暴露的工具，即此 matlas.search 的门控封装。

---

## 5. observability dashboard（端口 8099）

- 单文件 FastAPI 应用，**严格只读**，不 import 任何 danus.core 运行时模块。
- 数据源：`<project>/fact_graph/facts/*.md`（已验证事实 DAG）、`<project>/global_memory/<kind>.jsonl`（11 类发现）。
- **CHANNELS（11 个 kind + role 标签）**：`conclusion,example,counterexample,proof_attempt`（role `result`）；`plan,direction`（`judgment`）；`obstacle,dead_end`（`deadend`）；`verification`（`verify`）；`elaboration,master_guidance`（`strategy`）。**手工维护的 core.GLOBAL_KINDS 数据副本**。
- **路由**：`GET /api/overview`、`GET /api/factgraph`、`GET /api/channels`、`GET /api/channel/{kind}`（未知 kind -> 404）、`GET /` -> `static/index.html`、`/static/*` mount。
- **数据负载**：
  - overview：`{project, facts, facts_with_predecessors, facts_by_author, channel_counts, verdicts, updated_at}`。
  - factgraph：`{nodes:[{id,author,problem_id,statement,proof,intuition,predecessors,depth}], edges:[{source,target}], max_depth}`；depth=从叶子最长路径，叶=0，环防护。
  - channels：`{channels:[{kind,role,count}]}`；channel：`{kind,count,entries}`（按 `timestamp_utc` 降序=最新在前）。
- **绑定与安全**：默认 `127.0.0.1:8099`（loopback，SSH 转发暴露）；`--project` / `DANUS_DASHBOARD_PROJECT` / `DANUS_PROJECT_DIR` 在调用时解析；缺/不存在 -> fail fast（`SystemExit("project dir not found: ...")`）。容忍部分/坏数据（jsonl 断行跳过、坏文件跳过、环防护）。
- 入口：`python -m danus.observability --project <dir> [--port 8099]`；`main()` 里 `--host` 默认 `127.0.0.1`。

---

## 6. main-agent 四个 skill（用途与触发条件）

| skill | 用途 | 触发条件 |
|---|---|---|
| **initialize** | 首次运行 setup 访谈：问候+解释 Danus，问关键选择（codex 后端）+ 自由文本（称呼/语言/git 分支/预算），然后全部置办（分支、`config/danus.env`+`config/codex.env`、`OPERATOR.md`、codex login、verify 服务），标记 `runtime/.danus-initialized`。系统在回答前无法运行。 | 首次会话；`runtime/.danus-initialized` 缺失；`OPERATOR.md` 仍是空模板；或 operator 要求 setup/initialize/onboard/reconfigure。规则：问不猜；绝不在 `main` 工作；密钥只在 `config/*.env`；每步先持久化；栈变绿才写 sentinel；`doctor.sh` 绿/红如实报告。 |
| **elaboration** | 从全局记忆+事实图产出高信号数学综合（五段模板，七状态标签，严格 CLOSED 检验，接口契约表，危险启发式，缺失桥引理），用于 main-agent 自身策略与 worker 分派；经 `gm_add(kind="elaboration")` 发布。 | 每次战略周期（约 30 分钟心跳）当综合**实质改变**时生成一篇；不做重复 elaboration。读共享存储（全局记忆/事实图/PROBLEM），绝不读 worker 私有记忆。 |
| **write-paper** | 把项目已验证事实图转成可发表 LaTeX 论文（`amsart`、真实手工 bibliography、编译成 PDF）；经 write-paper MCP 的 6 个工具编排；引用链 `auditor(离线,标记)→verifier(在线,核验证)→reviser(编辑)`；编译门 + 全文档数学复验门；最后 `latex_git_push.sh` 推送（operator fork）。 | 项目目标定理在事实图中成立且 operator 要论文；或 operator 要求写/改/审计引用/推送。**不是** human-summary（无 bibliography 的读者报告）**也不是** elaboration（内部综合）。Stage 2 有**强制 BINDING RULE**：除非闭包个位数（<10），否则任何 `paper_write` 必须给 `fact_ids`（hand-picked 支持层），禁止抛整闭包。 |
| **human-summary** | 写读者向数学进度报告（编译 PDF）：精确问题陈述、关键部分结果（真实证明梗概）、主要障碍、中立路线时间线、当前状态与剩余唯一引理全写（boxed）；经 `summary_write`（隔离 codex、擦洗 id-free bundle）+ `render_pdf.sh` 渲染。 | 按需（operator 要报告）或周期 operator 更新。**不是** elaboration（内部）/dashboard/**不是** write-paper（无 bibliography 无 house style）。主要 agent 不读事实图、不写正文；只调工具、渲染、交付。 |

---

## 7. 测试固化的边界行为

### 7.1 authoring
- `resolve_project`：按名解析；非法名（`../evil`/`a/b`/`/abs`）-> `RuntimeError`；给了名但 `DANUS_AGENTS_ROOT` 未设 -> `RuntimeError`（消息含 `DANUS_AGENTS_ROOT`）；未知但格式良好名 -> 抛；回退 `DANUS_PROJECT_DIR`；两者皆空 -> 抛。
- `body_sections`：无 `## ` 但有关闭 fence -> 返回闭 fence 后内容（frontmatter 剥掉）；无标题无 fence -> 内容原样；未闭合 fence -> 落回原样（以 `---` 开头，不崩溃）。
- `classify_outcome`：ok（0 退出+非空 stdout）/nonzero（`returncode=3`, `stderr_tail` 含 boom）/empty（`"   \n"`, `error` 含 "no report"）/timeout（status=timeout）/missing-binary（status=error, "not found"）。
- `section` 包装含 BEGIN/END；`read_fixed`/`read_project` 缺文件抛 `FileNotFoundError`；`leak_findings` 只扫描调用方提供 pattern。
- `driver.run_codex`：stdout 逐字转发（fake codex `\documentclass{amsart}`）；cwd 是含 `danus-authoring-codex-` 前缀的全新临时目录且事后被清掉；nonzero returncode 透传（`[[FAKE:exit=7]]` -> rc 7 + 空 stdout + stderr 含 "forced nonzero exit"）；超时抛 `TimeoutExpired`；缺二进制抛 `FileNotFoundError`；裸名经 `shutil.which` 解析、不在 PATH 则返回原裸名；`subprocess_env` 仅对具体路径前置 bin 目录，裸名不动 PATH。
- 中性默认：`driver.DEFAULT_MODEL=="gpt-5.6-sol"`, `DEFAULT_EFFORT=="xhigh"`；`DANUS_MAIN_MODEL`/`DANUS_MAIN_EFFORT` 空且 `DANUS_CODEX_MODEL/DANUS_CODEX_EFFORT` 有值 -> 用后者。

### 7.2 write_paper.
- **诚实性**（全部工具）：nonzero/empty/timeout -> `status != ok`，无 main.tex 写入（`status="error"` 或 `"timeout"`，`returncode`/`stderr_tail` 如实）；`reference_verify` 非 ok 不写 ledger。
- **leak 门**：16-hex fact_id 混入 `.tex` -> `status=leak`、main.tex 不写、隔离 `main.leaky.tex`；已存在干净 main.tex 且新 run 泄漏 -> 旧文件**被删除**；允许 `worker/verifier/predecessors`（纸面词汇），否则 `leak_findings==[]`。
- **provenance**：`%%%PROVENANCE%%%` 在 leak 门之前被剥走，16-hex id 只进 `.provenance.json`，tex 保持干净；无标记向后兼容（`provenance_path=None`，不写该文件）；坏 JSON 则跳过仍写 tex。
- **code fence**：writer 把整份输出包进 ```tex 时剥外层 fence，tex 可编译；fence 内 provenance 仍恢复。
- **needs_target**：brief 空 + 无 TARGET.md -> `status=needs_target`，`headline_source=unset`，`candidates==["fact_odd_sum_main"]`，不写 main.tex；brief 空但已有 TARGET.md -> `source=target`；显式 headline arg 覆盖 brief（`source=arg`）；`fact_ids` 含未知 id -> `bad_fact_ids`（不写）。
- **swarm stop**：默认不停（`{skipped: stop_workers=False}`）；`stop_workers=True` 且 `_fake_do_stop` 被调 -> `force=False` 必须优雅；已 idle -> `{result:[{result:"not-running"}]}`，无 error；`DANUS_KEEP_SWARM_ON_WRITE=1` 强制 keep；stop 抛异常 -> 失败隔离（error 记录，paper 正常）；`needs_target` 绝不触发 stop。
- **gap-fill**（`paper_revise` 带 `verifier_feedback`+`add_facts`+`notes`）：三元素共同抵达 reviser 单一 gap-fill trigger（`MODE: gap-fill`、`VERIFIER FEEDBACK`、`FACTS TO ADD`、main-agent `notes`）；返回 `gap_fill_facts==["fact_odd_recurrence"]`。
- **reviser log**：追加（`# REVISION_LOG` 头只一次、`reviser (danus.write_paper)` 计两次）；正文 = reviser 真实 `%%%REVISION_SUMMARY%%%`（非 stub）；缺 summary -> `[degraded: ...]` 记录、tex 仍写。
- **compile-retry**：先失败后成功 -> `compile_attempts==2`、第二次是**低 effort 且无 MODE 行**的轻量 compile-fix 提示（**不重发 citation_fixes trigger**）、修复存活；次数尽 -> `compile_failed`、main.tex 不覆盖、隔离 `main.uncompiled.tex`、`compile_log_tail`；引擎缺失 -> 不循环、写一次、`compile="skipped: no engine"`、`compile_attempts==0`；non-ok 回归 -> 不写任何东西、`_compile_check` 不达。
- **degenerate**：patched tex < 0.6×原长且原长>2000 -> `main.shrunk.tex` + `status=degenerate_revision`，main.tex 不覆盖。
- **reference_verify**：JSON 与 **YAML-ish 块**都能解析（`verified/corrected/rejected` 等）；`confirmed_metadata` 嵌套 dict/`null` 正确处理；verified/corrected（带 source_url）-> `verified-by: verifier` + source_url + 元数据；rejected -> `verified-by: unverified (rejected)` 不提升；**就地单一表**（`## AC24` 恰好一次，无 `verifier delta`）；旧 delta 污染的下次写被压缩掉；全 `unverifiable` 不误提升；`networked=True, gateway_role="verifier"`。
- **run log**：`log_path` 指向 `<paper>/.runs/<utc>/<tool>/log.md`；含完整 prompt+完整 stdout+**完整 stderr（>2000 也全量）**+decisions+返回 envelope；`stderr_tail` 仍只 2000；failure 也写；needs_target 早退记 `(no prompt — early return before codex was driven)`/`(no codex run)`；`reference_verify` 记 `networked: True`+`applied_keys`；paper_revise `## Header` 恰好一次+`compile_outcomes`；`DANUS_WRITE_PAPER_RUN_LOG=0` -> `log_path=None` 且工具正常；**无 API-key 形状 secret**；写日志失败隔离（`Path.mkdir` 抛 -> `log_path=None`，paper 仍写）。
- **paper_verify_math**：correct -> `passed`+`deliver_ok=True`+`wrong==0`；wrong -> `blocked`+`repair_hints` 记录在 `whole-paper` 行；超预算 -> 不发送（`calls["n"]==0`）+`too_large`+`deliver_ok=False`；verify run 失败 -> `verify_error`（**绝不 passed**），无 `correct` 行；orphan proof -> `blocked`；无 main.tex -> `no_paper`；仅 ignorable -> `passed`+`ignorable==1` 且 `repair_hints==""`；must-fix 存在 -> `blocked`；缺失/未知 class -> 默认 must-fix；旧 `{verdict}` schema 向后兼容。
- **chunked**：小闭包走单遍（无 `chunked` 标志）；超预算（`DANUS_PAPER_WRITE_CHUNK_CHARS=100`）触发分块；`fact_ids` 选择时覆盖集=选中子集、其它节仍带 referenced 前驱 statements；`section_ref_context_ids` 只取本节的直接前驱（叶无 `\ref` 语境，绝不列自身为 `\ref`）；4 分隔符解析、缺分隔符 -> `ChunkError("plan")`；coverage 传/失败（未分配/重复）；`normalize_coverage` 修复去重/丢 stray/扫入 `Additional results`；stitch 含 preamble+各节+bib+`\end{document}`；provenance 只进 `.provenance.json`；任一节泄漏 16-hex -> 整份隔离 `main.leaky.tex` 不写 main.tex；planner/section 非 ok 或空 stdout -> `status=chunk_failed`+`failed_phase="plan"|"section:<label>"`，不写 main.tex，仍写 run log。
- **app/注册**：`build_app()` 注册 6 工具（`set _TOOLS=={paper_subgraph,paper_write,reference_audit,reference_verify,paper_revise,paper_verify_math}`）；`__main__` 调用 `build_app().run()` 恰一次；`per-service model/effort` 与 hs 独立。
- **多 paper**：`paper_workspace/paper_target_path` 映射 legacy 与 `papers/<id>`；`paper_id` 单段校验拒绝 `../escape`,`a/b`,`with space`,`/abs`,`.`；N 论文/单论文各一、N 论文多定理、union-closure 等于直接调用 `_toposort_with_predecessors`；`finalize --paper` 记录每论文 target；每论文 writer 事实与 seeded ledger 同闭包（`ThmB99` 只在 B 的 ledger）。

### 7.3 human_summary
- 组装嵌入 writer prompt+PROBLEM.md+proof 正文逐字；scrub 无 `fact_id:`/`author:`/`predecessors`/`problem_id:`/`glossary_introduces`/`external_refs`/`fact_*` slug；语言指令（默认 English，显式 Chinese 透传且含 "terminology in English"）；空图 -> sentinel `_(no verified results...`；坏循环确定性；缺 writer prompt/PROBLEM.md -> `FileNotFoundError`。
- server：干净输出 -> 写 report.md + `status=ok` + 无 leak + 小返回（无 full body）；泄漏 16-hex -> `status!=ok` + leak_findings + 不保留 report.md + 隔离 `report.leaky.md` + 删除旧干净 report.md；nonzero/empty/timeout -> 诚实不写；`_operator_language` 缺文件/空模板/无行 -> None、真实字符串被读到、`summary_write` 解析语言；`build_app` 注册 `{summary_write}`；`__main__` 调 run() 一次；per-service model/effort 独立；路径转义验证拒绝 `../evil`,`a/b`,`/abs`；leak scanner 捕获所有禁词类别。

### 7.4 matlas
空 query 短回路；归一化恰 4 字段、非 dict 丢弃、无 `error`；`URLError` -> `error.startswith("network:")`；非 list body -> 有 error；`HTTPError 403` -> `error.startswith("http 403")`；`TimeoutError` -> `error.startswith("TimeoutError")`；坏 JSON body -> `error.startswith("JSONDecodeError")`；`num_results=0` -> 请求体 `"num_results": 10`；`__main__` smoke 离线可跑。

### 7.5 observability
overview 计数（4 facts=3 种子+1 文件名 stem 回退，`facts_with_predecessors==2`，`facts_by_author`，plan 空/坏行跳过 -> 2，verdicts `{correct:1,wrong:1}`）；factgraph 深度 0/1/2、max_depth=2、边 2 条、section body 保留；环防护（互指 predecessors 不 hang/raise）；channels 11 kinds、plan role=`judgment`、channel 最新在前、未知 kind -> `KeyError`；缺失目录容忍（空 facts、空 nodes、空 entries）；HTTP 路由 200/404/index 页面含 "Danus"；`_project_dir` 未设 -> RuntimeError；缺项目 dir -> `SystemExit("project dir not found: ...")`；`main()` `--host`/`--port` 传给 uvicorn、`application==app.app`；`python -m danus.observability` 调 `main()`；`_load_facts` 跳过不可读/无 id 的 `*.md`；`_load_jsonl` 对不可读/权限拒绝返回 `[]`；`_parse_fact` 容忍无冒号 frontmatter 行。

---

## 附：移植关键可复用字符串/常量速查

- 分隔符：section `===== BEGIN {X} =====`/`===== END {X} =====`；reviser `%%%MAIN_TEX%%%`/`%%%REVISION_SUMMARY%%%`/`%%%PATCH%%%`；patch 块 `<<<<<<< FIND`/`=======`/`>>>>>>> REPLACE`；writer/planner `%%%PROVENANCE%%%`；planner `%%%PREAMBLE%%%`/`%%%FRONTMATTER%%%`/`%%%SECTIONS%%%`/`%%%BIBLIOGRAPHY%%%`；gap `[GAP:...]`；leak/machine 词。
- 工具：`paper_subgraph`/`paper_write`/`reference_audit`/`reference_verify`/`paper_revise`/`paper_verify_math`；`summary_write`。
- 状态：`needs_target`/`bad_fact_ids`/`leak`/`chunk_failed`/`no_edits_applied`/`degenerate_revision`/`compile_failed`/`compile="ok"|"skipped: no engine"`/`verify_error`/`too_large`/`no_paper`/`passed`/`blocked`/`correct`/`wrong`。
- 文件：`TARGET.md`、`PROJECT_BRIEF.md`、`REFERENCE_LEDGER.md`、`REVISION_LOG.md`、`VERIFY_LEDGER.md`、`main.tex`、`main.leaky.tex`、`main.uncompiled.tex`、`main.shrunk.tex`、`.provenance.json`、`.runs/<utc>/<tool>/log.md`、`<project>/paper/`、`<project>/papers/<paper_id>/`、`<project>/report/report.md`。
- codex 调用：`bin/codex exec --model <m> --config 'model_reasoning_effort="<eff>"' <tail> -`；`--sandbox read-only` / `--dangerously-bypass-approvals-and-sandbox` + `-c mcp_servers.danus=...DANUS_ROLE=verifier...` + `--config tools.web_search=true` + `--skip-git-repo-check`。
