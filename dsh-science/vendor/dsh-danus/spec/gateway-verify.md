# Danus 网关/验证子系统 — 行为规格（Python→TypeScript 移植用）

> 本规格从 `Danus/danus/gateway/*`、`Danus/danus/verify/*`、`Danus/danus/codex.py`、
> `Danus/danus/_mcp.py`、`Danus/danus/__init__.py`、`Danus/agents/contracts/{verifier,worker}.md`、
> `Danus/agents/skills/verify/*/SKILL.md + agents/openai.yaml` 提取。
> 目标：对照此文档即可不读源码地重写；保留全部关键常量确切值与错误消息原文。

---

## 0. 边界与整体图

- **gateway**（`danus.gateway`）= 一个 stdio MCP 服务器（名字固定为 `"danus-core"`），是通往 truth stores 的"唯一正门"。权限按"角色能**看到**哪些工具"实施（不是靠 prompt 约定）。
- **verify**（`danus.verify`）= 一个小型 HTTP 服务，是**唯一**的数学正确性写闸门。`fact_submit` 调用它；返回 `verdict == "correct"` 时 fact 才被写入 fact graph。
- verify 是 **LLM 直觉裁判，不是形式化（Lean）检查器**；默认**无人在环（no human in the loop）**。`gpt-5.6-sol` codex agent 读自然语言 markdown proof，返回 verdict。
- 网关与验证服务之间是**固定的 HTTP seam**（见 §2）。两端必须同时改（ARCHITECTURE §4）。

---

## 1. 6 个 MCP 工具（精确参数 schema / 返回结构 / 错误语义）

所有配置**在调用时**（call time）从环境变量读取，绝不在 import 时读取——因此服务可测、可重配。6 个工具的总表在 `gateway/server.py` 的 `_TOOLS` 字典，注册在 `build_app(role)`。

全局环境契约（`gateway/server.py` 顶部 docstring，均调用时读取）：

| env | 含义 | 默认 |
|---|---|---|
| `DANUS_PROJECT_DIR` | worker 被钉住的项目目录（main 的兜底） | ""（空） |
| `DANUS_AGENTS_ROOT` | 所有项目的根（`<root>/<project>`），让 main 用 `project` 参数按名寻址任意项目 | ""（空） |
| `DANUS_AUTHOR` | 本 agent 的 id，用于署名 | `"unknown"` |
| `DANUS_ROLE` | `worker`/`main`/`verifier`/`all`，决定暴露哪些工具；**未设置回退只读 verifier 集——fail-closed** | `"verifier"` |
| `DANUS_VERIFY_URL` | verify 服务端点，供 `fact_submit` | ""（空） |
| `DANUS_PROBLEM_ID` | 写入 fact 时盖的 problem id（默认：项目名） | 项目名 |
| `DANUS_VERIFY_TIMEOUT` | 网关→verify 的 HTTP 超时秒数；`int()` 失败则回退 3600 | `"3600"` |

### 1.1 `gm_add`

```python
def gm_add(
    kind: str,
    claim: str,
    evidence: str = "",
    verifiable: Optional[bool] = None,
    glossary: Optional[Dict[str, str]] = None,
    links: Optional[Dict[str, Any]] = None,
    project: Optional[str] = None,
) -> Dict[str, Any]
```

- 语义：发布一条 finding 到 shared global memory（claim + evidence）。`verifiable` kind（`conclusion`/`example`/`counterexample`/`proof_attempt`）**必须**有显式证据；judgments（`plan`/`direction`/`obstacle`/`master_guidance`/`elaboration`）不需要。
- 内部：`_gm(project).append(kind, claim=claim, evidence=evidence, author=_author(), verifiable=verifiable, glossary=glossary, links=links)`。
- 返回：`{"id": <entry_id>, "kind": <kind>}`。`entry_id` = `sha256(json([kind, claim, author, ts]))[:16]`（16 位十六进制）。
- 错误：`kind` 不在 `GLOBAL_KINDS` → `ValueError(f"unknown kind '{kind}'. Known: {sorted(GLOBAL_KINDS)}")`；`verifiable` 且 evidence 为空 → `ValueError(f"kind '{kind}' is verifiable and requires explicit evidence")`。这两处由 `GlobalMemory.append` 抛出。
- 主 agent 传 `project` 以按名寻址；worker 省略（钉在自己的项目）。

### 1.2 `gm_search`

```python
def gm_search(
    query: str,
    kinds: Optional[List[str]] = None,
    limit_per_kind: int = 10,
    project: Optional[str] = None,
) -> Dict[str, Any]
```

- 语义：BM25 检索 shared global-memory findings。用于复用他人结果、避免重复劳动、了解哪些路径已死。
- 返回：`GlobalMemory.search` 的结果，结构为：

```json
{
  "query": "<query>",
  "results_by_kind": {
    "<kind>": {
      "count": <int>,
      "results": [
        {"score": <float>, "entry": {<完整 entry 对象>}}
      ]
    }
  }
}
```

  - `entry` 对象字段：`id`、`timestamp_utc`、`author`、`kind`、`claim`、`evidence`、`verifiable`（bool）、`status`（`"unverified"`/`"open"`）、`fact_id`（`None` 或 id）、`links`（object）、`glossary`（object），外加 `gm_add` 传入的 `**extra`。
  - 分数 `<= 0` 的命中被丢弃；每 kind 至多 `limit_per_kind` 条。
- 错误：无（空图 / 未知 kind 均安全返回）。`kinds` 缺省=全部 `GLOBAL_KINDS`。

### 1.3 `fact_submit`（唯一写 fact 路径，见 §2 详述）

```python
def fact_submit(
    statement: str,
    proof: str,
    predecessors: Optional[List[str]] = None,
    glossary_introduces: Optional[Dict[str, str]] = None,
    intuition: str = "",
    source_id: Optional[str] = None,
    external_refs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]
```

- 语义：run glossary 覆盖率检查 → 调 verify → **iff 接受**才写 node；拒绝时返回 repair hints 且**什么都不写**。返回的 `fact_id` 需在下游被引用。
- 一旦 verdict 存在，验证结果**总是**记入 global memory（kind `verification`）——accept、reject、或 accept-but-write-failed——保证 verdict 从不会被"无人记录"（verifier 是 stateless 的，由这个 worker 工具持久化）。
- `source_id` 可选地把要晋升的 global-memory finding 链接过来。
- `external_refs`：如 `{"key": "HL26", "authors": ["Han", "Liu"], "title": "...", "arxiv": "2603.03817", "year": 2026, "cited_for": "Theorem 1.2"}`。它是可变元数据，**不影响** `fact_id`。

### 1.4 `fact_search`

