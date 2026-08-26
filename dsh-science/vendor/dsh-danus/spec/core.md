# danus/core 精确行为规格（Python→TypeScript 移植用）

> 本规格面向**无需再看原码即可据此在 TypeScript 中重写**的精度，保留了全部关键常量、排序/归一化/原子写细节，以及测试固化下来的边界行为。
>
> 源文件：`Danus/danus/core/{schema,factgraph,global_memory,local_memory,bm25,glossary,_util}.py`、`glossary_global.json`、`tests/test_core.py`；接口与 env 以 `Danus/danus/gateway/{server,roles}.py` 为准。
> 目标工程：`dsh-danus`（TypeScript, ES2022, NodeNext, strict, `type: module`）。

---

## 0. 模块边界（必须遵守的架构原则）

- `danus/core` 是**纯数据结构的读写层**：它只触碰**固定的数据结构**（三处 JSONL 文件 + fact graph 的节点）。任何"何时发布、何时送验、何时晋级为事实、控制循环、策略"都是 **prose（prompts/skills）**，不是代码。移植时**不得**把编排逻辑塞进 core。
- core 的构造函数全部接收**显式 root 目录**（`Path(root)`），由 orchestration 决定 worker/project 目录在哪。core 本身**不读任何环境变量**。
- 三个 store 的分层（scope/结构/unit/truth）：

| tier | scope | 结构 | 单元 | 是否为真值来源 |
|---|---|---|---|---|
| local memory | per-worker 私有 | 松散/粗略 | "我做了什么"日志 | 否（私有草稿） |
| global memory | project 共享 | 强类型 | 一个 `claim + evidence` | 否（共享发现，含死路） |
| fact graph | project 共享 | 全结构化 | 一个**已验证**事实 | **是（唯一正确性来源）** |

- 负载不变量：**一条证明只能建立在 fact graph 上（引用 `fact_id`）**；global memory 是 awareness（去重、想法、哪条路死了），即便带 evidence 也**从不**是正确性来源。只有 verifier 晋级 claim 进 fact graph。
- core 层**没有 `promote()` 函数**。晋级决策与 verify 调用属于 agent（prose）；库只提供 `FactGraph.add(statement=claim, proof=evidence, predecessors=links.predecessors)` 与 `GlobalMemory.set_status(id, "verified", fact_id)` 两个数据结构写操作。

---

## 1. 数据结构与校验（schema.py）

### 1.1 `GLOBAL_KINDS` —— 11 个 kind 及其 `verifiable` 默认值（dict 顺序即"全部 kind"的迭代顺序）

```python
GLOBAL_KINDS: Dict[str, bool] = {
    "conclusion":      True,   # 由命题推出的派生结论（需要 justification/proof 作为 evidence）
    "example":         True,   # 满足假设+结论的玩具例子；构造即 evidence
    "counterexample":  True,   # 反驳某 claim 的构造；构造即 evidence
    "proof_attempt":   True,   # 对子目标的尝试；若证出独立子结论则成为可验证 claim
    "plan":            False,  # 子目标分解/策略（判断，不可客观校验）
    "dead_end":        False,  # 某路为何失败；若被反例杀死可为可验证
    "direction":       False,  # "值得探索 X"——不可验证判断
    "obstacle":        False,  # "X 似乎挡住此路"——不可验证判断
    "master_guidance": False,  # 主 agent 周期性战略指引（权威但非正确性来源）
    "verification":    False,  # fact_submit 自动记录的验证结果痕迹（verdict + fact_id / repair_hints）
    "elaboration":     False,  # 主 agent 周期性的高信噪比进展综合
}
```
**准确值 = 恰好 11 个**。顺序（dict 插入序）固定为：`conclusion, example, counterexample, proof_attempt, plan, dead_end, direction, obstacle, master_guidance, verification, elaboration`。
- `list(GLOBAL_KINDS)` 按此顺序；`kinds or list(GLOBAL_KINDS)` 用作默认搜索范围。
- 过程类 `branch_states`/`events` 留在 local memory；`verification_reports` **不是**一个 kind（verifier verdict 挂在 entry 的 `status` 上）。

### 1.2 `STATUSES`

```python
STATUSES = (
    "unverified", "verifying", "verified", "refuted",   # verifiable entries
    "open", "supported", "challenged",                  # judgment entries
)
```
- 共 7 个字符串。`set_status` 据此校验；不在其中 → `ValueError("invalid status '{status}'. Valid: {STATUSES}")`。
- store 只**记录** status，**没有**强制状态机的逻辑（不校验 `unverified→verifying→verified` 的顺序是否合法；agent 决定推进）。
- 生命周期约定（prose）：verifiable entry `unverified → verifying → verified(设 fact_id) | refuted`；judgment entry `open → supported | challenged`。

### 1.3 `EXTERNAL_REF_KEYS` 与 `clean_external_refs`

```python
EXTERNAL_REF_KEYS = ("key", "authors", "title", "arxiv", "year", "venue", "doi", "cited_for")
```

`clean_external_refs(refs) -> List[Dict]`（规范化且**绝不抛异常**，advisory 数据）：
1. `refs` 为 falsy（`None`/`[]`/空）→ 返回 `[]`。
2. 遍历 `refs`；**非 dict 项直接丢弃**（如 `"junk"`、`7`）。
3. 对每个 dict：先按 `EXTERNAL_REF_KEYS` 顺序取命中键（`{k: r[k] for k in EXTERNAL_REF_KEYS if k in r}`）；再把**不在 `EXTERNAL_REF_KEYS` 里的额外键**按 `sorted(r)`（默认按 key 字典序）追加，保持确定性。
4. 返回 `List[Dict]`（键序：canonical 键在前 → 额外键按字典序）。

测试：`clean_external_refs([{"note":"z","title":"T","key":"K","aardvark":1}]) == [{"key":"K","title":"T","aardvark":1,"note":"z"}]`（键序 `["key","title","aardvark","note"]`）。`clean_external_refs(None) == []`、`clean_external_refs([]) == []`。`clean_external_refs([{"title":"T","key":"K"},"junk",7]) == [{"key":"K","title":"T"}]`。

### 1.4 `Fact` dataclass

```python
@dataclass
class Fact:
    fact_id: str
    problem_id: str
    author: str
    predecessors: List[str]                    # bare-hex fact ids（DAG），默认无
    statement: str
    proof: str
    glossary_introduces: Dict[str, str] = {}   # symbol -> definition；默认 {}
    intuition: str = ""
    external_refs: List[Dict[str, object]] = []  # 结构化外部文献；可变元数据，不参与 fact_id
```
- 6 个必填 + 3 个带默认值字段。
- frontmatter 的 6 字段：`fact_id / problem_id / author / predecessors / glossary_introduces / external_refs`（见 §3）。
- body 的 3 段：`## statement` / `## proof` / 可选 `## intuition`。

### 1.5 `_normalize(text)`（内容哈希用的规范化）

```python
def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()
```
- 把所有**连续空白（含换行、tab、多空格）压成一个空格**，然后 `.strip()` 去掉首尾。**不**做大小写折叠、不去标点、不 Unicode 归一化（NFC/NFKC）——原文除空白外逐字符保留。
- 作用：纯排版差异（换行/缩进）不扰动 `fact_id`。

---

## 2. `compute_fact_id` 精确算法（Danus 方案）

