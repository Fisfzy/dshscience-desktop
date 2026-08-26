# dsh-danus — Danus 的 DSH 原生移植

verifier 门控的数学证明搜索编排:fact graph(唯一真源)+ 角色门控工具 +
冷启动验证器 + worker swarm + 编排工具 + 心跳节拍。原版:
[frenzymath/Danus](https://github.com/frenzymath/Danus)(行为规格见 `spec/`,
parity 核对见 `PARITY.md`)。

## 组件

| 插件行(id) | 作用 | 挂载处 |
|---|---|---|
| `danus-gateway` | 6 个角色门控工具(gm_add/gm_search/fact_submit/fact_search/fact_revoke/search_arxiv_theorems) | main / worker / verifier 三种组合,`config.role` 定角色 |
| `danus-verify-service` | `ctx.danusVerify`:冷启动 judge(prechecks + headless dsh) | worker 组合(fact_submit 的写门) |
| `danus-swarm-service` | `ctx.danusSwarm`:项目/worker 生命周期库 | main 组合 |
| `danus-orchestration` | `danus_list/new/assign/finalize/start/status/stop` 模型工具 | main 组合 |
| `danus-heartbeat` | `danus_heartbeat` 工具:30min control beat + 4h audit | main 组合 |

## 部署三种组合

### 1. main agent(web profile,操作员会话)

在 `~/.dsh/profiles/web/cordis.patch.yml` 追加(**整行重述**,patch 语义):

```yaml
- id: danus-gateway
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/gateway.ts'
  config:
    role: main
    agentsRoot: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/runtime/projects'
    author: main_agent
- id: danus-swarm-service
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/swarm-service.ts'
- id: danus-orchestration
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/orchestration.ts'
- id: danus-heartbeat
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/heartbeat.ts'
```

main agent 合同:`contracts/main_agent.md`(作为会话的 AGENTS.md 或 skill 加载)。
main-agent skills 在 `skills/main/`(elaboration / human-summary / initialize / write-paper)。

### 2. worker(`dsh --profile danus-worker`,由 swarm 自动拉起)

```powershell
dsh plugin --profile danus-worker add <本包路径>   # 或手工建 profile
```

profile 的 cordis.patch.yml:

```yaml
- id: danus-gateway
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/gateway.ts'
  config:
    role: worker
- id: danus-verify-service
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/verify-service.ts'
  config:
    timeoutSeconds: 900
```

swarm 每个 worker 轮 spawn `dsh --profile danus-worker <kickoff>`,cwd = worker 家目录
(AGENTS.md = worker 合同,.agents/skills = 9 个证明 skills,env 带
DANUS_PROJECT_DIR/DANUS_AUTHOR/DANUS_ROLE=worker/DANUS_PROBLEM_ID)。

### 3. verifier(`dsh --profile danus-verifier`,每次验证冷启动)

```yaml
- id: danus-gateway
  name: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/dsh-danus/src/plugins/gateway.ts'
  config:
    role: verifier   # 只见 search_arxiv_theorems(只读)
```

verify 服务 spawn `dsh --profile danus-verifier`,cwd = verifier agent home
(`runtime/danus/verify/agent`,合同 = contracts/verifier.md,skills = skills/verify)。

## 开发

```powershell
pnpm install
pnpm test         # 56 个测试(node:test + tsx),含原版 golden 向量逐字节对照
pnpm typecheck
```

## 环境变量(全部调用时读取,原版 parity 契约)

| 变量 | 默认 | 用途 |
|---|---|---|
| `DANUS_AGENTS_ROOT` | `<cwd>/runtime/projects` | 项目根 |
| `DANUS_PROJECT_DIR` | — | worker 钉住的项目目录 |
| `DANUS_ROLE` | `verifier`(fail-closed) | gateway 角色(组合 config 优先) |
| `DANUS_AUTHOR` | `unknown` | 署名 |
| `DANUS_PROBLEM_ID` | 项目目录名 | fact 的 problem_id |
| `DANUS_ROUND_BEAT` / `DANUS_ROUND_HARD_TIMEOUT` / `DANUS_MAX_ROUNDS` / `DANUS_MAX_CONSEC_FAILURES` | 5 / 14400 / 0 / 5 | 外循环 |
| `DANUS_WORKER_PROFILE` / `DANUS_VERIFIER_PROFILE` | danus-worker / danus-verifier | spawn 的 profile |
| `DSH_BIN` | PATH 上的 dsh | dsh 二进制覆盖 |
| `VERIFY_*` | 见 spec | prechecks 阈值与开关 |
| `MATLAS_URL` | leansearch.net | arXiv 定理检索端点 |