```python
def fact_search(query: str, limit: int = 10, project: Optional[str] = None) -> Dict[str, Any]
```

- 语义：对已验证 fact graph（statement + proof + glossary）做 BM25；derived 索引**按需重建**（不持久化 board），fact graph 保持单一 truth source。用于**证明之前**检查是否已有同类 fact，并找出相关 verified facts 以引用其 `fact_id`。
- 返回：`{"query": <query>, "results": [ {fact_id, score, statement} ... ]}`。`FactGraph.search` 返回 list of `{fact_id, score, statement}`，按分数降序，`score <= 0` 即停，至多 `limit` 条；空图 → `[]`。

### 1.5 `fact_revoke`

```python
def fact_revoke(fact_id: str, reason: str, project: Optional[str] = None) -> Dict[str, Any]
```

- 语义：级联撤销错误 fact 及其所有依赖。破坏性；operator/main-agent 专用（`main` 有，`worker`/`verifier` 无）。
- 返回：`{"revoked": [<被撤销 id 列表>]}`（含自身 + 所有传递依赖）。
- 错误：`fact_id` 不存在 → `ValueError(f"unknown fact_id: {fact_id}")`（由 `FactGraph.revoke` 抛出）。

### 1.6 `search_arxiv_theorems`

```python
def search_arxiv_theorems(query: str, num_results: int = 10) -> Dict[str, Any]
```

- 语义：对 arXiv theorem 语句做语义检索（Matlas）。返回**逐字、as-published** 的 theorem/lemma/definition 语句——语句保真度对数学推理与引用检查很重要。尽量把 query 写成**完整数学语句**。外部 HTTP，无鉴权。
- 返回（`danus/integrations/matlas.search`）：

```python
{"query": <q>, "count": <int>, "results": [{title,theorem,arxiv_id,theorem_id}, ...], "endpoint": <URL>}
```

  - 每个 result **恰好** 4 个字段：`title`/`theorem`/`arxiv_id`/`theorem_id`。
  - 失败时**从不 raise**：返回同一 envelope，追加 `"error"` 字段且 `results: []`。错误分支：空 query→`"empty query"`；HTTP 错误→`"http <code>: <reason>"`；网络→`"network: <reason>"`；其他→`"<Type>: <msg>"`；非 list body→`"theorem endpoint must return a JSON list, got <type>"`。
- 端点：`POST https://leansearch.net/thm/search`，body `{"query", "task", "num_results"}`，`task` 为固定长字符串（见下）。`MATLAS_URL` 可覆盖端点。`num_results <= 0` 时钳到默认 10。默认 timeout 30s。需带 `Content-Type: application/json; Accept: application/json; User-Agent: danus/1.0 (+https://frenzymath.com)`（Cloudflare 挡裸 urllib 请求）。

### 1.7 角色门控表（`roles.py`）与 fail-closed

`ALL_TOOLS`（元组顺序固定）：

```python
ALL_TOOLS = ("gm_add", "gm_search", "fact_submit", "fact_search", "fact_revoke", "search_arxiv_theorems")
```

`ROLE_TOOLS`（角色 → 工具集）：

| 角色 | 工具 | 说明 |
|---|---|---|
| `worker` | `gm_add, gm_search, fact_submit, fact_search, search_arxiv_theorems` | 唯一能 `fact_submit` 的角色（verifier-gated 写） |
| `main` | `gm_add, gm_search, fact_search, fact_revoke, search_arxiv_theorems` | **没有 `fact_submit`**（编排者不做数学，不能捏造 fact） |
| `verifier` | `search_arxiv_theorems` | 纯只读（它把 fact graph 当文件读，不写） |
| `all` | `ALL_TOOLS`（全部 6 个） | 显式开发用全集 |

关于"工具集不可见"的语义：**未门控的工具物理上缺失**（`build_app` 只注册该角色能用到的）。未知 / 错拼 / 未设置的角色 **fail-closed** 到最严的只读 verifier 集；真正全集需要显式 `DANUS_ROLE=all`。

```python
def tools_for(role: str) -> List[str]:
    return list(ROLE_TOOLS.get(role, ROLE_TOOLS["verifier"]))
```

`_role()`（server.py）读取 `DANUS_ROLE`，缺省回 `"verifier"`：

```python
def _role() -> str:
    return os.environ.get("DANUS_ROLE", "verifier")
```

`build_app(role=None)`：`role` 缺省为 `DANUS_ROLE`（env）；对 `tools_for(role)` 里的每个名字注册。注册时 `app.tool(name=name)(_TOOLS[name])`。`FastMCP.apply_tool` 版本无关（见 §6 `_mcp.py`）。

### 1.8 项目目录解析（`_project`，跨工具公共）

```python
def _project(project: Optional[str] = None) -> Path
```

- 若给 `project`：必须已设 `DANUS_AGENTS_ROOT`，否则 `RuntimeError("DANUS_AGENTS_ROOT is not set; cannot resolve a project by name")`。名字须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`，否则 `RuntimeError(f"invalid project name: {project!r}")`；目录不存在则 `RuntimeError(f"no such project: {project!r} (under {agents_root})")`。返回 `Path(agents_root) / project`。
- 若未给 `project`：必须已设 `DANUS_PROJECT_DIR`，否则 `RuntimeError("DANUS_PROJECT_DIR is not set and no project was given")`；返回 `Path(DANUS_PROJECT_DIR)`。
- 名字被限制为单一路径段（无 `/` 或 `..`），因此**不能逃逸 agents root**。

---

## 2. `fact_submit` 完整调用链（gateway → verify HTTP）

### 2.1 网关侧 `_verify`（HTTP 客户端）

```python
def _verify(statement: str, proof: str) -> Dict[str, Any]:
    verify_url = os.environ.get("DANUS_VERIFY_URL", "")
    if not verify_url:
        raise RuntimeError("DANUS_VERIFY_URL is not set (verify service not wired yet)")
    try:
        timeout = int(os.environ.get("DANUS_VERIFY_TIMEOUT", "3600"))
    except ValueError:
        timeout = 3600
    data = json.dumps({"statement": statement, "proof": proof}).encode("utf-8")
    req = urllib.request.Request(verify_url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))
