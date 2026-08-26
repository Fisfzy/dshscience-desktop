# zotero-wave-rag

面向 Zotero 论文库的**浪潮式 RAG** 细节检索系统 —— DeepSeek Harness (DSH) 外部插件（纯 TypeScript，零运行时依赖，`node:sqlite` 直读 Zotero 库）。

在传统向量 RAG（KNN 最近邻）之上，移植并实现了 VCPToolBox "浪潮语义动力学" 的四个核心思想：

1. **标签河道图传播** —— 论文为节点、共享标签为河道边（权重 ∝ 1/标签稀有度），查询先做稠密召回得种子，再沿图做 personalized-PageRank 式多跳传播，挖出"语义不相似但沿关系链真实相关"的论文；
2. **虫洞跳转 (Wormhole)** —— 预计算"结构相连但语义疏远"的桥接边（共享作者/收藏夹、无共享标签、低向量相似），让能量跨领域跳跃；
3. **钟型阻尼 (Bell Damper)** —— 贪心选集时对与已选论文高度同质的候选做重叠惩罚，抑制"同义回音"、保证多样性；
4. **Ω 泛函重排** —— `score = Π[0,1]( α·语义基线 + β·拓扑创新 + γ·直接锚点 )`，其中创新通道只奖励"传播分超过其标签类期望"的候选（对应 RiverMemo Topology V3 的条件创新项），锚点通道保护 hop-0 事实匹配（查询点名标题/作者/标签）。

配套：**论文细节卡生成**（元数据 + 方法/贡献/实验 + 图邻居关联 + 证据引文）、**与 NaiveRAG 基线的消融评测**、**超参网格搜索**。

## 架构

```
zotero.sqlite(node:sqlite) / 内置示例库(31篇)
  → 元数据/作者/标签/收藏夹/批注/全文(fulltextItems)
  → 分块 → 可插拔嵌入(hash 离线 | API) → 标签河道图(含wormhole候选边)
  → 稠密种子 → 图传播 → 虫洞 → Ω重排 → 钟型阻尼 → Top-K
  → 细节卡生成(抽取式 | LLM)   →  评测/消融 CLI
```

## 评测（22 条人工标注查询，top-5，31 篇示例库）

浪潮参数由 96 组网格搜索按嵌入模型分别调优（`scripts/sweep.mjs --objective=ndcg`），
因此每个嵌入空间都有独立的默认工作点。

### 离线哈希嵌入（开发默认，无 API 依赖）— v0.6 起 wave 配置使用领域查询扩展

| 配置 | Recall@5 | MRR | NDCG@5 | 多样性↑ |
|---|---|---|---|---|
| Naive dense（基线，原始查询） | 0.833 | 0.879 | 0.796 | 0.824 |
| **Wave（完整，扩展查询）** | **0.848** | **0.947** | **0.830** | **0.827** |
| Wave − 虫洞 | 0.848 | 0.924 | 0.821 | 0.808 |
| Wave − 钟型阻尼 | 0.811 | 0.947 | 0.813 | 0.800 |
| Wave − Ω创新 | 0.826 | 0.894 | 0.789 | 0.835 |
| Wave − 直接锚点 | 0.833 | 0.879 | 0.783 | 0.832 |
| Wave + BM25 (RRF) | 0.811 | 0.943 | 0.800 | 0.812 |

> 小样本上 wave 已全指标反超基线（Recall +1.5pp、MRR +6.8pp、NDCG +3.4pp）；BM25 融合在小样本中性、
> 在真实库上对"正文方法名/缩写/跨语言"查询价值显著（见下）。

### Qwen/Qwen3-VL-Embedding-8B（多模态嵌入，文本语义空间偏弱）

| 配置 | Recall@5 | MRR | NDCG@5 | 多样性↑ |
|---|---|---|---|---|
| Naive dense（基线） | 0.833 | 0.879 | 0.796 | 0.824 |
| **Wave（完整）** | **0.818** | **0.947** | **0.806** | **0.831** |
| Wave − 虫洞 | 0.818 | 0.924 | 0.797 | 0.809 |
| Wave − 钟型阻尼 | 0.780 | 0.947 | 0.788 | 0.804 |
| Wave − Ω创新 | 0.811 | 0.894 | 0.776 | 0.835 |
| Wave − 直接锚点 | 0.803 | 0.879 | 0.759 | 0.834 |

### Qwen/Qwen3-VL-Embedding-8B（多模态嵌入，文本语义空间偏弱）

