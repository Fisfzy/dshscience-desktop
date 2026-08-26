# dsh-science

DSH Desktop 的科研层：把本地已验证不冲突的科研 skills 与精选插件预装进桌面版。

## 内容

- **20 组科研 skills**（`skills/`）：ai4s-agent、paper-writer、literature-survey、experiment-suite、publication-figures、research-explorer、integrity-auditor、traceability-review、domain-check、stats-integrity、large-file、mindmap-render、modal-run、remote-compute、science-reviewer，以及 DSH 运维系 skills（dsh-plugin-dev、dsh-session-recovery、dsh-snapshot-ab、dsh-web-doctor、dsh-web-guard）。
  - 首次启动时由 Host 入口幂等复制到 `$DSH_HOME/skills`（copy-if-missing，绝不覆盖用户已有内容），记录在 `$DSH_HOME/skills/.dsh-science.json`。
- **15 个插件**（`vendor/`，全部冻结为本地验证过的版本）：
  - 以 **Profile bundle** 形式注册（在 Desktop 插件管理里可单独禁用）：`dsh-cae-agent`、`dsh-danus`、`dsh-focus-chat`、`dsh-ego-browser`、`dsh-ventus-plugins`、`dsh-univer-office`、`@deepseek-ai/dsh-plan-execute`、`@deepseek-ai/dsh-session-health`、`@deepseek-ai/dsh-toolkit`。
  - 以 **patch 行**形式注册（无 bundle 元数据）：`dsh-model-inherit`、`@dsh-external/zotero-harvest`、`@fisfzy/zotero-wave-rag`、`@dsh-external/dsh-session-search`、`@dsh-external/dsh-input-history`、`@dsh-external/dsh-ui-progress`。

## 组装机制

- 本包是 `dsh-plugin-desktop` 的 dependency，全部 vendor 插件经 `file:` 依赖进入应用归档的物理 `node_modules`；
- `healProfilesModuleFallback` 会把整棵依赖树符号链接进 `$DSH_HOME/profiles/node_modules`，因此 profile 组合层可直接用裸包名解析；
- `dsh-plugin-desktop/src/profile.ts` 的 `SCIENCE_BUNDLES` 在每次 profile 规范化时把上述 10 个 bundle 种入 `dsh.profile.bundles`（用户可在插件管理中禁用，但不可随 `dsh plugin remove` 移除——与底座 bundle 同策略）。

## 许可

各 vendor 插件保留其原始许可（见各目录及根 `THIRD_PARTY_NOTICES` 汇总）；本包自身的组装代码与 `dsh-model-inherit`、`zotero-wave-rag` 为 MIT。