```

要点：
- `DANUS_VERIFY_URL` 为空 → `RuntimeError`（精确消息见上）。
- `DANUS_VERIFY_TIMEOUT` 缺省 `"3600"`；非整数 → 3600（不崩溃）。
- 请求体 JSON：`{"statement": ..., "proof": ...}`，`Content-Type: application/json`。

### 2.2 HTTP 契约（`GET /health` + `POST /verify`）

```
POST /verify
  request : {"statement": <str, >=1 char>, "proof": <str, >=1 char>}   # application/json
  200     : {"verification_report": {"summary": str,
                                      "critical_errors": [{"location": str, "issue": str}, ...],
                                      "gaps":            [{"location": str, "issue": str}, ...]},
             "verdict": "correct" | "wrong",
             "repair_hints": str}                # "" iff verdict == "correct"
  400     : vacuous input, or 一处 P1/P3/P5 预检命中（见 §3.1，先于任何 codex 调用）
  422     : request-model 校验失败（空 statement/proof — pydantic）
  500     : codex 失败 / 未写输出 / 输出不是合法 JSON / 非 dict
  504     : codex exec 超时（仅当 CODEX_TIMEOUT_SECONDS 被设置时）

GET /health -> {"status": "ok", "pid": <int>}   # async，永不排队在 /verify 之后
# pid 自标识当前实例，便于 doctor/services 在共享端口上区分"我们的 verify"与"别家的 verify"
```

**不变量（由 verifier *prompt* 强制，不是本代码）：** `verdict == "correct"` ⟺ `critical_errors == []` 且 `gaps == []`。服务返回 agent 写的东西，**不重算** verdict。

### 2.3 `fact_submit` 的精确分步逻辑（gateway/server.py 原文语义）

```
fg = _fg(); gm = _gm()
problem_id = os.environ.get("DANUS_PROBLEM_ID", Path(_project()).name)

# 0) glossary 覆盖率 —— 纯建议性，绝不能因启发式 bug 阻塞提交
try:
    undefined = fg.undefined_symbols(statement=statement, proof=proof,
                                     intuition=intuition, predecessors=predecessors,
                                     glossary_introduces=glossary_introduces)
except Exception:
    undefined = []

# 1) Verify。若服务报错，此时还没有 verdict：返回干净错误让 worker 重试，什么都不丢。
try:
    result = _verify(statement, proof)
except Exception as e:
    return {"accepted": False, "verdict": "error", "error": str(e), "undefined_symbols": undefined}

# 1b) 成功调用但返回非 dict body（如裸 list）→ 当 verify 错误处理（干净重试信封，无 verdict 可存）
if not isinstance(result, dict):
    return {"accepted": False, "verdict": "error",
            "error": f"verify service returned a non-dict body ({type(result).__name__})",
            "undefined_symbols": undefined}

verdict = result.get("verdict")
accepted = verdict == "correct"

# 2) 仅当接受才写 fact。捕获写失败（如 predecessor 被撤销）以免跳过下面的 trace。
fact_id = None
write_error = None
if accepted:
    try:
        fact_id = fg.add(problem_id=problem_id, author=_author(), statement=statement,
                         proof=proof, predecessors=predecessors,
                         glossary_introduces=glossary_introduces,
                         intuition=intuition, external_refs=external_refs)
    except Exception as e:
        write_error = str(e)

# 3) 一旦存在 verdict，总是把验证结果记入 global memory（kind=verification）
gm.append("verification",
          claim=statement,
          evidence="verdict: correct" if accepted else (result.get("repair_hints") or "verdict: wrong"),
          author=_author(), verifiable=False,
          links={"source_id": source_id, "predecessors": predecessors or []},
          verdict=verdict, fact_id=fact_id, write_error=write_error,
          verification_report=result.get("verification_report"))

# 4) 返回
if not accepted:
    return {"accepted": False, "verdict": verdict,
            "repair_hints": result.get("repair_hints"),
            "verification_report": result.get("verification_report"),
            "undefined_symbols": undefined}
if write_error:
    return {"accepted": True, "fact_id": None, "write_error": write_error,
            "undefined_symbols": undefined}
return {"accepted": True, "fact_id": fact_id, "undefined_symbols": undefined}
```

**四种返回信封**（精确字段）：

| 场景 | accepted | verdict | fact_id | 附加字段 |
|---|---|---|---|---|
| 正常接受 | `True` | —(无字段) | `<id>` | `undefined_symbols` |
| 接受但写失败（如 predecessor 被撤销） | `True` | —(无字段) | `None` | `write_error`, `undefined_symbols` |
| 拒绝（verdict=wrong） | `False` | `"wrong"` | —(无字段) | `repair_hints`, `verification_report`, `undefined_symbols` |
| verify 错误（异常或非 dict body） | `False` | `"error"` | —(无字段) | `error`（字符串）, `undefined_symbols` |

关键点：
- 接受但写失败时 verdict 仍被 trace 为 `correct`（第 3 步在写失败之后无条件执行）。
- `FactGraph.add` 拒绝被撤销的 predecessor：抛出 `ValueError(f"predecessor_revoked: {pid}")`。
- `undefined_symbols` 只在"任何异常"时被置为 `[]`（第 0 步），正常时由 `undefined_symbols()` 返回。
- `verification` 事实的 `evidence`：accept → `"verdict: correct"`；reject → `result.get("repair_hints") or "verdict: wrong"`。

### 2.4 网关→verify 的端口 / env

- 默认 verify 监听 `127.0.0.1:8091`（见 §3.4）。
- `DANUS_VERIFY_URL` 形如 `http://127.0.0.1:8091/verify`。
- ARCHITECTURE 中端口为**回环，不得重编号**：8091 = verify；8099 = dashboard。

---

## 3. verify 服务

### 3.1 prechecks（`danus/verify/prechecks.py` — 纯函数、离线可测）

**两层，均为纯 ADDITIVE（只能拒绝更多，绝不接受更多），每层 env 可开关：**
1. 空洞检查（vacuousness）——拒绝近空 / 单字（"QED"、"obvious"）输入，防止 verifier 被"糊弄通过"空内容。
2. 硬禁令 P1 / P3 / P5——特定坏证明形状的正则拒绝。

**常量（env 可在调用时覆盖）：**

```python
MIN_STATEMENT_CHARS = int(os.getenv("VERIFY_MIN_STATEMENT_CHARS", "10"))
MIN_PROOF_CHARS    = int(os.getenv("VERIFY_MIN_PROOF_CHARS", "30"))
MIN_PROOF_WORDS    = int(os.getenv("VERIFY_MIN_PROOF_WORDS", "5"))

_VACUOUS_PROOF_MARKERS = (
    "todo","fixme","tbd","to be done","see above","see below","obvious",
    "obviously true","trivial","trivially true","left as exercise",
    "left to the reader","exercise for the reader","by inspection",
    "by definition","clear","clearly","qed",
)

VERIFY_REJECT_PROBLEM_MD_CITATIONS = os.getenv("VERIFY_REJECT_PROBLEM_MD_CITATIONS", "1") == "1"
VERIFY_REJECT_UNPROVEN_CONDITIONALS = os.getenv("VERIFY_REJECT_UNPROVEN_CONDITIONALS", "1") == "1"
VERIFY_REJECT_VAGUE_GESTURES = os.getenv("VERIFY_REJECT_VAGUE_GESTURES", "1") == "1"
```

