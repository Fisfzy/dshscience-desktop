/**
 * Pure derivations for the focus view: one condensed flow over the chat
 * snapshot (consecutive Tool calls fold into expandable groups), per-call row
 * models, card render material, and the assistant thinking duration.
 * Everything here is a pure function of plain snapshot data — the component
 * renders, tests assert.
 */
import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { DiffHunk, ReadBlockLine, SearchBlockProps, WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types';
import { type AssistantBlock, type ChatConversationViewNode, type ContextMessageNode, type ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * Host-computed card render material for one call, mapped onto the shared
 * card primitives (the same family the chat tool rows draw). Null = the
 * generic sections (args + result text) render instead.
 */
export type FocusCard = {
    kind: 'terminal';
    command: string;
    cwd: string | undefined;
    output: string | undefined;
    exitCode: number | undefined;
    signal: string | undefined;
    running: boolean;
    description: string | undefined;
} | {
    kind: 'diff';
    diffs: DiffHunk[];
} | {
    kind: 'read';
    label: string;
    lines: ReadBlockLine[];
    totalLines: number;
    lang: string | undefined;
} | {
    kind: 'search';
    props: SearchBlockProps;
    recovery: string | undefined;
    title: string | undefined;
} | {
    kind: 'web';
    props: WebBlockProps;
};
/** Tool-row state semantics; colors self-supplied by the view. */
export type FocusToolState = 'running' | 'ok' | 'error' | 'stopped';
/** Tool-call row variants selected by the generic renderer (the chat table). */
export type FocusToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others';
/** One Tool call's condensed row model, derived from the frozen block. */
export interface FocusToolRow {
    callId: string;
    /** Wire Tool name ('' when the window dropped the call head). */
    name: string;
    /** Row variant (the chat row's classification). */
    variant: FocusToolVariant;
    /** Row title: the tool-owned or variant design literal (the chat row's). */
    title: string;
    /** Args-derived one-line summary (falls back to the call id). */
    summary: string;
    /** Filesystem path from args for single-file tools; undefined otherwise. */
    filePath: string | undefined;
    state: FocusToolState;
    /** Flattened result text; null while running or when the result has none. */
    output: string | null;
    /** First result line on an error row; null otherwise. */
    errorSummary: string | null;
    /** Expanded-body input text (pretty args); null = no input section. */
    body: string | null;
    /** Card render material from the host-computed views; null = generic sections. */
    card: FocusCard | null;
    /** Recursive child rows (the sub-call tree), in dispatch order. */
    subcalls: readonly FocusToolRow[];
}
/** One reasoning row absorbed into a tool group (the chat Think disclosure). */
export interface FocusGroupThink {
    /** Complete or streaming reasoning text. */
    text: string;
    /** Whether the reasoning is still the streaming tail (sweep + tail preview). */
    running: boolean;
}
/** One folded row inside a tool group: an absorbed context row, an absorbed
 *  Think row, or a call. */
export type FocusGroupItem = FocusContextItem | FocusGroupThink | FocusToolRow;
/** Step-summary metric families the group line aggregates, in display order. */
export type FocusMetricKey = 'commands' | 'edits' | 'searches' | 'files' | 'dirs';
/** Per-family call counts and their error rows ("Ran N commands (M failed)"). */
export interface FocusGroupMetrics {
    commands: number;
    edits: number;
    searches: number;
    files: number;
    dirs: number;
    /** Failed calls in the failure-aware families (error-state rows). */
    commandsFailed: number;
    editsFailed: number;
    searchesFailed: number;
}
/** One focus-mode group: the consecutive root calls folded into a summary line. */
export interface FocusToolGroup {
    /** Chat node keys of the folded roots, in flow order. */
    nodeKeys: readonly string[];
    /** Folded rows in flow order: the absorbed context rows, Think rows, and the calls. */
    items: readonly FocusGroupItem[];
    /** Whether any folded call is still running. */
    running: boolean;
    /** Per-family call counts, with failure tallies for the failure-aware families. */
    metrics: FocusGroupMetrics;
    /** Context injections directly preceding the run, absorbed into the group. */
    contextCount: number;
    context: readonly FocusContextItem[];
    /**
     * Thinking time of the runs folded into this group, summed when every run
     * carries timing (the group merges directly-consecutive runs); null when
     * unavailable.
     */
    thoughtMs: number | null;
}
/** One context-injection message row (the chat ContextInjectionRow chrome). */
export type FocusContextItem = Extract<FocusFlowItem, {
    kind: 'message';
}> & {
    role: 'context';
};
/** One condensed flow row; the view dispatches on `kind`. */
export type FocusFlowItem = {
    kind: 'message';
    nodeKey: string;
    role: 'user' | 'steering' | 'context';
    content: readonly ContentBlock[];
    time: number;
    /** Context-injection chrome (the chat ContextInjectionRow); absent for user/steering. */
    context?: {
        source: ContextMessageNode['source'];
        provenance: ContextMessageNode['provenance'];
        form: ContextMessageNode['form'];
    };
} | {
    /**
     * One running turn's context batch: consecutive context injections
     * folded into a single line while the turn is open (a completed turn
     * folds them individually into the turn fold instead).
     */
    kind: 'context-fold';
    nodeKey: string;
    turn: number | null;
    /** The merged context messages, in flow order. */
    items: readonly FocusContextItem[];
} | {
    kind: 'assistant';
    nodeKey: string;
    /** Remaining blocks; reasoning absorbed into a directly-following tool group is filtered out. */
    blocks: readonly AssistantBlock[];
    running: boolean;
    interrupted: boolean;
    thoughtMs: number | null;
    /** Settled assistant seq; null while streaming. */
    finalSeq: number | null;
} | {
    kind: 'tools';
    group: FocusToolGroup;
} | {
    kind: 'turn-fold';
    nodeKey: string;
    turn: number;
    /** Turn wall time (start → end); the "工作了 X 分 Y 秒" reading. */
    durationMs: number;
    /** The user stopped the turn: the line reads "用户 X 后停止" instead. */
    stopped: boolean;
    /** The turn's folded rows — intermediate assistant items and tool runs — in flow order. */
    items: readonly FocusFlowItem[];
} | {
    kind: 'turn-tail';
    nodeKey: string;
    turn: number;
    /** Closing assistant seq — the fork anchor; null when the turn ended without one. */
    closingSeq: number | null;
    /** Closing assistant time (the actions clock). */
    closingTime: number | null;
    /** Text of the closing assistant (the copy source). */
    closingText: string;
    /** Turn wall time for the `· Ran for Ns` reading. */
    runMs: number | null;
    /** Turn first-step TTFT in ms, when recorded. */
    ttftMs: number | null;
    /** Turn decode throughput, when recorded. */
    tokensPerSecond: number | null;
    /** Whether fork is unavailable (engine-computed; mirrors the chat tail). */
    branchUnavailable: boolean;
    /** Files produced by the closing turn, in first-seen order. */
    produced: readonly string[];
} | {
    kind: 'command';
    nodeKey: string;
    name: string | null;
    args: string | null;
    outcomeText: string | null;
    outcomeError: boolean;
    running: boolean;
} | {
    kind: 'manual-compaction';
    nodeKey: string;
    name: string | null;
    outcomeText: string | null;
    running: boolean;
    compaction: {
        summary: string | null;
        shadowedItemCount: number | null;
        shadowedTokenCount: number | null;
    } | null;
} | {
    kind: 'compaction';
    nodeKey: string;
    summary: string | null;
    shadowedItemCount: number | null;
    shadowedTokenCount: number | null;
} | {
    kind: 'retry';
    nodeKey: string;
    delayMs: number;
    retry: number;
    /** 'always' retries never exhaust; the chat row shows ∞. */
    maxRetries: number | null;
    mode: 'normal' | 'always';
    retryState: 'scheduled' | 'started' | 'cancelled';
    failure: {
        message: string;
    } | null;
} | {
    kind: 'turn-error';
    nodeKey: string;
    message: string;
    code: string | undefined;
} | {
    kind: 'unknown';
    nodeKey: string;
    nodeKind: string;
    data: unknown;
};
declare module '@deepseek-ai/dsh-client-runtime/client' {
    interface ConversationTurnDataMap {
        /** Successful mutation paths accumulated in this turn (the ui-deliverables contract). */
        deliverables: FocusDeliverablesData;
    }
}
/** One produced-path fact (the ui-deliverables turn data contract). */
interface FocusDeliverablesData {
    readonly produced: readonly {
        readonly seq: number;
        readonly path: string;
    }[];
}
/**
 * Strip the workspace root from a workspace-rooted absolute path (display
 * only, mirroring the chat tool rows).
 * @param text - the path to shorten.
 * @param cwd - session workspace root; absent or empty leaves the text unchanged.
 * @returns the text relative to the workspace root, or unchanged.
 */
export declare function relativizeToCwd(text: string, cwd: string | undefined): string;
/** Concatenate text content blocks (the result body the row expands to). */
export declare function flattenText(content: readonly ContentBlock[]): string;
/**
 * Derive the condensed row model from a frozen call slice (the chat row
 * model's derivation, reimplemented here).
 * @param block - running call or settled result node.
 * @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
 * @returns the row model.
 */
export declare function toolRowModel(block: ToolCallBlock, cwd?: string): FocusToolRow;
/**
 * Build the condensed flow over the chat snapshot: consecutive `tool-call`
 * nodes fold into one group per run, and directly-consecutive runs merge
 * into a single group. A completed turn (its wall duration known) folds
 * everything except the closing assistant's reply — every intermediate
 * assistant row and tool run — into one `工作了 X 分 Y 秒` line, keeping the
 * running turn unfolded. Stale keys (node vanished from the live store) are
 * dropped.
 * @param order - snapshot chat order (stable node keys).
 * @param getNode - snapshot chat node reader.
 * @param cwd - session workspace root for relative path summaries.
 * @returns the condensed flow in order.
 */
export declare function buildFocusFlow(order: readonly string[], getNode: (key: string) => ChatConversationViewNode | undefined, cwd?: string): FocusFlowItem[];
/**
 * Assistant thinking duration: time from the step's start to its first
 * non-empty token delta. Only meaningful once the step is settled; null
 * when the timing boundaries are unavailable.
 * @param data - the assistant chat node data.
 * @returns thinking time in ms, or null when not derivable.
 */
export declare function thoughtDurationMs(data: AssistantChatData): number | null;
/**
 * Display seconds for a duration: one decimal under ten seconds, whole
 * seconds beyond. Unit-less so the locale templates own the suffix.
 * @param ms - Duration in milliseconds (negatives clamp to zero).
 * @returns display number in seconds without unit.
 */
export declare function formatSeconds(ms: number): string;
export {};
