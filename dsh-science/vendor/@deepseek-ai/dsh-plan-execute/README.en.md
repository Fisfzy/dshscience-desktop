# @deepseek-ai/dsh-plan-execute

English | [中文](README.md)

**Dual-face package**: the host half routes plan/execute models; the same package's browser half registers the Web Settings "Plan/Execute models" row. One install yields both.

Dual-model plan/execute routing: while plan mode is active, every agent request is proposed against the configured **planner** model; otherwise against the configured **executor** model. The switch happens per request inside the same session — the `agent/request` waterfall — so a user-approved plan is carried out by the executor model from the very next request: no sub-agent, no state migration, no loop change.

The phase signal is the logged `plan/mode` state owned by `@deepseek-ai/dsh-plan-mode` (folded with its `foldPlanMode`), so resume, fork, and compaction recover routing from the log alone. The plugin adds no session events: the loop already records the effective config as `request/header` (reason `change`) whenever a proposal differs, keeping every model-visible routing decision reconstructable.

> The former standalone package `@deepseek-ai/dsh-client-ui-plan-execute` is merged here — do not install it separately.

## Installation (official bundle mechanism)

This plugin distributes through DSH's official built-in plugin mechanism: **profile bundle registration + workspace source embedding** (`dsh plugin` / `dsh.profile.bundles` / `cordis.patch.yml`). No third-party plugin registry is used.

| Surface | Detail |
|---|---|
| Package | `@deepseek-ai/dsh-plan-execute` |
| Embed path (optional monorepo) | `packages/plan/plan-execute` |
| Host | `exports["."]` — phase routing on `agent/request` |
| Client | `exports["./client"]` + package.json `dsh.client` — settings row |

**Recommended (production / other environments)**:

```sh
dsh plugin --profile web add github:dsh-external/dsh-plan-execute
```

One command mounts both the host router and the Web settings row (`client-modules` discovers `dsh.client` from the same Loader entry).

**Source-tree embedding**:

1. Embed this repository at `packages/plan/plan-execute` (pnpm workspace, package name `@deepseek-ai/dsh-plan-execute`).
2. Register through a bundle layer in `packages/bundle/base/cordis.patch.yml` (or the web profile):
   ```yaml
   - id: plan-execute
     name: '@deepseek-ai/dsh-plan-execute'
   ```
3. **Do not** register a separate `ui-plan-execute` / `@deepseek-ai/dsh-client-ui-plan-execute` row.
4. `pnpm install` and start web. The "Plan/Execute models" row appears under Settings → General.

### Web row shows "dsh-plan-execute is not composed"

The host registers the `plan-execute` settings namespace, but **the Web apiproxy does not expose third-party namespaces to the browser by default**. `settings.describe` only returns allow-listed namespaces; if `plan-execute` is missing from that list, the settings row cannot see the section and shows "not composed" with controls disabled — **even when the plugin is composed and host routing still works**.

In the Harness source, add `plan-execute` to the product exposure set (same class as `agent-presets` / `ui-onboarding`):

```ts
// packages/host/apiproxy/src/api-proxy.ts
const PRODUCT_SETTINGS_NAMESPACES = new Set([
  'ui-onboarding',
  AGENT_PRESET_SETTINGS_NAMESPACE,
  'plan-execute', // ← required
])
```

Restart `dsh web` after the change. `dsh plugin add` alone is **not** enough unless your DSH build already includes that allow-list entry.

You can still edit `$DSH_HOME/settings.yaml` under `plan-execute:`; that path is not filtered by the Web allow-list.

## Configuration

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

Both sections are optional and merge over the defaults above: the planner defaults to the official reasoning model with thinking enabled (`deepseek-v4-pro`, effort `high`), the executor to the official fast model with thinking disabled (`deepseek-v4-flash`, effort `off`). Each field is independently overridable; unset fields keep their default. A deployment on another provider must configure both sections, because the default provider route (`deepseek-official`) may not be composed — a misconfigured phase fails the request loudly (`NO_ADAPTER` / `UNKNOWN_MODEL` / `UNSUPPORTED_REASONING_EFFORT` naming the route or model). Unknown config keys and blank field values fail at plugin load.

When a settings service is composed, the user document's `plan-execute` section layers over the entry (which stays the `base`): the same `planner`/`executor` shape, committed through `settings.update` and re-resolved before the next request — a settings change hot-swaps the routing without a restart. A section the routing cannot serve is refused where it is written, and the previous routing keeps serving.

```yaml
# $DSH_HOME/settings.yaml — user layer over the composition entry
plan-execute:
  planner:
    model: deepseek-v4-pro
  executor:
    model: deepseek-v4-flash
```

The Web settings row (General → Plan/Execute models, this package's browser half) edits that section in the browser: blank fields keep inheritance, Apply writes the draft through the settings wire, Reset restores defaults.

The executor phase runs whenever plan mode is inactive, including sessions that never entered plan mode and compositions that do not mount `dsh-plan-mode` (the fold then sees no `plan/mode` events). Plan mode is entered via the `/plan` command, `ctx.planMode.set(agent, true)`, or the reviewed `exit_plan_mode` flow; routing follows the logged state at each request boundary.

## Model Experience

### Phase-routed request configuration

#### What the model sees

The plugin only changes which provider/model the loop calls; it contributes no prompt text, tool schemas, or messages. While plan mode is active, every request carries the planner route (`provider`/`model`/`reasoningEffort`); after approval (or any other exit), every request carries the executor route. Sampling fields set by the agent route (`temperature`, `maxTokens`, `stop`) pass through unchanged.

#### Token impact

No extra tokens beyond the normal `request/header` log entries.

#### KV Cache effect

Each phase boundary changes the request's provider/model/effort and therefore the cache domain; the first request after a boundary loses prefix reuse from the first changed token, and later requests in the same phase regain it. Within a phase the route fields are constant, so that phase's request prefix stays stable and reusable.

## Known Limitations and Deferred Work

- Routing is phase-level, not step-level: there is no per-step model override within a phase.
- The plugin does not add an execution-phase prompt section; executor behavior is shaped by the approved plan in history and `exit_plan_mode` result text. Deployments that need explicit phase guidance can compose their own `systemPrompt` section.
- There is no fallback when a configured phase route is not composed: the request fails rather than silently downgrading to the agent route.
- The Web settings row requires the Harness apiproxy to list `plan-execute` in `PRODUCT_SETTINGS_NAMESPACES`; without it the UI shows "not composed" (see above).
