/**
 * Evaluation dataset for the sample library.
 *
 * Each query lists the papers a good retrieval system should surface
 * (hand-labeled ground truth against the 14 built-in papers). Query types
 * deliberately mix:
 *   - direct  — query paraphrases a title (tests hop-0 anchor)
 *   - topic   — query names a research area (tests tag-river recall)
 *   - graph   — answer lives 1-2 hops away in the relation graph
 *   - cross   — spans distant domains (tests wormhole jumps)
 */

export interface EvalCase {
  id: string
  query: string
  type: 'direct' | 'topic' | 'graph' | 'cross'
  relevant: string[]
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'e01',
    query: 'retrieval augmented generation survey for knowledge intensive tasks',
    type: 'topic',
    relevant: ['rag-survey', 'rag-recsys-survey', 'rag-eval'],
  },
  {
    id: 'e02',
    query: 'dense passage retrieval for open domain question answering',
    type: 'direct',
    relevant: ['dpr', 'natural-questions'],
  },
  {
    id: 'e03',
    query: 'graph based retrieval augmented generation with communities',
    type: 'graph',
    relevant: ['graphrag', 'lightrag'],
  },
  {
    id: 'e04',
    query: 'vector databases and approximate nearest neighbor indexes',
    type: 'topic',
    relevant: ['vector-db-survey', 'ann-survey'],
  },
  {
    id: 'e05',
    query: 'survey of knowledge graph embeddings for link prediction',
    type: 'direct',
    relevant: ['kg-embeddings'],
  },
  {
    id: 'e06',
    query: 'contrastive learning of sentence embeddings',
    type: 'direct',
    relevant: ['simcse'],
  },
  {
    id: 'e07',
    query: 'language model agents with long term memory and tool use',
    type: 'topic',
    relevant: ['memorybank', 'toolformer'],
  },
  {
    id: 'e08',
    query: 'benchmarks for evaluating llms and retrieval augmented generation',
    type: 'topic',
    relevant: ['rag-eval', 'mmlu', 'natural-questions'],
  },
  {
    id: 'e09',
    query: 'how do knowledge graphs connect to retrieval augmentation pipelines',
    type: 'cross',
    relevant: ['graphrag', 'kg-embeddings', 'lightrag'],
  },
  {
    id: 'e10',
    query: 'large language models for conversational product recommendations',
    type: 'graph',
    relevant: ['rag-recsys-survey'],
  },
  {
    id: 'e11',
    query: 'natural questions benchmark for question answering research',
    type: 'direct',
    relevant: ['natural-questions', 'dpr'],
  },
  {
    id: 'e12',
    query: 'which papers cover embedding methods in nlp',
    type: 'topic',
    relevant: ['simcse', 'kg-embeddings'],
  },
  {
    id: 'e13',
    query: 'teaching language models to call external tools like calculators',
    type: 'direct',
    relevant: ['toolformer'],
  },
  {
    id: 'e14',
    query: 'memory augmented conversational agents that remember sessions',
    type: 'graph',
    relevant: ['memorybank'],
  },
  {
    id: 'e15',
    query: 'rag evaluation robustness to noisy retrieved contexts',
    type: 'graph',
    relevant: ['rag-eval', 'rag-survey'],
  },
  {
    id: 'e16',
    query: 'hnsw graph index for fast approximate similarity search',
    type: 'graph',
    relevant: ['ann-survey', 'vector-db-survey'],
  },
  {
    id: 'e17',
    query: 'retrieval indexes spanning both graphs and vector stores',
    type: 'cross',
    relevant: ['lightrag', 'ann-survey', 'vector-db-survey'],
  },
  {
    id: 'e18',
    query: 'late interaction token level passage search with contextual embeddings',
    type: 'direct',
    relevant: ['colbert'],
  },
  {
    id: 'e19',
    query: 'grounding large language models in knowledge graphs for question answering',
    type: 'cross',
    relevant: ['kg-rag', 'graphrag', 'kg-embeddings'],
  },
  {
    id: 'e20',
    query: 'agents that interleave reasoning traces with tool actions and reflect on failures',
    type: 'topic',
    relevant: ['react', 'reflexion', 'toolformer'],
  },
  {
    id: 'e21',
    query: 'automated faithfulness and relevance metrics for rag pipelines',
    type: 'graph',
    relevant: ['ragas', 'rag-eval'],
  },
  {
    id: 'e22',
    query: 'generative recommendation with large language models',
    type: 'direct',
    relevant: ['llm-recsys-survey', 'rag-recsys-survey'],
  },
]