签名：
```python
def compute_fact_id(*, problem_id, predecessors, glossary_introduces, statement, proof) -> str
```
**`external_refs` 被刻意排除**——它是参考审计员事后修正的可变元数据；若参与哈希，每次审计都会改 `fact_id` 并破坏 DAG，还会扰动所有既有 fact 的 id。被引用的 citation **keys 本身已在 `proof` 里（被哈希）**。

步骤（顺序敏感）：
1. 构造有序 body dict：
   ```python
   body = {
       "problem_id": problem_id,
       "predecessors": sorted(predecessors),                    # 默认字典序（无 key），对 hex 字符串即字典序
       "glossary_introduces": dict(
           sorted((str(k), str(v)) for k, v in glossary_introduces.items())
       ),
       "statement": _normalize(statement),
       "proof": _normalize(proof),
   }
   ```
   - `predecessors`：**先 `sorted()`**（对 id 字符串按 Unicode 码位排序；因 id 全是小写 hex，等价于字典序）。
   - `glossary_introduces`：按 `(str(k), str(v))` 元组排序生成 list 再 `dict(...)`。因 key 唯一，元组排序实际等价于**按 key 字典序**。随后 `json.dumps(sort_keys=True)` 会**再次**对 key 排序（与前述一致，冗余但一致）。**注意**：`str()` 强转先于比较，若 key 非字符串会被先规范化。
   - `statement`/`proof` 用 `_normalize`。
2. `canon = json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")`
   - **`ensure_ascii=False`**：非 ASCII 字符（如希腊字母、中文）**不转义**，按原字符写进 JSON。**这与哈希结果直接相关**——Unicode 字符按 UTF-8 字节哈希。
   - `sort_keys=True`：顶层 key 按字典序重排（`glossary_introduces, predecessors, problem_id, proof, statement`）。
3. `return hashlib.sha256(canon).hexdigest()[:16]`
   - SHA-256 of UTF-8 字节；`hexdigest()` 得 64 个小写十六进制字符；**截取前 16 个字符（= 8 字节）**作为 `fact_id`。
   - 输出恒为 **16 个小写 hex 字符**（不是 32 不是 64）。bare hex。

**重要不变量**：相同内容（problem_id + 排序后的 predecessors + 字典序后的 glossary_introduces + 规范化后的 statement + 规范化后的 proof）⇒ 相同 id ⇒ 天然去重；内容变更 ⇒ 不同 id ⇒ 新文件。节点不可变。

---

## 3. fact graph（factgraph.py）

### 3.1 磁盘布局

`FactGraph(root)` 构造：`root / "fact_graph"`。
```
<project>/fact_graph/
  facts/<fact_id>.md          # 每个 fact 一个可读 markdown 文件（文件名 = 无扩展名的 hex id）
  _revoked/<fact_id>.md       # 被级联撤销的 fact 文件（注意：实际代码直接平铺在 _revoked/，无时间戳子目录）
  glossary.json               # 累积的项目 glossary（symbol -> definition，json indent=2）
  revocation_log.jsonl        # 撤销日志（append-only JSONL）
```
- `_revoked/<ts>/` 是 **DATA_MODEL.md 里的描述**，**实现**并未按时间戳分子目录——`revoke` 直接 `shutil.move(src, revoked_dir / f"{fid}.md")`。以实际实现为准：被撤销文件平铺在 `_revoked/<fid>.md`。
- 故意**没有** `glossary.json`（有，见上）……实际上 `glossary.json` 是有的；明确断言：**无** `drafts/`（被拒 claim 留在 global memory 的 `refuted`），**无**持久化的 `verified_facts.jsonl` board（fact 只经 `fact submit` 进入，读视图是即建的 `fact_search` 索引）。

内部路径：
```python
self.dir = root / "fact_graph"
self.facts_dir = self.dir / "facts"
self.revoked_dir = self.dir / "_revoked"
self.glossary_path = self.dir / "glossary.json"
self.revocation_log = self.dir / "revocation_log.jsonl"
def _path(fact_id): return self.facts_dir / f"{fact_id}.md"
```

### 3.2 序列化/解析

**`serialize_fact(fact) -> str`**（markdown + frontmatter）：
```
---
fact_id: <id>
problem_id: <pid>
author: <author>
predecessors: [<a>, <b>]        # 用 ", "（逗号+空格）连接，无方括号内多余空格
glossary_introduces:             # 非空时：键为「sorted(fact.glossary_introduces)」顺序
  <k>: <v>
                                # 空时：单行 "glossary_introduces: {}"
external_refs: <json 流式数组>    # 总是输出（空时 "[]"）；json.dumps(ensure_ascii=False) 单行
---

## statement
<fact.statement.strip()>

## proof
<fact.proof.strip()>

## intuition                          # 仅当 fact.intuition.strip() 非空
<intuition.strip()>
```
细节：
- 头尾 `---`；每行 `\n` 拼接；最后追加一个 `""`（即文件以 `\n` 结尾）。
- `glossary_introduces` 键序：`for k in sorted(fact.glossary_introduces)`（注意这里按 key 排序，与 fact_id 里的 `(str(k),str(v))` 排序对字符串键等价）。
- body 的 statement/proof 用 `.strip()` 写入（与哈希用的 `_normalize` 不同：`_normalize` 压缩空白，`.strip()` 只去首尾）。
- `external_refs` **总是**输出一行（含空时 `[]`），用 `ensure_ascii=False` 的 `json.dumps`。

**`parse_frontmatter(text) -> {predecessors, glossary_introduces, external_refs}`**：
- 逐行扫描；当 `i > 0` 且 `line.strip() == "---"` → 停止（读到 frontmatter 闭合）。
- 两个编译 regex：
  ```python
  _PRED_RE       = re.compile(r"^predecessors:\s*\[(.*)\]\s*$")
  _GLOSS_LINE_RE = re.compile(r"^\s{2}([^:]+):\s*(.*)$")
  ```
- `predecessors`：匹配 `_PRED_RE` 后 `preds = [x.strip() for x in group(1).split(",") if x.strip()]`（按 `,` 切分、strip、丢弃空串）。
- `glossary_introduces`：一行以 `glossary_introduces:` 开头 → `in_gloss = ("{}" not in line)`。即若该行是 `glossary_introduces: {}` 则不进 gloss 模式；否则进入。进入后，每行用 `_GLOSS_LINE_RE`（**恰好 2 个前导空格**）匹配；**匹配失败（或遇到以 `external_refs:` 开头的行）→ `in_gloss = False` 终止该块**。匹配成功则 `gloss[name.strip()] = value.strip()`。
- `external_refs`：一行以 `external_refs:` 开头 → `in_gloss=False`；`payload = line[len("external_refs:"):].strip()`；`json.loads(payload) if payload else []`；`JSONDecodeError` → `[]`。
- **旧格式兼容**：无 `external_refs:` 字段的文件解析为 `external_refs == []`。

**`statement_of(text) -> str`**：取 `## statement` 段的 body 拼成单行摘要。
- 遍历 `text.splitlines()`；当 `line.strip().startswith("## ")`：若已在 statement 段则 `break`；否则 `in_stmt = (line.strip().lower() == "## statement")` 并 `continue`。若 `in_stmt` 则收集 `line.strip()`。
- 结尾 `" ".join(s for s in out if s).strip()`（把非空 stripped 行用单空格连接）。
- 测试：`statement_of("## statement\nA holds\nand more\n\n## proof\nirrelevant\n") == "A holds and more"`（**在下一个 `## ` 处停止**）。

