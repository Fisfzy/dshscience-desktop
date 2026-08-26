# @deepseek-ai/dsh-plan-execute

中文 | [English](README.en.md)

**单包双面（dual-face）插件**：Host 负责计划/执行双模型路由；同一包的浏览器半区提供 Web 设置页「规划/执行模型」行。一次安装即可同时获得路由与 UI。

计划/执行双模型路由：plan 模式激活期间，每个 agent 请求都被提议为配置的 **planner（规划）** 模型；否则为配置的 **executor（执行）** 模型。切换发生在同一会话内的每个请求上 —— 通过 `agent/request` waterfall —— 因此用户批准的计划从下一个请求起就由执行模型继续执行：无需子代理、无需状态迁移、无需改动循环。

阶段信号是 `@deepseek-ai/dsh-plan-mode` 拥有的已记录 `plan/mode` 状态（用其 `foldPlanMode` 折叠），因此恢复、fork 和压缩都能仅从日志恢复路由。本插件不新增会话事件：循环本来就会在提议与之前不同时把生效配置记录为 `request/header`（reason `change`），使每个对模型可见的路由决策都可重建。

> 原独立包 `@deepseek-ai/dsh-client-ui-plan-execute` 已并入本包，请勿再单独安装。

## 安装（官方 bundle 机制）

本插件按 DSH 官方内置的插件机制分发：**profile bundle 层注册 + workspace 源码嵌入**（`dsh plugin` / `dsh.profile.bundles` / `cordis.patch.yml`）。不使用任何第三方插件注册表。

| 内容 | 说明 |
|---|---|
| 包名 | `@deepseek-ai/dsh-plan-execute` |
| 嵌入路径（可选 monorepo） | `packages/plan/plan-execute` |
| Host | `exports["."]` — `agent/request` 阶段路由 |
| Client | `exports["./client"]` + `package.json` → `dsh.client` — 设置行 |

**推荐（生产 / 他人环境）**：

```sh
dsh plugin --profile web add github:dsh-external/dsh-plan-execute
```

一条命令同时挂上 Host 路由与 Web 设置行（client-modules 从同一 Loader entry 发现 `dsh.client`）。

**源码树嵌入**：

1. 将本仓库嵌入 `packages/plan/plan-execute`（pnpm workspace，包名 `@deepseek-ai/dsh-plan-execute`）。
2. 在 `packages/bundle/base/cordis.patch.yml`（或 web profile）加入：
   ```yaml
   - id: plan-execute
     name: '@deepseek-ai/dsh-plan-execute'
   ```
3. **无需**再单独注册 `ui-plan-execute` / `@deepseek-ai/dsh-client-ui-plan-execute`。
4. `pnpm install` 后启动 web。Settings → 通用设置 出现「规划/执行模型」设置行。

### Web 设置行显示「未装配 dsh-plan-execute」

Host 会注册 settings 命名空间 `plan-execute`，但 **Web 的 apiproxy 默认不把第三方命名空间暴露给浏览器**。`settings.describe` 只返回白名单内的 ns；`plan-execute` 若不在名单中，设置行会读不到该 section，从而显示「未装配」并禁用编辑——**即使插件已挂进 composition、Host 路由仍可能生效**。

在 Harness 源码中把 `plan-execute` 加入产品暴露列表（与 `agent-presets` / `ui-onboarding` 同类）：

```ts
// packages/host/apiproxy/src/api-proxy.ts
const PRODUCT_SETTINGS_NAMESPACES = new Set([
  'ui-onboarding',
  AGENT_PRESET_SETTINGS_NAMESPACE,
  'plan-execute', // ← 需要这一项
])
```

改完后重启 `dsh web`。仅 `dsh plugin add` **不够**，除非所用 DSH 版本已包含上述 allowlist。

`settings.yaml` 仍可直接写 `plan-execute:` 段；不受该白名单影响。

## 配置

```yaml
- name: '@deepseek-ai/dsh-plan-execute'
  config:
    planner:
      provider: deepseek-official
      model: deepseek-v4-pro
      reasoningEffort: high
    executor:
      provider: deepseek-official
      model: deepseek-v4-flash
      reasoningEffort: off
```

两段均可选，并覆盖在上面的默认值之上：planner 默认为官方推理模型并开启思考（`deepseek-v4-pro`，effort `high`），executor 默认为官方快速模型并关闭思考（`deepseek-v4-flash`，effort `off`）。每个字段都可独立覆盖；未设置的字段保留默认值。其他 provider 的部署必须同时配置两段，因为默认 provider 路由（`deepseek-official`）可能未装配 —— 配置错误的阶段会在请求时响亮失败（`NO_ADAPTER` / `UNKNOWN_MODEL` / `UNSUPPORTED_REASONING_EFFORT`，并指出路由或模型名）。未知配置键和空白字段值在插件加载时失败。

装配 settings 服务时，用户文档的 `plan-execute` section 叠加在条目配置之上（条目保持为 `base`）：同样是 `planner`/`executor` 形状，通过 `settings.update` 提交，并在下一个请求前重新解析 —— 设置变更无需重启即可热切换路由。无法服务的 section 会在写入处被拒绝，旧路由继续生效。

```yaml
# $DSH_HOME/settings.yaml — user layer over the composition entry
plan-execute:
  planner:
    model: deepseek-v4-pro
  executor:
    model: deepseek-v4-flash
```

Web 设置页（General → 规划/执行模型，本包浏览器半区）在浏览器中编辑该 section：留空字段保持继承，应用（Apply）通过 settings wire 写入草稿，重置（Reset）恢复默认。

plan 模式未激活时执行 executor 阶段，包括从未进入 plan 模式的会话，以及未装配 `dsh-plan-mode` 的组合（此时折叠读不到任何 `plan/mode` 事件）。plan 模式可通过 `/plan` 命令、`ctx.planMode.set(agent, true)` 或经过审核的 `exit_plan_mode` 流程进入；路由在每次请求边界跟随已记录状态。

## 模型体验

### 按阶段路由的请求配置

#### 模型看到什么

插件只改变循环调用哪个 provider/model；不贡献任何提示词文本、工具 schema 或消息。plan 模式激活期间，每个请求携带 planner 路由（`provider`/`model`/`reasoningEffort`）；批准（或任何其他退出）之后，每个请求携带 executor 路由。agent 路由设置的采样字段（`temperature`、`maxTokens`、`stop`）原样通过。

#### Token 影响

除 `request/header` 事件正常的日志条目外无额外 token。

#### KV Cache 影响

每次阶段边界都会改变请求的 provider/model/effort，从而选择不同的缓存域；边界后第一个请求从首个变化 token 起失去前缀复用，再次请求同一阶段时恢复。同一阶段内路由字段恒定，因此该阶段的请求前缀保持稳定、可复用。

## 已知限制与待办

- 路由是阶段级而非步骤级：阶段内没有逐步骤的模型覆盖。
- 插件不添加执行阶段的提示词 section；执行模型的行为由历史中的已批准计划和 `exit_plan_mode` 的结果文本塑造。需要显式阶段指引的部署可自行组合 `systemPrompt` section。
- 配置的阶段路由未装配时没有回退：请求会失败，而不是静默降级到 agent 路由。
- Web 设置行依赖 Harness apiproxy 将 `plan-execute` 列入 `PRODUCT_SETTINGS_NAMESPACES`；未列入时 UI 显示「未装配」，见上文。