**`_strip_markdown_noise(text)`**：删 code fence（```` ```... ``` ````）、inline code（`` `...` ``）、行首 `>` 引用、`[-*_]{3,}` hr、行首 `#+`，合并空白并 strip。作用：防止 markdown 包装让空洞 proof 显得有内容。

**`is_vacuous_proof(proof) -> (bool, reason)`**（保守：只标记"短"且"化简后只剩一个空洞 marker"的）：
- `len(cleaned) < MIN_PROOF_CHARS` → 真，`f"proof has only {len(cleaned)} substantive characters after stripping markdown noise (minimum {MIN_PROOF_CHARS}). A vacuous or near-empty proof cannot be passed by the verifier."`
- `word_count < MIN_PROOF_WORDS`（词数用 `\b\w+\b`）→ 真，`f"proof has only {word_count} substantive words (minimum {MIN_PROOF_WORDS})."`
- 去掉标点并 lowercase 后 `==` 某个 marker → 真，`f'proof body reduces to the vacuous marker "{marker}" after stripping punctuation and markdown noise.'`
- 否则 `(False, "")`。

**`is_vacuous_statement(statement) -> (bool, reason)`**：
- `len(cleaned) < MIN_STATEMENT_CHARS` → 真，`f"statement has only {len(cleaned)} substantive characters after stripping markdown noise (minimum {MIN_STATEMENT_CHARS}). Refusing to verify against an essentially empty statement."`
- 否则 `(False, "")`。

**P1 `check_problem_md_citation(proof) -> Optional[str]`**：当 toggle 关闭或 `proof` 非 str/空 → `None`。`_PROBLEM_MD_CITATION_PATTERNS`（9 条正则，均 `re.IGNORECASE`）：

```
r"\bas\s+declared\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
r"\bfrom[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md[\s`'\"]+(?:item|section|building\s+block|reduction)\b"
r"\bby\s+the\s+master\s+reduction\s+package\s+declared\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
r"\bby\s+the\s+master\s+reduction\s+package\s+declared\s+in\s+the\s+problem\s+statement\b"
r"\bas\s+known\s+from\s+(?:the\s+problem\s+(?:prompt|statement)|problem\.md|data/[A-Za-z0-9_]+\.md)\b"
r"\bby\s+the\s+verified\s+(?:reductions?|building\s+blocks?)\s+listed\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
r"\bas\s+stated\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
r"\bthe\s+(?:master\s+)?reduction\s+package\s+(?:declared|stated)\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
r"\b(?:this|that|it)\s+is\s+the\s+(?:master\s+)?reduction\s+package\s+declared\s+in[\s`'\"]+(?:problem|data/[A-Za-z0-9_]+)\.md\b"
```

命中 → 返回：
```
f"Hard Prohibition P1: the proof cites problem.md / data/<NAME>.md as a substantive math source. Matched phrase: {m.group(0)!r}. Replace with a specific verified fact_id from the fact graph; problem.md is the target description, not a source of premises. Override: set VERIFY_REJECT_PROBLEM_MD_CITATIONS=0."
```

**P3 `check_unproven_conditional_premises(proof) -> Optional[str]`**：`_CONDITIONAL_PREMISE_PATTERNS`（4 条，均 IGNORECASE）：

```
r"\bassume\s+(?:that\s+)?the\s+verified\s+[^.]{0,100}?\breductions?\s+have\s+(?:reduced|narrowed|placed|brought|moved|driven)"
r"\bassume\s+(?:that\s+)?the\s+verified\s+post-W_q\b"
r"\bassume\s+(?:that\s+)?the\s+post-W_q[^.]{0,100}?\breductions?\s+have\s+"
r"\bsuppose\s+(?:that\s+)?the\s+(?:no-hit\s+)?(?:putative\s+)?(?:residual|survivor|cell|data)\s+has\s+been\s+(?:reduced|narrowed|placed|moved|brought|driven)"
```

`_FACT_ID_PATTERN = re.compile(r"\b[0-9a-f]{16}\b")`。逻辑：对每个匹配，定位它所在**段落**（由 `\n\n` 界定）；若该**同一段落**内存在 16 位十六进制 `fact_id`（`_FACT_ID_PATTERN.search(para)`）→ `continue`（视为有依据，pass-through）；否则返回：
```
f"Hard Prohibition P3: the proof contains a conditional-premise phrase ({m.group(0)!r}) but no specific verified fact_id is cited in the same paragraph proving the assumed narrowing. Either replace the assumption with a specific citation or cite a backing fact_id in the same paragraph. Override: set VERIFY_REJECT_UNPROVEN_CONDITIONALS=0."
```

**P5 `check_vague_gestures(proof) -> Optional[str]`**：`_VAGUE_GESTURE_PATTERNS`（3 条，均 IGNORECASE）：

```
r"\bby\s+some\s+(?:Beatty|Dirichlet|Diophantine|Vinogradov|Weyl|Erd[oö]s[‐‑–—-]Tur[aá]n|classical|well-known)\s+(?:argument|theorem|inequality|estimate)\b"
r"\b(?:as|it)\s+is\s+well\s+known\s+(?:that|in\s+the\s+literature)\b"
r"\bby\s+(?:an?\s+)?(?:obvious|elementary|straightforward|standard)\s+(?:density|Diophantine|integer|approximation|estimation|counting|equidistribution)\s+(?:argument|theorem|principle)\b"
```

命中 → 返回：
```
f"Hard Prohibition P5: the proof gestures at a 'well-known'/classical result without a specific citation. Matched phrase: {m.group(0)!r}. Replace with a specific verified fact_id or an external paper citation (paper_id / theorem_id / arXiv id). Override: set VERIFY_REJECT_VAGUE_GESTURES=0."
```

**`run_prechecks(statement, proof) -> Optional[(int, str)]`**：首个拒绝返回 `(http_status, detail)`；全通过返回 `None`。顺序：
1. vacuous statement → `(400, f"vacuous statement: {reason}")`
2. vacuous proof → `(400, f"vacuous proof: {reason}")`
3. 遍历 (P1, P3, P5)，对每个再遍历 source_label ∈ (`"proof"`→proof, `"statement"`→statement)：`check_fn(source_text)`，**任何异常当作 no-match**（一个 check 绝不能变成 500）；命中 → `(400, f"[{name} on {source_label}] {reason}")`。

（P1/P3/P5 同时在 proof **和** statement 上跑——坏模式可能藏在 lemma 的假设里。）

### 3.2 冷启动 launcher（`danus/verify/launcher.py`）

- `_HERE = <package>/verify`；`_REPO_ROOT = _HERE.parent.parent`（repo 根）。
- `VERIFICATION_FILENAMES = ("verification.json", "verificationt.json")`（**注意第二个是拼写错误 `verificationt.json`，刻意保留**）。
- `_agent_home()` = `Path(env VERIFY_AGENT_HOME or _HERE/"agent").resolve()`。
- `_results_root()` = `Path(env VERIFIER_RESULTS_DIR or _HERE/"runs").resolve()`。
- `_model()` = `codex.model("DANUS_VERIFY_MODEL")`；`_effort()` = `codex.effort("DANUS_VERIFY_EFFORT")`。
- `_timeout()` = `int(env CODEX_TIMEOUT_SECONDS or "0") or None`（`0` → `None` = 无超时；库内默认无超时，`python -m danus.verify` 入口默认 900）。
- `_mcp_config_arg()` = `'mcp_servers.danus={command="python3",args=["-m","danus.gateway"],env={DANUS_ROLE="verifier"}}'`（通过 `-c` 注入，独立于 `CODEX_HOME`；verifier 角色只暴露 `search_arxiv_theorems`）。
- `_utc_timestamp()` = `datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")`。
- `generate_run_id(statement)` = `f"{ts}_{sha256(statement.encode(utf-8)).hexdigest()[:12]}"`。
- `_allocate_run_id(statement)`：`root.mkdir(parents=True, exist_ok=True)`；`base = generate_run_id`；循环 **最多 10000** 次 `(root / run_id).mkdir(parents=False, exist_ok=False)`；冲突则 `suffix+=1; run_id=f"{base}_{suffix}"`；全失败 → `RuntimeError(f"could not allocate a unique run_id under {root} for base={base}")`。并发共享 `RESULTS_ROOT` 绝不互相覆盖。
- `_verification_path(run_id)`：按 `VERIFICATION_FILENAMES` 顺序检查第一个已存在的文件；找不到 → `None`。
- `build_prompt(run_id, statement, proof)`：