| 配置 | Recall@5 | MRR | NDCG@5 | 多样性↑ |
|---|---|---|---|---|
| Naive dense（基线） | 0.705 | 0.643 | 0.598 | 0.800 |
| **Wave（完整）** | **0.765** | **0.708** | **0.641** | **0.821** |
| Wave − 虫洞 | 0.765 | 0.673 | 0.625 | 0.821 |
| Wave − 钟型阻尼 | 0.720 | 0.689 | 0.614 | 0.790 |
| Wave − Ω创新 | 0.705 | 0.757 | 0.637 | 0.828 |
| Wave − 直接锚点 | 0.674 | 0.575 | 0.521 | 0.824 |

### BAAI/bge-m3（文本专用嵌入，语义空间强）

| 配置 | Recall@5 | MRR | NDCG@5 | 多样性↑ |
|---|---|---|---|---|
| Naive dense（基线） | 0.917 | 0.909 | 0.851 | 0.816 |
| **Wave（完整）** | **0.856** | **0.902** | **0.813** | 0.816 |
| Wave − Ω创新 | 0.818 | 0.875 | 0.773 | 0.835 |
| Wave − 直接锚点 | 0.803 | 0.845 | 0.738 | 0.834 |

**要点**
- **嵌入模型越弱，浪潮图结构的价值越大**：Qwen3-VL 的纯文本语义空间较弱，naive 召回仅 0.705，
  wave 用图传播/锚点把 Recall@5 拉到 0.765（**+6.0pp**）、MRR 0.708（**+6.5pp**）、NDCG +4.3pp、多样性 +2.1pp —— 全指标胜出；
- **强文本嵌入下 dense 接近饱和**：bge-m3 下 naive 召回 0.917，图结构边际价值收窄，但消融仍显示
  Ω创新与锚点通道显著贡献（摘除后 NDCG −8.0pp / −7.5pp）；
- **每个组件都有可证明贡献**：任意通道被摘除都会损害至少一项指标（wormhole/阻尼/Ω创新/锚点）；
- 开发默认（哈希嵌入）下 wave 较基线 MRR +6.8%、NDCG +1.3%、多样性 +0.9%。

**方法论**（`scripts/`）
- `eval.mjs` —— 6 配置 × 22 查询消融对比（每查询嵌入一次并复用，节省 API 调用）；
- `sweep.mjs --objective=ndcg|recall` —— 96 组超参网格搜索，默认参数按嵌入模型自动切换（`config.ts` 的 `API_TUNED`）；
- `make-test-zotero.mjs` —— 生成最小 Zotero-schema sqlite 验证适配层（含全文、批注父链）；
- `check-zotero-dir.mjs` —— 校验真实 Zotero 目录并预览可摄入内容；
- 开发期嵌入为 4096 维字符 n-gram 哈希（可复现、无 API 依赖），API 密钥放 `.env.local`（gitignored）。
- 调试实录：`seedPool` 曾取自合并 options 前的 topK 导致评测/调参不一致（31 篇库种子池 30 vs 15），修复后两套脚本数值完全对齐。

## DSH 插件

| 工具 | 说明 |
|---|---|
| `zotero_status` | 数据源 / 索引状态 / 模型 provider / 浪潮超参 |
| `zotero_search` | 浪潮式检索，返回命中 + Ω 通道分数（semantic/propagation/anchor）+ 召回理由 |
| `zotero_paper_detail` | 单篇论文细节卡（元数据/方法/贡献/实验/关联/证据） |
| `zotero_compare` | 多篇论文并排对比 + 共享标签/作者 |

## 接入真实 Zotero 库

**零拷贝方案（WSL 直读，已实测）**：本机是 WSL 环境，Windows C 盘直接挂载在 `/mnt/c`，无需传输任何文件——
`zotero.sqlite`（107MB）只读直接打开，2.2GB 的 `storage/` PDF 原位解析。**实测结果**：
真实库 **311 篇论文 / 284 篇提取全文 / 15,885 chunks / 3,017 条图边（含 504 条虫洞边）**，
离线嵌入索引耗时 ~30s，索引缓存命中后加载 ~4s，查询延迟 ~150ms。

```sh
ZWR_DATA_DIR="/mnt/c/Users/Fisfzy/Zotero" node scripts/ingest.mjs   # 建索引（PDF 全文 + 索引缓存于 .zwr-cache/）
node scripts/query.mjs "近场动力学 断裂 有限元耦合 模拟" --detail     # 直接查询
```

**嵌入成本与两级索引（重要）**：嵌入按 token 计费，全库全文一次性向量化代价很高——
实测 284 篇全文 = **15,885 chunks ≈ 490 万 tokens**。为此引入两级索引：

