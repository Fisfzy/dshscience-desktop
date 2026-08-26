window.__ModuleLoader__.load({
	id: "dsh-danus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/**
		* client/api.ts — Danus Console 的同源 API 封装与 wire 类型。
		*
		* 全部端点由 host half 提供(src/plugins/observability.ts 只读统计 +
		* src/plugins/console-api.ts 操作路由),浏览器端经同源 fetch 访问。
		* 注意:overview / factgraph / channels / channel 由 observability 提供,
		* 项目固定在 host 侧(忽略 ?project=);workers / worker-log / export /
		* gm / fact 路由按 ?project= 寻址。
		*/
		const BASE = "/danus/api";
		/** 11 种 global-memory 频道(与 host CHANNELS 对齐,含语义角色)。 */
		const CHANNEL_KINDS = [
			["conclusion", "result"],
			["example", "result"],
			["counterexample", "result"],
			["proof_attempt", "result"],
			["plan", "judgment"],
			["direction", "judgment"],
			["obstacle", "deadend"],
			["dead_end", "deadend"],
			["verification", "verify"],
			["elaboration", "strategy"],
			["master_guidance", "strategy"]
		];
		function channelRole(kind) {
			return CHANNEL_KINDS.find(([k]) => k === kind)?.[1] ?? "result";
		}
		var ApiError = class extends Error {
			status;
			constructor(message, status) {
				super(message);
				this.status = status;
			}
		};
		async function request(path, init) {
			const res = await fetch(`${BASE}${path}`, {
				headers: { accept: "application/json" },
				...init
			});
			const text = await res.text();
			let data = null;
			try {
				data = text ? JSON.parse(text) : null;
			} catch {}
			if (!res.ok) {
				const detail = data?.detail;
				throw new ApiError(typeof detail === "string" ? detail : `HTTP ${res.status}`, res.status);
			}
			return data;
		}
		function post(path, body) {
			return request(path, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json"
				},
				body: JSON.stringify(body)
			});
		}
		const enc = encodeURIComponent;
		const api = {
			overview: () => request("/overview"),
			factgraph: () => request("/factgraph"),
			channels: () => request("/channels"),
			channel: (kind) => request(`/channel/${enc(kind)}`),
			projects: () => request("/workers"),
			workers: (project) => request(`/workers?project=${enc(project)}`),
			workerLog: (project, worker, tail = 200) => request(`/worker-log?project=${enc(project)}&worker=${enc(worker)}&tail=${tail}`),
			exportUrl: (project, format) => `${BASE}/export?project=${enc(project)}&format=${format}`,
			assign: (project, worker, task) => post("/assign", {
				project,
				worker,
				task
			}),
			startWorker: (target) => post("/worker/start", { target }),
			stopWorker: (target, force) => post("/worker/stop", {
				target,
				force
			}),
			gmAdd: (project, body) => post(`/gm/add?project=${enc(project)}`, body),
			gmStatus: (project, id, status, factId) => post(`/gm/status?project=${enc(project)}`, factId ? {
				id,
				status,
				fact_id: factId
			} : {
				id,
				status
			}),
			revokeFact: (project, factId, reason) => post(`/fact/revoke?project=${enc(project)}`, {
				fact_id: factId,
				reason
			})
		};
		//#endregion
		//#region src/client/views/shared.tsx
		/**
		* client/views/shared.tsx — 主题令牌、数据钩子与基础组件。
		*
		* 颜色一律走 DSH 设计令牌(var(--dsw-alias-*) / var(--dsw-specific-*)),
		* 令牌缺失时回退中性灰,保证亮/暗主题都可用;零运行时依赖,全手写。
		*/
		const C = {
			text: "var(--dsw-alias-label-primary, #c8c8c8)",
			textDim: "var(--dsw-alias-label-primary-dimmed, #9a9a9a)",
			caption: "var(--dsw-alias-label-caption, #7a7a7a)",
			border: "var(--dsw-alias-border-l1, #3c3c3c)",
			bg: "var(--dsw-alias-background-primary, transparent)",
			bgRaised: "var(--dsw-alias-background-secondary, rgba(128,128,128,0.10))",
			tip: "var(--dsw-specific-tip, rgba(128,128,128,0.08))",
			brand: "var(--dsw-alias-brand, #4d6bfe)"
		};
		/** 语义色(亮暗主题均可读的中间明度)。 */
		const SEM = {
			green: "#3fb950",
			orange: "#d29922",
			red: "#f85149",
			blue: "#58a6ff",
			purple: "#bc8cff",
			gray: "#8b949e"
		};
		const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
		/**
		* 轮询钩子:立即执行一次,之后每 ms 执行;组件卸载或 deps 变化时重置。
		* fn 内部自行 setState;抛错被吞掉(调用方负责错误态),保证轮询不中断。
		*/
		function usePoll(fn, ms, deps) {
			const ref = (0, react.useRef)(fn);
			ref.current = fn;
			(0, react.useEffect)(() => {
				let alive = true;
				const tick = async () => {
					if (!alive) return;
					try {
						await ref.current();
					} catch {}
				};
				tick();
				const timer = setInterval(() => {
					tick();
				}, ms);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [ms, ...deps]);
		}
		/** 一次性异步加载(带手动 reload);三态齐全:loading / error / data。 */
		function useAsync(fn, deps) {
			const [state, setState] = (0, react.useState)({
				data: null,
				error: null,
				loading: true
			});
			const [nonce, setNonce] = (0, react.useState)(0);
			const ref = (0, react.useRef)(fn);
			ref.current = fn;
			(0, react.useEffect)(() => {
				let alive = true;
				setState((s) => ({
					...s,
					loading: true,
					error: null
				}));
				ref.current().then((data) => {
					if (alive) setState({
						data,
						error: null,
						loading: false
					});
				}).catch((e) => {
					if (alive) setState({
						data: null,
						error: String(e?.message ?? e),
						loading: false
					});
				});
				return () => {
					alive = false;
				};
			}, [nonce, ...deps]);
			return {
				...state,
				reload: () => setNonce((n) => n + 1)
			};
		}
		function Badge(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				title: props.title ?? props.text,
				style: {
					display: "inline-block",
					flex: "none",
					padding: "1px 8px",
					borderRadius: 999,
					fontSize: 11,
					lineHeight: "16px",
					fontWeight: 600,
					color: props.color,
					border: `1px solid ${props.color}`,
					background: `color-mix(in srgb, ${props.color} 14%, transparent)`,
					whiteSpace: "nowrap"
				},
				children: props.text
			});
		}
		function Btn(props) {
			const color = props.danger ? SEM.red : props.primary ? C.brand : C.textDim;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				title: props.title,
				disabled: props.disabled,
				onClick: props.onClick,
				style: {
					padding: "3px 10px",
					borderRadius: 6,
					fontSize: 12,
					lineHeight: "18px",
					cursor: props.disabled ? "not-allowed" : "pointer",
					opacity: props.disabled ? .5 : 1,
					color,
					border: `1px solid ${props.primary || props.danger ? color : C.border}`,
					background: props.primary ? `color-mix(in srgb, ${C.brand} 12%, transparent)` : "transparent",
					fontFamily: "inherit",
					whiteSpace: "nowrap",
					...props.style
				},
				children: props.children
			});
		}
		function Card(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					border: `1px solid ${C.border}`,
					borderRadius: 10,
					background: C.tip,
					padding: "10px 12px",
					...props.style
				},
				children: props.children
			});
		}
		function SectionTitle(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					margin: "14px 0 8px",
					gap: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontSize: 13,
						fontWeight: 600,
						color: C.text
					},
					children: props.children
				}), props.right]
			});
		}
		function EmptyState(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "32px 16px",
					textAlign: "center"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 13,
						color: C.textDim
					},
					children: props.text
				}), props.hint && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						marginTop: 6,
						fontSize: 12,
						color: C.caption
					},
					children: props.hint
				})]
			});
		}
		function ErrorState(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "16px",
					textAlign: "center"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: SEM.red
					},
					children: ["请求失败:", props.error]
				}), props.onRetry && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: { marginTop: 8 },
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
						onClick: props.onRetry,
						children: "重试"
					})
				})]
			});
		}
		function LoadingState() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "24px 16px",
					textAlign: "center",
					fontSize: 12,
					color: C.caption
				},
				children: "加载中…"
			});
		}
		/** 轻量模态:遮罩 + 居中卡片;点遮罩关闭。 */
		function Modal(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				onClick: props.onClose,
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 1e3,
					background: "rgba(0,0,0,0.45)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					onClick: (e) => e.stopPropagation(),
					style: {
						width: 480,
						maxWidth: "90vw",
						maxHeight: "80vh",
						overflow: "auto",
						border: `1px solid ${C.border}`,
						borderRadius: 12,
						background: "var(--dsw-alias-background-primary, #1e1e1e)",
						padding: 16,
						boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 600,
								color: C.text
							},
							children: props.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							onClick: props.onClose,
							children: "关闭"
						})]
					}), props.children]
				})
			});
		}
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "5px 8px",
			borderRadius: 6,
			fontSize: 12,
			border: `1px solid ${C.border}`,
			background: "transparent",
			color: C.text,
			fontFamily: "inherit",
			outline: "none"
		};
		const textareaStyle = {
			...inputStyle,
			minHeight: 72,
			resize: "vertical",
			lineHeight: "18px"
		};
		/** 可截断展开的长文本。 */
		function ExpandableText(props) {
			const [open, setOpen] = (0, react.useState)(false);
			const limit = props.limit ?? 160;
			const text = props.text || "";
			if (!text) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				style: { color: C.caption },
				children: "(空)"
			});
			const truncated = !open && text.length > limit;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: {
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					...props.style
				},
				children: [truncated ? `${text.slice(0, limit)}…` : text, text.length > limit && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					onClick: () => setOpen(!open),
					style: {
						marginLeft: 6,
						color: C.brand,
						cursor: "pointer",
						fontSize: 11,
						whiteSpace: "nowrap"
					},
					children: open ? "收起" : "展开"
				})]
			});
		}
		/** 操作反馈行(成功/失败小字)。 */
		function Feedback(props) {
			if (!props.msg) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					marginTop: 6,
					fontSize: 12,
					color: props.msg.ok ? SEM.green : SEM.red
				},
				children: props.msg.text
			});
		}
		//#endregion
		//#region src/client/views/ProgressView.tsx
		/**
		* client/views/ProgressView.tsx — 推导进度总览(默认视图,5s 轮询)。
		*
		* 统计卡(事实数 / 含前驱 / verdict correct / wrong / live workers)+
		* 最近 verification 条目(verdict 徽章)+ master_guidance / elaboration 最新高亮。
		* 注:overview / channel 数据固定在 host 项目侧(忽略 project 参数);
		* live workers 数按当前选中项目统计。
		*/
		function verdictColor(v) {
			if (v === "correct") return SEM.green;
			if (v === "wrong") return SEM.red;
			return SEM.gray;
		}
		function StatCard(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
				style: {
					flex: 1,
					minWidth: 110,
					textAlign: "center",
					padding: "12px 8px"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 22,
						fontWeight: 700,
						color: props.color ?? C.text,
						fontVariantNumeric: "tabular-nums"
					},
					children: props.value
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						marginTop: 2,
						fontSize: 11,
						color: C.caption
					},
					children: props.label
				})]
			});
		}
		function ChannelHighlight(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
				style: {
					flex: 1,
					minWidth: 240
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginBottom: 6
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
						text: props.title,
						color: SEM.purple
					}), props.entry?.timestamp_utc && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 11,
							color: C.caption
						},
						children: props.entry.timestamp_utc
					})]
				}), props.entry ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: C.textDim,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word"
					},
					children: [props.entry.claim || "(无 claim)", props.entry.author && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							marginLeft: 8,
							fontSize: 11,
							color: C.caption
						},
						children: ["— ", props.entry.author]
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						color: C.caption
					},
					children: "暂无条目"
				})]
			});
		}
		function ProgressView(props) {
			const [data, setData] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			usePoll(async () => {
				try {
					const [overview, ver, guidanceCh, elabCh] = await Promise.all([
						api.overview(),
						api.channel("verification"),
						api.channel("master_guidance"),
						api.channel("elaboration")
					]);
					let liveWorkers = null;
					if (props.project) try {
						liveWorkers = ((await api.workers(props.project)).workers ?? []).filter((x) => x.alive).length;
					} catch {
						liveWorkers = null;
					}
					setData({
						overview,
						verification: (ver.entries ?? []).slice(0, 8),
						guidance: guidanceCh.entries?.[0] ?? null,
						elaboration: elabCh.entries?.[0] ?? null,
						liveWorkers
					});
					setError(null);
				} catch (e) {
					setError(String(e?.message ?? e));
				}
			}, 5e3, [props.project]);
			if (!data && error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorState, { error });
			if (!data) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {});
			const { overview, verification, guidance, elaboration, liveWorkers } = data;
			const correct = overview.verdicts?.["correct"] ?? 0;
			const wrong = overview.verdicts?.["wrong"] ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 12 },
				children: [
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 8,
							fontSize: 12,
							color: SEM.orange
						},
						children: ["本轮刷新失败(展示上一帧):", error]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							flexWrap: "wrap"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
								label: "事实数",
								value: overview.facts
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
								label: "含前驱",
								value: overview.facts_with_predecessors
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
								label: "verdict correct",
								value: correct,
								color: SEM.green
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
								label: "verdict wrong",
								value: wrong,
								color: wrong > 0 ? SEM.red : void 0
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
								label: "live workers",
								value: liveWorkers ?? "—",
								color: liveWorkers ? SEM.blue : void 0
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, { children: "最新指导 / 阐述" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelHighlight, {
							title: "master_guidance",
							entry: guidance
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelHighlight, {
							title: "elaboration",
							entry: elaboration
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, { children: "最近 verification" }),
					verification.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: "暂无 verification 条目" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6
						},
						children: verification.map((e, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
							style: { padding: "8px 10px" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
										text: String(e.verdict ?? "?"),
										color: verdictColor(String(e.verdict ?? "?"))
									}),
									e.fact_id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											fontFamily: "monospace",
											color: C.caption
										},
										children: e.fact_id
									}),
									e.author && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: C.caption
										},
										children: e.author
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
									e.timestamp_utc && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: C.caption
										},
										children: e.timestamp_utc
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									marginTop: 4,
									fontSize: 12,
									color: C.textDim,
									overflow: "hidden",
									display: "-webkit-box",
									WebkitLineClamp: 2,
									WebkitBoxOrient: "vertical"
								},
								children: e.claim || "(无 claim)"
							})]
						}, e.id ?? i))
					})
				]
			});
		}
		//#endregion
		//#region src/client/views/SwarmView.tsx
		/**
		* client/views/SwarmView.tsx — Swarm 实时介入(worker 表格 + 行操作 + 日志)。
		*
		* worker 表格 5s 轮询;label 徽章着色(working 绿 / stuck? 橙 / dead 灰 /
		* error 红 / created 蓝);行操作:指派(弹窗 textarea)/ 启动 / 优雅停 / 强杀;
		* 点行展开该 worker 最新轮日志 tail(等宽 200 行,手动刷新)。
		*/
		function labelColor(label) {
			if (label === "working") return SEM.green;
			if (label.startsWith("stuck")) return SEM.orange;
			if (label === "error") return SEM.red;
			if (label === "created") return SEM.blue;
			if (label === "deadline" || label === "max_rounds") return SEM.purple;
			return SEM.gray;
		}
		function fmtAge(age) {
			if (age == null) return "—";
			if (age < 60) return `${Math.round(age)}s`;
			if (age < 3600) return `${Math.floor(age / 60)}m${Math.round(age % 60)}s`;
			return `${Math.floor(age / 3600)}h${Math.floor(age % 3600 / 60)}m`;
		}
		function WorkerLogPanel(props) {
			const [log, setLog] = (0, react.useState)(null);
			const [err, setErr] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const load = async () => {
				setBusy(true);
				try {
					setLog(await api.workerLog(props.project, props.worker, 200));
					setErr(null);
				} catch (e) {
					setErr(String(e?.message ?? e));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { marginTop: 8 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							marginBottom: 6
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 12,
									color: C.textDim
								},
								children: ["最新轮日志", log?.round ? `(${log.round})` : ""]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								onClick: () => {
									load();
								},
								disabled: busy,
								children: log ? "刷新日志" : "加载日志"
							}),
							busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: C.caption
								},
								children: "加载中…"
							})
						]
					}),
					err && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: 12,
							color: SEM.red
						},
						children: ["日志加载失败:", err]
					}),
					log && log.lines.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 12,
							color: C.caption
						},
						children: "(无日志行)"
					}),
					log && log.lines.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: {
							margin: 0,
							padding: 10,
							maxHeight: 320,
							overflow: "auto",
							border: `1px solid ${C.border}`,
							borderRadius: 8,
							background: C.tip,
							fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
							fontSize: 11,
							lineHeight: "16px",
							color: C.textDim,
							whiteSpace: "pre-wrap",
							wordBreak: "break-all"
						},
						children: log.lines.join("\n")
					})
				]
			});
		}
		function SwarmView(props) {
			const [workers, setWorkers] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [expanded, setExpanded] = (0, react.useState)(null);
			const [assignTarget, setAssignTarget] = (0, react.useState)(null);
			const [assignTask, setAssignTask] = (0, react.useState)("");
			const [msg, setMsg] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			usePoll(async () => {
				if (!props.project) return;
				try {
					const res = await api.workers(props.project);
					setWorkers(res.workers ?? []);
					setError(null);
				} catch (e) {
					setError(String(e?.message ?? e));
				}
			}, 5e3, [props.project]);
			const act = async (fn, okText) => {
				setBusy(true);
				setMsg(null);
				try {
					await fn();
					setMsg({
						ok: true,
						text: okText
					});
					const res = await api.workers(props.project);
					setWorkers(res.workers ?? []);
				} catch (e) {
					setMsg({
						ok: false,
						text: String(e?.message ?? e)
					});
				} finally {
					setBusy(false);
				}
			};
			const submitAssign = async () => {
				if (!assignTarget || !assignTask.trim()) return;
				await act(() => api.assign(props.project, assignTarget, assignTask.trim()), `已指派任务给 ${assignTarget}`);
				setAssignTarget(null);
				setAssignTask("");
			};
			if (!props.project) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
				text: "未选择项目",
				hint: "请先在顶部选择一个项目"
			});
			if (!workers && error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorState, { error });
			if (!workers) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {});
			const target = (w) => `${props.project}/${w}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 12 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionTitle, {
						right: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 11,
								color: C.caption
							},
							children: ["5s 轮询 · 项目 ", props.project]
						}),
						children: [
							"Worker 列表(",
							workers.length,
							")"
						]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 8,
							fontSize: 12,
							color: SEM.orange
						},
						children: ["本轮刷新失败(展示上一帧):", error]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Feedback, { msg }),
					workers.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
						text: "该项目暂无 worker",
						hint: "可经 main agent 的 swarm 工具启动 worker"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 6,
							marginTop: 8
						},
						children: workers.map((w) => {
							const open = expanded === w.worker;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
								style: { padding: "8px 10px" },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									onClick: () => setExpanded(open ? null : w.worker),
									style: {
										display: "flex",
										alignItems: "center",
										gap: 10,
										cursor: "pointer",
										flexWrap: "wrap"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 11,
												color: C.caption,
												width: 12
											},
											children: open ? "▾" : "▸"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												fontWeight: 600,
												color: C.text,
												fontFamily: MONO
											},
											children: w.worker
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
											text: w.label,
											color: labelColor(w.label)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 11,
												color: C.caption
											},
											children: [
												"pid ",
												w.pid ?? "—",
												" · round ",
												w.round ?? "—",
												" · age ",
												fmtAge(w.age_s)
											]
										}),
										w.last_fact_id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 11,
												color: C.caption,
												fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
											},
											children: ["last: ", w.last_fact_id]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											onClick: (e) => e.stopPropagation(),
											style: {
												display: "flex",
												gap: 6
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
													onClick: () => {
														setAssignTarget(w.worker);
														setAssignTask("");
													},
													disabled: busy,
													children: "指派"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
													onClick: () => {
														act(() => api.startWorker(target(w.worker)), `已启动 ${w.worker}`);
													},
													disabled: busy,
													children: "启动"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
													onClick: () => {
														act(() => api.stopWorker(target(w.worker), false), `已优雅停止 ${w.worker}`);
													},
													disabled: busy,
													children: "优雅停"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
													danger: true,
													onClick: () => {
														act(() => api.stopWorker(target(w.worker), true), `已强杀 ${w.worker}`);
													},
													disabled: busy,
													children: "强杀"
												})
											]
										})
									]
								}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkerLogPanel, {
									project: props.project,
									worker: w.worker
								})]
							}, w.worker);
						})
					}),
					assignTarget && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Modal, {
						title: `指派任务 → ${assignTarget}`,
						onClose: () => setAssignTarget(null),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: C.caption,
									marginBottom: 6
								},
								children: "任务描述会写入该 worker 的指派队列,下一轮生效。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								autoFocus: true,
								value: assignTask,
								onChange: (e) => setAssignTask(e.target.value),
								placeholder: "输入要指派给该 worker 的任务…",
								style: textareaStyle
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									justifyContent: "flex-end",
									gap: 8,
									marginTop: 10
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									onClick: () => setAssignTarget(null),
									children: "取消"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									primary: true,
									onClick: () => {
										submitAssign();
									},
									disabled: busy || !assignTask.trim(),
									children: "确认指派"
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/views/HypothesesView.tsx
		/**
		* client/views/HypothesesView.tsx — 推理假设(global memory)管理。
		*
		* 11 种频道 chips 过滤;条目列表(claim/evidence 截断展开、status 徽章、
		* author、时间);judgment 类标记 supported/challenged,verifiable 类标记
		* verified/refuted;新增条目表单(kind/claim/evidence,verifiable 随 kind
		* 自动);撤销事实(fact_id + reason,二次确认,展示级联结果)。手动刷新。
		*/
		function statusColor(status) {
			switch (status) {
				case "supported":
				case "verified": return SEM.green;
				case "challenged": return SEM.orange;
				case "refuted": return SEM.red;
				case "open": return SEM.blue;
				default: return SEM.gray;
			}
		}
		/** 该条目可执行的状态标记:judgment 类 → supported/challenged;verifiable → verified/refuted。 */
		function statusActions(kind, entry) {
			if (channelRole(kind) === "judgment") return ["supported", "challenged"];
			if (entry.verifiable === true) return ["verified", "refuted"];
			return [];
		}
		const KIND_LABEL = {
			conclusion: "结论",
			example: "示例",
			counterexample: "反例",
			proof_attempt: "证明尝试",
			plan: "计划",
			direction: "方向",
			obstacle: "障碍",
			dead_end: "死路",
			verification: "验证",
			elaboration: "阐述",
			master_guidance: "主指导"
		};
		function HypothesesView(props) {
			const [kind, setKind] = (0, react.useState)("verification");
			const [msg, setMsg] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [showAdd, setShowAdd] = (0, react.useState)(false);
			const [newKind, setNewKind] = (0, react.useState)("plan");
			const [newClaim, setNewClaim] = (0, react.useState)("");
			const [newEvidence, setNewEvidence] = (0, react.useState)("");
			const [newVerifiable, setNewVerifiable] = (0, react.useState)(false);
			const [showRevoke, setShowRevoke] = (0, react.useState)(false);
			const [revokeId, setRevokeId] = (0, react.useState)("");
			const [revokeReason, setRevokeReason] = (0, react.useState)("");
			const [revokeConfirm, setRevokeConfirm] = (0, react.useState)(false);
			const [revoked, setRevoked] = (0, react.useState)(null);
			const channels = useAsync(() => api.channels(), []);
			const entries = useAsync(() => api.channel(kind), [kind]);
			const countOf = (k) => channels.data?.channels.find((c) => c.kind === k)?.count ?? null;
			const mark = async (id, status) => {
				if (!id) {
					setMsg({
						ok: false,
						text: "该条目缺少 id,无法标记"
					});
					return;
				}
				setBusy(true);
				setMsg(null);
				try {
					await api.gmStatus(props.project, id, status);
					setMsg({
						ok: true,
						text: `已标记 ${id} → ${status}`
					});
					entries.reload();
					channels.reload();
				} catch (e) {
					setMsg({
						ok: false,
						text: String(e?.message ?? e)
					});
				} finally {
					setBusy(false);
				}
			};
			const submitAdd = async () => {
				if (!newClaim.trim()) return;
				setBusy(true);
				setMsg(null);
				try {
					const res = await api.gmAdd(props.project, {
						kind: newKind,
						claim: newClaim.trim(),
						evidence: newEvidence.trim(),
						verifiable: newVerifiable
					});
					setMsg({
						ok: true,
						text: `已新增条目 ${res.id}`
					});
					setNewClaim("");
					setNewEvidence("");
					setShowAdd(false);
					if (newKind === kind) entries.reload();
					channels.reload();
				} catch (e) {
					setMsg({
						ok: false,
						text: String(e?.message ?? e)
					});
				} finally {
					setBusy(false);
				}
			};
			const submitRevoke = async () => {
				if (!revokeId.trim()) return;
				setBusy(true);
				setMsg(null);
				setRevoked(null);
				try {
					const res = await api.revokeFact(props.project, revokeId.trim(), revokeReason.trim() || "operator console revoke");
					setRevoked(res.revoked ?? []);
					setMsg({
						ok: true,
						text: `已撤销 ${res.revoked?.length ?? 0} 条事实`
					});
					setRevokeConfirm(false);
				} catch (e) {
					setMsg({
						ok: false,
						text: String(e?.message ?? e)
					});
					setRevokeConfirm(false);
				} finally {
					setBusy(false);
				}
			};
			if (!props.project) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
				text: "未选择项目",
				hint: "请先在顶部选择一个项目"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 12 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							gap: 6,
							flexWrap: "wrap"
						},
						children: CHANNEL_KINDS.map(([k, role]) => {
							const active = k === kind;
							const count = countOf(k);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								onClick: () => setKind(k),
								title: `${k} (${role})`,
								style: {
									padding: "3px 10px",
									borderRadius: 999,
									fontSize: 12,
									cursor: "pointer",
									border: `1px solid ${active ? C.brand : C.border}`,
									color: active ? C.brand : C.textDim,
									background: active ? `color-mix(in srgb, ${C.brand} 12%, transparent)` : "transparent",
									whiteSpace: "nowrap"
								},
								children: [KIND_LABEL[k] ?? k, count != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										marginLeft: 4,
										fontSize: 11,
										opacity: .75
									},
									children: count
								})]
							}, k);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionTitle, {
						right: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "flex",
								gap: 6
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									onClick: () => {
										setShowAdd(!showAdd);
										setShowRevoke(false);
									},
									children: showAdd ? "收起表单" : "新增条目"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									danger: true,
									onClick: () => {
										setShowRevoke(!showRevoke);
										setShowAdd(false);
										setRevoked(null);
									},
									children: showRevoke ? "收起撤销" : "撤销事实"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									onClick: () => {
										entries.reload();
										channels.reload();
									},
									children: "刷新"
								})
							]
						}),
						children: [
							KIND_LABEL[kind] ?? kind,
							"(",
							entries.data?.count ?? "…",
							")"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Feedback, { msg }),
					showAdd && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
						style: { marginTop: 8 },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										gap: 8,
										alignItems: "center"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 12,
												color: C.caption,
												width: 64
											},
											children: "kind"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
											value: newKind,
											onChange: (e) => {
												const k = e.target.value;
												setNewKind(k);
												const role = channelRole(k);
												setNewVerifiable(role === "result" || role === "verify");
											},
											style: {
												...inputStyle,
												width: "auto"
											},
											children: CHANNEL_KINDS.map(([k]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
												value: k,
												children: [
													KIND_LABEL[k] ?? k,
													"(",
													k,
													")"
												]
											}, k))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 4,
												fontSize: 12,
												color: C.textDim
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: newVerifiable,
												onChange: (e) => setNewVerifiable(e.target.checked)
											}), "verifiable"]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: newClaim,
									onChange: (e) => setNewClaim(e.target.value),
									placeholder: "claim(断言,必填)",
									style: inputStyle
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: newEvidence,
									onChange: (e) => setNewEvidence(e.target.value),
									placeholder: "evidence(证据/论证)",
									style: textareaStyle
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "flex-end",
										gap: 8
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
										onClick: () => setShowAdd(false),
										children: "取消"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
										primary: true,
										onClick: () => {
											submitAdd();
										},
										disabled: busy || !newClaim.trim(),
										children: "提交"
									})]
								})
							]
						})
					}),
					showRevoke && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
						style: {
							marginTop: 8,
							borderColor: `color-mix(in srgb, ${SEM.red} 50%, ${C.border})`
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 12,
										color: SEM.red
									},
									children: "撤销会级联删除依赖该事实的所有下游事实,不可恢复。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: revokeId,
									onChange: (e) => {
										setRevokeId(e.target.value);
										setRevokeConfirm(false);
									},
									placeholder: "fact_id(如 f000123)",
									style: {
										...inputStyle,
										fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: revokeReason,
									onChange: (e) => setRevokeReason(e.target.value),
									placeholder: "reason(撤销原因)",
									style: inputStyle
								}),
								!revokeConfirm ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										justifyContent: "flex-end"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
										danger: true,
										onClick: () => setRevokeConfirm(true),
										disabled: !revokeId.trim(),
										children: "撤销…"
									})
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "flex-end",
										gap: 8
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 12,
												color: SEM.red
											},
											children: [
												"确认撤销 ",
												revokeId,
												" 及其全部下游?"
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
											onClick: () => setRevokeConfirm(false),
											children: "再想想"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
											danger: true,
											onClick: () => {
												submitRevoke();
											},
											disabled: busy,
											children: "确认撤销"
										})
									]
								}),
								revoked && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										fontSize: 12,
										color: C.textDim
									},
									children: [
										"级联撤销(",
										revoked.length,
										"):",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
												marginLeft: 4
											},
											children: revoked.length > 0 ? revoked.join(", ") : "(无)"
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: { marginTop: 8 },
						children: [
							entries.loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {}),
							entries.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorState, {
								error: entries.error,
								onRetry: entries.reload
							}),
							entries.data && entries.data.entries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: "该频道暂无条目" }),
							entries.data && entries.data.entries.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 6
								},
								children: entries.data.entries.map((e, i) => {
									const actions = statusActions(kind, e);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
										style: { padding: "8px 10px" },
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8,
													flexWrap: "wrap"
												},
												children: [
													e.status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
														text: e.status,
														color: statusColor(e.status)
													}),
													e.verifiable === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, {
														text: "verifiable",
														color: SEM.blue
													}),
													e.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 11,
															fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
															color: C.caption
														},
														children: e.id
													}),
													e.author && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 11,
															color: C.caption
														},
														children: e.author
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
													e.timestamp_utc && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 11,
															color: C.caption
														},
														children: e.timestamp_utc
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													marginTop: 4,
													fontSize: 12,
													color: C.text
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExpandableText, { text: String(e.claim ?? "") })
											}),
											typeof e.evidence === "string" && e.evidence && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													marginTop: 4,
													fontSize: 12,
													color: C.textDim
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExpandableText, {
													text: e.evidence,
													limit: 220
												})
											}),
											e.fact_id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													marginTop: 4,
													fontSize: 11,
													fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
													color: C.caption
												},
												children: ["fact: ", e.fact_id]
											}),
											actions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													display: "flex",
													gap: 6,
													marginTop: 6
												},
												children: actions.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Btn, {
													onClick: () => {
														mark(e.id, s);
													},
													disabled: busy || e.status === s,
													children: ["标记 ", s]
												}, s))
											})
										]
									}, e.id ?? i);
								})
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/views/FactGraphView.tsx
		/**
		* client/views/FactGraphView.tsx — 事实图(SVG 分层 DAG)。
		*
		* x 按 depth 分层(深在左,depth 0 在右),同层按 id 排序均布;边为三次贝塞尔;
		* 节点大小/颜色随 depth;空白拖拽 pan、滚轮以指针为中心 zoom;hover 显示
		* id + statement 截断;点击节点右侧抽屉展开 statement/proof/intuition 全文 +
		* predecessors 链接跳转。手动刷新;「导出」按钮跳到导出视图。
		*/
		const LAYER_W = 240;
		const ROW_H = 96;
		const PAD_X = 120;
		const PAD_Y = 80;
		function layoutGraph(nodes, maxDepth) {
			const byDepth = /* @__PURE__ */ new Map();
			for (const n of nodes) {
				const list = byDepth.get(n.depth) ?? [];
				list.push(n);
				byDepth.set(n.depth, list);
			}
			const pos = /* @__PURE__ */ new Map();
			const layers = [];
			let maxRows = 1;
			for (const [depth, list] of byDepth) maxRows = Math.max(maxRows, list.length);
			for (let d = 0; d <= maxDepth; d++) {
				const list = (byDepth.get(d) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
				const x = PAD_X + (maxDepth - d) * LAYER_W;
				layers.push({
					depth: d,
					x,
					count: list.length
				});
				list.forEach((n, i) => {
					const y = PAD_Y + (i + 1) / (list.length + 1) * (maxRows * ROW_H);
					pos.set(n.id, {
						x,
						y
					});
				});
			}
			return {
				pos,
				width: PAD_X * 2 + (maxDepth + 1) * LAYER_W,
				height: PAD_Y * 2 + maxRows * ROW_H,
				layers
			};
		}
		function nodeColor(depth, maxDepth) {
			const frac = maxDepth > 0 ? depth / maxDepth : 0;
			return `hsl(${Math.round(215 - frac * 170)} 70% 58%)`;
		}
		function nodeRadius(depth) {
			return 12 + Math.min(depth, 8) * 1.6;
		}
		function FactGraphView(props) {
			const { data, error, loading, reload } = useAsync(() => api.factgraph(), []);
			const [selectedId, setSelectedId] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const [view, setView] = (0, react.useState)({
				x: 0,
				y: 0,
				k: 1
			});
			const svgRef = (0, react.useRef)(null);
			const containerRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			const viewRef = (0, react.useRef)(view);
			viewRef.current = view;
			const layout = (0, react.useMemo)(() => data ? layoutGraph(data.nodes ?? [], data.max_depth ?? 0) : null, [data]);
			const nodeById = (0, react.useMemo)(() => {
				const m = /* @__PURE__ */ new Map();
				for (const n of data?.nodes ?? []) m.set(n.id, n);
				return m;
			}, [data]);
			(0, react.useEffect)(() => {
				const svg = svgRef.current;
				if (!svg) return;
				const onWheel = (e) => {
					e.preventDefault();
					const rect = svg.getBoundingClientRect();
					const px = e.clientX - rect.left;
					const py = e.clientY - rect.top;
					const v = viewRef.current;
					const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
					const k = Math.min(4, Math.max(.15, v.k * factor));
					const ratio = k / v.k;
					setView({
						k,
						x: px - (px - v.x) * ratio,
						y: py - (py - v.y) * ratio
					});
				};
				svg.addEventListener("wheel", onWheel, { passive: false });
				return () => svg.removeEventListener("wheel", onWheel);
			}, [layout]);
			const centerOn = (id) => {
				const p = layout?.pos.get(id);
				const rect = containerRef.current?.getBoundingClientRect();
				if (!p || !rect) return;
				const k = Math.max(viewRef.current.k, .8);
				setView({
					k,
					x: rect.width / 2 - p.x * k,
					y: rect.height / 2 - p.y * k
				});
			};
			const onBackgroundDown = (e) => {
				dragRef.current = {
					sx: e.clientX,
					sy: e.clientY,
					ox: view.x,
					oy: view.y,
					moved: false
				};
				e.currentTarget.setPointerCapture(e.pointerId);
			};
			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (!d) return;
				const dx = e.clientX - d.sx;
				const dy = e.clientY - d.sy;
				if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
				if (d.moved) setView((v) => ({
					...v,
					x: d.ox + dx,
					y: d.oy + dy
				}));
			};
			const onPointerUp = () => {
				const d = dragRef.current;
				dragRef.current = null;
				if (d && !d.moved) setSelectedId(null);
			};
			const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {});
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorState, {
				error,
				onRetry: reload
			});
			if (!data || !layout) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, { text: "无事实图数据" });
			if (data.nodes.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
				text: "事实图为空",
				hint: "尚无已验证事实;worker 产出经 verifier 门控的事实后会出现在这里"
			});
			const hoverNode = hover ? nodeById.get(hover.id) ?? null : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: containerRef,
				style: {
					position: "relative",
					flex: 1,
					minHeight: 0,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							position: "absolute",
							top: 10,
							left: 10,
							zIndex: 5,
							display: "flex",
							gap: 6,
							alignItems: "center"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								onClick: reload,
								children: "刷新"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								onClick: () => setView({
									x: 0,
									y: 0,
									k: 1
								}),
								children: "重置视图"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
								primary: true,
								onClick: props.onExport,
								children: "导出"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 11,
									color: C.caption
								},
								children: [
									data.nodes.length,
									" 节点 · ",
									data.edges.length,
									" 边 · 最大深度 ",
									data.max_depth
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						ref: svgRef,
						width: "100%",
						height: "100%",
						style: {
							display: "block",
							cursor: dragRef.current ? "grabbing" : "grab",
							touchAction: "none"
						},
						onPointerDown: onBackgroundDown,
						onPointerMove,
						onPointerUp,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
							transform: `translate(${view.x},${view.y}) scale(${view.k})`,
							children: [
								layout.layers.map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("text", {
									x: l.x,
									y: 30,
									textAnchor: "middle",
									style: {
										fontSize: 11,
										fill: C.caption,
										fontFamily: MONO
									},
									children: ["depth ", l.depth]
								}, l.depth)),
								data.edges.map((e, i) => {
									const s = layout.pos.get(e.source);
									const t = layout.pos.get(e.target);
									if (!s || !t) return null;
									const bend = Math.max(40, Math.abs(s.x - t.x) / 2);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: `M ${s.x} ${s.y} C ${s.x - bend} ${s.y}, ${t.x + bend} ${t.y}, ${t.x} ${t.y}`,
										fill: "none",
										style: {
											stroke: C.border,
											strokeWidth: 1.2,
											opacity: .8
										}
									}, i);
								}),
								data.nodes.map((n) => {
									const p = layout.pos.get(n.id);
									if (!p) return null;
									const r = nodeRadius(n.depth);
									const isSel = n.id === selectedId;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
										transform: `translate(${p.x},${p.y})`,
										style: { cursor: "pointer" },
										onClick: (e) => {
											e.stopPropagation();
											setSelectedId(n.id);
										},
										onPointerEnter: (e) => {
											const rect = containerRef.current?.getBoundingClientRect();
											setHover({
												id: n.id,
												px: e.clientX - (rect?.left ?? 0),
												py: e.clientY - (rect?.top ?? 0)
											});
										},
										onPointerLeave: () => setHover((h) => h?.id === n.id ? null : h),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
											r,
											style: {
												fill: nodeColor(n.depth, data.max_depth),
												stroke: isSel ? C.text : "transparent",
												strokeWidth: isSel ? 2.5 : 0,
												opacity: .92
											}
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
											y: r + 12,
											textAnchor: "middle",
											style: {
												fontSize: 10,
												fill: C.textDim,
												fontFamily: MONO,
												pointerEvents: "none"
											},
											children: n.id
										})]
									}, n.id);
								})
							]
						})
					}),
					hoverNode && hover && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							position: "absolute",
							zIndex: 6,
							pointerEvents: "none",
							left: Math.min(hover.px + 14, (containerRef.current?.clientWidth ?? 400) - 260),
							top: hover.py + 14,
							maxWidth: 260,
							padding: "6px 10px",
							border: `1px solid ${C.border}`,
							borderRadius: 8,
							background: "var(--dsw-alias-background-primary, #1e1e1e)",
							boxShadow: "0 4px 16px rgba(0,0,0,0.35)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 11,
								fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
								color: C.brand
							},
							children: hoverNode.id
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								marginTop: 2,
								fontSize: 11,
								color: C.textDim,
								overflow: "hidden",
								display: "-webkit-box",
								WebkitLineClamp: 3,
								WebkitBoxOrient: "vertical"
							},
							children: hoverNode.statement || "(无 statement)"
						})]
					}),
					selected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							position: "absolute",
							top: 0,
							right: 0,
							bottom: 0,
							zIndex: 7,
							width: 340,
							maxWidth: "85%",
							overflow: "auto",
							borderLeft: `1px solid ${C.border}`,
							background: "var(--dsw-alias-background-primary, #1e1e1e)",
							padding: 14,
							boxShadow: "-4px 0 16px rgba(0,0,0,0.25)"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 13,
										fontWeight: 700,
										fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
										color: C.text
									},
									children: selected.id
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
									onClick: () => setSelectedId(null),
									children: "关闭"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									marginTop: 4,
									fontSize: 11,
									color: C.caption
								},
								children: [
									"author ",
									selected.author || "—",
									" · depth ",
									selected.depth,
									selected.problem_id ? ` · problem ${selected.problem_id}` : ""
								]
							}),
							[
								"statement",
								"proof",
								"intuition"
							].map((sec) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { marginTop: 12 },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 12,
										fontWeight: 600,
										color: C.textDim,
										marginBottom: 4
									},
									children: sec === "statement" ? "Statement" : sec === "proof" ? "Proof" : "Intuition"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 12,
										color: C.text,
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										padding: "6px 8px",
										border: `1px solid ${C.border}`,
										borderRadius: 6,
										background: C.tip,
										minHeight: 20
									},
									children: selected[sec] || /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: { color: C.caption },
										children: "(空)"
									})
								})]
							}, sec)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: { marginTop: 12 },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										fontSize: 12,
										fontWeight: 600,
										color: C.textDim,
										marginBottom: 4
									},
									children: [
										"Predecessors(",
										selected.predecessors.length,
										")"
									]
								}), selected.predecessors.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 12,
										color: C.caption
									},
									children: "(根事实,无前驱)"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										gap: 6,
										flexWrap: "wrap"
									},
									children: selected.predecessors.map((pid) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
										onClick: () => {
											setSelectedId(pid);
											centerOn(pid);
										},
										style: {
											fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
											fontSize: 11
										},
										children: pid
									}, pid))
								})]
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/views/ExportView.tsx
		/**
		* client/views/ExportView.tsx — 结果导出。
		*
		* JSON / Markdown 下载(window.open 导出 URL,浏览器直接下载);TARGET /
		* facts markdown 内容预览(fetch format=md 文本,截断展示);说明论文/报告
		* 由 main agent 的 paper_write / summary_write 工具产出。
		*/
		const MD_PREVIEW_LIMIT = 6e3;
		function ExportView(props) {
			const [mdText, setMdText] = (0, react.useState)(null);
			const [mdError, setMdError] = (0, react.useState)(null);
			const [mdLoading, setMdLoading] = (0, react.useState)(false);
			const [full, setFull] = (0, react.useState)(false);
			const overview = useAsync(() => api.overview(), []);
			const loadMd = async () => {
				setMdLoading(true);
				setMdError(null);
				try {
					const res = await fetch(api.exportUrl(props.project, "md"));
					if (!res.ok) {
						let detail = `HTTP ${res.status}`;
						try {
							const data = await res.json();
							if (typeof data.detail === "string") detail = data.detail;
						} catch {}
						throw new Error(detail);
					}
					setMdText(await res.text());
				} catch (e) {
					setMdError(String(e?.message ?? e));
				} finally {
					setMdLoading(false);
				}
			};
			if (!props.project) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
				text: "未选择项目",
				hint: "请先在顶部选择一个项目"
			});
			const truncated = mdText && !full && mdText.length > MD_PREVIEW_LIMIT;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 12 },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, { children: "下载事实库" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: 12,
							color: C.textDim,
							marginBottom: 10
						},
						children: [
							"导出项目 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
								style: { color: C.text },
								children: props.project
							}),
							" 的全部已验证事实",
							overview.data ? `(共 ${overview.data.facts} 条)` : "",
							";浏览器直接下载。"
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							primary: true,
							onClick: () => window.open(api.exportUrl(props.project, "json"), "_blank"),
							children: "下载 JSON"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							primary: true,
							onClick: () => window.open(api.exportUrl(props.project, "md"), "_blank"),
							children: "下载 Markdown"
						})]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, {
						right: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							onClick: () => {
								loadMd();
							},
							disabled: mdLoading,
							children: mdLoading ? "加载中…" : mdText ? "刷新预览" : "加载预览"
						}),
						children: "内容预览(facts markdown)"
					}),
					mdError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: 12,
							color: SEM.red,
							marginBottom: 8
						},
						children: ["预览加载失败:", mdError]
					}),
					!mdText && !mdError && !mdLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
						text: "尚未加载预览",
						hint: "点击「加载预览」拉取 format=md 导出内容"
					}),
					mdLoading && !mdText && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadingState, {}),
					mdText != null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: {
							margin: 0,
							padding: 12,
							maxHeight: truncated ? 360 : "70vh",
							overflow: "auto",
							border: `1px solid ${C.border}`,
							borderRadius: 8,
							background: C.tip,
							fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
							fontSize: 11,
							lineHeight: "17px",
							color: C.textDim,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word"
						},
						children: truncated ? mdText.slice(0, MD_PREVIEW_LIMIT) : mdText
					}), mdText.length > MD_PREVIEW_LIMIT && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { marginTop: 6 },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Btn, {
							onClick: () => setFull(!full),
							children: full ? "收起(仅前 6000 字符)" : `展开全部(${mdText.length} 字符)`
						})
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionTitle, { children: "说明" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
						style: {
							fontSize: 12,
							color: C.textDim,
							lineHeight: "20px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "· 本页导出的是 verifier 门控后的事实库(fact graph 全量)。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								"· 论文与总结报告由 main agent 的 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { fontFamily: MONO },
									children: "paper_write"
								}),
								" /",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { fontFamily: MONO },
									children: " summary_write"
								}),
								" 工具产出,请直接在会话中要求生成。"
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "· JSON 含每条事实的 frontmatter 与原始 markdown;Markdown 为事实合集, 可直接作为 TARGET / 附录材料。" })
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/DanusConsole.tsx
		/**
		* client/DanusConsole.tsx — Danus Console 主组件。
		*
		* 单 Tab 内顶部视图切换:进度 / Swarm / 假设 / 事实图 / 导出;顶部另有项目
		* 选择器(GET /danus/api/workers 的项目列表;无项目时显示空态)。全部数据
		* 走同源 /danus/api/*;中文 UI;主题走 --dsw-alias-* 令牌,亮暗自适应。
		*/
		const VIEWS = [
			{
				id: "progress",
				label: "进度"
			},
			{
				id: "swarm",
				label: "Swarm"
			},
			{
				id: "hypotheses",
				label: "假设"
			},
			{
				id: "factgraph",
				label: "事实图"
			},
			{
				id: "export",
				label: "导出"
			}
		];
		function DanusConsole() {
			const [view, setView] = (0, react.useState)("progress");
			const [projects, setProjects] = (0, react.useState)(null);
			const [project, setProject] = (0, react.useState)("");
			const [projectsError, setProjectsError] = (0, react.useState)(null);
			usePoll(async () => {
				try {
					const list = (await api.projects()).projects ?? [];
					setProjects(list);
					setProjectsError(null);
					if (list.length > 0 && !list.some((p) => p.project === project)) setProject(list[0].project);
				} catch (e) {
					setProjectsError(String(e?.message ?? e));
				}
			}, 5e3, [project]);
			const noProjects = projects !== null && projects.length === 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%",
					minHeight: 0,
					color: C.text,
					fontSize: 13,
					fontFamily: "system-ui, sans-serif"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: "none",
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexWrap: "wrap",
						padding: "8px 10px",
						borderBottom: `1px solid ${C.border}`
					},
					children: [
						VIEWS.map((v) => {
							const active = v.id === view;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								onClick: () => setView(v.id),
								style: {
									padding: "4px 12px",
									borderRadius: 8,
									fontSize: 12,
									cursor: "pointer",
									fontWeight: active ? 600 : 400,
									color: active ? C.brand : C.textDim,
									background: active ? `color-mix(in srgb, ${C.brand} 14%, transparent)` : "transparent",
									border: `1px solid ${active ? C.brand : "transparent"}`,
									whiteSpace: "nowrap"
								},
								children: v.label
							}, v.id);
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 6,
								fontSize: 12,
								color: C.caption
							},
							children: ["项目", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: project,
								onChange: (e) => setProject(e.target.value),
								disabled: !projects || projects.length === 0,
								style: {
									...inputStyle,
									width: "auto",
									minWidth: 120
								},
								children: [(!projects || projects.length === 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "(无项目)"
								}), projects?.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: p.project,
									children: [p.project, p.live > 0 ? ` (${p.live} live)` : ""]
								}, p.project))]
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						flex: 1,
						minHeight: 0,
						overflow: view === "factgraph" ? "hidden" : "auto",
						display: "flex",
						flexDirection: "column"
					},
					children: noProjects ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
						text: "暂无项目",
						hint: "后端未报告任何 worker 项目;经 main agent 启动 swarm 后会出现在这里"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						projectsError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "6px 12px",
								fontSize: 12,
								color: SEM.orange
							},
							children: ["项目列表刷新失败:", projectsError]
						}),
						view === "progress" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressView, { project }),
						view === "swarm" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwarmView, { project }),
						view === "hypotheses" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HypothesesView, { project }),
						view === "factgraph" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FactGraphView, { onExport: () => setView("export") }),
						view === "export" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExportView, { project })
					] })
				})]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** 必需依赖:betterSidebar 服务(dsh-better-sidebar 提供)。 */
		const inject = ["betterSidebar"];
		function apply(ctx) {
			const betterSidebar = ctx.betterSidebar;
			ctx.effect(() => betterSidebar.registerTab({
				id: "danus:console",
				title: "Danus",
				single: true,
				component: () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DanusConsole, {})
			}), "danus: console tab");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