### 3.3 公开操作语义

**类常量/副作用**：所有写操作**非原子**——`write_text`/`json.dumps` 直接覆写，**没有** temp-file+rename、**没有** fsync。

#### `add(*, problem_id, author, statement, proof, predecessors=None, glossary_introduces=None, intuition="", external_refs=None) -> str`
1. `predecessors = [p for p in (predecessors or []) if p]`（**过滤 falsy/空串**）。
2. `glossary_introduces = glossary_introduces or {}`；`external_refs = clean_external_refs(external_refs)`。
3. **撤销前驱拒绝**：对每个 `pid in predecessors`，若 `(revoked_dir / f"{pid}.md").exists()` → `raise ValueError(f"predecessor_revoked: {pid}")`。
4. `fact_id = compute_fact_id(problem_id=..., predecessors=..., glossary_introduces=..., statement=..., proof=...)`。
5. 构造 `Fact(...)`；`facts_dir.mkdir(parents=True, exist_ok=True)`；`_path(fact_id).write_text(serialize_fact(fact), encoding="utf-8")`。
6. `self._merge_glossary(glossary_introduces)`。
7. 返回 `fact_id`。
- **幂等**：相同内容 ⇒ 相同 id ⇒ 相同文件（重复 add 覆盖同一文件，内容不变）。
- 注意：**不检查**目标文件是否已存在同名；仅按内容 id 决定。

#### `_merge_glossary(new)`
- `new` 为空 → 直接 return。
- `cur = self.glossary()`；`cur.update({str(k): str(v) for k, v in new.items()})`；`glossary_path.parent.mkdir(...)`；`glossary_path.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")`。**大写注意：非原子覆写。**

#### `exists(fact_id) -> bool`
- `_path(fact_id).exists()`。

#### `list() -> List[str]`
- `facts_dir` 不存在 → `[]`。否则 `sorted(p.stem for p in facts_dir.glob("*.md"))`（**排序**，按文件名 stem 字典序；即 id 的字典序）。

#### `get_raw(fact_id) -> Optional[str]`
- 存在 → `read_text(utf-8)`；否则 `None`。

#### `glossary() -> Dict[str,str]`
- `glossary_path` 存在 → `json.loads(...)`；`JSONDecodeError` → `{}`（**永不抛**，坏 JSON 落空）；不存在 → `{}`。

#### `search(query, limit=10) -> List[{fact_id, score, statement}]`
- `fids = self.list()`；为空 → `[]`。
- `raws = [get_raw(fid) or "" for fid in fids]`；`docs = [bm25.tokenize(r) for r in raws]`。
- `scores = bm25.bm25_scores(query, docs)`。
- `for fid, raw, score in sorted(zip(fids, raws, scores), key=lambda t: -t[2])`（**按 score 降序；sort 稳定 ⇒ 同分保持 fids 字典序**）。
- 若 `score <= 0` → **break**（因降序，其后全 ≤0）。
- `ranked.append({"fact_id": fid, "score": score, "statement": statement_of(raw)})`；达到 `len(ranked) >= limit` 即停。
- 返回按 score 降序的 top-limit 列表（含零分则被 break 截掉）。
- 语义：**derived index 即时重建**（无持久化 board，无双写漂移）；用于 novelty/citation 查询。

#### `predecessors(fact_id) -> List[str]`
- `get_raw(fact_id) or ""` → `parse_frontmatter(...)["predecessors"]`。

#### `external_refs(fact_id) -> List[Dict]`
- 同上取 `["external_refs"]`；无则 `[]`。

#### `set_external_refs(fact_id, refs) -> List[Dict]`
- `_path(fact_id)` 不存在 → `raise ValueError(f"unknown fact_id: {fact_id}")`。
- `refs = clean_external_refs(refs)`；`new_line = "external_refs: " + json.dumps(refs, ensure_ascii=False)`。
- 读文件 `splitlines()`；找 frontmatter 闭合：`close = next((i for i in range(1, len(lines)) if lines[i].strip()=="---"), None)`；`close is None` → `raise ValueError("malformed fact file (no frontmatter close): {fact_id}")`。
- 在 `range(1, close)` 内找以 `external_refs:` 开头的行：命中→覆写该行；未命中→**在 `close` 处 `insert(close, new_line)`**（兼容旧格式无该字段）。
- `write_text("\n".join(lines) + "\n", utf-8)`。仅改这一行 frontmatter；body 与 `fact_id` 不变（refs 不参与哈希）。返回规范化后的 refs。

#### `descendants(fact_id) -> List[str]`
- 传递闭包（**不含** fact_id 自身）。
- `out=[]; seen=set(); frontier=[fact_id]`；`while frontier: cur=frontier.pop(); for fid in self.list(): if fid in seen: continue; if cur in self.predecessors(fid): out.append(fid); seen.add(fid); frontier.append(fid)`。
- **注意**：`self.list()` 在 while 每轮被重新调用（全量重列），且 `self.predecessors(fid)` 每次读文件解析 frontmatter → 复杂度高但语义正确。
- 顺序：由于 `frontier.pop()`（栈，DFS）、`self.list()` 为排序序，结果顺序确定但**非拓扑序**；测试用 `set(...)` 断言。

#### `undefined_symbols(*, statement, proof, intuition="", predecessors=None, glossary_introduces=None) -> List[str]`
- 构造可用的符号并集（覆盖四层，优先级低→高，高层遮蔽低层）：**global glossary → project glossary → 各 predecessor 的 glossary_introduces → 本 fact 的 glossary_introduces**。
  ```python
  defined = _glossary.global_terms()          # 全部项目通用的 universal notation
  defined |= set(self.glossary())
  defined |= set(glossary_introduces or {})
  for pid in (predecessors or []):
      raw = self.get_raw(pid)
      if raw: defined |= set(parse_frontmatter(raw)["glossary_introduces"])
  ```
- 调 `_glossary.undefined_symbols(statement=..., proof=..., intuition=..., defined=defined)`（见 §7）。

#### `revoke(fact_id, reason) -> List[str]`
- `not exists(fact_id)` → `raise ValueError("unknown fact_id: ${fact_id}")`。
- `to_revoke = [fact_id] + self.descendants(fact_id)`（根在前，后代在后）。
- `revoked_dir.mkdir(parents=True, exist_ok=True)`。
- 对每个 `fid in to_revoke`：若 `src = _path(fid)` 存在 → `shutil.move(src, revoked_dir / f"{fid}.md")`（**src 缺失则静默跳过**）。
- 无论是否移动，**都** `append_jsonl(revocation_log, {"timestamp_utc": utc_now(), "fact_id": fid, "reason": reason, "revoked_as_dependent_of": (fid != fact_id and fact_id or None)})`。
  - `revoked_as_dependent_of`：根事实为 `None`；后代为根 `fact_id`（Python `fid != fact_id and fact_id or None` 的布尔技巧）。
- 返回 `to_revoke`（根 + 全部后代）。

---

## 4. global memory（global_memory.py）

**布局**：`<project>/global_memory/<kind>.jsonl`（**每个 kind 一个 append-only JSONL 文件**，每通道一文件、全 worker 共享）+ 一个 `_status.jsonl`。
```python
_STATUS_LOG = "_status.jsonl"
self.dir = Path(root) / "global_memory"
def _path(kind): return self.dir / f"{kind}.jsonl"
```