```python
output_path = _results_dir(run_id) / VERIFICATION_FILENAMES[0]
return (f"Run_id: {run_id}. "
        f"Statement: {statement}. "
        f"Proof:\n{proof}\n\n"
        "Use AGENTS.md to verify the above proof for the statement. "
        f"Write the verification JSON to this exact path: {output_path}.")
```

- `build_codex_command(run_id, statement, proof)`：

```python
codex.exec_cmd(codex.resolve_bin(), _model(), _effort(),
    "-C", str(_agent_home()),
    "--skip-git-repo-check",          # 无 .git 的 tarball 安装下，codex 的 trusted-directory 检查拒绝运行
    "-c", _mcp_config_arg(),
    "--dangerously-bypass-approvals-and-sandbox",
    build_prompt(run_id=run_id, statement=statement, proof=proof))
```

- `ensure_agent_home()`：verify agent home 是 singleton、无 scaffolder。若 `home/AGENTS.md` 存在**且** `home/.agents/skills` 存在 → 直接返回（幂等 no-op）。若 canonical 源（`_REPO_ROOT/agents/contracts/verifier.md`、`_REPO_ROOT/agents/skills/verify`）缺失（如未装 `agents/` 树的已安装包）→ 也直接返回 home（不建断链）。否则：`(home/".agents").mkdir(parents=True, exist_ok=True)`，`_relink(home/"AGENTS.md", <contract>)`，`_relink(home/".agents/skills", <skills dir>)`（symbolic link 指向 canonical 源，保持同步）。
- `run_codex_verification(run_id, statement, proof) -> Dict`：

```python
results_dir = _results_dir(run_id); results_dir.mkdir(parents=True, exist_ok=True)
log_path = results_dir / "log.md"
ensure_agent_home()
cmd = build_codex_command(...)
env = codex.subprocess_env(cmd[0])
started_at = datetime.now(timezone.utc).isoformat()
try:
    with log_path.open("w", encoding="utf-8") as log_handle:
        log_handle.write(f"started_at_utc: {started_at}\n")
        log_handle.write(f"command: {shlex.join(cmd)}\n\n"); log_handle.flush()
        completed = subprocess.run(cmd, cwd=_agent_home(), env=env,
            stdin=subprocess.DEVNULL, stdout=log_handle, stderr=subprocess.STDOUT,
            text=True, timeout=_timeout(), check=False)
except subprocess.TimeoutExpired as exc:
    raise HTTPException(504, f"codex exec timed out after {exc.timeout}s. See log at {log_path}") from exc

if completed.returncode != 0:
    raise HTTPException(500, f"codex exec failed with exit code {completed.returncode}. See log at {log_path}")
verification_path = _verification_path(run_id)
if verification_path is None:
    expected = results_dir / VERIFICATION_FILENAMES[0]
    raise HTTPException(500, f"verification output was not found at {expected}. See log at {log_path}")
try: payload = json.loads(verification_path.read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    raise HTTPException(500, f"verification output at {verification_path} is not valid JSON") from exc
if not isinstance(payload, dict):
    raise HTTPException(500, f"verification output at {verification_path} must be a JSON object")
return payload
```

所以 launcher 把错误映射为 HTTPException：
- 504 = 超时
- 500 = 非零退出 / 无输出文件 / 坏 JSON / 非 dict JSON
这些由 `fact_submit` 翻译成 verify-error 路径（`verdict:"error"`）。

### 3.3 service.py（FastAPI / Pydantic）

```python
class VerifyRequest(BaseModel):
    statement: str = Field(..., min_length=1)
    proof:     str = Field(..., min_length=1)

app = FastAPI(title="Danus verify service", version="0.1.0")

@app.get("/health")
async def health() -> Dict[str, Any]:
    # async 有意义：/health 不得排队在同步 /verify threadpool 调用之后，
    # 无论有多少进行中的验证，都应在微秒级响应。
    return {"status": "ok", "pid": os.getpid()}

@app.post("/verify")
def verify(request: VerifyRequest) -> Dict[str, Any]:
    rejected = run_prechecks(request.statement, request.proof)
    if rejected is not None:
        status_code, detail = rejected
        raise HTTPException(status_code=status_code, detail=detail)
    run_id = _allocate_run_id(request.statement)
    return run_codex_verification(run_id=run_id, statement=request.statement, proof=request.proof)
```

- `min_length=1` → 空 statement/proof / 缺失字段 → pydantic 422（先于 prechecks）。
- `/health` 返回 `pid`（`os.getpid()`），调用方用 `runtime/run/verify.pid` 匹配以区分"我们的 verify"与共享端口上的别家部署。

