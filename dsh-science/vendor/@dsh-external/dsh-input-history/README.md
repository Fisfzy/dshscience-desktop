# dsh-input-history

DSH Web 输入历史插件：像终端一样用 **Ctrl+Up / Ctrl+Down** 召回和切换已发送的消息，零核心改动。

## 版本兼容 / Version compatibility

兼容 DSH snapshot0808（`snapshots/20260808T121140Z`）、snapshot0809（`snapshots/20260809T140917Z`）与 snapshot0810（`snapshots/20260810T155924Z`）：浏览器端实现只使用会话快照与官方输入门面（`conversation.input.for(actx).setDraft()`），不依赖任何被 0808/0809 迁移的槽位契约，typecheck 与实机加载均已验证——0809 运行中的 `window.__DSH_BOOT__` 清单包含本插件，Ctrl+Up / Ctrl+Down 召回实测可用；0810 迁移后 `dsh.client` 声明实测同样进 boot 图。

### 0809 兼容要点（实机验证）

- **加载机制变化**：0809 重构了客户端插件机制——旧的 `dsh.plugin.json` 清单 + `resolveClientPath`（`packages/plugin/plugin`）已删除，改为 **package.json 的 `dshClient` 声明**（`platform: 'web'`，可选 `inject`/`immediately`）+ `exports["./client"]` 指向构建产物；宿主扫描 loader 条目组成 boot 图，Web 端从 `/plugins/<id>/client.js` 拉取。本插件 package.json 已满足该声明，无需改动。
- 依赖的官方输入门面 `conversation.input.for(actx).setDraft()` 与 `ConversationSnapshot.nodes` 会话快照在 0809 上保留，契约未变；键盘 capture 拦截不依赖任何槽位。
- **构建要求**：0809 宿主在激活时校验 `dshClient` 包的构建产物，缺失会抛 `ClientPackageCompositionError` 并**拒绝启动 `dsh web`**——升级快照或改源码后必须重新 `pnpm run build` 再启动，否则浏览器拉到的是旧 `lib/client.js`。

### 0810 兼容要点（snapshot0810）

- **元数据发现变化**：0810 的 ClientModuleHostService 在启动时扫描已加载插件的 package.json，但只读**嵌套 `dsh.client`**（`packages/client/modules/src/index.ts` 的 `resolveMeta`，`pkg.dsh.client`）；顶层 `dshClient` 字段读不到会静默丢出 boot 图——无日志、无报错，"启动顺利但插件全没"。本插件已从顶层 `dshClient` 迁移为嵌套 `dsh.client`（inject 原样保留）；`lib/client.js` 构建产物不变（package.json 不参与编译），symlink 安装改源仓库即生效，无需重装。

## 功能

- **Ctrl+Up**：把最近一条已发送的用户消息填入输入框；连续按向上遍历更早的消息
- **Ctrl+Down**：向下遍历回更新的消息；回到最新位置时恢复你按 Ctrl+Up 之前未发送的草稿
- 裸方向键、Enter、Ctrl+Z/Y、斜杠菜单等全部原样放行——多行输入的光标移动不受影响（对应 [dsh-external/issues#153](https://github.com/dsh-external/issues/issues/153) 的约束）
- 历史来自当前会话快照的用户消息（自动去相邻重复、跳过空白），刷新页面后仍然可用
- 输入框被手动编辑、粘贴、或发送清空草稿后，浏览状态自动复位

## 安装

在 DSH 的 `cordis.yml` 中注册插件（或使用 marisa / plugin-registry 安装）：

```yaml
plugins:
  '@dsh-external/dsh-input-history':
    path: /path/to/dsh-input-history
```

重启 `dsh web` 后，浏览器端插件会随页面加载（`/plugins/<id>/client.js`）。

## 构建

```sh
pnpm install
pnpm run build      # lib/index.js + lib/invariant.js + lib/client.js
pnpm run test       # 纯逻辑单测
pnpm run typecheck
```

## 设计说明

- 纯浏览器端实现：无服务端行为（`src/index.ts` 是空壳），不向模型或会话日志注入任何内容
- 历史数据派生自 `ConversationSnapshot.nodes`（`kind === 'user'` 的文本块），不维护第二份状态
- 键盘在 document capture 阶段拦截，仅匹配 `Ctrl+ArrowUp/ArrowDown` 且焦点在会话输入框（`data-input-scroll` 内）时生效
- 草稿写入走官方输入门面 `conversation.input.for(actx).setDraft()`，与撤销/发送事务兼容

## Known Limitations and Deferred Work

- 历史仅覆盖当前会话（按 issue #153 语义）；跨会话/跨设备历史共享未实现
- 快照窗口外的旧消息不在召回范围内（窗口内必然包含最近发送的消息，实际影响很小）
- macOS 的 Cmd 修饰键未绑定（可扩展为配置项）
- 切换会话后浏览状态复位，不会跨会话续接
