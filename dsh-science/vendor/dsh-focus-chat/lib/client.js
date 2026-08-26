window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-focus-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/focus-model.ts
		/** Tool name → metric family; unknown tools carry no metric. Writes fold
		*  into the edit family (the summary line reads one "edited" segment). */
		const METRIC_BY_TOOL = {
			bash: "commands",
			pwsh: "commands",
			sh: "commands",
			cmd: "commands",
			terminal: "commands",
			shell: "commands",
			write: "edits",
			save: "edits",
			edit: "edits",
			replace: "edits",
			patch: "edits",
			apply_patch: "edits",
			web_search: "searches",
			grep: "searches",
			search: "searches",
			read: "files",
			glob: "dirs"
		};
		/** Concatenated text blocks of an assistant step (the chat copy source). */
		function assistantText(blocks) {
			return blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("");
		}
		/**
		* Files one closing assistant produced: mutation paths settled at or before
		* the closing seq, in first-seen order, deduped (the ui-deliverables
		* derivation, reimplemented here).
		* @param data - engine-published deliverables for one turn.
		* @param seq - closing assistant seq; later tool settlements are excluded.
		* @returns produced paths in first-seen order; empty when the turn wrote nothing.
		*/
		function producedForClosing(data, seq) {
			if (data === void 0) return [];
			const paths = [];
			const seen = /* @__PURE__ */ new Set();
			for (const produced of data.produced) {
				if (produced.seq > seq || seen.has(produced.path)) continue;
				seen.add(produced.path);
				paths.push(produced.path);
			}
			return paths;
		}
		/**
		* Resolve a terminal view's working directory the way the render-intent
		* contract assigns to the UI bridge: an absolute path is used as-is, a
		* relative one joins under the session workspace, and an omitted one IS the
		* session workspace (the chat derivation). Without a session cwd there is
		* nothing to resolve against, so a relative path stays as authored.
		* @param viewCwd - the cwd the terminal call view carries, if any.
		* @param sessionCwd - the session workspace root, if the caller knows it.
		* @returns the working directory for the prompt label, or undefined.
		*/
		function resolveTerminalCwd(viewCwd, sessionCwd) {
			if (viewCwd === void 0 || viewCwd === "") return sessionCwd;
			if (sessionCwd === void 0 || sessionCwd === "") return normalizeSegments(viewCwd);
			return normalizeSegments((0, _deepseek_ai_dsh_client_runtime_client.resolveWorkspacePath)(sessionCwd, viewCwd));
		}
		/**
		* Collapse `.` and `..` segments so the prompt label names the directory the
		* command actually ran in (the chat derivation). Separators are preserved as
		* authored; a `..` that would climb past the root is dropped, and a UNC
		* path's server and share are not poppable segments.
		*/
		function normalizeSegments(path) {
			if (!/(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(path)) return path;
			const unc = /^[/\\]{2}([^/\\]+)[/\\]+([^/\\]+)/.exec(path);
			if (unc !== null) {
				const [matched, server, share] = unc;
				const root = `\\\\${String(server)}\\${String(share)}`;
				const rest = collapse(path.slice(matched.length), true);
				return rest === "" ? root : `${root}\\${rest}`;
			}
			const separator = !(path.includes("\\") && !path.includes("/")) ? "/" : "\\";
			const rooted = /^[/\\]/.test(path);
			const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? "";
			const body = collapse(path.slice(drive.length), rooted || drive !== "", separator);
			const leading = rooted ? separator : "";
			return drive === "" ? `${leading}${body}` : `${drive}${rooted ? leading : separator}${body}`;
		}
		/** Collapse the `.`/`..` segments of a path body against a known root state. */
		function collapse(body, rooted, separator = "/") {
			const kept = [];
			for (const segment of body.split(/[/\\]/)) {
				if (segment === "" || segment === ".") continue;
				if (segment === "..") {
					if (kept.length > 0 && kept[kept.length - 1] !== "..") kept.pop();
					else if (!rooted) kept.push(segment);
					continue;
				}
				kept.push(segment);
			}
			return kept.join(separator);
		}
		/** First line of a multi-line string; the text itself when single-line. */
		function firstLine$1(text) {
			const nl = text.indexOf("\n");
			return nl === -1 ? text : text.slice(0, nl);
		}
		/** Parse args as JSON; undefined when empty or not JSON (mid-stream truncation). */
		function parseArgs(raw) {
			if (raw === "") return void 0;
			try {
				return JSON.parse(raw);
			} catch {
				return;
			}
		}
		/** Summary-key preference per variant (the chat row's table; args-derived). */
		const SUMMARY_KEYS = {
			bash: ["description", "command"],
			read: [
				"path",
				"file_path",
				"url"
			],
			search: [
				"query",
				"pattern",
				"url"
			],
			write: ["path", "file_path"],
			edit: ["path", "file_path"],
			code: ["description"],
			others: []
		};
		/** Figma row titles per variant (design literals, not translatable copy). */
		const VARIANT_TITLES = {
			search: "Search",
			read: "Read",
			bash: "Bash",
			write: "Write",
			edit: "Edit",
			code: "Code",
			others: "Tool call"
		};
		/** Known tool name → row variant (the chat row's classification). */
		const TOOL_VARIANTS$1 = {
			bash: "bash",
			pwsh: "bash",
			read: "read",
			web_fetch: "read",
			web_search: "search",
			grep: "search",
			glob: "search",
			write: "write",
			edit: "edit",
			run_code: "code",
			cordis_inspect: "read",
			cordis_mount: "code",
			cordis_unmount: "others"
		};
		/** Tool-owned titles that refine a generic row variant without replacing it. */
		const TOOL_TITLES = {
			cordis_inspect: "Inspect",
			cordis_mount: "Mount temporary Plugin",
			cordis_unmount: "Unmount temporary Plugin",
			pwsh: "Pwsh"
		};
		/** Path keys only — never `url` (web_fetch lands on the read variant). */
		const FILE_PATH_KEYS = ["path", "file_path"];
		/** File-tool variants whose summary may be an openable workspace path. */
		const FILE_PATH_VARIANTS = new Set([
			"read",
			"write",
			"edit"
		]);
		/** One-line args summary: preferred key, first string value, then the raw first line. */
		function deriveSummary(variant, raw) {
			if (raw === "") return "";
			const parsed = parseArgs(raw);
			if (typeof parsed !== "object" || parsed === null) return firstLine$1(raw);
			const args = parsed;
			for (const key of SUMMARY_KEYS[variant]) {
				const value = args[key];
				if (typeof value === "string" && value !== "") return firstLine$1(value);
			}
			for (const value of Object.values(args)) if (typeof value === "string" && value !== "") return firstLine$1(value);
			return firstLine$1(raw);
		}
		/** Filesystem path from args for a file-tool row; undefined for URL reads and non-file tools. */
		function deriveFilePath(variant, raw) {
			if (!FILE_PATH_VARIANTS.has(variant)) return void 0;
			const parsed = parseArgs(raw);
			if (typeof parsed !== "object" || parsed === null) return void 0;
			for (const key of FILE_PATH_KEYS) {
				const value = parsed[key];
				if (typeof value === "string" && value !== "") return firstLine$1(value);
			}
		}
		/** Expanded-body input text: the run_code program, or pretty args; null with no args. */
		function deriveBody(variant, raw) {
			if (raw === "") return null;
			const parsed = parseArgs(raw);
			if (parsed === void 0) return raw;
			if (variant === "code" && typeof parsed === "object" && parsed !== null) {
				const code = parsed.code;
				if (typeof code === "string" && code !== "") return code;
			}
			return JSON.stringify(parsed, null, 2);
		}
		/**
		* Flatten a settled result's content blocks to display text: text blocks
		* verbatim, other block shapes as pretty JSON. Empty content on a failed call
		* falls back to the structured error's `name: code` line (the chat derivation).
		* @param node - the settled result node.
		* @returns the flattened result text (may be empty).
		*/
		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(`${node.error.name}: ${node.error.code}`);
			return parts.join("\n");
		}
		/**
		* Strip the workspace root from a workspace-rooted absolute path (display
		* only, mirroring the chat tool rows).
		* @param text - the path to shorten.
		* @param cwd - session workspace root; absent or empty leaves the text unchanged.
		* @returns the text relative to the workspace root, or unchanged.
		*/
		function relativizeToCwd(text, cwd) {
			if (cwd === void 0 || cwd === "") return text;
			const root = cwd.replace(/[/\\]+$/, "");
			if (text.startsWith(`${root}/`) || text.startsWith(`${root}\\`)) return text.slice(root.length + 1);
			return text;
		}
		/** Concatenate text content blocks (the result body the row expands to). */
		function flattenText(content) {
			return content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
		}
		/**
		* Derive the card render material from the host-computed call/result views
		* (the render-intent contract the tools declare), mapped onto the shared card
		* primitives the chat tool rows use. The completed view wins; a running
		* terminal/diff call renders its pending card.
		* @param block - running call or settled result node.
		* @param cwd - session workspace root for terminal cwd resolution.
		* @returns the card material, or null for the generic sections.
		*/
		function cardOf(block, cwd) {
			if ("kind" in block) {
				const result = block.resultView;
				if (result === null) return null;
				switch (result.card) {
					case "terminal": {
						const call = block.callView?.card === "terminal" ? block.callView : null;
						return {
							kind: "terminal",
							command: result.title ?? call?.title ?? "",
							cwd: call === null ? void 0 : resolveTerminalCwd(call.cwd, cwd),
							output: result.output,
							exitCode: result.exitCode,
							signal: result.signal,
							running: false,
							description: call?.description
						};
					}
					case "diff": return {
						kind: "diff",
						diffs: result.diffs
					};
					case "read": return {
						kind: "read",
						label: result.title ?? result.path,
						lines: result.lines,
						totalLines: result.totalLines,
						lang: result.lang
					};
					case "search": {
						const recovery = result.truncated ? flattenText(block.content) : void 0;
						return result.shape === "matches" ? {
							kind: "search",
							props: {
								kind: "matches",
								files: result.files,
								truncated: result.truncated,
								total: result.total
							},
							recovery,
							title: result.title
						} : {
							kind: "search",
							props: {
								kind: "paths",
								paths: result.paths,
								truncated: result.truncated,
								total: result.total
							},
							recovery,
							title: result.title
						};
					}
					case "web": return result.kind === "search" ? {
						kind: "web",
						props: {
							kind: "search",
							answer: result.answer,
							sources: result.sources,
							truncated: result.truncated
						}
					} : {
						kind: "web",
						props: {
							kind: "fetch",
							url: result.url,
							statusCode: result.statusCode,
							truncated: result.truncated
						}
					};
					default: return null;
				}
			}
			const call = block.callView;
			if (call === null) return null;
			switch (call.card) {
				case "terminal": return {
					kind: "terminal",
					command: call.title,
					cwd: resolveTerminalCwd(call.cwd, cwd),
					output: void 0,
					exitCode: void 0,
					signal: void 0,
					running: true,
					description: call.description
				};
				case "diff": return {
					kind: "diff",
					diffs: call.diffs
				};
				default: return null;
			}
		}
		/**
		* Derive the condensed row model from a frozen call slice (the chat row
		* model's derivation, reimplemented here).
		* @param block - running call or settled result node.
		* @param cwd - session workspace root; workspace-rooted path summaries display relative to it.
		* @returns the row model.
		*/
		function toolRowModel(block, cwd) {
			const done = "kind" in block;
			const name = done ? block.call?.name ?? "" : block.name;
			const argsRaw = done ? block.call?.argsRaw ?? "" : block.argsRaw;
			const state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";
			const variant = TOOL_VARIANTS$1[name] ?? "others";
			const output = done ? resultText(block) || null : null;
			const errorSummary = state === "error" && output !== null ? firstLine$1(output) : null;
			const base = argsRaw === "" ? block.callId : relativizeToCwd(deriveSummary(variant, argsRaw), cwd);
			const toolTitle = TOOL_TITLES[name];
			const baseSummary = variant === "others" && name !== "" && toolTitle === void 0 ? `${name} · ${base}` : base;
			const card = cardOf(block, cwd);
			const summary = card?.kind === "terminal" && card.description !== void 0 ? card.description : card?.kind === "search" && card.title !== void 0 ? card.title : baseSummary;
			const terminalFailed = card?.kind === "terminal" && !card.running && (card.exitCode !== void 0 && card.exitCode !== 0 || card.signal !== void 0);
			const rowState = state === "ok" && terminalFailed ? "error" : state;
			return {
				callId: block.callId,
				name,
				variant,
				title: toolTitle ?? VARIANT_TITLES[variant],
				summary,
				filePath: deriveFilePath(variant, argsRaw),
				state: rowState,
				output,
				errorSummary,
				body: deriveBody(variant, argsRaw),
				card,
				subcalls: block.subCalls.map((child) => toolRowModel(child, cwd))
			};
		}
		/** Fold one consecutive run of root calls into a group model. */
		function toolGroup(blocks, cwd, thoughtMs, think) {
			const rows = blocks.map((block) => toolRowModel(block, cwd));
			const running = rows.some((row) => row.state === "running");
			const metrics = {
				commands: 0,
				edits: 0,
				searches: 0,
				files: 0,
				dirs: 0,
				commandsFailed: 0,
				editsFailed: 0,
				searchesFailed: 0
			};
			for (const row of rows) {
				if (row.state === "running") continue;
				const key = METRIC_BY_TOOL[row.name];
				if (key === void 0) continue;
				metrics[key] += 1;
				if (row.state === "error" && (key === "commands" || key === "searches" || key === "edits")) if (key === "commands") metrics.commandsFailed += 1;
				else if (key === "searches") metrics.searchesFailed += 1;
				else metrics.editsFailed += 1;
			}
			return {
				nodeKeys: [],
				items: [...think, ...rows],
				running,
				metrics,
				thoughtMs,
				contextCount: 0,
				context: []
			};
		}
		/** Resolve one node's data into the flow item family, or null to skip (turn-tail chrome). */
		function flowItemOf(key, node, data) {
			switch (node.kind) {
				case "user":
				case "steering":
				case "context": {
					const message = data;
					const base = {
						kind: "message",
						nodeKey: key,
						role: node.kind,
						content: message.content,
						time: message.time
					};
					if (node.kind !== "context") return base;
					const context = message;
					return {
						...base,
						context: {
							source: context.source,
							provenance: context.provenance,
							form: context.form
						}
					};
				}
				case "assistant-step": {
					const assistant = data;
					return {
						kind: "assistant",
						nodeKey: key,
						blocks: assistant.blocks,
						running: assistant.status === "running",
						interrupted: assistant.status === "interrupted",
						thoughtMs: thoughtDurationMs(assistant),
						finalSeq: assistant.finalNode?.seq ?? null
					};
				}
				/* v8 ignore next 2 -- unreachable: buildFocusFlow folds tool-call nodes before flowItemOf dispatch */
				case "tool-call": return null;
				case "command": {
					const command = data;
					const outcome = command.outcome;
					return {
						kind: "command",
						nodeKey: key,
						name: command.name,
						args: command.args,
						outcomeText: outcome === null ? null : outcome.text ?? null,
						outcomeError: outcome !== null && outcome.kind === "error",
						running: outcome === null
					};
				}
				case "manual-compaction": {
					const manual = data;
					const command = manual.command;
					const outcome = command.outcome;
					return {
						kind: "manual-compaction",
						nodeKey: key,
						name: command.name,
						outcomeText: outcome === null ? null : outcome.text ?? null,
						running: outcome === null,
						compaction: manual.compaction === null ? null : {
							summary: manual.compaction.summary,
							shadowedItemCount: manual.compaction.shadowedItemCount,
							shadowedTokenCount: manual.compaction.shadowedTokenCount
						}
					};
				}
				case "compaction": {
					const compaction = data;
					return {
						kind: "compaction",
						nodeKey: key,
						summary: compaction.summary,
						shadowedItemCount: compaction.shadowedItemCount,
						shadowedTokenCount: compaction.shadowedTokenCount
					};
				}
				case "model-retry": {
					const retry = data.current;
					return {
						kind: "retry",
						nodeKey: key,
						delayMs: retry.delayMs,
						retry: retry.retry,
						maxRetries: retry.mode === "normal" ? retry.maxRetries ?? null : null,
						mode: retry.mode,
						retryState: retry.retryState,
						failure: retry.failure === void 0 || retry.failure === null ? null : { message: retry.failure.message ?? "" }
					};
				}
				case "turn-error": {
					const error = data;
					return {
						kind: "turn-error",
						nodeKey: key,
						message: error.message,
						code: error.code
					};
				}
				case "turn-tail": {
					const tail = data;
					const location = node.location;
					const turn = location.kind === "turn" || location.kind === "step" ? location.turn : void 0;
					const closing = tail.closing;
					const runMs = turn === void 0 || turn.start === void 0 || turn.end === void 0 ? null : Math.max(0, turn.end.time - turn.start.time);
					const produced = producedForClosing(turn?.data.get("deliverables"), closing?.finalNode.seq ?? tail.seq);
					return {
						kind: "turn-tail",
						nodeKey: key,
						turn: tail.turn,
						closingSeq: closing?.finalNode.seq ?? null,
						closingTime: closing?.time ?? null,
						closingText: closing === null ? "" : assistantText(closing.blocks),
						runMs,
						ttftMs: tail.ttftMs ?? null,
						tokensPerSecond: tail.tokensPerSecond ?? null,
						branchUnavailable: tail.branchUnavailable,
						produced
					};
				}
				default: return {
					kind: "unknown",
					nodeKey: key,
					nodeKind: node.kind,
					data
				};
			}
		}
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
		function buildFocusFlow(order, getNode, cwd) {
			const nodeTurn = /* @__PURE__ */ new Map();
			const turnPlans = /* @__PURE__ */ new Map();
			for (const key of order) {
				const node = getNode(key);
				if (node === void 0 || node.visibility === "hidden") continue;
				const location = node.location;
				const turn = location.kind === "turn" || location.kind === "step" ? location.turn : void 0;
				if (turn === void 0) continue;
				nodeTurn.set(key, turn.turn);
				const plan = turnPlans.get(turn.turn);
				if (plan === void 0) turnPlans.set(turn.turn, {
					durationMs: turn.start !== void 0 && turn.end !== void 0 ? Math.max(0, turn.end.time - turn.start.time) : null,
					closingKey: node.kind === "assistant-step" && assistantHasText(node.data) ? key : null,
					startTime: turn.start?.time ?? null,
					endTime: turn.end?.time ?? null,
					stopped: stepInterrupted(node)
				});
				else {
					if (node.kind === "assistant-step" && assistantHasText(node.data)) plan.closingKey = key;
					if (stepInterrupted(node)) plan.stopped = true;
				}
			}
			const flow = [];
			let pending = null;
			/** Turn-fold buffer: assistant rows and tool runs of the current completed
			*  turn segment (a mid-way interjection closes the segment). */
			let pendingFoldTurn = null;
			let pendingFold = [];
			/** The buffered segment's wall-clock start: the turn start, or the previous
			*  interjection's time — the segment's worked duration reads end − start. */
			let pendingFoldStart = null;
			/** Running-turn context batch: consecutive context injections merge into
			*  one collapsed line while the turn is open (a completed turn folds them
			*  individually into the turn fold instead). */
			let pendingContextTurn = void 0;
			let pendingContext = [];
			const keyOf = (item) => item.kind === "tools" ? item.group.nodeKeys[0] ?? "tools" : item.nodeKey;
			/** Emit the buffered rows as one `工作了 X 分 Y 秒` line. The duration
			*  reads `end − segmentStart` — a mid-way interjection passes its own time
			*  as the end, so each stretch between two interjections carries its own
			*  worked duration; a null end falls back to the turn's total wall time. A
			*  duration-less window cut renders the rows unfolded rather than a
			*  meaningless line. */
			const flushFold = (end) => {
				const turnId = pendingFoldTurn;
				pendingFoldTurn = null;
				const start = pendingFoldStart;
				pendingFoldStart = null;
				const folded = pendingFold;
				pendingFold = [];
				if (turnId === null || folded.length === 0) return;
				const plan = turnPlans.get(turnId);
				const endTime = end ?? plan?.endTime ?? null;
				const durationMs = start !== null && endTime !== null ? Math.max(0, endTime - start) : plan?.durationMs ?? null;
				if (durationMs === null) {
					for (const item of folded) flow.push(item);
					return;
				}
				flow.push({
					kind: "turn-fold",
					nodeKey: keyOf(folded[0]),
					turn: turnId,
					durationMs,
					stopped: plan?.stopped ?? false,
					items: folded
				});
			};
			/** Emit the buffered running-turn context batch as one collapsed line. */
			const flushContext = () => {
				if (pendingContext.length === 0) return;
				const first = pendingContext[0];
				flow.push({
					kind: "context-fold",
					nodeKey: first.nodeKey,
					turn: pendingContextTurn ?? null,
					items: pendingContext
				});
				pendingContext = [];
				pendingContextTurn = void 0;
			};
			/** Push one flow item, folding completed turns: a closed turn buffers every
			*  assistant row, context injection, and tool run until its closing reply
			*  arrives. User and steering messages stay visible — they are the
			*  conversation's anchors. */
			const pushItem = (item) => {
				const key = keyOf(item);
				const turnId = nodeTurn.get(key);
				if (item.kind === "message" && item.role === "context") {
					const plan = turnId === void 0 ? void 0 : turnPlans.get(turnId);
					if (plan === void 0 || plan.durationMs === null) {
						if (pendingContext.length > 0 && pendingContextTurn !== turnId) flushContext();
						pendingContextTurn = turnId;
						pendingContext.push(item);
						return;
					}
				}
				flushContext();
				if (item.kind === "message" && item.role === "steering") {
					const plan = turnId === void 0 ? void 0 : turnPlans.get(turnId);
					if (plan !== void 0 && plan.durationMs !== null) {
						flushFold(item.time);
						pendingFoldStart = item.time;
					} else flushFold(null);
					flow.push(item);
					return;
				}
				if (turnId === void 0 || item.kind === "message" && item.role !== "context" || item.kind === "turn-tail") {
					flushFold(null);
					flow.push(item);
					return;
				}
				const plan = turnPlans.get(turnId);
				if (plan === void 0 || plan.durationMs === null) {
					flushFold(null);
					flow.push(item);
					return;
				}
				if (item.kind === "assistant" && key === plan.closingKey) {
					let closing = item;
					if (item.kind === "assistant" && item.blocks.some((block) => block.kind === "reasoning")) {
						const blocks = [];
						for (const block of item.blocks) if (block.kind === "reasoning") pendingFold.push({
							...item,
							blocks: [block]
						});
						else blocks.push(block);
						pendingFoldTurn = turnId;
						closing = {
							...item,
							blocks
						};
					}
					flushFold(null);
					flow.push(closing);
					return;
				}
				if (item.kind === "assistant" || item.kind === "tools" || item.kind === "message" && item.role === "context") {
					if (pendingFoldTurn !== null && pendingFoldTurn !== turnId) flushFold(null);
					pendingFoldTurn = turnId;
					if (pendingFold.length === 0 && pendingFoldStart === null) pendingFoldStart = plan.startTime;
					pendingFold.push(item);
					return;
				}
				flushFold(null);
				flow.push(item);
			};
			const flush = () => {
				if (pending === null) return;
				// v8 ignore next -- unreachable: pending is created only by a visible tool-call node
				if (pending.blocks.length > 0) {
					const previous = pendingFold.length > 0 ? pendingFold[pendingFold.length - 1] : flow.at(-1);
					const adjacentAssistant = previous !== void 0 && previous.kind === "assistant" ? previous : null;
					const thoughtMs = adjacentAssistant === null ? null : adjacentAssistant.thoughtMs;
					const think = [];
					let trailingAssistant = null;
					if (adjacentAssistant !== null) {
						const blocks = [];
						for (let i = 0; i < adjacentAssistant.blocks.length; i += 1) {
							const block = adjacentAssistant.blocks[i];
							if (block.kind === "reasoning") think.push({
								text: block.text,
								running: adjacentAssistant.running && i === adjacentAssistant.blocks.length - 1
							});
							else blocks.push(block);
						}
						if (adjacentAssistant.running || adjacentAssistant.interrupted || blocks.some((block) => block.kind !== "tool-call")) trailingAssistant = {
							...adjacentAssistant,
							blocks
						};
						if (pendingFold.length > 0) pendingFold.pop();
						else flow.pop();
					}
					const groupTurn = nodeTurn.get(pending.keys[0]) ?? null;
					const previousAfterAssistant = pendingFold.length > 0 ? pendingFold[pendingFold.length - 1] : flow.at(-1);
					let absorbedContext = [];
					if (previousAfterAssistant !== void 0 && previousAfterAssistant.kind === "context-fold" && previousAfterAssistant.turn === groupTurn) {
						absorbedContext = previousAfterAssistant.items;
						if (pendingFold.length > 0) pendingFold.pop();
						else flow.pop();
					}
					const group = toolGroup(pending.blocks, cwd, thoughtMs, think);
					const folded = {
						...group,
						nodeKeys: pending.keys,
						items: [...absorbedContext, ...group.items],
						contextCount: absorbedContext.length,
						context: absorbedContext
					};
					const previousItem = pendingFold.length > 0 ? pendingFold[pendingFold.length - 1] : flow.at(-1);
					if (trailingAssistant !== null) {
						pushItem(trailingAssistant);
						pushItem({
							kind: "tools",
							group: folded
						});
					} else if (previousItem !== void 0 && previousItem.kind === "tools") {
						const prev = previousItem.group;
						const merged = {
							nodeKeys: [...prev.nodeKeys, ...folded.nodeKeys],
							items: [...prev.items, ...folded.items],
							running: prev.running || folded.running,
							metrics: {
								commands: prev.metrics.commands + folded.metrics.commands,
								edits: prev.metrics.edits + folded.metrics.edits,
								searches: prev.metrics.searches + folded.metrics.searches,
								files: prev.metrics.files + folded.metrics.files,
								dirs: prev.metrics.dirs + folded.metrics.dirs,
								commandsFailed: prev.metrics.commandsFailed + folded.metrics.commandsFailed,
								editsFailed: prev.metrics.editsFailed + folded.metrics.editsFailed,
								searchesFailed: prev.metrics.searchesFailed + folded.metrics.searchesFailed
							},
							contextCount: prev.contextCount + folded.contextCount,
							context: [...prev.context, ...folded.context],
							thoughtMs: prev.thoughtMs === null ? folded.thoughtMs : folded.thoughtMs === null ? prev.thoughtMs : prev.thoughtMs + folded.thoughtMs
						};
						if (pendingFold.length > 0) pendingFold[pendingFold.length - 1] = {
							kind: "tools",
							group: merged
						};
						else flow[flow.length - 1] = {
							kind: "tools",
							group: merged
						};
					} else pushItem({
						kind: "tools",
						group: folded
					});
				}
				pending = null;
			};
			for (const key of order) {
				const node = getNode(key);
				if (node === void 0 || node.visibility === "hidden") continue;
				if (node.kind === "tool-call") {
					const data = node.data;
					if (pending === null) pending = {
						keys: [],
						blocks: []
					};
					pending.keys.push(key);
					pending.blocks.push(data.root);
					continue;
				}
				flush();
				const item = flowItemOf(key, node, node.data);
				if (item !== null) pushItem(item);
			}
			flush();
			flushFold(null);
			flushContext();
			return flow;
		}
		/** Whether one assistant-step node's blocks carry a visible text reply. */
		function assistantHasText(data) {
			return data.blocks.some((block) => block.kind === "text" && block.text.trim() !== "");
		}
		/** Whether one chat node marks a user-stopped step: an interrupted assistant
		*  step, or a settled tool call whose result error code is `interrupted`. */
		function stepInterrupted(node) {
			if (node.kind === "assistant-step") return node.data.status === "interrupted";
			if (node.kind === "tool-call") {
				const root = node.data.root;
				return "kind" in root && root.error?.code === "interrupted";
			}
			return false;
		}
		/**
		* Assistant thinking duration: time from the step's start to its first
		* non-empty token delta. Only meaningful once the step is settled; null
		* when the timing boundaries are unavailable.
		* @param data - the assistant chat node data.
		* @returns thinking time in ms, or null when not derivable.
		*/
		function thoughtDurationMs(data) {
			const timing = data.finalNode?.timing;
			if (timing === void 0 || timing.stepStartTime === null || timing.firstTokenTime === null) return null;
			const ms = timing.firstTokenTime - timing.stepStartTime;
			return ms > 0 ? ms : null;
		}
		/**
		* Display seconds for a duration: one decimal under ten seconds, whole
		* seconds beyond. Unit-less so the locale templates own the suffix.
		* @param ms - Duration in milliseconds (negatives clamp to zero).
		* @returns display number in seconds without unit.
		*/
		function formatSeconds(ms) {
			const s = Math.max(0, ms) / 1e3;
			return s < 10 ? String(Math.round(s * 10) / 10) : String(Math.round(s));
		}
		//#endregion
		//#region \0dsh-css:/root/Projects/dsh-external/audit/dsh-focus-chat/src/client/FocusView.module.css.mjs
		const css = ".O3CwIa_root{flex-direction:column;flex:auto;min-width:0;min-height:0;display:flex;position:relative}.O3CwIa_scroll{flex:auto;min-height:0;overflow-y:auto}[data-conversation-scroll] .O3CwIa_root{flex:none;height:auto;min-height:auto}[data-conversation-scroll] .O3CwIa_scroll{flex:none;min-height:auto;overflow:visible}.O3CwIa_column{max-width:var(--dsh-chat-content-width);flex-direction:column;gap:16px;width:100%;margin:0 auto;padding:16px 0;display:flex}.O3CwIa_flowItem{min-width:0}.O3CwIa_flowItem:empty{display:none}.O3CwIa_turnStatus{height:26px;font:var(--dsw-font-s-strong-14);white-space:nowrap;background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite O3CwIa_dsh-focus-turn-shimmer;display:inline-flex}.O3CwIa_turnStatusClock{font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);margin-left:8px;font-weight:400}@keyframes O3CwIa_dsh-focus-turn-shimmer{to{background-position:0 0}}@media (prefers-reduced-motion:reduce){.O3CwIa_turnStatus{background-position:0 0;background-size:100% 100%;animation:none}}.O3CwIa_older{justify-content:center;display:flex}.O3CwIa_olderButton{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);cursor:pointer;border:none;border-radius:14px;padding:4px 12px;font-size:12px}.O3CwIa_olderButton:disabled{cursor:default;opacity:.6}.O3CwIa_empty{color:var(--dsw-alias-label-tertiary);align-self:center;padding:24px 0;font-size:14px;line-height:20px}.O3CwIa_userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}.O3CwIa_bubble{background:var(--dsw-specific-bubble);max-width:min(525px,82%);color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px}.O3CwIa_refChip{color:var(--dsw-alias-label-primary);white-space:nowrap;vertical-align:baseline;background:#6187d838;border-radius:6px;margin:0 2px;padding:0 8px;font-size:.85em;line-height:1.6;display:inline-block}.O3CwIa_messageActions{align-items:center;gap:10px;height:28px;display:flex}.O3CwIa_messageActions[data-clock=start] .O3CwIa_messageClock{padding-right:12px}.O3CwIa_messageActions[data-clock=end] .O3CwIa_messageClock{padding-left:12px}.O3CwIa_messageActions[data-clock=end]{margin-left:-6px}.O3CwIa_messageClock{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:14px;line-height:24px}@media (hover:hover){[data-time-hover-root] .O3CwIa_messageClock{opacity:0;transition:opacity 80ms}[data-time-hover-root]:hover .O3CwIa_messageClock,[data-time-hover-root]:focus-within .O3CwIa_messageClock{opacity:1}}.O3CwIa_messageClockDot{margin:0 10px}.O3CwIa_messageAction{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}.O3CwIa_messageAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.O3CwIa_messageAction[data-unavailable]{cursor:default;opacity:.4}.O3CwIa_messageAction[data-unavailable]:hover{color:var(--dsw-alias-label-tertiary);background:0 0}.O3CwIa_turnTail{flex-direction:column;gap:16px;display:flex}.O3CwIa_producedRow{flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;font-size:13px;line-height:22px;display:flex}.O3CwIa_producedLabel{color:var(--dsw-alias-label-tertiary)}.O3CwIa_producedFile{text-overflow:ellipsis;white-space:nowrap;background:var(--dsw-alias-interactive-bg-hover);max-width:320px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border:none;border-radius:6px;margin:0;padding:0 8px;overflow:hidden}.O3CwIa_producedFile:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}.O3CwIa_producedMore{color:var(--dsw-alias-label-tertiary)}.O3CwIa_contextRow{min-width:0}.O3CwIa_contextRow[data-open]{padding-bottom:4px}.O3CwIa_contextChevron{color:var(--dsw-alias-label-secondary)}.O3CwIa_contextSource,.O3CwIa_contextSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_contextSource{flex:none}.O3CwIa_contextSummary{flex:auto}.O3CwIa_contextBody{box-sizing:border-box;background:var(--dsw-alias-markdown-code-block);width:calc(100% - 22px);max-height:141px;color:var(--dsw-alias-label-tertiary);font:400 11px/16px var(--ds-font-family-code);border:none;border-radius:8px;margin:4px 0 0 22px;padding:10px 16px 12px 12px;overflow:auto}.O3CwIa_contextText{color:var(--dsw-alias-label-secondary);font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.O3CwIa_contextFields{border-top:1px solid var(--dsw-alias-line-secondary);flex-direction:column;gap:2px;margin:8px 0 0;padding-top:8px;display:flex}.O3CwIa_contextField{gap:8px;min-width:0;display:flex}.O3CwIa_contextFieldKey{min-width:96px;color:var(--dsw-alias-label-caption);flex:none}.O3CwIa_contextFieldValue{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:auto;margin:0}.O3CwIa_contextFiles{flex-wrap:wrap;gap:4px 12px;margin:0 0 8px;padding:0;list-style:none;display:flex}.O3CwIa_contextFile{align-items:baseline;gap:6px;min-width:0;display:flex}.O3CwIa_contextFilePath{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.O3CwIa_contextFileAction{color:var(--dsw-alias-label-caption)}.O3CwIa_contextNotice{color:var(--dsw-alias-label-caption);margin:0 0 6px}.O3CwIa_contextEntries{flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;display:flex}.O3CwIa_contextEntry{gap:8px;min-width:0;display:flex}.O3CwIa_contextEntryName{color:var(--dsw-alias-label-secondary);flex:none}.O3CwIa_contextEntryDescription{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}.O3CwIa_contextSections{flex-direction:column;gap:8px;margin:0;display:flex}.O3CwIa_contextSection{flex-direction:column;gap:2px;min-width:0;display:flex}.O3CwIa_contextSectionName{color:var(--dsw-alias-label-caption)}.O3CwIa_contextSectionText{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.O3CwIa_contextRelaySender{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;margin:0 0 6px}.O3CwIa_contextRecalls{flex-direction:column;gap:2px;margin:0 0 8px;padding:0;list-style:none;display:flex}.O3CwIa_contextRecall{gap:8px;min-width:0;display:flex}.O3CwIa_contextRecallLabel{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.O3CwIa_contextRecallCounts{color:var(--dsw-alias-label-caption);flex:none}.O3CwIa_retryRow{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.O3CwIa_retrySummary{width:fit-content;color:inherit;cursor:pointer;user-select:none;border-radius:3px;align-items:center;gap:7px;padding:2px 0;list-style:none;display:inline-flex}.O3CwIa_retrySummary::-webkit-details-marker{display:none}.O3CwIa_retrySummary:after{content:\"\";opacity:.8;border-bottom:1.5px solid;border-right:1.5px solid;width:6px;height:6px;transition:transform .12s;transform:rotate(-45deg)}.O3CwIa_retrySummary:hover{color:var(--dsw-alias-label-secondary)}.O3CwIa_retrySummary:focus-visible{outline:1.5px solid var(--dsw-alias-button-info-fill);outline-offset:2px}.O3CwIa_retryText{color:inherit}.O3CwIa_retryRow[data-active] .O3CwIa_retryText{background:linear-gradient(90deg, var(--dsw-alias-label-tertiary) 0%, var(--dsw-alias-label-tertiary) 40%, var(--dsw-alias-label-secondary) 50%, var(--dsw-alias-label-tertiary) 60%, var(--dsw-alias-label-tertiary) 100%);color:#0000;background-position:100%;background-size:200% 100%;background-clip:text;animation:1.6s ease-in-out infinite O3CwIa_dsh-focus-retry-shimmer}.O3CwIa_retryRow[open] .O3CwIa_retrySummary:after{transform:rotate(45deg)}.O3CwIa_retryDetails{overflow-wrap:anywhere;gap:2px;margin-top:3px;padding-left:14px;font-size:12px;line-height:18px;display:grid}.O3CwIa_retryDetailLabel{color:var(--dsw-alias-label-secondary)}@keyframes O3CwIa_dsh-focus-retry-shimmer{0%{background-position:100%}to{background-position:0}}@media (prefers-reduced-motion:reduce){.O3CwIa_retryRow[data-active] .O3CwIa_retryText{color:inherit;background:0 0;animation:none}}.O3CwIa_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.O3CwIa_openError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.O3CwIa_toBottomSlot{z-index:8;height:0;padding-right:max(0px, calc((100% - var(--dsh-chat-content-width)) / 2));pointer-events:none;justify-content:flex-end;display:flex;position:sticky;bottom:16px}[data-conversation-scroll] .O3CwIa_toBottomSlot{bottom:calc(var(--dsh-composer-height,152px) + 16px)}.O3CwIa_toBottom{border:1px solid var(--dsw-alias-border-l2);width:34px;height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-shadow-lv2);cursor:pointer;pointer-events:auto;border-radius:100px;justify-content:center;align-items:center;margin-top:-34px;padding:0;display:flex}.O3CwIa_toBottom:hover{background:var(--dsw-alias-button-floating-hover)}.O3CwIa_commandRow{flex-direction:column;display:flex}.O3CwIa_commandRow[data-state=running] [data-disclosure-row]:after{content:\"\";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite O3CwIa_dsh-focus-command-row-sweep;position:absolute;left:0}@keyframes O3CwIa_dsh-focus-command-row-sweep{0%{left:-300px}90%,to{left:100%}}@media (prefers-reduced-motion:reduce){.O3CwIa_commandRow[data-state=running] [data-disclosure-row]:after{animation:none}}.O3CwIa_commandSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_commandSummary[data-error]{color:var(--dsw-alias-state-error-primary)}.O3CwIa_commandBody{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);max-height:260px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap;border-radius:12px;margin:4px 0 4px 4px;padding:12px 16px;overflow:auto}.O3CwIa_commandBody[data-error]{color:var(--dsw-alias-state-error-primary)}.O3CwIa_compactionRow{padding:2px 0}.O3CwIa_compactionButton{width:100%;min-width:0;height:24px;color:inherit;font:inherit;text-align:left;background:0 0;border:none;border-radius:6px;align-items:center;padding:0;display:flex}.O3CwIa_compactionButton:not(:disabled){cursor:pointer}.O3CwIa_compactionButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}.O3CwIa_compactionLeading{width:16px;height:16px;color:var(--dsw-alias-label-secondary);flex:none;place-items:center;margin-right:6px;display:inline-grid}.O3CwIa_compactionContextIcon,.O3CwIa_compactionDisclosureIcon{grid-area:1/1;justify-content:center;align-items:center;display:inline-flex}.O3CwIa_compactionDisclosureIcon,.O3CwIa_compactionButton:not(:disabled):hover .O3CwIa_compactionContextIcon,.O3CwIa_compactionButton:not(:disabled):focus-visible .O3CwIa_compactionContextIcon{opacity:0}.O3CwIa_compactionButton:not(:disabled):hover .O3CwIa_compactionDisclosureIcon,.O3CwIa_compactionButton:not(:disabled):focus-visible .O3CwIa_compactionDisclosureIcon{opacity:1}.O3CwIa_compactionTitle{color:var(--dsw-alias-label-primary-dimmed);flex:none;font-size:14px;line-height:24px}.O3CwIa_compactionSep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.O3CwIa_compactionSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_compactionBody{color:var(--dsw-alias-label-tertiary);padding:4px 0 4px 22px;font-size:14px;line-height:24px}.O3CwIa_turnErrorRow{grid-template-columns:10px minmax(0,1fr) auto;align-items:start;gap:8px;padding:2px 0;font-size:13px;line-height:20px;display:grid}.O3CwIa_turnErrorDot{margin-top:5px}.O3CwIa_turnErrorCopy{overflow-wrap:anywhere;min-width:0}.O3CwIa_turnErrorTitle{color:var(--dsw-alias-state-error-primary);margin-right:6px;font-weight:600}.O3CwIa_turnErrorMessage{color:var(--dsw-alias-label-secondary)}.O3CwIa_turnErrorCode{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block-small)}.O3CwIa_assistant{color:var(--dsw-alias-label-primary);flex-direction:column;gap:16px;font-size:16px;line-height:28px;display:flex}.O3CwIa_stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px}.O3CwIa_thinkWrap,.O3CwIa_thinkRow{flex-direction:column;display:flex}.O3CwIa_thinkRowInner{position:relative;overflow:hidden}.O3CwIa_thinkWrap[data-state=running] .O3CwIa_thinkRowInner:after{content:\"\";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite O3CwIa_dsh-focus-reasoning-sweep;position:absolute;left:0}@keyframes O3CwIa_dsh-focus-reasoning-sweep{0%{left:-300px}90%,to{left:100%}}@media (prefers-reduced-motion:reduce){.O3CwIa_thinkWrap[data-state=running] .O3CwIa_thinkRowInner:after{animation:none}}.O3CwIa_thinkSeparator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.O3CwIa_thinkSummary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_thinkSummary[data-follow-end]{text-overflow:clip}.O3CwIa_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.O3CwIa_thinkBody{color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:14px;line-height:24px}.O3CwIa_turnFold,.O3CwIa_turnFoldRow{flex-direction:column;display:flex}.O3CwIa_turnFoldBody{flex-direction:column;gap:8px;margin-top:8px;padding-left:14px;display:flex}.O3CwIa_groupRow{flex-direction:column;display:flex}.O3CwIa_groupTitleLine{white-space:nowrap;text-overflow:ellipsis;min-width:0;color:var(--dsw-alias-label-secondary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_groupTitleFailed{color:var(--dsw-alias-state-error-primary)}.O3CwIa_runningCalls{flex-direction:column;gap:16px;display:flex}.O3CwIa_groupRowInner{flex-direction:column;display:flex}.O3CwIa_calls{border-left:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;margin-top:8px;padding-left:14px;display:flex}.O3CwIa_contextFold,.O3CwIa_contextFoldRow{flex-direction:column;display:flex}.O3CwIa_contextFoldBody{flex-direction:column;gap:8px;margin-top:8px;padding-left:14px;display:flex}.O3CwIa_callRow{flex-direction:column;display:flex}.O3CwIa_callRow[data-state=running] [data-disclosure-row]:after{content:\"\";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite O3CwIa_dsh-focus-tool-row-sweep;position:absolute;left:0}@keyframes O3CwIa_dsh-focus-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}@media (prefers-reduced-motion:reduce){.O3CwIa_callRow[data-state=running] [data-disclosure-row]:after{animation:none}}.O3CwIa_callRow[data-tool^=cordis_] .O3CwIa_callLeading,.O3CwIa_callRow[data-tool^=cordis_] .O3CwIa_callTitle{color:var(--dsw-alias-state-business-primary)}.O3CwIa_callRow[data-tool^=cordis_] .O3CwIa_callTitle{font-weight:500}.O3CwIa_callRow[data-tool^=cordis_] .O3CwIa_callSeparator{background:var(--dsw-alias-state-business-primary)}.O3CwIa_callChevron{color:var(--dsw-alias-label-secondary)}.O3CwIa_callSeparator{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.O3CwIa_callSummary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_callFileLink{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:inherit;text-align:left;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-decoration-color:var(--dsw-alias-label-quaternary);text-underline-offset:3px;cursor:pointer;background:0 0;border:none;flex:auto;margin:0;padding:0;font-size:14px;line-height:24px;overflow:hidden}.O3CwIa_callFileLink:hover{color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}.O3CwIa_callErrorSummary{color:var(--dsw-alias-state-error-primary)}.O3CwIa_callBodyWrap{flex-direction:column;display:flex}.O3CwIa_bodyScroll{max-height:260px;overflow-y:auto}.O3CwIa_ioCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);border-radius:12px;flex-direction:column;margin:4px 0 4px 4px;display:flex}.O3CwIa_ioSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}.O3CwIa_ioLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}.O3CwIa_ioDivider{background:var(--dsw-alias-border-l2);flex:none;height:1px}.O3CwIa_ioText{white-space:pre-wrap;word-break:break-word;min-width:0;color:var(--dsw-alias-label-secondary)}.O3CwIa_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}.O3CwIa_codeBody,.O3CwIa_terminalBody,.O3CwIa_diffBody,.O3CwIa_readBody,.O3CwIa_searchBody,.O3CwIa_webBody{margin:4px 0 4px 4px}.O3CwIa_searchRecovery{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:4px 0 4px 4px}.O3CwIa_codeBody{--dsl-code-block-content-font:var(--dsw-font-markdown-code-block-small)}.O3CwIa_terminalBody{--dsl-terminal-font:var(--dsw-font-markdown-code-block-small);--dsl-terminal-line-height:18px;--dsl-terminal-output-max-height:224px;border:1px solid var(--dsw-alias-border-l1)}.O3CwIa_subcalls{border-left:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:4px;margin:4px 0 2px 22px;padding-left:8px;display:flex}";
		const tagId = "dsh-focus-chat/FocusView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-focus-chat";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var FocusView_module_css_default = {
			"dsh-focus-command-row-sweep": "O3CwIa_dsh-focus-command-row-sweep",
			"ioLabel": "O3CwIa_ioLabel",
			"olderButton": "O3CwIa_olderButton",
			"commandBody": "O3CwIa_commandBody",
			"thinkBody": "O3CwIa_thinkBody",
			"bubble": "O3CwIa_bubble",
			"contextBody": "O3CwIa_contextBody",
			"dsh-focus-reasoning-sweep": "O3CwIa_dsh-focus-reasoning-sweep",
			"subcalls": "O3CwIa_subcalls",
			"turnErrorTitle": "O3CwIa_turnErrorTitle",
			"retryRow": "O3CwIa_retryRow",
			"compactionRow": "O3CwIa_compactionRow",
			"compactionDisclosureIcon": "O3CwIa_compactionDisclosureIcon",
			"contextSectionName": "O3CwIa_contextSectionName",
			"messageClock": "O3CwIa_messageClock",
			"groupTitleFailed": "O3CwIa_groupTitleFailed",
			"producedRow": "O3CwIa_producedRow",
			"messageClockDot": "O3CwIa_messageClockDot",
			"callSummary": "O3CwIa_callSummary",
			"producedLabel": "O3CwIa_producedLabel",
			"toBottomSlot": "O3CwIa_toBottomSlot",
			"callErrorSummary": "O3CwIa_callErrorSummary",
			"calls": "O3CwIa_calls",
			"runningCalls": "O3CwIa_runningCalls",
			"turnErrorCode": "O3CwIa_turnErrorCode",
			"contextFieldKey": "O3CwIa_contextFieldKey",
			"webBody": "O3CwIa_webBody",
			"hint": "O3CwIa_hint",
			"thinkWrap": "O3CwIa_thinkWrap",
			"callTitle": "O3CwIa_callTitle",
			"contextRecalls": "O3CwIa_contextRecalls",
			"openError": "O3CwIa_openError",
			"commandRow": "O3CwIa_commandRow",
			"callChevron": "O3CwIa_callChevron",
			"contextRecall": "O3CwIa_contextRecall",
			"contextSection": "O3CwIa_contextSection",
			"retryText": "O3CwIa_retryText",
			"turnFoldBody": "O3CwIa_turnFoldBody",
			"diffBody": "O3CwIa_diffBody",
			"turnErrorCopy": "O3CwIa_turnErrorCopy",
			"turnFold": "O3CwIa_turnFold",
			"contextFieldValue": "O3CwIa_contextFieldValue",
			"ioSection": "O3CwIa_ioSection",
			"retrySummary": "O3CwIa_retrySummary",
			"contextField": "O3CwIa_contextField",
			"toBottom": "O3CwIa_toBottom",
			"groupRowInner": "O3CwIa_groupRowInner",
			"contextFields": "O3CwIa_contextFields",
			"retryDetails": "O3CwIa_retryDetails",
			"ioCard": "O3CwIa_ioCard",
			"turnStatusClock": "O3CwIa_turnStatusClock",
			"messageAction": "O3CwIa_messageAction",
			"contextFold": "O3CwIa_contextFold",
			"empty": "O3CwIa_empty",
			"contextFoldRow": "O3CwIa_contextFoldRow",
			"stopped": "O3CwIa_stopped",
			"callRow": "O3CwIa_callRow",
			"turnStatus": "O3CwIa_turnStatus",
			"scroll": "O3CwIa_scroll",
			"contextRow": "O3CwIa_contextRow",
			"contextRecallCounts": "O3CwIa_contextRecallCounts",
			"callBodyWrap": "O3CwIa_callBodyWrap",
			"compactionSep": "O3CwIa_compactionSep",
			"contextSectionText": "O3CwIa_contextSectionText",
			"contextSummary": "O3CwIa_contextSummary",
			"compactionLeading": "O3CwIa_compactionLeading",
			"thinkRowInner": "O3CwIa_thinkRowInner",
			"callSeparator": "O3CwIa_callSeparator",
			"compactionContextIcon": "O3CwIa_compactionContextIcon",
			"root": "O3CwIa_root",
			"contextEntryName": "O3CwIa_contextEntryName",
			"dsh-focus-tool-row-sweep": "O3CwIa_dsh-focus-tool-row-sweep",
			"commandSummary": "O3CwIa_commandSummary",
			"turnErrorMessage": "O3CwIa_turnErrorMessage",
			"userRow": "O3CwIa_userRow",
			"thinkSeparator": "O3CwIa_thinkSeparator",
			"turnFoldRow": "O3CwIa_turnFoldRow",
			"terminalBody": "O3CwIa_terminalBody",
			"contextSections": "O3CwIa_contextSections",
			"contextText": "O3CwIa_contextText",
			"contextEntryDescription": "O3CwIa_contextEntryDescription",
			"contextNotice": "O3CwIa_contextNotice",
			"contextEntry": "O3CwIa_contextEntry",
			"searchRecovery": "O3CwIa_searchRecovery",
			"assistant": "O3CwIa_assistant",
			"dsh-focus-retry-shimmer": "O3CwIa_dsh-focus-retry-shimmer",
			"codeBody": "O3CwIa_codeBody",
			"readBody": "O3CwIa_readBody",
			"producedFile": "O3CwIa_producedFile",
			"callFileLink": "O3CwIa_callFileLink",
			"contextFileAction": "O3CwIa_contextFileAction",
			"compactionTitle": "O3CwIa_compactionTitle",
			"thinkRow": "O3CwIa_thinkRow",
			"turnErrorRow": "O3CwIa_turnErrorRow",
			"callLeading": "O3CwIa_callLeading",
			"contextRelaySender": "O3CwIa_contextRelaySender",
			"compactionBody": "O3CwIa_compactionBody",
			"contextFoldBody": "O3CwIa_contextFoldBody",
			"older": "O3CwIa_older",
			"retryDetailLabel": "O3CwIa_retryDetailLabel",
			"dsh-focus-turn-shimmer": "O3CwIa_dsh-focus-turn-shimmer",
			"bodyScroll": "O3CwIa_bodyScroll",
			"flowItem": "O3CwIa_flowItem",
			"groupTitleLine": "O3CwIa_groupTitleLine",
			"groupRow": "O3CwIa_groupRow",
			"refChip": "O3CwIa_refChip",
			"thinkSummary": "O3CwIa_thinkSummary",
			"messageActions": "O3CwIa_messageActions",
			"ioText": "O3CwIa_ioText",
			"searchBody": "O3CwIa_searchBody",
			"turnTail": "O3CwIa_turnTail",
			"contextFile": "O3CwIa_contextFile",
			"contextFiles": "O3CwIa_contextFiles",
			"contextRecallLabel": "O3CwIa_contextRecallLabel",
			"visuallyHidden": "O3CwIa_visuallyHidden",
			"turnErrorDot": "O3CwIa_turnErrorDot",
			"contextEntries": "O3CwIa_contextEntries",
			"column": "O3CwIa_column",
			"compactionSummary": "O3CwIa_compactionSummary",
			"ioDivider": "O3CwIa_ioDivider",
			"contextFilePath": "O3CwIa_contextFilePath",
			"contextSource": "O3CwIa_contextSource",
			"contextChevron": "O3CwIa_contextChevron",
			"producedMore": "O3CwIa_producedMore",
			"compactionButton": "O3CwIa_compactionButton"
		};
		//#endregion
		//#region src/client/FocusView.tsx
		/**
		* FocusView: the condensed conversation surface (Claude Code-style focus
		* mode). One row per user/assistant/command message; every run of Tool calls
		* folds into a single expandable step-summary line ("思考了 36 秒，运行了 2
		* 个命令，探索了 17 个文件，18 个目录"), whose expansion reveals one row
		* per call — each expandable to the full card rendering the chat tool rows
		* draw, with the recursive sub-call tree nested underneath. The Think rows
		* mirror the chat reasoning row: one line by default, tail-following while
		* streaming; the reasoning of an assistant step directly followed by a run
		* is absorbed into the group and folds with it. Everything renders from the
		* session chat snapshot through the standard kit — no chat renderer reuse,
		* no state outside this view.
		*/
		/** First line of a multi-line string; the text itself when single-line. */
		function firstLine(text) {
			const newline = text.indexOf("\n");
			return newline === -1 ? text : text.slice(0, newline);
		}
		/** Latest non-empty line of a streaming text (the running tail preview). */
		function latestLine(text) {
			const visible = text.trimEnd();
			const newline = visible.lastIndexOf("\n");
			return newline === -1 ? visible : visible.slice(newline + 1);
		}
		/** Zero-padded two-digit number (the chat clock's rhythm). */
		function pad2(n) {
			return String(n).padStart(2, "0");
		}
		/** Trailing path segment, the part that identifies a produced file at a glance. */
		function basename(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/** Decode-throughput figure: whole tokens from ten up, one decimal below. */
		function formatTokensPerSecond(tps) {
			const clamped = Math.max(0, tps);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		/** Local calendar-day epoch (ms at local midnight) for an instant. */
		function startOfLocalDay(ms) {
			const d = new Date(ms);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}
		/** Delay until the next local midnight after `ms` (at least 1ms). */
		function msUntilNextLocalMidnight(ms) {
			const next = new Date(ms);
			next.setHours(24, 0, 0, 0);
			return Math.max(next.getTime() - ms, 1);
		}
		/** The current local calendar-day epoch, re-resolved at each midnight. */
		function useCalendarDay() {
			const [day, setDay] = (0, react.useState)(() => startOfLocalDay(Date.now()));
			(0, react.useEffect)(() => {
				let timer;
				const schedule = () => {
					timer = window.setTimeout(() => {
						setDay(startOfLocalDay(Date.now()));
						schedule();
					}, msUntilNextLocalMidnight(Date.now()));
				};
				schedule();
				return () => {
					clearTimeout(timer);
				};
			}, []);
			return day;
		}
		/**
		* Compact local timestamp for message chrome (the chat clock): same local
		* calendar day → `HH:mm`; earlier this year → the `clock.md` template;
		* other years → `clock.ymd`.
		* @param time - Unix epoch ms from the source session event.
		* @param t - focus locale seat supplying the date templates.
		* @param now - reference instant for the day/year cut.
		* @returns the date-aware clock string.
		*/
		function formatMessageClock(time, t, now = Date.now()) {
			const d = new Date(time);
			const n = new Date(now);
			const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
			if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
			const params = {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			};
			return `${d.getFullYear() === n.getFullYear() ? t("clock.md", params) : t("clock.ymd", params)} ${clock}`;
		}
		/** Concatenated text blocks of a message (the chat bubble's join). */
		function messageText(content) {
			return content.flatMap((block) => block.type === "text" ? [block.text ?? ""] : []).join("");
		}
		/**
		* Display projection of reference forms in a user bubble: `/name` / `@name`
		* word-boundary tokens decorate as chips, everything else stays plain text
		* (the chat bubble's projection — sent tokens were validated at compose time,
		* so shape alone decorates).
		*/
		function projectUserText(text) {
			const re = /(^|\s)([/@][\w-]+)(?=\s|$)/g;
			const parts = [];
			let cursor = 0;
			let m;
			while ((m = re.exec(text)) !== null) {
				const tokenStart = m.index + (m[1]?.length ?? 0);
				const label = m[2] ?? "";
				if (tokenStart > cursor) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text: text.slice(cursor, tokenStart) }, cursor));
				parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.refChip,
					"data-ref-chip": label.startsWith("@") ? "subagent" : "skill",
					children: label
				}, tokenStart));
				cursor = tokenStart + label.length;
			}
			if (parts.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text });
			if (cursor < text.length) parts.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MessageText, { text: text.slice(cursor) }, cursor));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: parts });
		}
		/**
		* Frame-throttled scheduling for non-essential visual alignment (the chat
		* reasoning row's rhythm): coalesce updates over a frame interval and apply
		* the latest one.
		* @param update - DOM alignment to run after the throttle interval.
		* @param intervalFrames - frames to wait before applying the latest alignment.
		* @returns a stable function that schedules the latest update.
		*/
		function useThrottledVisualUpdate(update, intervalFrames = 3) {
			const updateRef = (0, react.useRef)(update);
			updateRef.current = update;
			const pendingFrameRef = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => () => {
				if (pendingFrameRef.current === null) return;
				cancelAnimationFrame(pendingFrameRef.current);
				pendingFrameRef.current = null;
			}, []);
			return (0, react.useCallback)(() => {
				if (pendingFrameRef.current !== null) return;
				let remainingFrames = intervalFrames;
				const advance = () => {
					remainingFrames -= 1;
					if (remainingFrames > 0) {
						pendingFrameRef.current = requestAnimationFrame(advance);
						return;
					}
					pendingFrameRef.current = null;
					updateRef.current();
				};
				pendingFrameRef.current = requestAnimationFrame(advance);
			}, [intervalFrames]);
		}
		/** JsonBlock truncation footer bound to the focus locale (one shared lambda). */
		function jsonTruncated(t) {
			return (total) => t("json.truncated", { total });
		}
		/** Card line caps the chat rows apply (design rhythm). */
		const CHAT_DIFF_MAX_LINES = 8;
		const CHAT_READ_MAX_LINES = 8;
		const CHAT_SEARCH_MAX_LINES = 8;
		/** Terminal-card labels bound to the focus locale (the chat label seam). */
		function terminalLabels(t) {
			return {
				signal: (signal) => t("terminal.signal", { signal }),
				exitCode: (code) => t("terminal.exitCode", { code }),
				running: t("terminal.running"),
				failed: t("terminal.failed"),
				done: t("terminal.done"),
				copy: t("copy"),
				copied: t("copied"),
				noOutput: t("terminal.noOutput"),
				collapseAria: t("terminal.collapseAria"),
				collapse: t("terminal.collapse"),
				expandAria: (hidden) => t("terminal.expandAria", { n: hidden }),
				expand: (hidden) => t("terminal.expand", { n: hidden })
			};
		}
		/** Tool-family leading icons, mirroring the chat GenericToolCard table (glyphs at 14). */
		const VARIANT_ICONS = {
			search: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 14 }),
			read: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 }),
			bash: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, { size: 14 }),
			write: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, { size: 14 }),
			edit: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, { size: 14 }),
			code: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCodeOutline16, { size: 14 }),
			others: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 14 })
		};
		/** Tool name → leading-icon family (mirrors the chat row classification). */
		const TOOL_VARIANTS = {
			bash: "bash",
			pwsh: "bash",
			read: "read",
			web_fetch: "read",
			web_search: "search",
			grep: "search",
			glob: "search",
			write: "write",
			edit: "edit",
			run_code: "code",
			cordis_mount: "code"
		};
		/** One call's leading glyph: the family icon, or the state dot for failures. */
		function leadingFor(row) {
			if (row.state === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" });
			if (row.state === "stopped") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" });
			const variant = TOOL_VARIANTS[row.name] ?? "others";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"data-tool-icon": variant,
				children: VARIANT_ICONS[variant]
			});
		}
		/**
		* One Think disclosure, mirroring the chat reasoning row: one line by
		* default, previewing the streaming tail while running (end-following
		* scroll), the first line once settled; the body expands on click.
		*/
		const ThinkRow = (0, react.memo)(function ThinkRow({ text, running, title, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const summaryRef = (0, react.useRef)(null);
			const summary = running ? latestLine(text) : firstLine(text);
			const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
				const element = summaryRef.current;
				if (element === null) return;
				element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0;
			});
			(0, react.useEffect)(() => {
				scheduleSummaryScroll();
			}, [
				running,
				scheduleSummaryScroll,
				summary
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.thinkWrap,
				"data-state": running ? "running" : "ok",
				children: [running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.visuallyHidden,
					children: t("row.running")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.thinkRow,
					rowClassName: FocusView_module_css_default.thinkRowInner,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconThinkOutline14, { size: 14 }),
					title,
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.thinkSeparator,
						"aria-hidden": true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						ref: summaryRef,
						className: FocusView_module_css_default.thinkSummary,
						"data-follow-end": running || void 0,
						children: summary
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FocusView_module_css_default.thinkBody,
						children: text
					})
				})]
			});
		});
		/** One call's card material through the shared card primitives (the same family the chat rows draw). */
		function CardBody({ card, t }) {
			switch (card.kind) {
				case "terminal": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
					command: card.command,
					cwd: card.cwd,
					output: card.output,
					exitCode: card.exitCode,
					signal: card.signal,
					running: card.running,
					maxLines: Infinity,
					labels: terminalLabels(t),
					className: FocusView_module_css_default.terminalBody
				});
				case "diff": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DiffBlock, {
					diffs: card.diffs,
					maxLines: CHAT_DIFF_MAX_LINES,
					className: FocusView_module_css_default.diffBody
				});
				case "read": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ReadBlock, {
					label: card.label,
					lines: card.lines,
					totalLines: card.totalLines,
					lang: card.lang,
					maxLines: CHAT_READ_MAX_LINES,
					className: FocusView_module_css_default.readBody
				});
				case "search": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SearchBlock, {
					...card.props,
					maxLines: CHAT_SEARCH_MAX_LINES,
					className: FocusView_module_css_default.searchBody
				}), card.recovery !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FocusView_module_css_default.searchRecovery,
					children: card.recovery
				})] });
				case "web": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.WebBlock, {
					...card.props,
					className: FocusView_module_css_default.webBody
				});
			}
		}
		/** One Tool call row inside an expanded group: the chat ToolRow chrome (title · summary, cards, IN/OUT). */
		const ToolCallRow = (0, react.memo)(function ToolCallRow({ row, t, openFile }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const card = row.card;
			const expandable = row.body !== null || row.output !== null || card !== null;
			const open = expanded && expandable;
			const failureLine = row.state === "error" ? row.errorSummary : null;
			const summaryText = failureLine ?? row.summary;
			const fileLink = row.filePath !== void 0 && failureLine === null;
			const status = row.state === "running" ? t("row.running") : row.state === "error" ? t("row.failed") : row.state === "stopped" ? t("row.stopped") : null;
			const cardBody = row.variant === "code" ? null : row.body;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.callRow,
				"data-variant": row.variant,
				"data-tool": row.name || void 0,
				"data-state": row.state,
				children: [status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.visuallyHidden,
					children: status
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.callRowInner,
					leadingClassName: FocusView_module_css_default.callLeading,
					titleClassName: FocusView_module_css_default.callTitle,
					chevronClassName: FocusView_module_css_default.callChevron,
					icon: leadingFor(row),
					title: row.title,
					open,
					expandable,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: summaryText !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.callSeparator,
						"aria-hidden": true
					}), fileLink ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: FocusView_module_css_default.callFileLink,
						onClick: (event) => {
							event.stopPropagation();
							openFile(row.filePath);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") event.stopPropagation();
						},
						children: summaryText
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `${FocusView_module_css_default.callSummary}${failureLine !== null ? ` ${FocusView_module_css_default.callErrorSummary}` : ""}`,
						children: summaryText
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FocusView_module_css_default.callBodyWrap,
						children: [card !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CardBody, {
							card,
							t
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [row.variant === "code" && row.body !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FocusView_module_css_default.bodyScroll,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.CodeBlock, {
								code: row.body,
								lang: "typescript",
								copyLabel: t("copy"),
								copiedLabel: t("copied"),
								className: FocusView_module_css_default.codeBody
							})
						}), (cardBody !== null || row.output !== null) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: FocusView_module_css_default.ioCard,
							children: [
								cardBody !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: FocusView_module_css_default.ioSection,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FocusView_module_css_default.ioLabel,
										children: "IN"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FocusView_module_css_default.ioText,
										children: cardBody
									})]
								}),
								cardBody !== null && row.output !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: FocusView_module_css_default.ioDivider,
									"aria-hidden": true
								}),
								row.output !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: FocusView_module_css_default.ioSection,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FocusView_module_css_default.ioLabel,
										children: "OUT"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: FocusView_module_css_default.ioText,
										"data-error": row.state === "error" || void 0,
										children: row.output
									})]
								})
							]
						})] }), row.subcalls.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FocusView_module_css_default.subcalls,
							"data-subcalls": true,
							children: row.subcalls.map((sub) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolCallRow, {
								row: sub,
								t,
								openFile
							}, sub.callId))
						})]
					})
				})]
			});
		});
		function groupTitleParts(group, t) {
			const { commands, edits, searches, files, dirs } = group.metrics;
			const { commandsFailed, editsFailed, searchesFailed } = group.metrics;
			const parts = [];
			if (group.thoughtMs !== null) parts.push({ text: t("tool.thought", { n: formatSeconds(group.thoughtMs) }) });
			if (group.contextCount > 0) parts.push({ text: t(group.contextCount === 1 ? "tool.context.one" : "tool.context", { n: group.contextCount }) });
			metricPart(parts, commands, commandsFailed, "commands", t);
			metricPart(parts, edits, editsFailed, "edits", t);
			metricPart(parts, searches, searchesFailed, "searches", t);
			if (files > 0 && dirs > 0) parts.push({ text: t("tool.explored.both", {
				files,
				dirs
			}) });
			else if (files > 0) parts.push({ text: t(files === 1 ? "tool.explored.files.one" : "tool.explored.files", { n: files }) });
			else if (dirs > 0) parts.push({ text: t(dirs === 1 ? "tool.explored.dirs.one" : "tool.explored.dirs", { n: dirs }) });
			const others = group.items.reduce((count, item) => count + ("callId" in item && item.state !== "running" ? 1 : 0), 0) - commands - edits - searches - files - dirs;
			if (others > 0) parts.push({ text: t(others === 1 ? "tool.others.one" : "tool.others", { n: others }) });
			if (parts.length === 0) {
				const running = group.items.find((item) => "callId" in item && item.state === "running");
				if (running !== void 0) parts.push({ text: running.summary === "" ? running.title : `${running.title} · ${running.summary}` });
				else parts.push({ text: t("tool.group", { n: 0 }) });
			}
			return parts;
		}
		/** PR67 sentence style: the first visible segment is capitalized, every
		*  later segment starts lowercase (a no-op for the zh line). */
		function caseSegments(segments) {
			let first = true;
			return segments.map((segment) => {
				if (segment.text === "") return segment;
				const text = first ? segment.text.charAt(0).toUpperCase() + segment.text.slice(1) : segment.text.charAt(0).toLowerCase() + segment.text.slice(1);
				first = false;
				return {
					...segment,
					text
				};
			});
		}
		/** One metric family's summary segment with PR67 failure semantics: the
		*  count reads successful calls, a mixed family appends its failure tally
		*  (red, parentheses included), and a family that failed outright reads its
		*  singular failed phrase or the count with an all-failed suffix. */
		function metricPart(parts, total, failed, family, t) {
			const ok = total - failed;
			if (ok === 0 && failed === 0) return;
			if (ok > 0 && failed === 0) {
				parts.push({ text: countSegment(family, ok, t) });
				return;
			}
			if (ok > 0) {
				parts.push({
					text: countSegment(family, ok, t),
					failed: t("tool.failedSuffix", { n: failed })
				});
				return;
			}
			if (failed === 1) {
				parts.push({
					text: "",
					failed: t(`tool.failed.${family}.one`)
				});
				return;
			}
			parts.push({
				text: countSegment(family, failed, t),
				failed: t("tool.failedAll")
			});
		}
		/** The count segment of one metric family, with the singular form for one. */
		function countSegment(family, n, t) {
			return t(n === 1 ? `tool.${family}.one` : `tool.${family}`, { n });
		}
		/** One folded run of Tool calls: the step-summary line with its metrics. */
		const ToolGroupRow = (0, react.memo)(function ToolGroupRow({ group, t, codeLabels, openFile }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const segments = caseSegments(groupTitleParts(group, t));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: FocusView_module_css_default.groupRow,
				"data-state": group.running ? "running" : "ok",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.groupRowInner,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 16 }),
					title: "",
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.groupTitleLine,
						"data-group-title": true,
						children: segments.map((segment, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
							index > 0 && t("tool.separator"),
							segment.text,
							segment.failed !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FocusView_module_css_default.groupTitleFailed,
								"data-group-title-failed": true,
								children: segment.failed
							})
						] }, index))
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FocusView_module_css_default.calls,
						"data-calls": true,
						children: group.items.map((item, index) => "callId" in item ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolCallRow, {
							row: item,
							t,
							openFile
						}, item.callId) : "kind" in item ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextRow, {
							item,
							t,
							codeLabels
						}, item.nodeKey) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThinkRow, {
							text: item.text,
							running: item.running || group.running,
							title: t("think"),
							t
						}, index))
					})
				})
			});
		});
		/** The chat IconActions chrome: copy, optional branch, and an optional date-aware clock. */
		const MessageActions = (0, react.memo)(function MessageActions({ text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, t }) {
			const day = useCalendarDay();
			const [copied, setCopied] = (0, react.useState)(false);
			const copyPending = (0, react.useRef)(false);
			const copyTimer = (0, react.useRef)(null);
			const copyEpoch = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				copyEpoch.current += 1;
				copyPending.current = false;
				if (copyTimer.current !== null) clearTimeout(copyTimer.current);
			}, []);
			const onCopy = (0, react.useCallback)(() => {
				if (copied || copyPending.current) return;
				const epoch = copyEpoch.current;
				copyPending.current = true;
				(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text).then((ok) => {
					if (epoch !== copyEpoch.current) return;
					copyPending.current = false;
					if (!ok) return;
					setCopied(true);
					copyTimer.current = window.setTimeout(() => {
						copyTimer.current = null;
						setCopied(false);
					}, 1e3);
				});
			}, [copied, text]);
			const clockEl = time === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: FocusView_module_css_default.messageClock,
				children: [
					formatMessageClock(time, t, day),
					runMs !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.messageClockDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("ranFor", { duration: formatElapsed(runMs, t) })
					] }),
					ttftMs !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.messageClockDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("ttft", { seconds: formatSeconds(ttftMs) })
					] }),
					tokensPerSecond !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.messageClockDot,
							"aria-hidden": true,
							children: "·"
						}),
						" ",
						t("tokensPerSecond", { tps: formatTokensPerSecond(tokensPerSecond) })
					] })
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.messageActions,
				"data-clock": clock,
				children: [
					clock === "start" ? clockEl : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: copied ? t("copied") : t("copy"),
						side: "bottom",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: FocusView_module_css_default.messageAction,
							"aria-label": copied ? t("copied") : t("copy"),
							onClick: onCopy,
							children: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, {})
						})
					}),
					onBranch !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: branchUnavailable ? t("branchUnavailable") : t("branch"),
						side: "bottom",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: FocusView_module_css_default.messageAction,
							"aria-label": t("branch"),
							"aria-disabled": branchUnavailable || void 0,
							"data-unavailable": branchUnavailable || void 0,
							onClick: branchUnavailable ? void 0 : onBranch,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
						})
					}),
					clock === "end" ? clockEl : null
				]
			});
		});
		/** Model-facing context text stays bounded at the disclosure, not at the producer. */
		const CONTEXT_MAX_CHARS = 2e4;
		/** Rows a list body materializes before summarizing the remainder. */
		const CONTEXT_MAX_ENTRIES = 200;
		/** One durable context source narrowed to the readable-record shape; null for anything else. */
		function asRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
		}
		/**
		* The content blocks as runs, in the order the model received them: adjacent
		* text joins with no separator (the chat body's rule), unknown blocks break
		* the run and keep their own fallback.
		*/
		function contentRuns(content) {
			const runs = [];
			for (const block of content) {
				if (block.type !== "text") {
					runs.push({ block });
					continue;
				}
				const last = runs[runs.length - 1];
				if (last !== void 0 && "text" in last) last.text += block.text ?? "";
				else runs.push({ text: block.text ?? "" });
			}
			return runs;
		}
		/** The model-facing text, truncated to the display bound. */
		function boundedText(text, t) {
			return text.length > CONTEXT_MAX_CHARS ? `${text.slice(0, CONTEXT_MAX_CHARS)}\n${t("json.truncated", { total: text.length })}` : text;
		}
		/** One source field rendered as a value row; nested shapes stay compact JSON. */
		function fieldValue(value, t) {
			return boundedText(typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value), t);
		}
		/** Source fields as a key/value list (the chat body's field chrome). */
		function SourceFields({ source, formRendered, t }) {
			const record = asRecord(source);
			if (record === null) return null;
			const hidden = formRendered ? ["kind", "form"] : ["kind"];
			const rows = Object.entries(record).filter(([key]) => !hidden.includes(key));
			if (rows.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: FocusView_module_css_default.contextFields,
				"data-context-fields": true,
				children: rows.map(([key, value]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.contextField,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						className: FocusView_module_css_default.contextFieldKey,
						children: key
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						className: FocusView_module_css_default.contextFieldValue,
						children: fieldValue(value, t)
					})]
				}, key))
			});
		}
		/** Content blocks this UI version does not know, kept visible rather than dropped. */
		function UnknownBlocks({ blocks, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: blocks.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("unknownBlock"),
				payload: block,
				truncatedLabel: jsonTruncated(t)
			}, index)) });
		}
		/** The model-facing content of one context, shared by every form that shows it. */
		function ModelFacingContent({ content, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: contentRuns(content).map((run, index) => "text" in run ? run.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: FocusView_module_css_default.contextText,
				"data-context-text": true,
				children: boundedText(run.text, t)
			}, index) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
				label: t("unknownBlock"),
				payload: run.block,
				truncatedLabel: jsonTruncated(t)
			}, index)) });
		}
		/** Default context presentation: the model-facing text, then the remaining source fields. */
		function OpaqueBody({ content, source, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceFields, {
				source,
				formRendered: false,
				t
			})] });
		}
		/** Instruction changes read off the source, or null when the record is not a usable list. */
		function instructionChanges(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["changes"];
			if (!Array.isArray(list)) return null;
			const changes = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of list) {
				const change = asRecord(entry);
				if (change === null) return null;
				const path = change["path"];
				if (typeof path !== "string" || path === "") return null;
				const action = change["action"];
				if (action !== "set" && action !== "replace" && action !== "remove") return null;
				const digest = change["digest"];
				if (seen.has(path)) continue;
				seen.add(path);
				changes.push({
					action,
					path,
					...typeof digest === "string" ? { digest } : {}
				});
			}
			return changes.length === 0 ? null : changes;
		}
		/** Locale key for one reconciled file (the chat body's action words). */
		function instructionAction(action, baseline) {
			if (action === "remove") return "context.instructions.removed";
			if (baseline) return "context.instructions.loaded";
			return action === "set" ? "context.instructions.added" : "context.instructions.updated";
		}
		/** `instructions` form: the files this context reconciled, then their text. */
		function InstructionsBody({ content, source, t }) {
			const changes = instructionChanges(source);
			if (changes === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const baseline = asRecord(source)?.["baseline"] === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: FocusView_module_css_default.contextFiles,
				"data-context-files": true,
				children: changes.map((change) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: FocusView_module_css_default.contextFile,
					title: change.digest,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.contextFilePath,
						children: change.path
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.contextFileAction,
						children: t(instructionAction(change.action, baseline))
					})]
				}, change.path))
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** Catalog entries read off the source, or null when the record is not a usable catalog. */
		function catalogEntries(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["entries"];
			if (!Array.isArray(list)) return null;
			const entries = [];
			for (const item of list) {
				const entry = asRecord(item);
				if (entry === null) return null;
				const name = entry["name"];
				const description = entry["description"];
				if (typeof name !== "string" || name === "" || typeof description !== "string") return null;
				entries.push({
					name,
					description
				});
			}
			return entries;
		}
		/** `catalog` form: the published entries as a list, read from the source. */
		function CatalogBody({ content, source, t }) {
			const entries = catalogEntries(source);
			if (entries === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			const update = asRecord(source)?.["update"] === true;
			const shown = entries.slice(0, CONTEXT_MAX_ENTRIES);
			const rest = contentRuns(content).flatMap((run) => "block" in run ? [run.block] : []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				update && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: FocusView_module_css_default.contextNotice,
					"data-context-catalog-update": true,
					children: t("context.catalog.replaced")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: FocusView_module_css_default.contextEntries,
					"data-context-entries": true,
					children: shown.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: FocusView_module_css_default.contextEntry,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: FocusView_module_css_default.contextEntryName,
							children: entry.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.contextEntryDescription,
							children: entry.description
						})]
					}, index))
				}),
				shown.length < entries.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: FocusView_module_css_default.contextNotice,
					"data-context-entries-truncated": true,
					children: t("context.catalog.more", { count: entries.length - shown.length })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnknownBlocks, {
					blocks: rest,
					t
				})
			] });
		}
		/** Snapshot sections read off the source, or null when the record is unusable. */
		function snapshotSections(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["sections"];
			if (!Array.isArray(list)) return null;
			const sections = [];
			for (const item of list) {
				const section = asRecord(item);
				if (section === null) return null;
				const name = section["name"];
				const text = section["text"];
				if (typeof name !== "string" || name === "" || typeof text !== "string") return null;
				sections.push({
					name,
					text
				});
			}
			return sections.length === 0 ? null : sections;
		}
		/** `snapshot` form: the named contributions this snapshot assembled, in order. */
		function SnapshotBody({ content, source, t }) {
			const sections = snapshotSections(source);
			if (sections === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: FocusView_module_css_default.contextNotice,
				"data-context-snapshot-supersedes": true,
				children: t("context.snapshot.supersedes")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: FocusView_module_css_default.contextSections,
				"data-context-sections": true,
				children: sections.map((section, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.contextSection,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						className: FocusView_module_css_default.contextSectionName,
						children: section.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						className: FocusView_module_css_default.contextSectionText,
						children: boundedText(section.text, t)
					})]
				}, index))
			})] });
		}
		/** The one-line account a `notice` puts on its collapsed row, when it records one. */
		function noticeSummary(source) {
			const summary = asRecord(source)?.["summary"];
			return typeof summary === "string" && summary !== "" ? summary : null;
		}
		/** `notice` form: what just happened, with the model-facing text beneath it. */
		function NoticeBody({ content, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			});
		}
		/** The sending agent's session id, or null when the record does not name one. */
		function relaySender(source) {
			const sender = asRecord(source)?.["senderSessionId"];
			return typeof sender === "string" && sender !== "" ? sender : null;
		}
		/** `relay` form: which agent sent this, then what it said. */
		function RelayBody({ content, source, t }) {
			const sender = relaySender(source);
			if (sender === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: FocusView_module_css_default.contextRelaySender,
				"data-context-relay-sender": true,
				children: t("context.relay.from", { session: sender })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** Recalled sessions read off the source, or null when the record is unusable. */
		function recalledSessions(source) {
			const record = asRecord(source);
			const list = record === null ? void 0 : record["references"];
			if (!Array.isArray(list)) return null;
			const sessions = [];
			for (const item of list) {
				const reference = asRecord(item);
				if (reference === null) return null;
				const label = reference["label"];
				const retained = reference["retainedMessages"];
				const omitted = reference["omittedMessages"];
				const truncated = reference["truncated"];
				if (typeof label !== "string" || label === "" || typeof retained !== "number" || typeof omitted !== "number" || typeof truncated !== "boolean") return null;
				sessions.push({
					label,
					retained,
					omitted,
					truncated
				});
			}
			return sessions.length === 0 ? null : sessions;
		}
		/** `recall` form: which sessions this material came from and how much survived. */
		function RecallBody({ content, source, t }) {
			const sessions = recalledSessions(source);
			if (sessions === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, {
				content,
				source,
				t
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: FocusView_module_css_default.contextRecalls,
				"data-context-recalls": true,
				children: sessions.map((session, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: FocusView_module_css_default.contextRecall,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.contextRecallLabel,
							children: session.label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.contextRecallCounts,
							children: t("context.recall.counts", {
								retained: session.retained,
								omitted: session.omitted
							})
						}),
						session.truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.contextRecallCounts,
							children: t("context.recall.truncated")
						})
					]
				}, index))
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelFacingContent, {
				content,
				t
			})] });
		}
		/** Choose the body for one context node (the chat body's form switch). */
		function contextBody(form, props) {
			const opaque = {
				rendered: null,
				summary: null,
				body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OpaqueBody, { ...props })
			};
			switch (form) {
				case "instructions": return instructionChanges(props.source) === null ? opaque : {
					rendered: "instructions",
					summary: null,
					body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstructionsBody, { ...props })
				};
				case "catalog": return catalogEntries(props.source) === null ? opaque : {
					rendered: "catalog",
					summary: null,
					body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogBody, { ...props })
				};
				case "snapshot": return snapshotSections(props.source) === null ? opaque : {
					rendered: "snapshot",
					summary: null,
					body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SnapshotBody, { ...props })
				};
				case "notice": {
					const summary = noticeSummary(props.source);
					return summary === null ? opaque : {
						rendered: "notice",
						summary,
						body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBody, { ...props })
					};
				}
				case "relay": return relaySender(props.source) === null ? opaque : {
					rendered: "relay",
					summary: null,
					body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RelayBody, { ...props })
				};
				case "recall": return recalledSessions(props.source) === null ? opaque : {
					rendered: "recall",
					summary: null,
					body: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RecallBody, { ...props })
				};
				case null: return opaque;
				default: throw new Error(`unreachable context form: ${String(form)}`);
			}
		}
		/** Logged context-injection row (the chat ContextInjectionRow chrome: header, source, form body). */
		const ContextRow = (0, react.memo)(function ContextRow({ item, t, codeLabels }) {
			const [open, setOpen] = (0, react.useState)(false);
			const context = item.context;
			const provenance = context?.provenance;
			const label = provenance === void 0 ? null : provenance.label;
			const { rendered, summary, body } = contextBody(context?.form ?? null, {
				content: item.content,
				source: context?.source,
				t
			});
			const title = provenance !== void 0 && provenance.role !== "recall" ? t("contextInjection") : t("contextRecall");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				className: FocusView_module_css_default.contextRow,
				chevronClassName: FocusView_module_css_default.contextChevron,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 }),
				title,
				open,
				expandable: true,
				expandOnRowClick: true,
				keepContentWhenOpen: true,
				onToggle: () => {
					setOpen((value) => !value);
				},
				collapsedContent: label === null && summary === null ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [label !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.thinkSeparator,
					"aria-hidden": true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.contextSource,
					"data-context-source": true,
					children: label
				})] }), summary !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.thinkSeparator,
					"aria-hidden": true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.contextSummary,
					"data-context-summary": true,
					children: summary
				})] })] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FocusView_module_css_default.contextBody,
					"data-context-injection-body": true,
					"data-context-form": rendered ?? void 0,
					children: body
				})
			});
		});
		/** One running turn's context batch: consecutive context injections under a
		*  single collapsed line (the completed turn folds them into the turn fold
		*  instead; expanding here reveals the individual ContextRows). */
		const ContextFoldRow = (0, react.memo)(function ContextFoldRow({ item, t, codeLabels }) {
			const [open, setOpen] = (0, react.useState)(false);
			const title = item.items.length === 1 ? t("contextInjection") : t("context.fold", { count: String(item.items.length) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: FocusView_module_css_default.contextFold,
				"data-context-fold": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.contextFoldRow,
					chevronClassName: FocusView_module_css_default.contextChevron,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, { size: 14 }),
					title,
					open,
					expandable: true,
					expandOnRowClick: true,
					onToggle: () => {
						setOpen((value) => !value);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FocusView_module_css_default.contextFoldBody,
						"data-context-fold-body": true,
						children: item.items.map((inner) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
							item: inner,
							t,
							codeLabels
						}, inner.nodeKey))
					})
				})
			});
		});
		/** User / steering bubble row (the chat UserStyleBubble chrome: chips, clock, copy). */
		const MessageRow = (0, react.memo)(function MessageRow({ item, t, codeLabels }) {
			if (item.role === "context") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextRow, {
				item,
				t,
				codeLabels
			});
			const text = (0, react.useMemo)(() => messageText(item.content), [item.content]);
			const others = item.content.filter((block) => block.type !== "text");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.userRow,
				"data-role": item.role,
				"data-time-hover-root": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.bubble,
					children: [projectUserText(text), others.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("extraBlock"),
						payload: block,
						truncatedLabel: jsonTruncated(t)
					}, index))]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageActions, {
					text,
					time: item.time,
					runMs: null,
					ttftMs: null,
					tokensPerSecond: null,
					clock: "start",
					t
				})]
			});
		});
		/** Files past this stay counted but unlisted: a refactor turn must not bury the answer. */
		const PRODUCED_SHOWN = 6;
		/** One completed turn's footer: the produced-files row and the chat actions chrome. */
		const TurnTailRow = (0, react.memo)(function TurnTailRow({ item, openFile, forkAt, t }) {
			const shown = item.produced.slice(0, PRODUCED_SHOWN);
			const hidden = item.produced.length - shown.length;
			const closingSeq = item.closingSeq;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.turnTail,
				"data-turn-tail": item.turn,
				"data-time-hover-root": true,
				children: [shown.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.producedRow,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.producedLabel,
							children: t("produced.label")
						}),
						shown.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: FocusView_module_css_default.producedFile,
							title: path,
							"aria-label": t("produced.open", { name: path }),
							onClick: () => {
								openFile(path);
							},
							children: basename(path)
						}, path)),
						hidden > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.producedMore,
							children: t("produced.more", { count: String(hidden) })
						})
					]
				}), closingSeq !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageActions, {
					text: item.closingText,
					time: item.closingTime,
					runMs: item.runMs,
					ttftMs: item.ttftMs,
					tokensPerSecond: item.tokensPerSecond,
					clock: "end",
					onBranch: () => {
						forkAt(closingSeq);
					},
					branchUnavailable: item.branchUnavailable,
					t
				})]
			});
		});
		/** One Host-authoritative pending steering item (the chat pending bubble shape). */
		const PendingSteeringBubble = (0, react.memo)(function PendingSteeringBubble({ content, t }) {
			const text = (0, react.useMemo)(() => messageText(content), [content]);
			const others = content.filter((block) => block.type !== "text");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.userRow,
				"data-pending-steering": true,
				"data-time-hover-root": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.bubble,
					children: [projectUserText(text), others.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("extraBlock"),
						payload: block,
						truncatedLabel: jsonTruncated(t)
					}, index))]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageActions, {
					text,
					time: null,
					runMs: null,
					ttftMs: null,
					tokensPerSecond: null,
					clock: "start",
					t
				})]
			});
		});
		/** One command row (the chat GenericCommandCard chrome: name · settlement, expandable multiline body). */
		const CommandRow = (0, react.memo)(function CommandRow({ item, runningSummary, t }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const text = item.outcomeText;
			const summary = item.running ? runningSummary ?? t("command.running") : text ?? (item.outcomeError ? t("command.failed") : t("command.done"));
			const title = item.name ?? t("command");
			const body = text !== null && text.includes("\n") ? text : null;
			const open = expanded && body !== null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.commandRow,
				"data-state": item.running ? "running" : item.outcomeError ? "error" : "ok",
				children: [item.running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.visuallyHidden,
					children: t("row.running")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.commandRowInner,
					icon: item.outcomeError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, { size: 14 }),
					title,
					open,
					expandable: body !== null,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.thinkSeparator,
						"aria-hidden": true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.commandSummary,
						"data-error": item.outcomeError || void 0,
						children: summary
					})] }),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: FocusView_module_css_default.commandBody,
						"data-error": item.outcomeError || void 0,
						children: body
					})
				})]
			});
		});
		/** One landed-compaction marker (the chat CompactionItem chrome). */
		const CompactionRow = (0, react.memo)(function CompactionRow({ item, title, fallbackSummary, t, codeLabels }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const expandable = item.summary !== null;
			const open = expandable && expanded;
			const summary = item.shadowedItemCount !== null && item.shadowedTokenCount !== null ? t("compaction.completed", {
				items: item.shadowedItemCount,
				tokens: item.shadowedTokenCount
			}) : fallbackSummary ?? (expandable ? t("compaction.expand") : t("compaction.unavailable"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.compactionRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: FocusView_module_css_default.compactionButton,
					disabled: !expandable,
					"aria-expanded": expandable ? open : void 0,
					onClick: () => {
						setExpanded((value) => !value);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: FocusView_module_css_default.compactionLeading,
							"aria-hidden": true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FocusView_module_css_default.compactionContextIcon,
								"data-compaction-icon": "context",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconApiOutline14, {})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FocusView_module_css_default.compactionDisclosureIcon,
								"data-compaction-disclosure": open ? "expanded" : "collapsed",
								children: !open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.compactionTitle,
							children: title ?? t("compaction")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.compactionSep,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.compactionSummary,
							children: summary
						})
					]
				}), open && item.summary !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FocusView_module_css_default.compactionBody,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
						text: item.summary,
						codeLabels
					})
				})]
			});
		});
		/** One manual `/compact` lifecycle: the command card, or the checkpoint marker. */
		const ManualCompactionRow = (0, react.memo)(function ManualCompactionRow({ item, t, codeLabels }) {
			if (item.compaction !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CompactionRow, {
				item: {
					kind: "compaction",
					nodeKey: item.nodeKey,
					summary: item.compaction.summary,
					shadowedItemCount: item.compaction.shadowedItemCount,
					shadowedTokenCount: item.compaction.shadowedTokenCount
				},
				title: "compact",
				fallbackSummary: item.outcomeText,
				t,
				codeLabels
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandRow, {
				item: {
					kind: "command",
					nodeKey: item.nodeKey,
					name: item.name,
					args: null,
					outcomeText: item.outcomeText,
					outcomeError: false,
					running: item.running
				},
				runningSummary: t("compaction.running"),
				t
			});
		});
		/** One model-retry row (the chat ModelRetryItem chrome: countdown + details). */
		const RetryRow = (0, react.memo)(function RetryRow({ item, t }) {
			const deadline = (0, react.useMemo)(() => Date.now() + item.delayMs, [item.delayMs, item.nodeKey]);
			const scheduledSeconds = retrySeconds(item.delayMs);
			const maximum = item.mode === "normal" ? item.maxRetries : "∞";
			const [countdown, setCountdown] = (0, react.useState)(() => ({
				deadline,
				seconds: retrySeconds(deadline - Date.now())
			}));
			const remainingSeconds = countdown.deadline === deadline ? countdown.seconds : retrySeconds(deadline - Date.now());
			(0, react.useEffect)(() => {
				if (item.retryState !== "scheduled") return;
				const updateCountdown = () => {
					const next = retrySeconds(deadline - Date.now());
					setCountdown((current) => current.deadline === deadline && current.seconds === next ? current : {
						deadline,
						seconds: next
					});
					return next;
				};
				if (updateCountdown() === 1) return;
				const timer = window.setInterval(() => {
					if (updateCountdown() === 1) window.clearInterval(timer);
				}, 250);
				return () => {
					window.clearInterval(timer);
				};
			}, [item.retryState, deadline]);
			const active = item.retryState === "scheduled";
			const label = active ? t("retry.active") : item.retryState === "cancelled" ? t("retry.cancelled") : t("retry.started");
			const seconds = active ? remainingSeconds : scheduledSeconds;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: FocusView_module_css_default.retryRow,
				"data-active": active || void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
					className: FocusView_module_css_default.retrySummary,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.retryText,
						role: "status",
						children: t("retry.status", {
							label,
							retry: item.retry,
							maximum: String(maximum),
							seconds
						})
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.retryDetails,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: FocusView_module_css_default.retryDetailLabel,
							children: t("retry.delay")
						}),
						Math.round(item.delayMs),
						"ms"
					] }), item.failure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: FocusView_module_css_default.retryDetailLabel,
						children: t("retry.failure")
					}), item.failure.message] })]
				})]
			});
		});
		/** Whole seconds, one minimum (the chat retry countdown's rhythm). */
		function retrySeconds(milliseconds) {
			return Math.max(1, Math.ceil(milliseconds / 1e3));
		}
		/** One completed turn's work line: every intermediate assistant row and tool
		*  run folded under `工作了 X 分 Y 秒`, expandable back to the full rows. */
		const TurnFoldRow = (0, react.memo)(function TurnFoldRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const duration = formatElapsed(item.durationMs, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: FocusView_module_css_default.turnFold,
				"data-turn-fold": item.turn,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					className: FocusView_module_css_default.turnFoldRow,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, { size: 16 }),
					title: item.stopped ? t("turnFold.stopped", { duration }) : t("worked", { duration }),
					open: expanded,
					expandable: true,
					expandOnRowClick: true,
					onToggle: () => {
						setExpanded((value) => !value);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: FocusView_module_css_default.turnFoldBody,
						"data-turn-fold-body": true,
						children: item.items.map((inner) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FlowRow, {
							item: inner,
							t,
							codeLabels,
							openFile,
							forkAt,
							mentionsByKey
						}, flowKey(inner)))
					})
				})
			});
		});
		/** One condensed flow row, dispatched on kind. */
		const FlowRow = (0, react.memo)(function FlowRow({ item, t, codeLabels, openFile, forkAt, mentionsByKey }) {
			switch (item.kind) {
				case "message": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
					item,
					t,
					codeLabels
				});
				case "context-fold": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContextFoldRow, {
					item,
					t,
					codeLabels
				});
				case "assistant": {
					if (!item.running && !item.interrupted && !item.blocks.some((block) => block.kind !== "tool-call")) return null;
					const last = item.blocks.length - 1;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: FocusView_module_css_default.assistant,
						"data-streaming": item.running || void 0,
						children: [item.blocks.map((block, index) => {
							switch (block.kind) {
								case "text": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
									text: block.text,
									streaming: item.running,
									codeLabels,
									fileMentions: mentionsByKey.get(item.nodeKey)
								}, index);
								case "reasoning": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThinkRow, {
									text: block.text,
									running: item.running && index === last,
									title: item.running || item.thoughtMs === null ? t("think") : t("thought.duration", { n: formatSeconds(item.thoughtMs) }),
									t
								}, index);
								case "tool-call": return null;
								default: return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
									label: t("unknownBlock"),
									payload: block.block,
									truncatedLabel: jsonTruncated(t)
								}, index);
							}
						}), item.interrupted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: FocusView_module_css_default.stopped,
							children: t("stopped")
						})]
					});
				}
				case "tools": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolGroupRow, {
					group: item.group,
					t,
					codeLabels,
					openFile
				});
				case "turn-fold": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnFoldRow, {
					item,
					t,
					codeLabels,
					openFile,
					forkAt,
					mentionsByKey
				});
				case "turn-tail": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TurnTailRow, {
					item,
					openFile,
					forkAt,
					t
				});
				case "command": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandRow, {
					item,
					t
				});
				case "manual-compaction": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManualCompactionRow, {
					item,
					t,
					codeLabels
				});
				case "compaction": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CompactionRow, {
					item,
					t,
					codeLabels
				});
				case "retry": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RetryRow, {
					item,
					t
				});
				case "turn-error": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: FocusView_module_css_default.turnErrorRow,
					role: "status",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
							state: "error",
							className: FocusView_module_css_default.turnErrorDot
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: FocusView_module_css_default.turnErrorCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FocusView_module_css_default.turnErrorTitle,
								children: t("turnError")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: FocusView_module_css_default.turnErrorMessage,
								children: item.message
							})]
						}),
						item.code !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: FocusView_module_css_default.turnErrorCode,
							children: item.code
						})
					]
				});
				case "unknown": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: FocusView_module_css_default.contextRow,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonBlock, {
						label: t("unknownSurface", { type: item.nodeKind }),
						payload: item.data,
						truncatedLabel: jsonTruncated(t)
					})
				});
			}
		});
		/** Stable React key for one flow item. */
		function flowKey(item) {
			// v8 ignore next -- ?? arm: folded groups always carry at least one node key
			return item.kind === "tools" ? item.group.nodeKeys[0] ?? "tools" : item.nodeKey;
		}
		/** Latest open turn's logged start time, mirroring the chat view's clock anchor. */
		function runningTurnStartTime(timeline) {
			let latest = null;
			for (const turn of timeline.turns.values()) if (turn.status === "open" && turn.start !== void 0) latest = turn.start.time;
			return latest;
		}
		/** Elapsed clock copy: whole seconds, minute-padded past 60 (the chat view's rhythm). */
		function formatElapsed(ms, t) {
			const total = Math.max(0, Math.floor(ms / 1e3));
			const minutes = Math.floor(total / 60);
			const seconds = total % 60;
			return minutes > 0 ? t("duration.minutes", {
				minutes,
				seconds: String(seconds).padStart(2, "0")
			}) : t("duration.seconds", { seconds });
		}
		/** Turn-level running signal: "Deep diving..." plus an elapsed clock past 15s. */
		function RunningStatus({ startTime, t }) {
			const [mountedAt] = (0, react.useState)(() => Date.now());
			const anchor = startTime ?? mountedAt;
			const [elapsedMs, setElapsedMs] = (0, react.useState)(() => Math.max(0, Date.now() - anchor));
			(0, react.useEffect)(() => {
				const tick = () => {
					setElapsedMs(Math.max(0, Date.now() - anchor));
				};
				tick();
				const id = setInterval(tick, 1e3);
				return () => {
					clearInterval(id);
				};
			}, [anchor]);
			const showClock = elapsedMs >= 15e3;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: FocusView_module_css_default.turnStatus,
				role: "status",
				"aria-live": "polite",
				children: [t("status.diving"), showClock && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: FocusView_module_css_default.turnStatusClock,
					"aria-hidden": true,
					children: formatElapsed(elapsedMs, t)
				})]
			});
		}
		/** Active conversation column host when present; otherwise the view-local scroller. */
		function scrollerOf(from) {
			return from.closest("[data-conversation-scroll]") ?? from;
		}
		/** Find an already-rendered settled flow row without interpolating a selector. */
		function anchorElement(list, key) {
			for (const row of list.querySelectorAll("[data-focus-anchor-key]")) if (row.dataset.focusAnchorKey === key) return row;
			return null;
		}
		/** Row position in scrollport coordinates (viewport-independent). */
		function flowTop(row, scrollport) {
			return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
		}
		/** Select a visible stable flow identity, falling back only when layout has not exposed a visible box yet. */
		function pagingAnchor(list, scrollport) {
			const viewport = scrollport.getBoundingClientRect();
			const visibleBottom = scrollport.querySelector("[data-composer-seat]")?.getBoundingClientRect().top ?? viewport.bottom;
			if (typeof document.elementsFromPoint === "function" && visibleBottom > viewport.top) {
				const content = list.getBoundingClientRect();
				const left = Math.max(viewport.left, content.left);
				const right = Math.min(viewport.right, content.right);
				const x = left + Math.max(0, right - left) / 2;
				const height = visibleBottom - viewport.top;
				const points = [
					1,
					Math.min(32, height / 3),
					height / 2,
					Math.max(1, height - 1)
				];
				for (const offset of points) for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
					const row = element instanceof HTMLElement ? element.closest("[data-focus-anchor-key]") : null;
					if (row !== null && list.contains(row)) return row;
				}
			}
			const rows = [...list.querySelectorAll("[data-focus-anchor-key]")];
			return rows.filter((row) => {
				const rect = row.getBoundingClientRect();
				return rect.bottom > viewport.top && rect.top < visibleBottom;
			})[0] ?? rows[0] ?? null;
		}
		/** Capture a reflow-resistant reader position from the current rendered window. */
		function scrollPosition(list, scrollport) {
			const row = pagingAnchor(list, scrollport);
			const anchorKey = row?.dataset.focusAnchorKey;
			if (row === null || anchorKey === void 0) return null;
			return {
				anchorKey,
				anchorTop: flowTop(row, scrollport),
				scrollTop: scrollport.scrollTop
			};
		}
		/**
		* The focus view slot entry: pure component over the composed props. Scroll
		* follows the chat view's ledger: the resolved scrollport (the shared
		* conversation column in the app, the view itself in tests) keeps reader
		* positions saved continuously on scroll and restored on mount.
		* @param props - conversation view standard kit and the focus locale seat.
		*/
		function FocusView({ useSession, sessionId, useSessions, loadOlder, openFile, forkAt, fileMentions, scroll, t }) {
			const chat = useSession((s) => s.chat);
			const running = useSession((s) => s.running);
			const hasMore = useSession((s) => s.hasMore);
			const loadingOlder = useSession((s) => s.loadingOlder);
			const inbox = useSession((s) => s.queue);
			const openState = useSession((s) => s.openState);
			const openError = useSession((s) => s.openError);
			const cwd = useSessions((s) => s.byId[sessionId]?.cwd);
			const flow = (0, react.useMemo)(() => buildFocusFlow(chat.order, (key) => chat.nodes.get(key), cwd), [chat, cwd]);
			const runningCalls = (0, react.useMemo)(() => {
				const rows = [];
				for (const item of flow) {
					if (item.kind !== "tools" || !item.group.running) continue;
					for (const row of item.group.items) if ("callId" in row && row.state === "running") rows.push(row);
				}
				return rows;
			}, [flow]);
			const runningTurnStart = (0, react.useMemo)(() => runningTurnStartTime(chat.timeline), [chat.timeline]);
			const codeLabels = (0, react.useMemo)(() => ({
				copyLabel: t("copy"),
				copiedLabel: t("copied")
			}), [t]);
			const pendingSteering = (0, react.useMemo)(() => inbox.filter((item) => item.placement === "steering"), [inbox]);
			const mentionsByKey = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const item of flow) {
					if (item.kind !== "assistant" || item.finalSeq === null) continue;
					const location = chat.nodes.get(item.nodeKey)?.location;
					const turn = location?.kind === "turn" || location?.kind === "step" ? location.turn : void 0;
					const tail = turn?.data.get("turn-tail");
					if (turn === void 0 || tail?.closing?.finalNode.seq !== item.finalSeq) continue;
					map.set(item.nodeKey, fileMentions({
						turn,
						seq: item.finalSeq,
						openFile
					}));
				}
				return map;
			}, [
				chat,
				fileMentions,
				flow,
				openFile
			]);
			const listRef = (0, react.useRef)(null);
			const columnRef = (0, react.useRef)(null);
			const atBottomRef = (0, react.useRef)(true);
			const [atBottom, setAtBottom] = (0, react.useState)(true);
			/** Last position delivered or written on the main thread. */
			const observedTopRef = (0, react.useRef)(0);
			/** Paging anchor: semantic row/position at click, restored after the prepend lands. */
			const anchorRef = (0, react.useRef)(null);
			const openedRef = (0, react.useRef)(false);
			const firstKeyRef = (0, react.useRef)(null);
			const lastKeyRef = (0, react.useRef)(null);
			/** Flow tip signature — follow-scroll only when this moves, never on a
			*  scroll-driven chrome re-render. */
			const followSigRef = (0, react.useRef)(null);
			const lastItem = flow.at(-1);
			const firstKey = flow[0] === void 0 ? null : flowKey(flow[0]);
			const lastKey = lastItem === void 0 ? null : flowKey(lastItem);
			const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null;
			const followSig = `${openState}:${firstKey}:${lastKey}:${flow.length}:${running ? 1 : 0}:${lastSteeringId ?? ""}`;
			const toBottom = (el) => {
				anchorRef.current = null;
				el.scrollTop = el.scrollHeight;
				observedTopRef.current = el.scrollTop;
				atBottomRef.current = true;
				setAtBottom(true);
				scroll.save(null);
			};
			(0, react.useLayoutEffect)(() => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
				if (local === null) return;
				const el = scrollerOf(local);
				if (openState === "open" && !openedRef.current) {
					openedRef.current = true;
					const saved = scroll.read();
					if (saved === null) toBottom(el);
					else {
						el.scrollTop = saved.scrollTop;
						const row = anchorElement(local, saved.anchorKey);
						if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop;
						observedTopRef.current = el.scrollTop;
						const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 25;
						atBottomRef.current = isAtBottom;
						setAtBottom(isAtBottom);
						scroll.save(isAtBottom ? null : scrollPosition(local, el));
					}
					firstKeyRef.current = firstKey;
					lastKeyRef.current = lastKey;
					followSigRef.current = followSig;
					return;
				}
				if (anchorRef.current !== null && firstKey !== null && firstKeyRef.current !== null && firstKey !== firstKeyRef.current) {
					const anchor = anchorRef.current;
					anchorRef.current = null;
					const row = anchorElement(local, anchor.key);
					if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top;
					observedTopRef.current = el.scrollTop;
					firstKeyRef.current = firstKey;
					lastKeyRef.current = lastKey;
					followSigRef.current = followSig;
					return;
				}
				firstKeyRef.current = firstKey;
				const appendedUser = lastKey !== lastKeyRef.current && lastItem?.kind === "message" && (lastItem.role === "user" || lastItem.role === "steering");
				const tipMoved = followSigRef.current !== followSig;
				lastKeyRef.current = lastKey;
				followSigRef.current = followSig;
				if (appendedUser || tipMoved && atBottomRef.current) toBottom(el);
			});
			const onScrollRef = (0, react.useRef)(() => {});
			onScrollRef.current = () => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
				if (local === null) return;
				const el = scrollerOf(local);
				const floor = Math.max(0, el.scrollHeight - el.clientHeight);
				const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > .5;
				const isAtBottom = movedByReader ? floor - el.scrollTop <= 25 : atBottomRef.current;
				if (!movedByReader && isAtBottom) {
					toBottom(el);
					return;
				}
				atBottomRef.current = isAtBottom;
				setAtBottom(isAtBottom);
				const position = isAtBottom ? null : scrollPosition(local, el);
				if (isAtBottom) anchorRef.current = null;
				else if (anchorRef.current !== null && position !== null) anchorRef.current = {
					key: position.anchorKey,
					top: position.anchorTop
				};
				if (isAtBottom) scroll.save(null);
				else if (position !== null) scroll.save(position);
				observedTopRef.current = el.scrollTop;
			};
			(0, react.useEffect)(() => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
				if (local === null) return;
				const el = scrollerOf(local);
				const onScroll = () => {
					onScrollRef.current();
				};
				el.addEventListener("scroll", onScroll, { passive: true });
				return () => {
					el.removeEventListener("scroll", onScroll);
				};
			}, []);
			const followRef = (0, react.useRef)(null);
			followRef.current = () => {
				const local = listRef.current;
				if (local !== null && atBottomRef.current) {
					const el = scrollerOf(local);
					el.scrollTop = el.scrollHeight;
					observedTopRef.current = el.scrollTop;
					scroll.save(null);
				}
			};
			(0, react.useEffect)(() => {
				const column = columnRef.current;
				const local = listRef.current;
				if (column === null || local === null || typeof ResizeObserver === "undefined") return;
				const composer = scrollerOf(local).querySelector("[data-composer-seat]");
				const observer = new ResizeObserver(() => {
					followRef.current?.();
				});
				observer.observe(column);
				if (composer !== null) observer.observe(composer);
				return () => {
					observer.disconnect();
				};
			}, []);
			const loadOlderAnchored = () => {
				const local = listRef.current;
				/* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
				if (local !== null) {
					const el = scrollerOf(local);
					const row = pagingAnchor(local, el);
					if (row !== null && row.dataset.focusAnchorKey !== void 0) anchorRef.current = {
						key: row.dataset.focusAnchorKey,
						top: flowTop(row, el)
					};
				}
				loadOlder();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: FocusView_module_css_default.root,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: listRef,
					className: FocusView_module_css_default.scroll,
					"data-focus-scroll": "",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: columnRef,
						className: FocusView_module_css_default.column,
						"data-focus-flow": "",
						children: [
							openState === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.hint,
								children: t("loadingHistory")
							}),
							openState === "error" && openError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.openError,
								children: t("loadError", {
									message: openError.message,
									code: openError.code
								})
							}),
							hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.older,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: FocusView_module_css_default.olderButton,
									disabled: loadingOlder,
									onClick: loadOlderAnchored,
									children: loadingOlder ? t("loading") : t("loadOlder")
								})
							}),
							flow.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.empty,
								children: t("empty")
							}),
							flow.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.flowItem,
								"data-focus-anchor-key": flowKey(item),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FlowRow, {
									item,
									t,
									codeLabels,
									openFile,
									forkAt,
									mentionsByKey
								})
							}, flowKey(item))),
							runningCalls.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.flowItem,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: FocusView_module_css_default.runningCalls,
									"data-running-calls": true,
									children: runningCalls.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolCallRow, {
										row,
										t,
										openFile
									}, row.callId))
								})
							}),
							running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunningStatus, {
								startTime: runningTurnStart,
								t
							}),
							pendingSteering.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PendingSteeringBubble, {
								content: item.content,
								t
							}, item.id)),
							!atBottom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: FocusView_module_css_default.toBottomSlot,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: FocusView_module_css_default.toBottom,
									"aria-label": t("toBottom"),
									onClick: () => {
										const local = listRef.current;
										/* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
										if (local !== null) toBottom(scrollerOf(local));
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
								})
							})
						]
					})
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** `focus` namespace dictionaries (the focus view's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"view.label": "聚焦对话",
			"copy": "复制",
			"copied": "已复制",
			"tool.group": "运行了 {n} 个命令",
			"tool.group.one": "运行了 {n} 个命令",
			"tool.commands": "运行了 {n} 个命令",
			"tool.commands.one": "运行了 {n} 个命令",
			"tool.searches": "搜索了 {n} 个正则",
			"tool.searches.one": "搜索了 {n} 个正则",
			"tool.thought": "思考了 {n} 秒",
			"tool.context": "载入了 {n} 项上下文",
			"tool.context.one": "载入了 1 项上下文",
			"tool.edits": "编辑了 {n} 次",
			"tool.edits.one": "编辑了 1 次",
			"tool.failedSuffix": "（{n} 次失败）",
			"tool.failedAll": "（全部失败）",
			"tool.failed.commands.one": "命令失败",
			"tool.failed.edits.one": "编辑失败",
			"tool.failed.searches.one": "搜索失败",
			"worked": "工作了 {duration}",
			"turnFold.stopped": "用户 {duration}后停止",
			"context.fold": "上下文注入 · {count} 项",
			"tool.explored.files": "读取了 {n} 个文件",
			"tool.explored.files.one": "读取了 {n} 个文件",
			"tool.explored.dirs": "列出了 {n} 个目录",
			"tool.explored.dirs.one": "列出了 {n} 个目录",
			"tool.explored.both": "读取了 {files} 个文件，列出了 {dirs} 个目录",
			"tool.others": "调用了 {n} 个工具",
			"tool.others.one": "调用了 {n} 个工具",
			"tool.separator": "，",
			"status.diving": "Deep diving...",
			"duration.seconds": "{seconds} 秒",
			"duration.minutes": "{minutes} 分 {seconds} 秒",
			"tool.input": "输入",
			"row.running": "运行中",
			"row.failed": "失败",
			"row.stopped": "已停止",
			"extraBlock": "附加内容块",
			"terminal.signal": "信号 {signal}",
			"terminal.exitCode": "退出码 {code}",
			"terminal.running": "运行中",
			"terminal.failed": "失败",
			"terminal.done": "已完成",
			"terminal.noOutput": "无输出",
			"terminal.collapseAria": "收起输出",
			"terminal.collapse": "收起",
			"terminal.expandAria": "展开其余 {n} 行输出",
			"terminal.expand": "… 其余 {n} 行",
			"tool.expandAria": "展开工具详情",
			"tool.collapseAria": "收起工具详情",
			"loadOlder": "加载更早的消息",
			"loading": "加载中…",
			"think": "Think",
			"thought.duration": "思考了 {n} 秒",
			"thought.expandAria": "展开思考内容",
			"stopped": "已停止",
			"command": "命令",
			"command.running": "执行中…",
			"command.done": "已完成",
			"command.failed": "命令失败",
			"compaction": "上下文已压缩",
			"compaction.completed": "已压缩 {items} 条历史记录（约 {tokens} tokens）",
			"compaction.expand": "点击查看压缩摘要",
			"compaction.unavailable": "压缩摘要不可用",
			"compaction.running": "正在压缩…",
			"contextInjection": "上下文注入",
			"contextRecall": "跨会话召回",
			"context.instructions.loaded": "已载入",
			"context.instructions.added": "已新增",
			"context.instructions.updated": "已更新",
			"context.instructions.removed": "已移除",
			"context.catalog.replaced": "替换目录",
			"context.catalog.more": "…还有 {count} 条",
			"context.snapshot.supersedes": "取代先前的快照",
			"context.relay.from": "来自会话 {session}",
			"context.recall.counts": "保留 {retained} 条 · 省略 {omitted} 条",
			"context.recall.truncated": "已截断",
			"unknownSurface": "未知 surface 事件：{type}",
			"unknownBlock": "未知内容块",
			"retry.active": "正在重试模型请求",
			"retry.scheduled": "等待重试模型请求",
			"retry.started": "已重试模型请求",
			"retry.cancelled": "模型请求重试已取消",
			"retry.status": "{label}（{retry}/{maximum}） · {seconds}s",
			"retry.delay": "重试延迟：",
			"retry.failure": "失败原因：",
			"turnError": "本轮运行失败",
			"loadingHistory": "载入历史…",
			"loadError": "历史加载失败：{message}（{code}）",
			"toBottom": "回到底部",
			"ranFor": "用时 {duration}",
			"ttft": "首 token {seconds}秒",
			"tokensPerSecond": "{tps} tok/s",
			"branch": "在新对话中分支",
			"branchUnavailable": "仅可从已完成轮次的最后一条消息分支",
			"produced.label": "产物",
			"produced.more": "还有 {count} 个",
			"produced.open": "打开 {name}",
			"clock.md": "{m}月{d}日",
			"clock.ymd": "{y}年{m}月{d}日",
			"json.truncated": "… 已截断，共 {total} 字符",
			"empty": "暂无消息"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"view.label": "Focus chat",
			"copy": "Copy",
			"copied": "Copied",
			"tool.group": "ran {n} commands",
			"tool.group.one": "ran {n} command",
			"tool.commands": "ran {n} shell commands",
			"tool.commands.one": "ran {n} shell command",
			"tool.searches": "searched for {n} patterns",
			"tool.searches.one": "searched for {n} pattern",
			"tool.thought": "Thought for {n}s",
			"tool.context": "loaded {n} context items",
			"tool.context.one": "loaded {n} context item",
			"tool.edits": "edited {n} files",
			"tool.edits.one": "edited {n} file",
			"tool.failedSuffix": " ({n} failed)",
			"tool.failedAll": " (all failed)",
			"tool.failed.commands.one": "Command failed",
			"tool.failed.edits.one": "Edit failed",
			"tool.failed.searches.one": "Search failed",
			"worked": "Worked for {duration}",
			"turnFold.stopped": "Stopped after {duration}",
			"context.fold": "Context injection · {count} items",
			"tool.explored.files": "read {n} files",
			"tool.explored.files.one": "read {n} file",
			"tool.explored.dirs": "listed {n} directories",
			"tool.explored.dirs.one": "listed {n} directory",
			"tool.explored.both": "read {files} files, listed {dirs} directories",
			"tool.others": "called {n} tools",
			"tool.others.one": "called {n} tool",
			"tool.separator": ", ",
			"status.diving": "Deep diving...",
			"duration.seconds": "{seconds}s",
			"duration.minutes": "{minutes}m {seconds}s",
			"tool.input": "Input",
			"row.running": "Running",
			"row.failed": "Failed",
			"row.stopped": "Stopped",
			"extraBlock": "Extra content block",
			"terminal.signal": "signal {signal}",
			"terminal.exitCode": "exit code {code}",
			"terminal.running": "Running",
			"terminal.failed": "Failed",
			"terminal.done": "Done",
			"terminal.noOutput": "No output",
			"terminal.collapseAria": "Collapse output",
			"terminal.collapse": "Collapse",
			"terminal.expandAria": "Expand the remaining {n} output lines",
			"terminal.expand": "… {n} more lines",
			"tool.expandAria": "Expand tool details",
			"tool.collapseAria": "Collapse tool details",
			"loadOlder": "Load earlier messages",
			"loading": "Loading…",
			"think": "Think",
			"thought.duration": "Thought for {n}s",
			"thought.expandAria": "Expand thinking",
			"stopped": "Stopped",
			"command": "Command",
			"command.running": "Running…",
			"command.done": "Completed",
			"command.failed": "Command failed",
			"compaction": "Context compacted",
			"compaction.completed": "Compacted {items} history items (~{tokens} tokens)",
			"compaction.expand": "View compaction summary",
			"compaction.unavailable": "Compaction summary unavailable",
			"compaction.running": "Compacting context…",
			"contextInjection": "Context injection",
			"contextRecall": "Session recall",
			"context.instructions.loaded": "loaded",
			"context.instructions.added": "added",
			"context.instructions.updated": "updated",
			"context.instructions.removed": "removed",
			"context.catalog.replaced": "Replacement catalog",
			"context.catalog.more": "… {count} more",
			"context.snapshot.supersedes": "Supersedes earlier snapshots",
			"context.relay.from": "From session {session}",
			"context.recall.counts": "{retained} kept · {omitted} omitted",
			"context.recall.truncated": "truncated",
			"unknownSurface": "Unknown surface event: {type}",
			"unknownBlock": "Unknown content block",
			"retry.active": "Retrying model request",
			"retry.scheduled": "Waiting to retry model request",
			"retry.started": "Retried model request",
			"retry.cancelled": "Model request retry cancelled",
			"retry.status": "{label} ({retry}/{maximum}) · {seconds}s",
			"retry.delay": "Retry delay: ",
			"retry.failure": "Failure reason: ",
			"turnError": "This turn failed",
			"loadingHistory": "Loading history…",
			"loadError": "Failed to load history: {message} ({code})",
			"toBottom": "Back to bottom",
			"ranFor": "Ran for {duration}",
			"ttft": "TTFT {seconds}s",
			"tokensPerSecond": "{tps} tok/s",
			"branch": "Branch into a new conversation",
			"branchUnavailable": "Available only on the last message of a completed turn",
			"produced.label": "Produced",
			"produced.more": "{count} more",
			"produced.open": "Open {name}",
			"clock.md": "{m}/{d}",
			"clock.ymd": "{y}-{m}-{d}",
			"json.truncated": "… truncated, {total} chars",
			"empty": "No messages yet"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "focus";
		/** Required services: the conversation view slot, the locale registry, sessions, and the host opener. */
		const inject = [
			"slots",
			"locale",
			"sessions",
			"workspaces"
		];
		/**
		* Client plugin body: register the focus view tab.
		* The registration rides the slot service's effect wrapper, so plugin unload
		* removes the tab.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-focus-chat: dictionaries");
			const t = ctx.locale.bind(NS);
			const focusScrollPositions = /* @__PURE__ */ new Map();
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "focus",
				order: 5,
				label: () => t("view.label"),
				locale: NS,
				inject: (sessionId) => ({
					loadOlder: () => {
						(ctx.sessions.scope(sessionId)?.get("conversation"))?.loadOlder();
					},
					openFile: (path) => {
						const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
						ctx.workspaces.openPath((0, _deepseek_ai_dsh_client_runtime_client.resolveWorkspacePath)(cwd, path)).catch(() => {});
					},
					forkAt: (seq) => {
						ctx.sessions.fork({
							sessionId,
							atSeq: seq,
							increaseTitle: true
						}).then((childId) => {
							ctx.sessions.open(childId);
						}).catch(() => {});
					},
					fileMentions: (owner) => {
						return ctx.get("chatFileMentions")?.forClosing(owner);
					},
					scroll: {
						save: (position) => {
							focusScrollPositions.set(sessionId, position);
						},
						read: () => focusScrollPositions.get(sessionId) ?? null
					}
				})
			}, FocusView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map