### 3.4 __main__ 入口（`python -m danus.verify`）

```python
os.environ.setdefault("CODEX_TIMEOUT_SECONDS", "900")   # 入口提供有界缺省；库默认 _timeout() 保持 0/None
host = os.getenv("VERIFY_HOST", "127.0.0.1")
port = int(os.getenv("VERIFY_PORT", os.getenv("PORT", "8091")))
uvicorn.run(app, host=host, port=port)
```

- 默认绑定 `127.0.0.1:8091`（`VERIFY_HOST`/`VERIFY_PORT`（或 `PORT`）可覆盖；`VERIFY_HOST=0.0.0.0` 仅当 gateway 在另一台主机）。
- 需要 codex CLI：`DANUS_CODEX_BIN`（或 PATH 上的 `codex` / 仓库 `bin/codex` 包装）以及 `CODEX_HOME` 账号——**没有内置回退路径（BYO）**。verifier agent 运行 `python -m danus.gateway`，故该环境须装有 `danus`。

### 3.5 verdict JSON 完整 schema（verify skill 约定字段）

verifier（agent）输出到 `results/{run_id}/verification.json`，`/verify` 逐字返回：

```json
{
  "verification_report": {
    "summary": "<string>",
    "critical_errors": [ {"location": "<string>", "issue": "<string>"} ],
    "gaps":             [ {"location": "<string>", "issue": "<string>"} ]
  },
  "verdict": "<'correct' | 'wrong'>",
  "repair_hints": "<string>"
}
```

约束（agents/contracts/verifier.md + synthesize-verification-report skill）：
- `verdict` 恰为 `"correct"` 或 `"wrong"`。
- `repair_hints` **非空 iff** `verdict == "wrong"`（`"correct"` 时为空字符串）。
- `critical_errors` 与 `gaps` 的每项**都必须有** `location` 和 `issue`。
- 严格判定：`correct` ⟺ `critical_errors == []` 且 `gaps == []`，否则 `wrong`。
- 若任何 error/gap 存在，verdict 必须为 `"wrong"` 且 `repair_hints` 非空。
- verifier **不写任何 memory**；它只写 `verification.json`（worker 做所有对 global memory 和 fact graph 的写入）。

verifier 内部三步骤 skill（按顺序：`$verify-sequential-statements` → `$check-referenced-statements` → `$synthesize-verification-report`）各自的中间记录 schema（保持在上下文中，不持久化）：
- sequential：`{"location", "status", "critical_errors":[{location,issue}], "gaps":[{location,issue}]}`
- referenced：`{"location", "referenced_statement", "context_expansion", "arxiv_match_found", "web_match_found", "critical_error":{location,issue}}`

另外，**synthesize skill** 还要求自我检查（自推理，非工具）：若 self-check 失败，先改对象再继续；写完后把同一 JSON 作为最终消息发出。

### 3.6 health 端点

- `GET /health` → `200 {"status": "ok", "pid": <int>}`。`async` 是故意的，避免排队在同步 `/verify` 之后。无参数、无错误分支（除未启动）。

---

## 4. `danus/codex.py` 命令 / env 解析逻辑

共享 codex launcher——每个执行 codex 的地方（execution.loop 的 workers、verify.launcher、authoring.driver 的 one-shot renderers）都通过它解析 bin/model/effort/subprocess env/`exec` 前缀，保证三处一致。

- `_REPO_ROOT = Path(__file__).resolve().parents[1]`。
- `DEFAULT_MODEL = "gpt-5.6-sol"`；`DEFAULT_EFFORT = "xhigh"`。
- `_PROJECT_WORKER_KEY_ENV = "DANUS_PROJECT_WORKER_API_KEY"`。

### 4.1 `resolve_bin()` — codex 二进制优先级（调用时）

1. `DANUS_CODEX_BIN` env（**back-compat 别名：`CODEX_BIN`**）：若是绝对路径 → 原样使用；否则 `shutil.which(override) or override`（找不到则原样返回裸名，exec 时抛清晰的 `FileNotFoundError`）。
2. `<repo>/bin/codex` 包装（若存在）→ `str(wrapper)`。
3. `shutil.which("codex")`。
4. 裸字符串 `"codex"`。

### 4.2 `model(*override_env_names, default=DEFAULT_MODEL)` / `effort(...)`

- 先遍历给定 per-service override env 变量（按顺序取**第一个非空**）。
- 再回退中性默认：model → `DANUS_MAIN_MODEL`（别名 `DANUS_CODEX_MODEL`）；effort → `DANUS_MAIN_EFFORT`（别名 `DANUS_CODEX_EFFORT`）。
- 最后回退 `default`（`gpt-5.6-sol` / `xhigh`）。

各处叠的 override 名：
- verify service：`DANUS_VERIFY_MODEL` / `DANUS_VERIFY_EFFORT`
- workers：`DANUS_WORKER_MODEL`
- renderers：`DANUS_WRITE_PAPER_MODEL`、`DANUS_HUMAN_SUMMARY_MODEL` 等

（README 表里写明：`DANUS_VERIFY_MODEL`/`DANUS_VERIFY_EFFORT` fall back 到中性 `DANUS_MAIN_MODEL`/`DANUS_MAIN_EFFORT`，aka `DANUS_CODEX_MODEL`/`DANUS_CODEX_EFFORT`。）

### 4.3 `subprocess_env(codex_bin, *, worker_project=None)`

- 复制 `os.environ`；**只有 `codex_bin` 带目录分量（具体路径）且目录 != "." 时**，才把该目录 prepend 到 `PATH`（已在该目录则不重复）。裸 `"codex"` 回退**不得**把 CWD 注入子进程 PATH。
- 若 `worker_project` 指向配置了 per-project worker API profile 的工程，则注入（子进程专用）键 `DANUS_PROJECT_WORKER_API_KEY = profile.api_key`。main agents/verifiers/renderers 用的共享 Azure/OpenAI 变量保持原样。

### 4.4 `exec_cmd(codex_bin, model, effort, *tail)`

```python
return [codex_bin, "exec",
        "--model", model,
        "--config", f'model_reasoning_effort="<effort>"',   # 统一用带引号的形式
        *tail]
```

`*tail` 原样透传（各站点自己有精确 tail：sandbox flags、`-C` home、MCP `-c` 注入、输出路径、`-` stdin sentinel、prompt……）。注意 effort 使用**带引号**的 `model_reasoning_effort="xhigh"` 约定。

### 4.5 (可选，按工程) `project_worker_api(project)` / `project_worker_config_args(project)`

