/**
 * Built-in sample library — lets the whole pipeline run with zero local
 * Zotero. The schema mirrors what `db.ts` produces from a real `zotero.sqlite`
 * (same `Paper` type), so the ingest/retrieval core is identical either way.
 *
 * The papers intentionally span several research areas (RAG, dense retrieval,
 * graph methods, vector DBs, LLM agents, evaluation, embeddings) with
 * overlapping tags, so the wave graph has real "rivers" to propagate along
 * and a couple of cross-domain "wormhole" opportunities.
 */

import type { Annotation, Paper } from '../core/types.ts'

const a = (firstName: string, lastName: string) => ({ firstName, lastName })

/** Papers lacking explicit annotations get an empty list (type default). */
const withDefaults = (
  papers: Array<Omit<Paper, 'annotations'> & { annotations?: Annotation[] }>,
): Paper[] => papers.map((p) => ({ annotations: [], ...p }))

export const SAMPLE_PAPERS: Paper[] = withDefaults([
  {
    key: 'rag-survey',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    creators: [a('Patrick', 'Lewis'), a('Ethan', 'Perez'), a('Aleksandra', 'Piktus')],
    year: 2020,
    abstract:
      'Large pre-trained language models store factual knowledge in their parameters, but struggle with knowledge-intensive tasks and updating knowledge. Retrieval-augmented generation (RAG) combines a parametric sequence-to-sequence model with a non-parametric dense retriever over a document index. The retriever supplies latent documents that the generator conditions on, improving factual accuracy on open-domain QA and fact verification, and enabling the model to be updated without retraining.',
    tags: ['rag', 'retrieval', 'nlp', 'knowledge', 'generation'],
    collections: ['RAG 基础', '我的必读'],
    url: 'https://arxiv.org/abs/2005.11401',
    doi: '10.48550/arXiv.2005.11401',
    fullText:
      '1. Introduction\nNeural language models have driven rapid progress in open-domain QA and generation, but their purely parametric knowledge is hard to update and can be stale or hallucinated. In this paper we treat a pre-trained model as a parametric memory, complemented by a non-parametric memory — a dense vector index of documents — accessed by a retriever at generation time.\n\n2. Method\nRAG models use a query encoder to embed the input question, retrieve the top-k documents by dot-product similarity from the dense index, then feed each retrieved document together with the question to a sequence-to-sequence generator that marginalizes over the k documents. The retriever and generator are trained jointly end-to-end.\n\n3. Results\nOn open-domain Natural Questions, RAG achieves state-of-the-art exact-match scores, and on FEVER fact verification it outperforms parametric-only generators of the same size, showing that retrieval helps grounded, knowledge-intensive generation.',
    annotations: [
      {
        quote: 'a non-parametric memory — a dense vector index of documents — accessed by a retriever at generation time',
        note: '核心卖点：检索器 + 生成器联合训练',
        page: 1,
      },
      {
        quote: 'retrieve the top-k documents by dot-product similarity from the dense index',
        note: '',
        page: 2,
      },
    ],
  },
  {
    key: 'dpr',
    title: 'Dense Passage Retrieval for Open-Domain Question Answering',
    creators: [a('Vladimir', 'Karpukhin'), a('Barlas', 'Oğuz'), a('Sewon', 'Min')],
    year: 2020,
    abstract:
      'Open-domain question answering requires efficient passage retrieval. Dense Passage Retrieval (DPR) embeds questions and passages with two independent BERT encoders trained on question-passage pairs, and retrieves by dot product. DPR substantially outperforms BM25 and other sparse baselines on Natural Questions, TriviaQA and WebQuestions, and is a key component of strong open-domain QA pipelines.',
    tags: ['retrieval', 'dense-retrieval', 'qa', 'bert', 'nlp'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/2004.04906',
    doi: '10.48550/arXiv.2004.04906',
  },
  {
    key: 'rag-recsys-survey',
    title: 'A Survey of Retrieval-Augmented Generation for Recommender Systems',
    creators: [a('Yin', 'Zhang'), a('Qing', 'Li')],
    year: 2024,
    abstract:
      'Recommender systems increasingly rely on large language models, and retrieval-augmented generation offers a principled way to ground LLM recommendations in item catalogs, user history and knowledge. This survey organizes RAG-for-recommendation methods into retrieval-side and generation-side designs, discusses when dense, sparse or hybrid retrieval wins, and identifies open problems including freshness, cold start and evaluation.',
    tags: ['rag', 'recommender', 'survey', 'llm', 'retrieval'],
    collections: ['RAG 基础'],
    url: 'https://arxiv.org/abs/2406.14680',
  },
  {
    key: 'graphrag',
    title: 'From Local to Global: A Graph RAG Approach to Query-Focused Summarization',
    creators: [a('Darren', 'Edge'), a('Ha-Trinh', 'Nguyen'), a('Newman', 'Newman')],
    year: 2024,
    abstract:
      'Query-focused summarization over large private corpora is hard for naive RAG because information is scattered across many sources. Graph RAG builds a knowledge graph over the corpus with an LLM, partitions it into communities, and pre-computes community summaries; at query time it aggregates the most relevant community summaries to answer questions whose answers span the whole corpus. Graph RAG substantially improves comprehensiveness and diversity of answers on a million-token news corpus.',
    tags: ['graph-rag', 'rag', 'knowledge-graph', 'summarization', 'llm'],
    collections: ['图方法'],
    url: 'https://arxiv.org/abs/2404.16130',
    doi: '10.48550/arXiv.2404.16130',
    fullText:
      '1. Introduction\nQuestion-focused summarization over private corpora requires answers that synthesize information across many documents; chunk-level RAG retrieval often misses the forest for the trees.\n\n2. Graph Indexing\nAn LLM extracts entity and relation triples from each source chunk, forming a knowledge graph. Leiden community detection partitions the graph, and the LLM summarizes each community, yielding a hierarchical summary index.\n\n3. Query-Time Map-Reduce\nFor a question, community summaries are scored by relevance; the highest-scoring ones are combined in a map-reduce pass to produce a grounded global answer. Ablations show the graph structure is responsible for the gains in comprehensiveness and diversity.',
    annotations: [
      {
        quote: 'chunk-level RAG retrieval often misses the forest for the trees',
        note: '对比点：chunk 级 RAG 的痛点',
        page: 1,
      },
    ],
  },
  {
    key: 'lightrag',
    title: 'LightRAG: Simple and Fast Retrieval-Augmented Generation',
    creators: [a('Zirui', 'Guo'), a('Lianghao', 'Xia'), a('Yuhui', 'Zhang')],
    year: 2024,
    abstract:
      'LightRAG introduces a lightweight graph-based retrieval paradigm that integrates graph structures into text indexing and retrieval, supporting both keyword and semantic queries with dual-level retrieval over entities and relations. It requires only one LLM call to index the graph, runs fast, and improves answer completeness and retrieval efficiency compared to baselines including Graph RAG and vector-only RAG.',
    tags: ['graph-rag', 'rag', 'retrieval', 'vector-db'],
    collections: ['图方法'],
    url: 'https://arxiv.org/abs/2410.05779',
  },
  {
    key: 'vector-db-survey',
    title: 'Vector Databases in the Era of Generative AI: A Survey',
    creators: [a('Xiaoxu', 'Han'), a('Chenyu', 'You')],
    year: 2024,
    abstract:
      'Vector databases are the retrieval backbone of generative-AI applications: they store embeddings, support approximate nearest neighbor search, and provide CRUD, metadata filtering and hybrid search. This survey compares the design of major vector databases (Milvus, Pinecone, Weaviate, Qdrant), covering indexing (IVF, HNSW, PQ), distance functions, and the trade-offs between recall, latency and memory.',
    tags: ['vector-db', 'retrieval', 'database', 'survey', 'ann'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/2411.02777',
  },
  {
    key: 'ann-survey',
    title: 'Approximate Nearest Neighbor Search on High Dimensional Data — Experiments, Analyses, and Improvement',
    creators: [a('Yury', 'Malkov'), a('Alexander', 'Ponomarenko')],
    year: 2019,
    abstract:
      'Approximate nearest neighbor (ANN) search underlies vector retrieval. This study benchmarks leading ANN methods on high-dimensional data, analyzes why graph-based methods (especially HNSW) dominate, and proposes refinements. It is a reference for understanding the recall/latency trade-offs of vector indexes used in RAG pipelines.',
    tags: ['ann', 'vector-db', 'retrieval', 'hnsw'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/1904.12319',
  },
  {
    key: 'memorybank',
    title: 'MemoryBank: Enhancing Large Language Models with Long-Term Memory',
    creators: [a('Wenfeng', 'Zhong'), a('Lianghong', 'Guo')],
    year: 2023,
    abstract:
      'Long-term memory lets LLM-based agents behave coherently across sessions. MemoryBank maintains a memory database of past interactions, updates it with a memory-augmented mechanism, and uses a similarity-based retrieval controller to decide which memories to surface. Evaluated on the SILICONE benchmark, it improves conversational memory and response quality.',
    tags: ['llm', 'memory', 'agent', 'retrieval'],
    collections: ['智能体'],
    url: 'https://arxiv.org/abs/2305.10250',
  },
  {
    key: 'toolformer',
    title: 'Toolformer: Language Models Can Teach Themselves to Use Tools',
    creators: [a('Timo', 'Schick'), a('Jane', 'Dwivedi-Yu')],
    year: 2023,
    abstract:
      'Toolformer teaches language models to decide when and how to call external tools (search, calculators, translation systems) through self-supervised learning. Models learn to insert API calls into text, and the results improve downstream performance on QA, math and factual generation, showing that tool use can be learned without large amounts of human annotation.',
    tags: ['llm', 'agent', 'tools', 'qa'],
    collections: ['智能体'],
    url: 'https://arxiv.org/abs/2302.04761',
  },
  {
    key: 'rag-eval',
    title: 'Benchmarking Large Language Models in Retrieval-Augmented Generation',
    creators: [a('Jiawei', 'Chen'), a('Hongyu', 'Lin')],
    year: 2023,
    abstract:
      'This work builds a comprehensive benchmark for RAG evaluation, covering answer generation quality, context utilization, and noise robustness. It finds that LLMs are sensitive to retrieval quality and context order, and proposes NOISESET to test robustness against irrelevant or conflicting retrieved passages — a widely used reference for RAG evaluation methodology.',
    tags: ['rag', 'eval', 'benchmark', 'llm'],
    collections: ['评测'],
    url: 'https://arxiv.org/abs/2309.01431',
  },
  {
    key: 'mmlu',
    title: 'Measuring Massive Multitask Language Understanding',
    creators: [a('Dan', 'Hendrycks'), a('Collin', 'Burns')],
    year: 2021,
    abstract:
      'MMLU is a benchmark of 57 tasks spanning elementary mathematics, US history, computer science, law and more, designed to measure knowledge acquired during pretraining. Models well below expert accuracy on MMLU show the limits of purely parametric knowledge, motivating retrieval- and knowledge-augmented approaches.',
    tags: ['llm', 'eval', 'benchmark', 'knowledge'],
    collections: ['评测'],
    url: 'https://arxiv.org/abs/2009.03300',
  },
  {
    key: 'kg-embeddings',
    title: 'A Survey on Knowledge Graph Embeddings',
    creators: [a('Dai', 'Quan'), a('Rossi', 'Andrea')],
    year: 2021,
    abstract:
      'Knowledge graph embeddings map entities and relations into low-dimensional vector spaces for link prediction and reasoning. This survey covers translational models (TransE), tensor decomposition (RESCAL, DistMult, ComplEx), and GNN-based encoders, and discusses how KG embeddings integrate with text and retrieval systems.',
    tags: ['knowledge-graph', 'embedding', 'survey', 'kg'],
    collections: ['图方法'],
    url: 'https://arxiv.org/abs/2010.02026',
  },
  {
    key: 'simcse',
    title: 'SimCSE: Simple Contrastive Learning of Sentence Embeddings',
    creators: [a('Tianyu', 'Gao'), a('Xingcheng', 'Yao')],
    year: 2021,
    abstract:
      'SimCSE produces high-quality sentence embeddings with contrastive learning: unsupervised SimCSE predicts a sentence from itself using dropout as noise, and supervised SimCSE uses NLI entailment pairs. It consistently beats prior sentence-embedding methods on STS tasks and transfers well to retrieval-style similarity search.',
    tags: ['embedding', 'representation-learning', 'nlp', 'contrastive'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/2104.08821',
  },
  {
    key: 'natural-questions',
    title: 'Natural Questions: A Benchmark for Question Answering Research',
    creators: [a('Tom', 'Kwiatkowski'), a('Jennimaria', 'Palomaki')],
    year: 2019,
    abstract:
      'Natural Questions (NQ) is a large-scale benchmark of real anonymized Google search queries with answers annotated in Wikipedia pages. NQ became the standard evaluation for open-domain QA and drove the transition from extractive readers to retrieval-augmented pipelines.',
    tags: ['qa', 'benchmark', 'retrieval', 'dataset'],
    collections: ['评测'],
    url: 'https://aclanthology.org/Q19-1026/',
  },
  {
    key: 'colbert',
    title: 'ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT',
    creators: [a('Omar', 'Khattab'), a('Matei', 'Zaharia')],
    year: 2020,
    abstract:
      'ColBERT introduces late interaction: queries and passages are encoded separately into token-level embeddings, then matched with a lightweight MaxSim operator. This retains the expressiveness of cross-encoders at near bi-encoder speed, substantially improving passage ranking effectiveness.',
    tags: ['retrieval', 'dense-retrieval', 'ranking', 'nlp'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/2004.12832',
  },
  {
    key: 'rerank-cross',
    title: 'Multi-Stage Passage Retrieval with Cross-Encoder Re-ranking',
    creators: [a('Rodrigo', 'Nogueira'), a('Kyunghyun', 'Cho')],
    year: 2019,
    abstract:
      'This work shows that a BM25 first stage followed by a cross-encoder re-ranker achieves state-of-the-art results on passage retrieval benchmarks, establishing the standard two-stage retrieval architecture used in later RAG pipelines.',
    tags: ['retrieval', 'ranking', 'sparse', 'nlp'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/1901.04085',
  },
  {
    key: 'selfrag',
    title: 'Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection',
    creators: [a('Akari', 'Asai'), a('Zejiang', 'Shen')],
    year: 2023,
    abstract:
      'Self-RAG trains a model to decide when to retrieve, generate with or without retrieved evidence, and critique its own outputs with reflection tokens. It improves factual accuracy and quality across open-domain QA and long-form generation while using retrieval only when needed.',
    tags: ['rag', 'llm', 'retrieval', 'self-reflection'],
    collections: ['RAG 基础'],
    url: 'https://arxiv.org/abs/2310.11511',
  },
  {
    key: 'hyde',
    title: 'Precise Zero-Shot Dense Retrieval without Relevance Labels',
    creators: [a('Gautier', 'Izacard'), a('Patrick', 'Lewis')],
    year: 2022,
    abstract:
      'HyDE generates a hypothetical document from the query with an LLM and embeds it instead of the query, retrieving passages whose embedding is close to the hypothetical document. It closes much of the gap to supervised dense retrievers in zero-shot settings.',
    tags: ['retrieval', 'dense-retrieval', 'zero-shot'],
    collections: ['嵌入与检索'],
    url: 'https://arxiv.org/abs/2212.10496',
  },
  {
    key: 'adaptive-rag',
    title: 'Adaptive-RAG: Learning to Adapt Retrieval-Augmented Large Language Models through Question Complexity',
    creators: [a('Soyeong', 'Jeong'), a('Jinheon', 'Baek')],
    year: 2024,
    abstract:
      'Adaptive-RAG routes each query by its complexity: simple questions skip retrieval, moderate ones use single-pass retrieval, and complex ones trigger multi-step retrieval with a feedback loop. The router is trained to predict which strategy fits, improving accuracy and efficiency.',
    tags: ['rag', 'llm', 'adaptive', 'retrieval'],
    collections: ['RAG 基础'],
    url: 'https://arxiv.org/abs/2403.14403',
  },
  {
    key: 'rag-fusion',
    title: 'RAG-Fusion: A New Take on Retrieval Augmented Generation',
    creators: [a('Zachary', 'Fisher'), a('Katie', 'Delavar')],
    year: 2024,
    abstract:
      'RAG-Fusion generates multiple query variations from the user question, retrieves for each, and fuses the result sets with reciprocal rank fusion before generation, improving recall and answer quality by covering more query angles.',
    tags: ['rag', 'retrieval', 'fusion'],
    collections: ['RAG 基础'],
    url: 'https://arxiv.org/abs/2402.03367',
  },
  {
    key: 'bm25-survey',
    title: 'A Short Survey on BM25 and Information Retrieval Scoring',
    creators: [a('Stephen', 'Robertson'), a('Hugo', 'Zaragoza')],
    year: 2009,
    abstract:
      'BM25 is the canonical sparse retrieval scoring function, balancing term frequency saturation and document length normalization. This survey explains its components and variants, and why sparse and dense retrieval remain complementary.',
    tags: ['retrieval', 'sparse', 'ranking', 'survey'],
    collections: ['嵌入与检索'],
    url: 'https://doi.org/10.1561/1500000019',
  },
  {
    key: 'transe',
    title: 'Translating Embeddings for Modeling Multi-relational Data',
    creators: [a('Antoine', 'Bordes'), a('Nicolas', 'Usunier')],
    year: 2013,
    abstract:
      'TransE models relations as translations in embedding space: for a triple (h, r, t), the embedding of the head plus the relation should approximate the tail embedding. It became the baseline for knowledge graph embedding research.',
    tags: ['knowledge-graph', 'embedding', 'kg'],
    collections: ['图方法'],
    url: 'https://proceedings.neurips.cc/paper/2013/hash/1cecc7a77928ca8133fa24680a88d2f9',
  },
  {
    key: 'rgnn',
    title: 'Modeling Relational Data with Graph Convolutional Networks',
    creators: [a('Michael', 'Schlichtkrull'), a('Thomas', 'Kipf')],
    year: 2018,
    abstract:
      'R-GCN extends graph convolutional networks to relational graphs with typed edges, learning entity and relation representations for link prediction and node classification on knowledge bases.',
    tags: ['knowledge-graph', 'gnn', 'representation-learning'],
    collections: ['图方法'],
    url: 'https://arxiv.org/abs/1703.06103',
  },
  {
    key: 'kg-rag',
    title: 'Knowledge Graph Augmented Large Language Models for Question Answering',
    creators: [a('Linyi', 'Yang'), a('Hongyu', 'Chen')],
    year: 2024,
    abstract:
      'A survey and framework for grounding LLMs in knowledge graphs: entities are retrieved from the KG, verbalized into natural language, and injected into prompts, improving answer grounding and reducing hallucination compared to text-only retrieval.',
    tags: ['knowledge-graph', 'rag', 'llm', 'qa'],
    collections: ['图方法'],
    url: 'https://arxiv.org/abs/2405.17336',
  },
  {
    key: 'react',
    title: 'ReAct: Synergizing Reasoning and Acting in Language Models',
    creators: [a('Shunyu', 'Yao'), a('Jeffrey', 'Zhao')],
    year: 2022,
    abstract:
      'ReAct interleaves reasoning traces and tool actions in a single language model rollout, letting the model reason about what to do, act, and observe the result. It outperforms both pure reasoning and pure acting on knowledge and decision benchmarks.',
    tags: ['llm', 'agent', 'reasoning', 'tools'],
    collections: ['智能体'],
    url: 'https://arxiv.org/abs/2210.03629',
  },
  {
    key: 'reflexion',
    title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
    creators: [a('Noah', 'Shinn'), a('Frederico', 'Cassano')],
    year: 2023,
    abstract:
      'Reflexion agents convert task feedback into verbal self-reflection stored in an episodic memory buffer, which is replayed on later attempts. The mechanism improves decision-making agents without weight updates.',
    tags: ['llm', 'agent', 'memory', 'self-reflection'],
    collections: ['智能体'],
    url: 'https://arxiv.org/abs/2303.11366',
  },
  {
    key: 'ragas',
    title: 'RAGAS: Automated Evaluation of Retrieval Augmented Generation',
    creators: [a('Shahul', 'Es'), a('Jithin', 'James')],
    year: 2023,
    abstract:
      'RAGAS evaluates RAG pipelines without ground-truth answers by scoring faithfulness, answer relevance, and context relevance with LLM judgments, providing a reference framework for automated RAG evaluation.',
    tags: ['rag', 'eval', 'benchmark'],
    collections: ['评测'],
    url: 'https://arxiv.org/abs/2309.15217',
  },
  {
    key: 'truthfulqa',
    title: 'TruthfulQA: Measuring How Models Mimic Human Falsehoods',
    creators: [a('Stephanie', 'Lin'), a('Jacob', 'Hilton')],
    year: 2022,
    abstract:
      'TruthfulQA probes whether models generate truthful answers rather than mimicking popular misconceptions. Its adversarial design exposes knowledge limitations that retrieval augmentation is often proposed to address.',
    tags: ['llm', 'eval', 'benchmark', 'knowledge'],
    collections: ['评测'],
    url: 'https://arxiv.org/abs/2109.07958',
  },
  {
    key: 'milvus',
    title: 'Milvus: A Purpose-Built Vector Data Management System',
    creators: [a('Jianguo', 'Wang'), a('Xiaomeng', 'Yi')],
    year: 2021,
    abstract:
      'Milvus is an open-source vector database with a storage/computation separation architecture, supporting multiple ANN indexes, metadata filtering and hybrid search, and is a common retrieval backend for production RAG systems.',
    tags: ['vector-db', 'database', 'ann', 'rag'],
    collections: ['嵌入与检索'],
    url: 'https://dl.acm.org/doi/10.1145/3448016.3457550',
  },
  {
    key: 'attention',
    title: 'Attention Is All You Need',
    creators: [a('Ashish', 'Vaswani'), a('Noam', 'Shazeer')],
    year: 2017,
    abstract:
      'The Transformer architecture replaces recurrence with self-attention, enabling massively parallel training and becoming the backbone of modern NLP models used across retrieval and generation.',
    tags: ['nlp', 'transformer', 'generation'],
    collections: ['我的必读'],
    url: 'https://arxiv.org/abs/1706.03762',
  },
  {
    key: 'llm-recsys-survey',
    title: 'Large Language Models for Generative Recommendation: A Survey',
    creators: [a('Jizhi', 'Zhang'), a('Keqin', 'Bao')],
    year: 2023,
    abstract:
      'This survey maps how large language models are applied to recommendation, from item-textualization and generative ranking to conversational and retrieval-augmented designs, and analyzes evaluation protocols for generative recommenders.',
    tags: ['llm', 'recommender', 'survey', 'generation'],
    collections: ['RAG 基础'],
    url: 'https://arxiv.org/abs/2305.19860',
  },
])
