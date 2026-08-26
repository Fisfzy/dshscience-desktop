# dsh-danus — Architecture

> Danus (frenzymath/Danus) 的原生 TypeScript/DSH 移植。本文档是 as-built 地图:
> 分层模型、目录布局、设计不变量、与原版的功能对照(parity)矩阵。
> 原版行为规格的权威来源是 `spec/*.md`(从 Python 源码逐行提取)。

## 0. 与原版的关系

| 原版(Python + codex) | 本版(TS + DSH) | 变化性质 |
|---|---|---|
| `danus/core` 纯 stdlib 真源层 | `src/core/` 纯 TS(零 cordis 依赖) | **逐行移植**,磁盘格式兼容 |
| `danus/gateway` MCP server + ROLE_TOOLS | `src/plugins/gateway.ts` defineTool + 组合层角色配置 + `tools.guard` 纵深 | 机制替换,权限语义不变 |
| `danus/verify` HTTP 服务 + codex launcher | `src/services/verify.ts`:冷启动 = spawn `dsh --profile danus-verifier` | 去掉 HTTP 中间层,进程内服务 |
| `danus/execution` worker 外循环(fcntl/POSIX) | `src/services/swarm.ts`:跨平台进程监督(Node child_process) | **超越原版**:Windows 可跑 |
| `danus/orchestration` CLI 7 动词 | `src/plugins/orchestration.ts` 模型工具 `danus_*` | CLI → 模型工具,语义不变 |
| clock.sleep 30min/4h 节拍 | `src/plugins/heartbeat.ts`:setInterval + agent.inject | 机制替换 |
| codex subagents 探索轨 | DSH 原生 `subagent` 工具 | 零代码,原生能力 |
| 持久 Goal | DSH 原生 goal 栈(create_goal/update_goal) | 零代码,原生能力 |
| `.agents/skills`、`agents/contracts` | `skills/`、`contracts/`(DSH skill-filesystem 直接发现) | 内容移植,格式不变 |
| write-paper / human-summary MCP | `src/services/authoring.ts` + 工具 | 逐行移植 |
| observability dashboard :8099 | (可选)`ctx.webServer` 路由,DSH 内嵌 | **超越原版**:无独立进程 |

## 1. 分层模型(与原版同构)

```
operator → ① orchestration (main agent 会话 + danus_* 工具 + goal 栈)
             ② strategy     (main agent 的周期综合: elaboration → master_guidance;心跳插件驱动节拍)
             ③ execution    (worker swarm; 每轮 = 一个 dsh headless 会话跑 worker skills)
  gm_* │        │ fact_submit
       ▼        ▼
  ⑤ truth    ④ verification (冷启动 headless dsh judge; correct ⟺ 无 critical_errors 且无 gaps)
  (fact graph + memory)   — 事实仅当 verifier 接受才存在
       ▲
       └── ⑥ gateway 角色门控工具(main 无 fact_submit;verifier 只读)

横切: ⑦ observability(webServer 只读路由)  ⑧ ops(打包/profile/配置)
输出: write-paper · human-summary —— 各自由隔离 headless 会话渲染
```

## 2. 目录布局

```
dsh-danus/
├─ ARCHITECTURE.md           本文档
├─ package.json              dsh.bundle manifest
├─ cordis.patch.yml          组合层:插入全部插件行
├─ spec/                     原版行为规格(移植的权威依据)
│   ├─ core.md
│   ├─ gateway-verify.md
│   ├─ execution-orchestration.md
│   └─ authoring-outputs.md
├─ src/
│  ├─ core/                  ⑤ truth:纯 TS,零 cordis 依赖(可裸 node 测试)
│  │   ├─ schema.ts          数据模型 + 校验(Fact/MemoryEntry/Glossary 等)
│  │   ├─ util.ts            原子写、哈希、归一化、env 解析
│  │   ├─ factgraph.ts       内容寻址 DAG、级联撤销
│  │   ├─ global-memory.ts   11 种 GLOBAL_KINDS + BM25 检索
│  │   ├─ local-memory.ts    worker 私有记忆
│  │   ├─ bm25.ts            BM25 排名
│  │   └─ glossary.ts        术语表
│  ├─ services/              cordis Service 类(供其他插件 inject)
│  │   ├─ truth.ts           DanusTruth:按项目打开 core stores
│  │   ├─ verify.ts          DanusVerify:冷启动 judge(写门)
│  │   ├─ swarm.ts           DanusSwarm:worker 生命周期 + 轮循环
│  │   └─ authoring.ts       DanusAuthoring:隔离 one-shot 渲染驱动
│  ├─ plugins/               函数形态插件(工具/监听)
│  │   ├─ gateway.ts         6 个角色门控模型工具
│  │   ├─ orchestration.ts   danus_list/new/assign/finalize/start/status/stop
│  │   └─ heartbeat.ts       30min control beat + 4h audit 定时注入
│  └─ shared/
│      ├─ layout.ts          磁盘布局唯一真源(移植自 execution/layout.py)
│      └─ headless.ts        dsh headless 进程 spawn 共享层(替代 danus/codex.py)
├─ skills/                   DSH skill 包(移植自 .agents/skills + agents/skills)
├─ contracts/                worker.md / verifier.md / main 合同(AGENTS.md 形态)
└─ test/                     node:test + tsx;parity 测试对照原版测试用例
```

