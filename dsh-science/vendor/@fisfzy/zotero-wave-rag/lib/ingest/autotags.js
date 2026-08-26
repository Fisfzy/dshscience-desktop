/**
 * Tag bootstrapping — machine-derived topic tags.
 *
 * The real library is almost untagged (311 papers, 1 tagged), which starves
 * the wave engine's "tag river" channel. `deriveAutoTags` extracts lexicon
 * terms that appear in the title/abstract and returns them as `autoTags`
 * (separate from user `tags` — user tags stay authoritative; autoTags only
 * feed the graph and BM25, never the detail card).
 */
/** Curated domain lexicon (mechanics / composites / peridynamics / AI). */
export const AUTO_TAG_LEXICON = [
    'peridynamics', '近场动力学', 'nonlocal', '非局部',
    'delamination', '分层', 'crack', '裂纹', 'fracture', '断裂', 'damage', '损伤',
    'buckling', '屈曲', 'postbuckling', '后屈曲',
    'coupling', '耦合', 'laminate', '层合板', 'composite', '复合材料',
    'cohesive', '粘聚力', 'interface', '界面', 'interlaminar', '层间',
    'energy release rate', '应力强度因子', 'fatigue', '疲劳', 'impact', '冲击',
    'thermal', 'moisture', '湿度', 'residual stress', '残余应力',
    'finite element', '有限元', 'numerical', '数值', 'experimental', '试验',
    'optimization', '优化', 'machine learning', '机器学习', 'neural network', '神经网络',
    'deep learning', '深度学习', 'constitutive', '本构', 'vibration', '振动',
    'concrete', '混凝土', 'rock', '岩石', 'polymer', '聚合物', 'fiber', '纤维',
    'graphene', '石墨烯', 'carbon', '碳', 'metal', '金属', 'shell', '壳',
    'plate', '板', 'beam', '梁', 'structural', '结构',
];
/** Type-classification keyword scores (title+abstract, case-insensitive). */
const METHOD_TYPE_KEYWORDS = {
    experimental: [
        ['experimental', 3], ['experiment', 3], ['measured', 2], ['measurements', 2],
        ['astm', 2], ['specimen', 1], ['specimens', 1], ['试验', 3], ['实验', 3], ['测试', 2], ['试件', 1], ['实测', 2],
    ],
    numerical: [
        ['numerical', 3], ['finite element', 3], ['fem', 2], ['simulation', 2], ['simulated', 2],
        ['computational', 2], ['variational', 2], ['model', 1], ['modelling', 2], ['modeling', 2],
        ['abaqus', 2], ['ansys', 2], ['数值', 3], ['模拟', 2], ['有限元', 3], ['模型', 1],
    ],
    analytical: [
        ['analytical', 3], ['theoretical', 3], ['closed-form', 2], ['derivation', 2], ['derived', 1],
        ['解析', 3], ['理论', 2], ['推导', 2], ['公式', 1],
    ],
    review: [
        ['review', 3], ['survey', 3], ['state of the art', 2], ['综述', 3], ['回顾', 2], ['进展', 1],
    ],
};
/**
 * Classify a paper by research method (P0-1 lesson: "试验" queries must not
 * surface pure model papers). Scoring on title+abstract; highest score wins,
 * ties -> mixed.
 */
export function deriveMethodType(paper) {
    const hay = `${paper.title} ${paper.abstract ?? ''}`.toLowerCase();
    let best = 'unknown';
    let bestScore = 0;
    let tie = false;
    for (const [type, kws] of Object.entries(METHOD_TYPE_KEYWORDS)) {
        let score = 0;
        for (const [kw, w] of kws) {
            if (hay.includes(kw))
                score += w;
        }
        if (score > bestScore) {
            bestScore = score;
            best = type;
            tie = false;
        }
        else if (score === bestScore && score > 0) {
            tie = true;
        }
    }
    return tie ? 'mixed' : best;
}
/**
 * Derive auto tags for one paper: lexicon terms found verbatim in the
 * title/abstract (case-insensitive for latin). Cap at 6, longest first.
 */
export function deriveAutoTags(paper, lexicon = AUTO_TAG_LEXICON) {
    const hay = `${paper.title} ${paper.abstract ?? ''}`.toLowerCase();
    const found = [];
    for (const term of lexicon) {
        if (hay.includes(term.toLowerCase()))
            found.push({ term, len: term.length });
    }
    found.sort((a, b) => b.len - a.len);
    return [...new Set(found.map((f) => f.term))].slice(0, 6);
}