- `_project_worker_prefix(project)`：把工程名打磨成 `DANUS_PROJECT_<TOKEN>_WORKER_API_`（token = 非字母数字替换为 `_`、去首尾 `_`、大写）。
- 从 `prefix + "PROVIDER"/"BASE_URL"/"VERSION"/"KEY"` 读取；全空 → `None`；**部分缺失 → `ValueError`（fail-closed，防止把该工程流量静默发到共享默认 API）**；provider 非 `azure` → `ValueError`。
- `project_worker_config_args` 生成 `--config model_provider="danus_project_worker"` 与内联 provider 配置（base_url、`wire_api="responses"`、`query_params={api-version=...}`、`env_http_headers={"api-key"="DANUS_PROJECT_WORKER_API_KEY"}`、`supports_websockets=false`）（凭据经 env 名引用，绝不进 argv）。

---

## 5. 测试固化的边界行为与错误消息

### 5.1 gateway 测试（`gateway/tests/test_gateway.py`）

verify 被 mock（替换 `server._verify`），`fact_submit` 不依赖真实 verifier/codex。每个 test 用 `_env` 包裹设 `DANUS_*` 于临时 project dir。

- `test_role_table`：`main` 无 `fact_submit` 但有 `fact_revoke`；`verifier == ["search_arxiv_theorems"]`；`worker` 有 `fact_submit`；三者都有 `search_arxiv_theorems`；`tools_for("nope") == tools_for("verifier")`（fail-closed）且无 `fact_submit`/`gm_add`；`build_app(worker|main|verifier|all)` 均非 None。
- `test_gm_and_fact_search_over_temp_project`：`gm_add("plan", ...)` → `out["kind"]=="plan" and out["id"]`；`gm_search("reduce")` → `hits["results_by_kind"]["plan"]["count"] == 1`；`fact_search("anything")["results"] == []`（空图良好结构）。
- `test_fact_submit_accept_writes_fact_and_traces`：`accepted is True and fact_id`；`FactGraph.exists(fact_id)`；`gm.read("verification")[-1]["verdict"] == "correct"` 且 `["fact_id"] == res["fact_id"]`。
- `test_fact_submit_reject_writes_nothing_but_traces`：mock `verdict="wrong", repair_hints="gap in step 2"` → `accepted is False and repair_hints=="gap in step 2"`；`fg.list() == []`；`gm.read("verification")[-1]["verdict"]=="wrong"`（仍 trace）。
- `test_fact_submit_verify_error_is_clean`：mock 抛 `RuntimeError("service down")` → `accepted is False and verdict=="error"` 且 `"service down" in res["error"]`。
- `test_fact_submit_accept_but_write_failed_still_traces`：先 `fg.add` base，再 `fg.revoke(base, ...)`，然后 `fact_submit(..., predecessors=[base])` → `accepted is True and fact_id is None and write_error`；**verdict `"correct"` 仍被 trace**。
- `test_fact_submit_glossary_check_never_blocks`：`FactGraph.undefined_symbols` monkeypatch 成抛异常 → 提交成功，`undefined_symbols == []`（建议性启发式）。
- `test_fact_submit_nondict_verify_body_is_clean`：`server._verify = lambda *_: ["not","a","dict"]` → `accepted is False and verdict=="error"` 且 `"non-dict" in res["error"]`；`FactGraph(Path(d)).list() == []`。
- `test_role_env_default_and_build_app`：`_role()` 读 env；`build_app()`（role=None 走 env）；`DANUS_ROLE=None` 时 `_role()=="verifier"`（fail-closed）。
- `test_project_by_name_without_agents_root_raises`：给 project 但无 AGENTS_ROOT → `RuntimeError` 且 `"DANUS_AGENTS_ROOT" in str(e)`。
- `test_verify_http_roundtrip_and_errors`（真实本地 HTTP 回环）：未设 `DANUS_VERIFY_URL` → `RuntimeError` 且 `"DANUS_VERIFY_URL" in str(e)`；真实 POST round-trip → `out["verdict"]=="correct"`，`'"statement": "S(n)=n^2"' in captured["body"]`，`captured["ctype"] == "application/json"`；坏 timeout（`"not-an-int"`）→ 回退默认且 `out["verdict"]=="correct"`。
- `test_fact_revoke_cascades`：base+child（child predecessors=[base]）→ `set(out["revoked"]) == {base, child}`，且两者 `exists(...)` 均 `False`。
- `test_search_arxiv_theorems_delegates`：stub `server._arxiv_search` → `out["query"]=="Beatty sequence" and out["num_results"]==3 and out["results"]==[{"title":"T"}]`。
- `test_project_resolution_by_name_and_validation`：`gm_add(..., project="proj_a")` 成功且 `GlobalMemory(root/proj_a).read("master_guidance")` 非空；对 `("../evil","a/b","","/abs")` 及 `"missing"` 均抛 `RuntimeError`。
- `test_main_module_builds_and_runs`：`runpy.run_module("danus.gateway", run_name="__main__")` → `FastMCP.run` 被调用一次。

### 5.2 prechecks 测试（`verify/tests/test_prechecks.py`）

- vacuous proof：`"QED"` → 真 + `"substantive characters"`；长 hyphen 词（2 词 40 字符）→ 真 + `"substantive words"`；`_toggles(MIN_PROOF_CHARS=1, MIN_PROOF_WORDS=1)` 下 `"Obviously true."` → 真 + `"vacuous marker"` + `"obviously true"`；`_GOOD_PROOF` → 假。
- vacuous statement：`"x"` → 真 + `"substantive characters"`；`_GOOD_STATEMENT` → 假。
- P1：9 条触发器各返回值非 None；toggle-off → None；`""`/`None` → None；clean pass → None。
- P3：`_P3_TRIGGER` 无 fact_id → 非 None；同段加 `fact deadbeefdeadbeef` → None；**异段**的 fact_id → 仍非 None；post-W_q 变体 3 条 → 各非 None；toggle-off → None；空 → None；clean → None。
- P5：4 条触发器 → 各非 None；toggle-off → None；空 → None；clean → None。
- `run_prechecks`：clean → None；空 statement → `(400, "vacuous statement: ...")`；空 proof → `(400, "vacuous proof: ...")`；P1 on proof → `(400, "[P1 on proof] ...")`；P5 on statement（坏 pattern 藏 statement 里）→ `(400, "[P5 on statement] ...")`；P3 → `(400, "[P3 on proof] ...")`；defensive（P1 抛异常）→ `None`（视为 no-match，绝不 500）。

### 5.3 launcher 测试（`verify/tests/test_launcher.py`）