**Entry schema**（**扁平**——没有 local memory 的 `record` 包裹；全部字段在顶层）：
```json
{
  "id": "<16-hex>",
  "timestamp_utc": "<iso8601>",
  "author": "<worker id | main_agent>",
  "kind": "counterexample",
  "claim": "...",
  "evidence": "...",
  "verifiable": true,
  "status": "unverified",        // verifiable 时为 "unverified"；否则 "open"
  "fact_id": null,
  "links": {},
  "glossary": {},
  ...extra                        // kind-specific 自由字段也扁平在顶层（verdict/fact_id/write_error/input_tokens/...）
}
```

### 操作

**`append(kind, claim, evidence, author, *, verifiable=None, links=None, glossary=None, **extra) -> id`**
1. `kind not in GLOBAL_KINDS` → `raise ValueError(f"unknown kind '{kind}'. Known: {sorted(GLOBAL_KINDS)}")`（注意报错里 kind 列表是 `sorted(GLOBAL_KINDS)`，非插入序）。
2. `verifiable is None` → `verifiable = GLOBAL_KINDS[kind]`。
3. **可验证必需 evidence**：`verifiable and not (evidence or "").strip()` → `raise ValueError(f"kind '{kind}' is verifiable and requires explicit evidence")`。
4. `ts = utc_now()`。
5. `entry_id = hashlib.sha256(json.dumps([kind, claim, author, ts], ensure_ascii=False).encode()).hexdigest()[:16]` —— **对元组 `[kind, claim, author, timestamp]` 的 JSON（`ensure_ascii=False`）做 SHA-256 取前 16 hex**。**注意：id 含 timestamp** ⇒ 同一 author 同 claim 不同时刻产生不同 id（**非内容寻址**，与 fact_id 相反）；`timestamp_utc` 来自 `utc_now()`，精度到微秒。
6. `append_jsonl(_path(kind), {id, timestamp_utc: ts, author, kind, claim, evidence, verifiable, status: "unverified" if verifiable else "open", fact_id: None, links: links or {}, glossary: glossary or {}, **extra})`。
7. 返回 `entry_id`。
- 参数 `extra` 直接扁平合并进顶层（`**extra` 在 dict 字面量末尾，不覆盖既有键）。

**`set_status(entry_id, status, fact_id=None)`**
- `status not in STATUSES` → `raise ValueError(f"invalid status '{status}'. Valid: {STATUSES}")`。
- `append_jsonl(self.dir / _STATUS_LOG, {"timestamp_utc": utc_now(), "id": entry_id, "status": status, "fact_id": fact_id})`。**append-only**（不改原 entry)。

**`_latest_status() -> {id: rec}`**
- 遍历 `_status.jsonl`，`if rec.get("id"): latest[rec["id"]] = rec`（**文件按时间顺序，后写覆盖**，last wins）。

**`read(kind) -> List[entry]`**
- `latest = _latest_status()`；对 `read_jsonl(_path(kind))` 的每个 entry：`st = latest.get(e["id"])`；若命中 → `e = {**e, "status": st["status"], "fact_id": st.get("fact_id") or e.get("fact_id")}`（**status 折叠**：若最新 status 事件的 `fact_id` 为 falsy，则保持 entry 原 `fact_id`）。返回全部 entry。

**`search(query, kinds=None, limit_per_kind=10) -> {query, results_by_kind} `**
- `latest = _latest_status()`。
- `for kind in (kinds or list(GLOBAL_KINDS))`（默认按插入序遍历全部 11 种 kind）：
  - `entries = read_jsonl(_path(kind))`；`docs = [bm25.tokenize(json.dumps(e, ensure_ascii=False)) for e in entries]`（**对整条 entry 的 JSON 字符串分词**）；`scores = bm25.bm25_scores(query, docs)`。
  - `for e, s in sorted(zip(entries, scores), key=lambda p: -p[1])`：`s <= 0` → `break`；`st = latest.get(e["id"])` 命中则折叠 status；`ranked.append({"score": s, "entry": e})`；`len(ranked) >= limit_per_kind` → `break`。
  - `out[kind] = {"count": len(ranked), "results": ranked}`。
- 返回 `{"query": query, "results_by_kind": out}`。
- **语义**：按 kind 分桶返回，每桶最多 `limit_per_kind` 条、按 score 降序、剔除零分命中。

---

## 5. local memory（local_memory.py）

**布局**：`<worker_dir>/local_memory/<channel>.jsonl`。
```python
DEFAULT_CHANNELS = ("notes", "events")
self.dir = Path(root) / "local_memory"
self.channels = list(channels) if channels else list(DEFAULT_CHANNELS)
```
- 每 worker 私有；**无 CLI 包装**（worker 直接读写/grep 自己文件）。
- 默认通道：`notes`（自由想法/部分推理/待试）与 `events`（已做动作日志，auto-logged + 显式）。

**Entry**（有 `record` 包裹；与 global 扁平不同）：
```json
{ "timestamp_utc": "...", "channel": "notes", "record": { ...any JSON object... } }
```

### 操作

**`append(channel, record) -> {status, channel, path, entry}`**
- `not isinstance(record, dict)` → `raise ValueError("record must be a JSON object")`（**必须 dict**；字符串等被拒）。
- `channel not in self.channels` → `self.channels.append(channel)`（**允许临时注册新通道**）。
- `entry = {timestamp_utc: utc_now(), channel, record}`；`append_jsonl(_path(channel), entry)`。
- **breadcrumb**：若 `channel != "events"` → `append_jsonl(_path("events"), {timestamp_utc: utc_now(), event_type: "local_append", channel})`（对 `events` 通道本身追加**不产生** breadcrumb）。
- 返回 `{"status": "ok", "channel": channel, "path": str(_path(channel)), "entry": entry}`。

**`read(channel)`**：`read_jsonl(_path(channel))`（`[]` 若不存在）。

**`search(query, channels=None, limit_per_channel=10)`**
- `search_channels = channels or [c for c in self.channels if c != "events"]`（默认**排除 events**）。
- 对每个 channel：`items = read_jsonl`；`docs = [tokenize(json.dumps(it, ensure_ascii=False)) for it in items]`；`scores = bm25_scores(query, docs)`；`ranked = [{"score": s, "item": it} for it, s in sorted(zip(items, scores), key=lambda p: -p[1]) if s > 0][:limit_per_channel]`；`out[channel] = {count, results}`。
- 返回 `{"query": query, "channels": search_channels, "results_by_channel": out}`。

---

## 6. BM25 排名（bm25.py）

```python
_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")
def tokenize(text): return _TOKEN_RE.findall(text.lower())
```
- 分词：**仅** `[A-Za-z0-9_]`（`lower()` 后）。**非 ASCII 字符（希腊字母、中文、数学符号等）在分词阶段全部丢弃**——这是本项目的一个关键且容易漏掉的点；query 与 doc 里的 Unicode 对 bm25 评分无贡献，但 doc 是整条 entry 的 `json.dumps(ensure_ascii=False)` 序列化文本。
- `tokenize("S_M(x)")` → `["s_m", "x"]`（`_`、字母、数字保留；`( )` 丢弃）。