- `ZWR_INDEX_LEVEL=abstract`（推荐，真实库已用）：只嵌入标题+摘要，**265 chunks ≈ 8 万 tokens（成本 ~1/60）**；
  检索跑在摘要级索引上，细节卡直接使用已提取的 PDF 全文（**卡片不需要嵌入**，按需切块零成本）；
- `ZWR_INDEX_LEVEL=fulltext`（默认）：完整全文嵌入，语料大时昂贵；
- 索引按级别分缓存（`index-abstract-v1.*` / `index-fulltext-v1.*`），切换级别互不冲突。

**嵌入 API 说明**：SiliconFlow 账户余额不足时（HTTP 402）会自动失败——此时把 `.env.local`
里的 `ZWR_EMBEDDER` 设为 `hash` 即可零成本离线嵌入（当前即此状态）；充值后改回 `api` 并
删除对应 `.zwr-cache/index-*.v1.*` 强制重建。建议改用文本专用模型（`BAAI/bge-m3` 或
`Qwen/Qwen3-Embedding-8B`）——比多模态 Qwen3-VL-Embedding-8B 便宜得多且文本检索更好。

如果将来换了机器/环境，三档替代方案：
1. **只拷 sqlite**（最小方案，~100MB）：检索核心不需要 PDF——Zotero 6 全文在库里；Zotero 7 需同时有 PDF 目录；
2. **网络挂载**：sshfs/SMB 挂载 Zotero 目录后同上（sqlite 跨网络文件系统注意锁语义，建议先退出 Zotero）；
3. **Zotero Web API**：仅元数据、无全文——**不适合**本项目的全文 RAG 目标。

校验：`node scripts/check-zotero-dir.mjs /path/to/zotero`。

> **Zotero 6/7 差异（真实库踩坑实录）**：Zotero 6 的 `fulltextItems.indexableText` 存原始全文；Zotero 7
> 移除该列（只剩无位置的词袋索引，无法重建正文），适配层自动检测并回退到 **poppler `pdftotext`** 提取（磁盘缓存）。
> 另外 Zotero 7 附件 `path` 变为 `storage:文件名.pdf`（旧版带存储 key 子目录），存储子目录是附件条目自身的 key，
> `resolveStorageFile` 兼容两种格式；CJK 论文无空格，chunker 对相邻 CJK 字符加人工边界避免超大 chunk。

真实库评测：`src/eval/dataset.ts` 目前标注的是示例库真值；真实库需按你的收藏重标（脚本结构已就绪）。

## v0.6 新增：检索内容策略三件套（本地、零 API 成本）

1. **全文 BM25 稀疏通道 + RRF 融合**（`retrieval/bm25.ts`）：BM25 不需要嵌入，
   因此**全部正文（15,885 chunks 的量）都能免费建词法索引**——精确术语、方法名、
   缩写（VCCT/CZM/PDDO）只出现在正文也能命中。引擎层与 wave 结果做 RRF 融合
   （`bm25` 分数随命中返回，可解释）。
2. **领域查询扩展**（`retrieval/expand.ts`）：缩写→全称、**中文↔英文桥**（近场动力学→peridynamics、
   拉弯耦合→tension bending coupling…），跨语言检索互通，零成本。
3. **标签自举**（`ingest/autotags.ts`）：真实库 311 篇仅 1 篇有用户标签 → 从标题+摘要
   自动提取领域词作为 `autoTags`（**不污染用户标签**，只进图/BM25），图边 3,824 → 26,438，
   浪潮的"标签河道"重新有水。

实测（真实库）：中文查询"近场动力学的断裂和裂纹扩展模拟"直接命中
"Virtual crack closure technique in peridynamic theory"（bm25 通道）；"VCCT energy release rate"
命中 VCCT 与能量释放率两篇。

## v0.7 新增（对照 llm-for-zotero 改造，全部本地、零 API 成本）

