# PARITY.md — dsh-danus 与原版 frenzymath/Danus 的功能一致性核对表

> 核对基准:`spec/*.md`(从原版 Python 源码逐行提取的权威规格)+ 原版测试断言。
> 状态图例:✅ 逐行移植(含精确消息/常量) · 🔀 机制替换、语义不变 · 🚀 超越原版 · ⚠️ 有意差异 · ⬜ 未做
>
> 验证:102/102 测试绿(含原版 golden 向量逐字节对照)+ typecheck 0 错误 +
> 实机 E2E(headless profile 工具调用全链路 + 真实冷启动 judge verdict=correct)。

## 1. core 真源层(spec/core.md)

| 原版行为 | 本版位置 | 状态 | 证据 |
|---|---|---|---|
| fact_id = SHA256(canonJSON)[:16](sort_keys, ', '/': ' 分隔符,ensure_ascii=False,码点排序) | `core/util.ts` pyDumps/canonJson + `core/schema.ts` computeFactId | ✅ 逐字节 | golden 向量 4 组(fact_id_basic/empty/unicode/greek)与原版 Python 输出一致 |
| `_normalize` 空白压缩 | util.ts normalizeText | ✅ | golden |
| 11 个 GLOBAL_KINDS + 7 个 STATUSES | schema.ts | ✅ | gateway/memory 测试 |
| clean_external_refs 键序 | schema.ts | ✅ | golden(键序 key,title,aardvark,note) |
| serialize_fact / parse_frontmatter / statement_of 逐字节 | factgraph.ts | ✅ | golden 往返 |
| FactGraph.add/exists/list/get_raw/glossary/search(BM25 派生索引)/predecessors/external_refs/set_external_refs/descendants/undefined_symbols/revoke(级联+日志) | factgraph.ts | ✅ | core.test.ts 13 项全绿(含级联撤销、撤销前驱拒绝、旧格式兼容、坏 JSON 容忍) |
| GlobalMemory append/set_status/read(status 折叠 last-wins)/search(分桶) | global-memory.ts | ✅ | 含 evidence 必需、breadcrumb、零分剔除 |
| LocalMemory channels/breadcrumb/默认排除 events | local-memory.ts | ✅ | |
| BM25(k1=1.5,b=0.75,idf=ln(1+(N-df+0.5)/(df+0.5)),[A-Za-z0-9_] 分词) | bm25.ts | ✅ | |
| glossary flatten/global 资源/undefined_symbols(base form 规则) | glossary.ts + glossary_global.json(原版同文件复制) | ✅ | |
| JSONL append-only + 坏行跳过 | util.ts appendJsonl/iterJsonl | ✅ | |
| 所有写非原子 | atomicWrite 统一原子写 | 🚀 更稳,字节一致 | |

## 2. gateway 角色门控(spec/gateway-verify.md §1–2)

| 原版行为 | 本版位置 | 状态 |
|---|---|---|
| ROLE_TOOLS 表(worker/main/verifier/all;main 无 fact_submit;verifier 只读) | plugins/gateway.ts ROLE_TOOLS | ✅ |
| 未知角色 fail-closed → verifier | toolsFor + resolveRole | ✅ |
| 工具物理缺失(未授权不注册) | apply 只注册可见集 | ✅ |
| 6 工具参数/返回结构(gm_add/gm_search/fact_submit/fact_search/fact_revoke/search_arxiv_theorems) | gateway.ts | ✅ 11 测试 |
| `_project` 按名寻址(单段正则、agents root 防逃逸、精确错误消息) | resolveProject | ✅(空串走按名寻址被拒,与原版 `is not None` 一致) |
| fact_submit 四信封(accept/accept-write-failed/reject/error)+ verdict 恒 trace(kind=verification) | gateway.ts factSubmit | ✅ 5 测试 |
| glossary 覆盖检查 advisory(异常→[]) | factSubmit try/catch | ✅ |
| DANUS_VERIFY_URL HTTP seam | ctx.danusVerify 进程内服务调用 | 🔀 去 HTTP 中间层;信封语义不变;"not wired yet" 等价错误 |
| search_arxiv_theorems → Matlas(逐字 4 字段、永不抛、UA 头、错误 envelope) | integrations/matlas.ts | ✅(URL 改为调用时读 env) |