**`bm25_scores(query, documents, *, k1=1.5, b=0.75) -> List[float]`**
```python
query_tokens = tokenize(query)
if not query_tokens or not documents:
    return [0.0 for _ in documents]
query_term_counts  = Counter(query_tokens)
document_frequencies = Counter()          # df：含该 token 的文档数
document_term_counts = [Counter(doc) for doc in documents]
document_lengths = [len(doc) for doc in documents]
avg_doc_length = sum(document_lengths)/len(document_lengths) if document_lengths else 0.0
total_documents = len(documents)
for doc in documents:
    for token in set(doc): document_frequencies[token] += 1     # 用 set(doc)，每文档只计一次
```
对每篇 doc：
```python
norm = k1 * (1 - b + b * (doc_length / avg_doc_length)) if avg_doc_length > 0 else k1
score = 0.0
for token, query_tf in query_term_counts.items():
    tf = doc_counts.get(token, 0)
    if tf <= 0: continue
    df = document_frequencies.get(token, 0)
    idf = math.log(1.0 + ((total_documents - df + 0.5) / (df + 0.5)))
    score += query_tf * idf * (tf * (k1 + 1.0)) / (tf + norm)
```
- 参数：`k1 = 1.5`，`b = 0.75`。
- IDF：`ln(1 + (N - df + 0.5)/(df + 0.5))` —— **含 `+1`**，故恒为非负（df 再大也不为负）。对单文档 corpus（`total_documents == 1`）：当 df==1 时 `idf = ln(1 + (0.5)/(1.5)) = ln(1.333…) > 0`。
- 位置 `norm`：`avg_doc_length == 0` 时退化到 `k1`（避免除零）。
- 每篇返回一个分数；**`query` 里没有出现过的 token 不贡献**。

---

## 7. glossary（glossary.py + glossary_global.json）

### 7.1 `flatten(glossary_obj) -> {term_or_alias: definition}`

接受两种形状：
- 全局形状：`{version, terms: {term: {definition, aliases: [...]}}}`（取 `terms`）。
- 扁平形状：`{term: definition_str}`。

逻辑：
```python
terms = glossary_obj["terms"] if (dict(obj) and isinstance(obj.get("terms"), dict)) else glossary_obj
for term, entry in (terms or {}).items():
    if isinstance(entry, dict):
        defn = str(entry.get("definition", ""))
        out[str(term)] = defn
        for alias in entry.get("aliases", []) or []:
            out[str(alias)] = defn       # alias 继承 definition
    else:
        out[str(term)] = str(entry)
```
- falsy（None/{}）→ `{}`。
- 键与 alias 均被加入集合；alias 与 term 共享同一 definition。

### 7.2 global glossary 加载

- 资源文件名：`_GLOBAL_RESOURCE = "glossary_global.json"`。
- `_load_global_text()`：用 `importlib.resources`（`resources.files(__package__).joinpath(...).read_text(utf-8)`）读取包内资源；捕获 `FileNotFoundError, ModuleNotFoundError, AttributeError, OSError` → 返回 `None`。
- `global_glossary()`（`@lru_cache(maxsize=1)`）：text 为 None → `{}`；`flatten(json.loads(text))`；`JSONDecodeError` → `{}`。
- `global_terms()` = `set(global_glossary())`（term + alias 都算已定义）。

### 7.3 `undefined_symbols(statement, proof, intuition, defined) -> List[str]`

- 公式 regex（用于挑"有趣的数学记号"）：
  ```python
  _GREEK = (...).split()   # alpha beta gamma delta epsilon eta theta iota kappa lambda mu nu xi pi rho
                          # sigma tau phi chi psi omega  Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega
  _INTERESTING = re.compile(r"\b("
      r"[A-Za-z][A-Za-z]?(?:_\{[^}]+\}|_[A-Za-z0-9+]+)+(?:\([^)\s]{0,30}\))?"
      r"|[A-Z][A-Z]?(?:\([^)\s]{0,30}\)|\+|>=\d+|<=\d+)"
      r"|" + "|".join(sorted(_GREEK, key=len, reverse=True)) +
      r"|\{[a-zA-Z]\}|\[[a-z],\s*[a-z]\]|\([a-z],\s*[a-z]\)"
      r")"
  _STOPLIST = frozenset({"I","II","III","IV","V","VI","OR","AND","NOT","IF","THEN",
                         "QED","PROOF","LEMMA","THEOREM","CLAIM"})
  ```
- 算法：
  ```python
  defined_set = set(defined)
  found = {}
  for text in (statement, proof, intuition):
      for m in _INTERESTING.finditer(text or ""):
          tok = m.group(1)
          if tok in _STOPLIST or tok in defined_set: continue
          stripped = re.sub(r"\([^)]*\)$", "", tok)         # 去掉尾部参数列表的 base form
          if stripped and stripped in defined_set: continue
          found[tok] = None
  return sorted(found)
  ```
- 语义：`defined`（调用方传入的可用并集）中的记号被跳过；**base form**（去掉尾部 `(...)` 参数列表）在 `defined` 中的也跳过；剩余按字典序排序、去重返回。
- 测试固化：`undefined_symbols("S_M(x) applied", defined={"S_M"}) == []`（base 已定义不报）；`undefined_symbols("S_M(x) applied", defined=set()) == ["S_M(x)"]`。

### 7.4 `glossary_global.json` 结构

```json
{
  "version": 1,
  "description": "...",
  "terms": {
    "Z+": {"kind": "set", "definition": "The set of positive integers ...", "aliases": ["positive integers", "Z_+", "Z>=1"]},
    "Z>=k": {"kind": "set", "definition": "...", "aliases": ["Z_{>=k}", "integers at least k"]},
    "Z": ..., "N": ..., "Q": ..., "R": ..., "R+": ..., "R>=0": ..., "C": ...,
    "floor(x)": ..., "ceil(x)": ..., "{x}": ..., "gcd": ..., "lcm": ..., "mod": ..., "divides": ...,
    "[a,b]": ..., "(a,b)": ..., "[a,b)": ..., "(a,b]": ..., "iff": ..., "sgn(x)": ...,
    "epsilon": ..., "eta": ..., "delta": ..., "lambda": ..., "mu": ..., "nu": ..., "rho": ...,
    "sigma": ..., "phi": ..., "pi": ..., "tau": ..., "Phi": ..., "Pi": ..., "Sigma": ..., "Gamma": ...,
    "chi": ..., "h^i": ..., "X_b": ..., "O_{Y,y}": ..., "T_Y": ..., "T_{Y/Z}": ...
  }
}
```
- 每个 term：`kind`（`set|function|operator|predicate|logical|parameter|parameter-or-point|function-or-parameter|morphism-or-parameter|morphism|morphism-or-constant|operator-or-product|set-or-curve|graph-or-curve|scheme|ring|sheaf` 等）、`definition`、`aliases`（数组）。
- `version` 恒为 `1`；包数据通过 `importlib.resources` 加载（checkout 与 pip-installed 都能解析）。

---

## 8. `_util.py` —— append-only JSONL 辅助

```python
def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
```
- ISO-8601，带 `+00:00` 偏移，含微秒，如 `2024-01-01T12:34:56.123456+00:00`。

```python
def append_jsonl(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
```
- **打开方式为 `"a"`（追加模式），不是原子写**：无 temp+rename、无 fsync、无文件锁（多进程并发写同一文件**不**做互斥，靠 OS 追加原子性，非线程/进程安全——移植时若需跨进程安全需自行加锁或改用原子 append）。
- `json.dumps(payload, ensure_ascii=False)`（非 ASCII 不转义），单行 + `\n`。