- `test_build_codex_command_shape`：`cmd[0]=="/abs/codex" and cmd[1]=="exec"`；`--model` 后为 `"m-test"`；`--config` 含 `'model_reasoning_effort="e-test"'`；含 `-C`；含 `-c` 且 `any('mcp_servers.danus=' in a and 'DANUS_ROLE="verifier"' in a for a in cmd)`；含 `--dangerously-bypass-approvals-and-sandbox`；`cmd[-1].endswith("verification.json.")`；含 `"Run_id: RID"` 与 statement。
- `test_subprocess_env_prepends_dir_for_concrete_path`：`env["PATH"].split(os.pathsep)[0] == str(Path(tmp).resolve())`。
- `test_subprocess_env_no_cwd_injection_for_bare_name`：裸 `"codex"` → `env["PATH"] == before`（未注入 `.` / CWD）。
- `test_allocate_run_id_retries_on_collision`：预建 base 目录 + freeze `generate_run_id` → `rid == f"{base}_2"` 且 `(root/rid).is_dir()`。
- `test_verification_path_found_and_absent`：空 → None；`VERIFICATION_FILENAMES[1]`（`verificationt.json`）#先写 → 识别到其名；再写 `[0]`（`verification.json`）→ 优先 `[0]`。
- `run_codex_verification`：成功读回（`out["verdict"]=="correct"`、`critical_errors==[]`）；504 超时（sleep-stub + `timeout="1"`，`"timed out" in e.detail`）；500 非零退出（`"exit code 7" in e.detail`）；500 缺输出（`"was not found" in e.detail`）；500 坏 JSON（`"not valid JSON" in e.detail`）；500 非 dict（`"must be a JSON object" in e.detail`）。
- `test_ensure_agent_home_provisions_missing_home`：缺失 home 被构建，`AGENTS.md` 与 `.agents/skills` 存在且 resolve 到 repo canonical sources；幂等（二次调用 no-op）。

### 5.4 service 测试（`verify/tests/test_service.py`）

- `/health` → `200`，`status=="ok"`，`isinstance(pid,int) and pid>0`。
- `/verify` happy path → `200`，`verdict=="correct"`，`critical_errors==[]`，含 `repair_hints`；`_allocate_run_id` 被用（run_id=="RID-fake"）。
- reject verdict 仍是 200（verdict 即 payload）：`verdict=="wrong"`、`repair_hints=="fix the gap"`。
- vacuous proof 400（`_fake_run(_must_not_run)` 断言 codex 不运行）：`"vacuous proof" in detail`。
- P1 on proof 400：`"[P1 on proof]" in detail`。
- launcher 错误映射：504 → `"timed out"`；500 → `"exit code"`；500 → `"was not found"`；500 → `"not valid JSON"`。
- schema 校验 422（先于 prechecks）：空 `statement` → 422；缺 `proof` → 422。
- `python -m danus.verify` 入口（uvicorn mock）：`host=="127.0.0.1"`、`port==8199`、`app is not None`、且 `os.environ.get("CODEX_TIMEOUT_SECONDS") == "900"`。

### 5.5 verify 测试（`verify/tests/test_verify.py`，用 `fake_codex.py` 桩）

- `fake_codex.py` 判定规则：prompt 含 `[[FAKE:wrong]]` → `verdict:"wrong"`（并注入一个 critical_error）；否则 `verdict:"correct"`、`critical_errors:[]`、`gaps:[]`。找不到输出路径 → exit 3；没 prompt 参数 → exit 2。它忽略真实 codex flags，prompt 是最后 argv 项。
- prechecks 单测 + accept via fake_codex + reject via fake_codex（`_GOOD_PROOF + " [[FAKE:wrong]]"` → `verdict=="wrong" and repair_hints`）+ vacuous 400 + P1 400。

---

## 6. 其他迁移注意

- `_mcp.py`：`FastMCP` 类按能力（try import）而非版本号解析：mcp 1.x 用 `from mcp.server.fastmcp import FastMCP`；2.x 用 `from mcp.server.mcpserver import MCPServer as FastMCP`。Danus 用的表面（`FastMCP(name)`、`app.tool(name=...)(fn)`、`app.run()`）两者一致。
- `danus/__init__.py`：`__version__ = "0.1.0"`。
- 数据模型权威参考（供检索形状）：global memory 每 kind 一个 append-only JSONL（`global_memory/<kind>.jsonl`）十 BM25；`GlobalMemory.search` 返回 `{"query", "results_by_kind"}`；`FactGraph.search` 返回 `[{fact_id,score,statement}]`；`GLOBAL_KINDS` 含 `master_guidance`/`elaboration`/`verification` 等 11 种。
- `fact_id` 内容寻址：`problem_id + sorted(predecessors) + sorted(glossary_introduces) + normalized(statement, proof)`；`external_refs` **被排除**在 hash 之外（可变语义，mutability-only，不影响 fact_id）。该不变量在 ARCHITECTURE §3.4。
- 三端 seam（ARCHITECTURE §4，同一改动内必须两端同时改）：MCP 工具集+角色门控；MCP 启动（`python -m danus.gateway` + `DANUS_ROLE`）；verify HTTP（`POST /verify {statement,proof}` → `{verification_report,verdict,repair_hints}`；verdict ⟺ 无 critical_errors 且无 gaps）。
- 端口固定（回环，不得重编号）：8091 = verify `/verify`,`/health`；8099 = dashboard。

---

## 7. 快速常量速查

| 常量 / 默认 | 值 |
|---|---|
| MCP server 名 | `"danus-core"` |
| 工具数 | 6（`ALL_TOOLS`） |
| `DANUS_ROLE` 默认 | `"verifier"` |
| `DANUS_AUTHOR` 默认 | `"unknown"` |
| `DANUS_VERIFY_TIMEOUT` 默认 | `"3600"`（`int()` 失败 → 3600） |
| verify 默认绑定 | `127.0.0.1:8091` |
| `CODEX_TIMEOUT_SECONDS`（库 launcher） | `0` → `None`（无超时） |
| `CODEX_TIMEOUT_SECONDS`（`python -m danus.verify` 入口） | `"900"` |
| `DANUS_VERIFY_MODEL`/`_EFFORT` 默认 | `gpt-5.6-sol` / `xhigh` |
| 空洞阈值 | `MIN_STATEMENT_CHARS=10`，`MIN_PROOF_CHARS=30`，`MIN_PROOF_WORDS=5` |
| P1/P3/P5 toggle | 均默认 ON（`"1"`）；`"0"` 关闭 |
| run_id 前缀 | `%Y%m%dT%H%M%SZ`（UTC）+ `sha256(statement)[:12]` |
| run_id 冲突重试 | 最多 10000 次，后缀 `_N` |
| verification 文件名 | `("verification.json", "verificationt.json")`（后者为刻意拼写错误） |
| 缺失/未接 verify 的错误 | `DANUS_VERIFY_URL is not set (verify service not wired yet)` |