## 3. verify 冷启动裁判(spec/gateway-verify.md §3)

| 原版行为 | 本版位置 | 状态 |
|---|---|---|
| 预检:空洞阈值(10/30/5)+ P1/P3/P5 正则禁令(9+4+3 条,IGNORASE)+ 同段 fact_id 豁免 + 双源(proof/statement)+ 异常即 no-match | core/prechecks.ts | ✅ 7 测试;env 改为调用时读(原版 import 时,本版更灵活) |
| run_id = UTC 时间戳 + sha256(statement)[:12];冲突 _N 后缀 ≤10000 | services/verify.ts | ✅ |
| 输出文件名 ("verification.json", "verificationt.json")(刻意拼写保留) | VERIFICATION_FILENAMES | ✅ |
| agent home 幂等预备(合同 + skills 链接) | ensureAgentHome | ✅(Windows 用 junction/copy 替代 symlink) |
| build_prompt 逐字 | buildPrompt | ✅ |
| 冷启动 judge = 每次 spawn 新会话;错误映射 500(非零退出/缺输出/坏 JSON/非 dict)/ 504(超时) | runJudge + fake-dsh 桩全链路测试 | ✅ 9 测试 + **真实 dsh judge E2E verdict=correct** |
| judge 载体 codex exec | `dsh --profile danus-verifier`(headless one-shot) | 🔀 机制替换,冷启动语义不变 |
| HTTP 服务 8091 + /health | 无(进程内服务) | 🔀 无需端口;模型路由走 DSH profile |

## 4. execution + orchestration(spec/execution-orchestration.md)