```python
def iter_jsonl(path) -> Iterator[dict]:
    if not path.exists(): return                 # 缺失即空
    for line in open(path, "r", encoding="utf-8"): ...
        line = line.strip()
        if not line: continue                     # 空行跳过
        try: payload = json.loads(line)
        except json.JSONDecodeError: continue     # 坏 JSON 行跳过
        if isinstance(payload, dict): yield payload   # 非 dict（如 [1,2,3]）跳过
```

```python
def read_jsonl(path) -> list:
    return list(iter_jsonl(path))
```
- 测试固化：`read_jsonl(missing) == []`；对 `{"ok":1}\n\nnot json\n[1,2,3]\n{"ok":2}\n` → `[{"ok":1},{"ok":2}]`（bad JSON、空行、非 dict 全被跳过）。

---

## 9. 环境变量（gateway / roles 层 —— 包装 core 的接口层）

> core 本身不读 env。以下 env 由 `danus/gateway/server.py` 在 **call time**（不是 import time）读取，便于测试与重配置。

| 变量 | 默认值 | 读取时机 / 用途 |
|---|---|---|
| `DANUS_PROJECT_DIR` | `""` | `_project()`：worker 固定项目目录（无 `project` 参数时的兜底）。未设且无 `project` → `RuntimeError("DANUS_PROJECT_DIR is not set and no project was given")` |
| `DANUS_AGENTS_ROOT` | `""` | `_project()`：持有所有项目 `<root>/<project>`；main agent 按名寻项目。给了 `project` 但未设 → `RuntimeError("DANUS_AGENTS_ROOT is not set; cannot resolve a project by name")` |
| `DANUS_AUTHOR` | `"unknown"` | `_author()`：agent 的 id，用于归因（gm/fact 的 `author`） |
| `DANUS_ROLE` | `"verifier"` | `_role()` + `build_app()`：`worker\|main\|verifier\|all`；**未设或拼错 → 回退到最严格的只读 verifier 集（fail-closed）**，全量需显式 `DANUS_ROLE=all` |
| `DANUS_VERIFY_URL` | `""` | `_verify()`：verify-service 端点。`fact_submit` 需要它；未设 → `RuntimeError("DANUS_VERIFY_URL is not set (verify service not wired yet)")` |
| `DANUS_VERIFY_TIMEOUT` | `"3600"` | `_verify()`：HTTP 超时秒数；`int()` 失败 → 回落 `3600` |
| `DANUS_PROBLEM_ID` | `Path(_project()).name` | `fact_submit()`：写入事实的 problem id（默认 = 项目目录名） |

**`_project(project=None)` 决议顺序**：
1. 若有 `project`（main agent 的选择器）：必须已设 `DANUS_AGENTS_ROOT`；`.match(^[A-Za-z0-9][A-Za-z0-9._-]*$)`（**单路径段**，防 `/`、`..` 逃逸）；`Path(agents_root)/project` 必须是已存在目录，否则 `RuntimeError(f"no such project: {project!r} (under {agents_root})")`。
2. 否则必须已设 `DANUS_PROJECT_DIR`，返回 `Path(project_dir)`。
3. 否则 → `RuntimeError`。

**roles.py —— 角色 → 可见工具集（`DANUS_ROLE` 选择）**，这是分离职责的单一事实来源：

| role | 可见工具 |
|---|---|
| `worker` | `gm_add, gm_search, fact_submit, fact_search, search_arxiv_theorems` |
| `main` | `gm_add, gm_search, fact_search, fact_revoke, search_arxiv_theorems` |
| `verifier` | `search_arxiv_theorems`（只读） |
| `all` | 全部 6 个工具 |

不变量：`main` **无** `fact_submit`（编排者不做数学、永远造不出事实）；`verifier` 只读；`worker` 是唯一能 `fact_submit` 的角色。未知/拼错 role → 回退 `verifier` 集（fail-closed）。

**相邻子系统（非 core，但 `fact_submit` 会调用）的 env**（供参考，不属 core 移植范围）：verify 服务读 `CODEX_TIMEOUT_SECONDS`(默认 900)、`VERIFY_HOST`(默认 127.0.0.1)、`VERIFY_PORT`/`PORT`(默认 8091)、`VERIFY_MIN_STATEMENT_CHARS`(10)、`VERIFY_MIN_PROOF_CHARS`(30)、`VERIFY_MIN_PROOF_WORDS`(5)、`VERIFY_REJECT_PROBLEM_MD_CITATIONS`(1)、`VERIFY_REJECT_UNPROVEN_CONDITIONALS`(1)、`VERIFY_REJECT_VAGUE_GESTURES`(1)；编排层读 `DANUS_AGENTS_ROOT`/`DANUS_WORKER_CONTRACT` 等；codex.py 读 `DANUS_CODEX_BIN`(alias `CODEX_BIN`)、`DANUS_MAIN_MODEL`(默认 `"gpt-5.6-sol"`, alias `DANUS_CODEX_MODEL`)、`DANUS_MAIN_EFFORT`(默认 `"xhigh"`, alias `DANUS_CODEX_EFFORT`)、`DANUS_WORKER_MODEL` 等；matlas 读 `MATLAS_URL`(默认 `https://leansearch.net/thm/search`)。

---

## 10. `fact_submit` 完整语义（gateway —— fact graph 的"verified gate"）

这是**唯一**写 fact 的路径；不变量"fact 只能在 verifier 接受后存在"由**代码**而非 prose 保证。

```
fact_submit(statement, proof, predecessors=[], glossary_introduces=None, intuition="",
            source_id=None, external_refs=None) -> {...}
```
1. `fg = FactGraph(project)`；`gm = GlobalMemory(project)`；`problem_id = DANUS_PROBLEM_ID or Path(_project()).name`。
2. **glossary-coverage 检查（advisory，绝不阻塞）**：`fg.undefined_symbols(statement, proof, intuition, predecessors, glossary_introduces)`；**任何异常 → `undefined = []`**。
3. **调用 verifier**：`_verify(statement, proof)` POST `{statement, proof}`。
   - 异常（服务 down / 超时）→ `{"accepted": false, "verdict": "error", "error": str(e), "undefined_symbols": undefined}`；**无 verdict，不存储任何东西，worker 重试**。
   - 返回非 dict body（如 list）→ 同样 `{"accepted":false, "verdict":"error", "error":"verify service returned a non-dict body (...)", ...}`。
4. `verdict = result.get("verdict")`；`accepted = (verdict == "correct")`。
5. **iff accepted 才写事实**（写失败——如前驱被撤销——用 try/except 捕获，**不会跳过后面的 trace**）：
   - `fact_id = fg.add(problem_id, author=_author(), statement, proof, predecessors, glossary_introduces, intuition, external_refs)`；异常 → `write_error = str(e)`。
6. **一旦有 verdict，一律写一条 global memory 的 `verification` 记录**（verifier 无状态；此 worker 工具负责持久化，故不可被后续失败跳过）：
   ```python
   gm.append("verification",
       claim=statement,
       evidence="verdict: correct" if accepted else (result.get("repair_hints") or "verdict: wrong"),
       author=_author(), verifiable=False,
       links={"source_id": source_id, "predecessors": predecessors or []},
       verdict=verdict, fact_id=fact_id, write_error=write_error,
       verification_report=result.get("verification_report"))
   ```