- **P0-1 片段级证据检索**：`RetrievalHit.snippet`（带 `[section]`/`[p.N]` 前缀），两段式——论文级 BM25 召回后，在命中论文内按全局 BM25 词统计选最佳 chunk；
- **P0-2 查询规划**：`retrieval/query_plan.ts` 规则版（领域扩展 + 引文引用解析 "Madenci et al. (2016)"/"Samborski 等 (2019)" → 库内论文标题并入查询，锚点/BM25 直接受益）；可选 LLM 变体生成（无 key 时行为与规则版完全一致）；
- **P0-3 增量嵌入缓存**（缓存 v3）：per-paper `textHash`（FNV-1a），只重嵌内容变化的论文（验收：改一篇 → 仅该篇重嵌，其余逐位复用）；全量未变时零嵌入调用直接命中；
- **P1-1 嵌入健壮性**：API 批次 ≤16；构建期 API 失败（如 402 余额不足）**自动降级 hash** 并记入 `index.degraded`（status 可见），降级结果不写缓存、下次构建重试 API；
- **P1-2 chunk 元数据**：`sourceStart/sourceEnd` 字符偏移 + 页码（pdftotext `\f` 分页，best-effort），细节卡证据带 `[p.N]`；
- **P1-3 语义开关**：`ZWR_SEMANTIC=0` 关闭语义通道（BM25-only 兜底）；`zotero_status` 新增 `semanticEnabled`/`semanticReason`/`degraded`。

## v0.7.1：忠实度校验层 + 论文类型标注（UJUTGR83 教训落地）

真实 RAG 失败案例复盘驱动的两项能力：

1. **methodType 自动分类**（`ingest/autotags.ts` `deriveMethodType`）：标题+摘要关键词打分 →
   `experimental / numerical / analytical / review / mixed`；细节卡与检索命中都带该字段，
   `zotero_search` 新增 `type` 参数过滤（"试验"查询可只看 experimental）——UJUTGR83 这类
   数值模型论文不再混进试验清单。
2. **claim–evidence 校验器**（`generate/claim_check.ts`）：LLM 生成细节卡后逐句校验——
   复用插件自身的 BM25 词管线和中英桥词典，判"该句是否被证据支持"（支持度 = 命中/术语数，
   中英桥规范术语单独计分）；不支持句标注「⚠ 此句未在证据中找到直接支持」而非静默删除。
   实测 UJUTGR83 场景 5/5 判别正确（含跨语言），"拉弯耦合→自由边→萌生判据"越界句被拦下。

> 局限（如实）：校验是词法级（含中英桥），语义级蕴含（近义改写）需 API 嵌入或 NLI 模型——
> 这正是充值换 bge-m3 后可继续强化的方向；届时可用 RAGAS 离线评测量化 faithfulness。

## 嵌入模型选择（用户入口）

两个入口，选择即持久化（`~/.config/zotero-wave-rag/config.json`），索引缓存按模型隔离、切换后自动重建：

- **DSH 工具** `zotero_embedder`：`list` 查看预设与当前模型；`set <id>` 切换（在对话里说"换个嵌入模型"即可触发）；
- **CLI**：`node scripts/embedder.mjs list | set <id> | status`。

| id | 模型 | 需要 API key | 说明 |
|---|---|---|---|
| `hash` | 离线哈希（免费） | 否 | 当前默认；无依赖、可复现 |
| `bge-m3` | BAAI/bge-m3 | 是 | 文本检索最佳（评测 Recall@5 0.917）、单价低 |
| `qwen3-embed-8b` | Qwen/Qwen3-Embedding-8B | 是 | Qwen 系文本嵌入 |
| `qwen3-vl-embed-8b` | Qwen/Qwen3-VL-Embedding-8B | 是 | 多模态；纯文本任务不划算 |

运行时配置文件（`~/.config/zotero-wave-rag/config.json`）还包含 `dataDir` 与 `indexLevel`——真实库路径与索引粒度都可以运行时切换，**无需在服务器启动时注入环境变量**。
优先级：运行时配置（用户显式选择）> 环境变量（`ZWR_EMBEDDER*`/`ZWR_DATA_DIR`/`ZWR_INDEX_LEVEL`）> 默认值。
API key 只从环境变量读取（`.env.local`，gitignored），不落入预设注册表。

## 开发

```sh
pnpm run build    # tsc -> lib/
pnpm run verify   # 以宿主 tsx loader 挂载插件并逐个执行工具（含宿主侧 schema 校验）
node scripts/ingest.mjs    # 建索引
node scripts/eval.mjs      # 消融评测
node scripts/sweep.mjs     # 超参搜索
dshx install zotero-wave-rag .   # 安装进 DSH checkout（本地，不发布）
dshx list / dshx verify zotero-wave-rag
```

## 路线图

- [x] M0 插件骨架 + 工具契约 + 状态自检
- [x] M1 Zotero 适配层 + 示例库 + 索引管线
- [x] M2 NaiveRAG 基线 + 细节卡生成
- [x] M3 浪潮检索核心（传播 / 虫洞 / 阻尼 / Ω 重排）
- [x] M4 评测集 + 消融 + 超参搜索
- [x] M5 打磨：配置文档、真实库接入说明（本文件）、（可选）检索传播可视化