| 原版行为 | 本版位置 | 状态 |
|---|---|---|
| 磁盘布局(TASK.md/.role/.pid/.pid.lock/.stop/.status.json/.run_deadline/logs/local_memory) | shared/layout.ts | ✅ 同名同格式 |
| parse_roles 命名与全部拒绝形态 | layout.ts parseRoles | ✅ |
| do_new 骨架(project.json/.role/TASK 占位/初始 status/AGENTS.md+skills 链接/拒重名) | services/swarm.ts newProject | ✅ 8 断言 |
| kickoff prompt 逐字;轮状态机(running/idle/stopped/deadline/max_rounds/error/terminated/created);rc 规则(0 成功/124 中性/127 短路/其他计失败,连失 5 退出);write_status 合并原子写;SIGTERM 传播;last_fact_id 抓取 | swarm/loop.ts + loop-main.ts | ✅ 9 测试 |
| 外循环载体:detached `python -m danus.execution`(POSIX:fcntl/killpg//proc) | detached `node loop-main.ts`;O_EXCL 文件锁;Windows taskkill /T 树杀 | 🚀 **跨平台(原版 Windows 不可跑)** |
| CLI 7 动词语义(list/new/assign/finalize/start/status/stop;flock 幂等;stagger;stuck? 阈值=1.5×硬超时;finalize 校验+建议模式+TARGET.md) | services/swarm.ts + plugins/orchestration.ts(danus_* 模型工具) | ✅ + 实机 E2E 全链路 |
| `danus` CLI 文本格式(_fmt_list/_fmt_status) | 未移植(模型工具返回 JSON,render 负责可读) | ⚠️ 有意(CLI→工具) |
| .codex/config.toml MCP 接线 | 不需要(组合层角色配置) | 🔀 |
| worker 模型 .role MODEL 经 CLI flag | profile 默认模型(DSH 模型路由层) | 🔀(.role 仍写,兼容) |

## 5. main agent 编排合同

| 原版机制 | 本版 | 状态 |
|---|---|---|
| 持久 Codex Goal | DSH 原生 goal 栈(create_goal/update_goal) | 🔀 零代码原生 |
| clock.sleep 30min/4h 节拍 | plugins/heartbeat.ts danus_heartbeat(followup 唤醒,忙跳过) | 🔀 学自 dsh-loop 已验证模式 |
| Codex subagents 探索轨 | DSH 原生 subagent 工具 | 🔀 零代码原生 |
| AGENTS.md / worker.md / verifier.md 合同 | contracts/(顶部 DSH 注解,正文逐字) | ✅ |
| 9 个 worker skills + 3 个 verify skills + 4 个 main skills | skills/(DSH skill-filesystem 同格式直接发现;openai.yaml 忽略) | ✅ |

## 6. authoring / write-paper / human-summary / observability(spec/authoring-outputs.md)

| 原版行为 | 本版位置 | 状态 |
|---|---|---|
| authoring common(resolve_project/section/read_fixed/read_project/body_sections/classify_outcome/leak_findings) | authoring/common.ts | ✅ 11 测试 |
| 一次性隔离渲染驱动(空 cwd、诚实分类) | authoring/driver.ts(headless dsh) | ✅ ⚠️ prompt 走 argv 而非 stdin(TODO-PARITY,语义等价) |
| write-paper 6 工具全语义(needs_target/bad_fact_ids/leak 门/provenance/chunked PLAN→FILL→STITCH/coverage/compile 重试环/degenerate 防护/run log/ledger/reference audit+verify/paper_verify_math 全文档复验门) | services/write-paper*.ts + plugins/paper.ts | ✅ 15 测试 |
| human-summary summary_write(scrubbing、9 项 leak 集、_ordered_load_bearing 拓扑) | services/human-summary.ts + plugins/summary.ts | ✅ 12 测试 |
| observability 只读 dashboard 4 端点 + 11 频道 role 标签 | plugins/observability.ts(ctx.webServer 路由,无独立进程) | ✅ 8 测试 🚀 内嵌 DSH |

## 7. 有意差异汇总(全部记录在案)

1. prompt 经 headless argv(超长自动落盘文件)而非 codex stdin —— 隔离语义等价。
2. 写操作统一原子化(原版非原子)—— 更强,字节一致。
3. verify 去 HTTP 层;flock→O_EXCL;killpg→taskkill /T;symlink→junction/copy —— 跨平台等价物。
4. 模型路由走 DSH profile/适配器(替代 DANUS_*_MODEL flag 链;env 回退保留)。
5. CLI 文本格式未移植(模型工具 + render 取代)。
6. `OPERATOR.md` 默认读 `<cwd>/OPERATOR.md`(DANUS_OPERATOR_MD 可覆写)。

## 8. 实机验证记录(2026-08-23)

- headless profile + dev-overlay:danus_new/assign/status/list/stop 全链路真实模型调用成功。
- 真实冷启动 judge(danus-verifier profile):归纳法证明 → verdict=correct,报告提到 P1/P3/P5 硬禁令检查。
- **完整 worker 轮 E2E**:danus-worker profile 冷启动 worker → 读 TASK.md → 证明 →
  fact_submit → 独立冷启动 verifier 判 correct → 事实 `cefabd883755ac88` 入图,
  loop 状态正确记录 last_fact_id(test/live-worker-round.ts)。
- **依赖闭包 E2E**:基于已验证事实连续构建三层定理链(奇数和 → 偶数和 → 前 n 项和),
  每条都过独立裁判、predecessors 正确连成 DAG(test/live-dependent-fact.ts)。
- **LaTeX 编译门**:`compile_verify.sh` 已移植为原生 TS(`services/compile-check.ts`,
  免 bash),真实 MiKTeX 验证:合法文档 COMPILE OK + PDF 落盘;未定义引用严格失败。
- 加载器约束(已适配):.ts 扩展名、strip-only(无参数属性)、输出 schema 白名单、inject 声明。