7. 返回：
   - reject → `{"accepted": false, "verdict": verdict, "repair_hints": result.get("repair_hints"), "verification_report": result.get("verification_report"), "undefined_symbols": undefined}`
   - accept-but-write-failed → `{"accepted": true, "fact_id": null, "write_error": write_error, "undefined_symbols": undefined}`
   - accept → `{"accepted": true, "fact_id": fact_id, "undefined_symbols": undefined}`

**Guarantee**：verdict 一旦存在（accept/reject/accept-but-write-failed）则**必在返回前记录**（step 6）；verifier 无状态，`fact_submit` 负责持久化，故写库不可被后续失败跳过（在事实写之后、且事实写被 try 包裹）。verify 服务错误**不产生** verdict ⇒ 什么都不存，worker 重试。

---

## 11. 测试固化的边界行为（`tests/test_core.py` 全量）

以下断言必须全部通过，是移植的"真值"：

**local memory**
- `lm.append("notes", "not a dict")` 抛 `ValueError`（record 必须 dict）。
- 追加到新通道 `scratch` 会注册到 `channels`（`"scratch" not in lm.channels` → append 后 `"scratch" in lm.channels`，且 `read("scratch")[0]["record"] == {"x":1}`）。
- `lm.append("notes", ...)` + `lm.append("events", ...)` 后 `len(read("events")) >= 2`（显式 event + auto breadcrumb）；搜索 `"Beatty decomposition"` 命中 notes 桶 count==1，events 桶被默认排除（channel `events` 不参与默认搜索）。

**global memory**
- `gm.append("bogus_kind", ...)` 抛 `ValueError`；`gm.set_status("someid", "not-a-status")` 抛 `ValueError`。
- 搜索折叠：append 3 条 `plan`（`reduce to q>={i} case`），`set_status(first, "supported")`；`search("reduce", kinds=["plan"], limit_per_kind=2)` 返回 `results["plan"]["count"] == 2`（limit 生效），且 `first` 那条的 `status == "supported"`（折叠命中）。
- `search("zzzquarkxyz", kinds=["plan"])["count"] == 0`（零分被 break 掉）。
- verifiable 但空 evidence：`gm.append("conclusion", claim="c", evidence="")` 抛 `ValueError`。
- judgment（`verifiable=False`）空 evidence 可 append；`read(...)[0]["status"] == "open"`。
- `master_guidance` / `elaboration`（main agent）可带 `links={"fact_ids": [...]}`；`verification` 允许上层额外字段 `verdict`/`fact_id`（`ventry["verdict"]=="correct"`、`ventry["fact_id"]=="abc123"`）。
- verifiable counterexample 初始 `status == "unverified"`；`set_status(gid, "verified", fact_id="abc123")` 后 `status == "verified"` 且 `fact_id == "abc123"`。

**_util**
- `read_jsonl(missing) == []`。
- 垃圾/空行/非 dict 跳过：`{"ok":1}\n\nnot json\n[1,2,3]\n{"ok":2}\n` → `[{"ok":1},{"ok":2}]`。

**schema / external_refs**
- `clean_external_refs([{"note":"z","title":"T","key":"K","aardvark":1}]) == [{"key":"K","title":"T","aardvark":1,"note":"z"}]`（canonical 键在前，额外键按字典序）。

**glossary**
- `flatten(None) == {}`、`flatten({}) == {}`。
- `flatten({version, terms:{S_M:{definition,aliases:[SM]}}})` → `fl["S_M"]=="a set"` 且 `fl["SM"]=="a set"`（alias 继承定义）；`flatten({"K_F":"canonical"}) == {"K_F":"canonical"}`。
- `undefined_symbols(statement="S_M(x) applied", defined={"S_M"}) == []`（base form 已定义）；`defined=set()` → `["S_M(x)"]`。
- global glossary：`global_glossary()` 加载真实资源为非空 dict；资源缺失（`_load_global_text→None`）→ `{}`，`global_terms()==set()`；JSON 坏 → `{}`（走 JSONDecodeError）；`_load_global_text()` 正常路径返回 text 非 None；把 `_GLOBAL_RESOURCE` 指向不存在文件 → `_load_global_text() is None`。

**fact graph**
- `add(... intuition="the key idea is X")` → `get_raw` 含 `## intuition` 且含 `"the key idea is X"`。
- `search("B", limit=2)`（含 3 条 "B one/two/three"）→ 恰 2 条（limit 生效）。
- glossary.json 写成坏 JSON `{not json` → `glossary() == {}`（不抛）。
- `revoke("deadbeefdeadbeef")` 抛 `ValueError`（unknown fact_id）。
- content addressing：`base == compute_fact_id(...)`（含 glossary 内容）⇒ 同 id；`predecessors(child)==[base]`；`set(descendants(base)) == {child, grand}`；`get_raw(base)` 含 `## statement` 与 `## proof`。
- 派生索引：`search("B from A")[0]["fact_id"]==child`、`[0]["statement"]=="B from A"`、所有 `score>0`；`search("nonexistent symplectic quark") == []`。
- glossary 序列化/合并/解析往返：`"X: a complex manifold" in get_raw(base)`、`glossary().get("X") == "a complex manifold"`、`parse_frontmatter(get_raw(base))["glossary_introduces"] == {"X": "a complex manifold"}`。
- 覆盖检查：`undefined_symbols(statement="K_F equals zero", proof="by X", predecessors=[base]) == ["K_F"]`；`undefined_symbols(statement="X is nice", proof="X is a manifold", predecessors=[base]) == []`；`undefined_symbols(statement="let epsilon in R+", proof="Z+ is nonempty") == []`（global glossary 把 universal notation 视为已定义）。
- 级联撤销：`revoke(base)` → `{base, child, grand}`；三者的 `exists()` 全 False。
- 撤销前驱拒绝：`fg.add(..., predecessors=[base])`（base 已撤销）抛 `ValueError("predecessor_revoked")`。

**set_external_refs（兼容性/审计路径）**
- `set_external_refs("deadbeefdeadbeef", [])` 抛 `ValueError("unknown fact_id")`。
- 旧格式文件（无 `external_refs:` 行）→ 该行被**插入**（`set_external_refs(fid, refs) == refs`、`external_refs(fid) == refs`、`get_raw` 含 `external_refs:`）。
- 畸形 frontmatter（无闭合 `---`）→ 抛 `ValueError("malformed")`。
- **`external_refs` 不参与 fact_id**（backward-compat 关键）：`add(..., external_refs=refs)` 的 id == 裸 `compute_fact_id(...)`；同内容无 refs 再 add → 同 id（幂等）；无 refs 的 fact 读回 `[]`；旧格式解析 `external_refs==[]`；`set_external_refs` 重写 refs 后 `exists(fid_b)` 照旧、body（`split("## statement",1)[1]`）不变。

**parse_frontmatter**
- `external_refs: {not valid json` → 解析为 `[]`（JSONDecodeError 分支）。
- glossary 块被非 glossary 行终止：`glossary_introduces:\n  X: a manifold\nsome_other_field: value\nexternal_refs: []` → `parsed["glossary_introduces"]=={"X":"a manifold"}`、`parsed["external_refs"]==[]`。

**statement_of**
- `## statement\nA holds\nand more\n\n## proof\n...` → `"A holds and more"`（在下一篇 `## ` 处停止）。

---

## 12. 关键常量汇总（移植直接对照）