## 3. 设计不变量(从原版继承,不得回归)

1. **三层记忆,一条正确性边界**:local(私有)→ global(共享感知)→ fact graph(唯一真源)。
   证明只能建立在 `fact_id` 上;global memory 永远不是正确性来源。
2. **权限由工具可见性强制,不靠 prompt 约定**。组合层决定角色(worker 组合只见 worker
   工具集);`gateway.ts` 内部再按 config.role fail-closed 过滤;`main` 无 `fact_submit`,
   `verifier` 只读。纵深第三层:`fact_submit` 的写门在服务代码路径,不在文本。
3. **verifier 是唯一写门**。事实仅当 `correct` verdict 返回才存在。
4. **内容寻址、可级联撤销的 fact graph**。`fact_id` = hash(problem_id + predecessors +
   glossary_introduces + normalized(statement, proof));`external_refs` 刻意排除。
5. **自治与可恢复**。worker detach 运行;"轮"从持久记忆续跑;单次崩溃不丢已验证工作。
6. **main agent 自己的推理是大脑**:30 分钟 control beat + 4 小时宏观审计,
   由 heartbeat 插件定时 `agent.inject` 驱动;持久 Goal 用 DSH 原生 goal 栈。
7. **可移植、零硬编码**:一切可调参数进 Schemastery 配置;机密走 credentials/env 引用。
8. **干净的作者上下文**:对外产物(论文/报告)由全新隔离 headless 会话生成,
   prompt 经过 scope 裁剪,永远不用编排器自己污染的窗口。

## 4. DSH 机制映射(对照原版机制)

| 原版机制 | DSH 机制 | 说明 |
|---|---|---|
| `DANUS_ROLE` env + MCP ROLE_TOOLS | cordis 组合 + gateway 插件 `role` 配置 + `ctx.tools.restrict`/guard | 三层门控 |
| `codex exec` 每轮 | `dsh --profile danus-worker <kickoff>`(经 `ctx.subprocess` spawn) | worker profile = dsh-base + dsh-headless + dsh-danus(role: worker) |
| 冷启动 codex judge | `dsh --profile danus-verifier <statement+proof>` | verifier profile 只挂只读工具 |
| `clock.sleep` + Goal | goal 栈(持久目标/续跑)+ heartbeat 插件(wall-clock 定时) | 分工:goal 管连续,心跳管定时 |
| `.pid/.stop/.status.json` + fcntl + /proc | 同名文件语义 + Node 跨平台进程存活检测(`process.kill(pid,0)`)+ 文件锁(proper-lockfile 或自实现 O_EXCL) | Windows 可用 |
| `danus` CLI | 模型工具 `danus_*`(main agent 自然语言调用)+ 等价的 `dsh --profile headless` 也可脚本化 | |
| MCP 工具 JSON 契约 | defineTool parameters/output.schema | 类型化,校验更强 |
| `agents/openai.yaml` | 不需要(DSH skill frontmatter 即注册) | |

## 5. Parity 验证策略

1. `spec/*.md` 是从 Python 源码逐行提取的权威规格;实现完成后逐条核对(见 PARITY.md)。
2. `test/` 移植原版每个测试文件的核心用例(core/gateway/verify/execution/orchestration/authoring),
   相同输入断言相同输出(含 fact_id 哈希值这类精确匹配)。
3. 磁盘格式互操作测试:用原版 Python 生成的 fixture 项目目录,TS 版能读;反之亦然。

## 6. 超越原版的点(实现后核验)

- [ ] Windows 原生可跑(原版 fcntl/killpg//proc 为 POSIX-only)
- [ ] 单运行时(无 Python 依赖)
- [ ] 模型路由走 DSH LLM 适配器层(worker/verifier/main 可用不同 provider)
- [ ] worker 事件经 cordis 事件总线广播(`danus/worker-status` 等),UI/观测可插拔
- [ ] HMR:改插件代码热替换,worker 管理逻辑不用重启 web
- [ ] dashboard 内嵌 DSH webServer,免独立进程