| 常量/默认 | 值 |
|---|---|
| `GLOBAL_KINDS` | 11 项（见 §1.1） |
| `STATUSES` | `("unverified","verifying","verified","refuted","open","supported","challenged")` |
| `EXTERNAL_REF_KEYS` | `("key","authors","title","arxiv","year","venue","doi","cited_for")` |
| `fact_id` | SHA-256 前 16 个小写 hex（8 字节） |
| BM25 | `k1=1.5`, `b=0.75`, `idf=ln(1+(N-df+0.5)/(df+0.5))` |
| 分词 | `[A-Za-z0-9_]+`，`lower()`；非 ASCII 丢弃 |
| `DEFAULT_CHANNELS` | `("notes","events")` |
| `_STATUS_LOG` | `"_status.jsonl"` |
| `global_memory.search` limit | `limit_per_kind=10` |
| `local_memory.search` limit | `limit_per_channel=10` |
| `factgraph.search` limit | `limit=10` |
| global-memory entry id | `sha256(json([kind,claim,author,ts]))[:16]` |
| `utc_now()` | `datetime.now(tz).isoformat()`（`+00:00`，含微秒） |
| `glossary_global.json` version | `1` |
| `_GLOBAL_RESOURCE` | `glossary_global.json` |
| `_PRED_RE` | `^\s*predecessors:\s*\[(.*)\]\s*$`（匹配时 strip 掉行首） |
| `_GLOSS_LINE_RE` | `^\s{2}([^:]+):\s*(.*)$`（恰好 2 个前导空格） |

---

## 13. 微妙的排序/归一化/原子写细节（易错清单）

1. **fact_id 不含 external_refs**（backward-compat）。`proof` 里的 citation key 被哈希，`external_refs` 不被哈希。
2. **fact_id 的 glossary 排序**用 `(str(k), str(v))` 元组；`serialize_fact` 用 `sorted(dict)`（按 key）。对字符串 key 二者等价，但实现细节不同。**应保证 TS 端用相同规则**（建议统一按 `String(k)` 排序且 `String(v)` 参与判别）。
3. **`json.dumps`/`JSON.stringify` 的 key 顺序**：Python 用 `sort_keys=True`；`json.dumps(body, ensure_ascii=False)`。TS 的 `JSON.stringify` **不保证 key 顺序**——哈希必须**显式构造**（手工按确定顺序拼字符串或实现确定性 stringify），否则同一事实在不同运行/不同 JS 引擎产生不同 id。这是移植最易错处。
4. **`ensure_ascii=False` 等价**：Python 不转义非 ASCII；TS 中 `JSON.stringify` 默认也不转义 Unicode（现代引擎），但需注意部分旧行为。务必保证 Unicode 按原字符进入字节序列（UTF-8）。
5. **`_normalize`** 只压缩空白并 strip；**不做**大小写折叠、不 NFC/NFKC、不处理全角/半角。哈希前对 statement/proof 用同一 `_normalize`。
6. **`_revoked/` 无时间戳子目录**（DATA_MODEL 描述与实际实现不一致）：实际平铺为 `_revoked/<fid>.md`。以实现为准。
7. **所有 JSONL 追加 & glossary.json/fact 文件写入都非原子**（`open("a")`、`write_text`、无 fsync、无临时文件+rename、无文件锁）。多进程并发写同一 JSONL **没有互斥**。若 TS 端需要跨进程安全，需自行加锁或改用原子 append。
8. **status 折叠**：`read`/`search` 用 `_latest_status()`（文件按时间序，后写覆盖 last wins）；`fact_id` 折叠用 `status_event.fact_id or entry.fact_id`（status 事件 fact_id 为 falsy 时保留 entry 原值）。
9. **`descendants` / `revoke` 用 `frontier.pop()`（栈，DFS）+ 每轮重跑 `list()` 与 `predecessors`**——顺序确定（受 `list()` 排序影响）但非拓扑序。
10. **BM25 分词丢弃非 ASCII**：search 对 `json.dumps(entry)` 序列化文本分词；Unicode（希腊/中文）与任何数学符号对评分无贡献，但**仍以原字符序列化进 JSON**（对 fact_id、id、glossary 解析有影响）。
11. **local memory 的 breadcrumb**：`channel != "events"` 时才写一条 `{event_type:"local_append", channel}` 到 events；对 events 追加不产生 breadcrumb。
12. **global memory entry id 含 timestamp**（无内容寻址）→ 同 author 同 claim 不同时刻不同 id。
13. **`add` 过滤 falsy predecessors**（`if p`）；`fact_submit` 的 `"predecessors": predecessors or []` 默认空数组。
14. **`clean_external_refs` 丢弃非 dict、canonical 键在前、额外键按 sorted(r) 追加**。
15. **`fact_submit` 的 glossary 检查异常静默置 `[]`**（advisory，绝不阻塞提交）；verify 服务 down → `verdict:"error"` 且不写任何东西（worker 重试）。
16. **`revoked_as_dependent_of`** 用 Python 布尔技巧 `(fid != fact_id and fact_id or None)`：根为 `None`，后代为根 id。
17. **`GlobalMemory.search` 返回结构**是 `{query, results_by_kind}`，每 kind 一个 `{count, results:[{score, entry}]}`；`FactGraph.search` 返回平列表 `[{fact_id, score, statement}]`；`LocalMemory.search` 返回 `{query, channels, results_by_channel}`。

---

## 附：核心公开 API 签名一览（移植目标）

```
LocalMemory(root: Path, channels?: string[])            # dir = root/"local_memory"
  .append(channel, record) -> {status,channel,path,entry}
  .read(channel) -> entry[]
  .search(query, channels?, limit_per_channel=10) -> {query,channels,results_by_channel}

GlobalMemory(root: Path)                                 # dir = root/"global_memory"
  .append(kind, claim, evidence, author, {verifiable?,links?,glossary?,...extra}) -> id
  .set_status(entry_id, status, fact_id?) -> void
  .read(kind) -> entry[]                                 # status 折叠
  .search(query, kinds?, limit_per_kind=10) -> {query,results_by_kind}

FactGraph(root: Path)                                    # root/"fact_graph"
  .add({problem_id,author,statement,proof,predecessors?,glossary_introduces?,intuition?,external_refs?}) -> fact_id
  .exists(fact_id) -> bool
  .list() -> string[]                                    # sorted stems
  .get_raw(fact_id) -> string | null
  .glossary() -> {symbol:def}
  .search(query, limit=10) -> [{fact_id,score,statement}]
  .predecessors(fact_id) -> string[]
  .external_refs(fact_id) -> dict[]
  .set_external_refs(fact_id, refs) -> dict[]
  .descendants(fact_id) -> string[]
  .undefined_symbols({statement,proof,intuition?,predecessors?,glossary_introduces?}) -> string[]
  .revoke(fact_id, reason) -> string[]

schema:  compute_fact_id({problem_id,predecessors,glossary_introduces,statement,proof}) -> string
          clean_external_refs(refs) -> dict[]
          Fact / GLOBAL_KINDS / STATUSES / EXTERNAL_REF_KEYS
bm25:     tokenize(text) -> string[]  ;  bm25_scores(query, docs, k1=1.5, b=0.75) -> number[]
glossary: flatten(obj) -> {term:def} ; global_glossary() -> {term:def} ; global_terms() -> Set
           undefined_symbols({statement,proof,intuition?,defined}) -> string[]
_util:    utc_now() -> string ; append_jsonl(path, payload) ; read_jsonl(path) -> dict[]
```
