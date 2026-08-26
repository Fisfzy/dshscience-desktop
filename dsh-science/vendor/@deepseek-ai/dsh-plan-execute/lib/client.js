window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-plan-execute",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_web_react = require("@deepseek-ai/dsh-client-web-react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region lib/types/client/catalog.js
		/**
		* Encode a provider/model pair for a `<select>` option value.
		* JSON so HTML option attributes never drop opaque separators (NUL is stripped).
		* @param provider - provider route id.
		* @param model - model id.
		* @returns opaque option value.
		*/
		function encodeRoute(provider, model) {
			return JSON.stringify([provider, model]);
		}
		/**
		* Decode a route option value.
		* @param value - option value from the model select.
		* @returns provider and model, or undefined when the value is the inherit option.
		*/
		function decodeRoute(value) {
			if (value === "") return void 0;
			try {
				const parsed = JSON.parse(value);
				if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string" && parsed[0] !== "" && parsed[1] !== "") return {
					provider: parsed[0],
					model: parsed[1]
				};
			} catch {}
		}
		/**
		* Find one model entry in the catalog.
		* @param groups - catalog groups from `llm.models`.
		* @param provider - provider route id.
		* @param model - model id.
		* @returns the catalog model, or undefined when absent.
		*/
		function findCatalogModel(groups, provider, model) {
			return groups.find((g) => g.id === provider)?.models.find((m) => m.id === model);
		}
		/**
		* Build the select value for a phase draft: inherit when either id is blank.
		* @param draft - the phase draft.
		* @returns the option value.
		*/
		function routeValueOf(draft) {
			if (draft.provider.trim() === "" || draft.model.trim() === "") return "";
			return encodeRoute(draft.provider.trim(), draft.model.trim());
		}
		/**
		* Human label for one catalog model option.
		* @param groupName - provider display name.
		* @param model - catalog model.
		* @returns option label.
		*/
		function modelOptionLabel(groupName, model) {
			return model.name === model.id ? `${groupName} / ${model.id}` : `${groupName} / ${model.name} (${model.id})`;
		}
		/**
		* Label for the inherit-default option, carrying the resolved (effective) route.
		* @param resolved - effective phase after defaults merge.
		* @param inheritLabel - localized "inherit defaults" stem.
		* @returns option label.
		*/
		function inheritRouteLabel(resolved, inheritLabel) {
			const parts = [
				resolved.provider,
				resolved.model,
				resolved.reasoningEffort
			].filter((p) => p.trim() !== "");
			return parts.length === 0 ? inheritLabel : `${inheritLabel}（${parts.join(" · ")}）`;
		}
		/**
		* Label for the inherit-effort option when a model is chosen.
		* @param model - catalog model for the active route.
		* @param inheritLabel - localized stem.
		* @returns option label.
		*/
		function inheritEffortLabel(model, inheritLabel) {
			const def = model?.reasoning?.defaultEffort;
			return def === void 0 || def === "" ? inheritLabel : `${inheritLabel}（${def}）`;
		}
		//#endregion
		//#region \0dsh-css:/Users/open/Desktop/test-SivanCola/packages/plan/plan-execute/src/client/PlanExecuteRow.module.css.mjs
		const css = ".DI4i2G_row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:flex-start;gap:8px;padding:16px 0;display:flex}.DI4i2G_rowText{flex-direction:column;flex:1;gap:8px;min-width:0;padding-right:8px;display:flex}.DI4i2G_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.DI4i2G_panel{background:var(--dsw-alias-bg-module);border-radius:12px;flex-direction:column;gap:12px;padding:12px;display:flex}.DI4i2G_phase{border:none;flex-direction:column;gap:8px;margin:0;padding:0;display:flex}.DI4i2G_phaseLabel{color:var(--dsw-alias-label-secondary);padding:0;font-size:13px;font-weight:500;line-height:20px}.DI4i2G_fields{grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px;display:grid}.DI4i2G_field{flex-direction:column;gap:4px;min-width:0;display:flex}.DI4i2G_fieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.DI4i2G_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);width:100%;min-width:0;height:32px;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:14px;line-height:22px}.DI4i2G_select:focus{border-color:var(--dsw-alias-brand-primary);outline:none}.DI4i2G_select:disabled{color:var(--dsw-alias-label-dimmed);cursor:not-allowed}.DI4i2G_hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.DI4i2G_actions{align-items:center;gap:8px;display:flex}.DI4i2G_saved{color:var(--dsw-alias-label-success);font-size:12px;line-height:18px}.DI4i2G_error{color:var(--dsw-alias-label-danger);font-size:12px;line-height:18px}.DI4i2G_expander{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;margin-top:2px;display:inline-flex}.DI4i2G_expander:hover{background:var(--dsw-alias-interactive-bg-hover)}.DI4i2G_chevron{transition:transform .15s}.DI4i2G_expander[aria-expanded=true] .DI4i2G_chevron{transform:rotate(180deg)}";
		const tagId = "@deepseek-ai/dsh-plan-execute/PlanExecuteRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-plan-execute";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PlanExecuteRow_module_css_default = {
			"rowText": "DI4i2G_rowText",
			"hint": "DI4i2G_hint",
			"phase": "DI4i2G_phase",
			"actions": "DI4i2G_actions",
			"saved": "DI4i2G_saved",
			"fields": "DI4i2G_fields",
			"title": "DI4i2G_title",
			"row": "DI4i2G_row",
			"fieldLabel": "DI4i2G_fieldLabel",
			"error": "DI4i2G_error",
			"panel": "DI4i2G_panel",
			"field": "DI4i2G_field",
			"select": "DI4i2G_select",
			"expander": "DI4i2G_expander",
			"chevron": "DI4i2G_chevron",
			"phaseLabel": "DI4i2G_phaseLabel"
		};
		//#endregion
		//#region lib/types/client/PlanExecuteRow.js
		/**
		* Plan/execute model settings row: the General-section preference row
		* editing the `plan-execute` routing. Each phase picks a route from the
		* host `llm.models` catalog (provider + model) and an effort from that
		* model's advertised levels; blank inherits composition defaults.
		*/
		/**
		* Apply a model-route pick onto a phase draft: inherit clears the phase;
		* a catalog pick sets provider/model and the model's default effort when known.
		*/
		function draftFromRoute(groups, value, previous) {
			const route = decodeRoute(value);
			if (route === void 0) return {
				provider: "",
				model: "",
				reasoningEffort: ""
			};
			const entry = findCatalogModel(groups, route.provider, route.model);
			const defaultEffort = entry?.reasoning?.defaultEffort ?? "";
			const keepEffort = previous.reasoningEffort !== "" && entry?.reasoning?.efforts.some((level) => level.id === previous.reasoningEffort) === true;
			return {
				provider: route.provider,
				model: route.model,
				reasoningEffort: keepEffort ? previous.reasoningEffort : defaultEffort
			};
		}
		/** One phase's model + effort pickers. */
		function PhaseEditor({ label, draft, resolved, groups, disabled, onDraftChange, t }) {
			const routeValue = routeValueOf(draft);
			const activeProvider = draft.provider.trim() !== "" ? draft.provider.trim() : resolved.provider.trim();
			const activeModel = draft.model.trim() !== "" ? draft.model.trim() : resolved.model.trim();
			const catalogModel = activeProvider !== "" && activeModel !== "" ? findCatalogModel(groups, activeProvider, activeModel) : void 0;
			const efforts = catalogModel?.reasoning?.efforts ?? [];
			const effortDisabled = disabled || routeValue === "";
			const orphanRoute = routeValue !== "" && findCatalogModel(groups, draft.provider.trim(), draft.model.trim()) === void 0;
			const modelOptions = (0, react.useMemo)(() => {
				const options = [{
					value: "",
					label: inheritRouteLabel(resolved, t("plan-execute.inheritDefault"))
				}];
				for (const group of groups) for (const model of group.models) options.push({
					value: encodeRoute(group.id, model.id),
					label: modelOptionLabel(group.name, model)
				});
				if (orphanRoute) options.push({
					value: routeValue,
					label: t("plan-execute.currentRoute").replace("{provider}", draft.provider).replace("{model}", draft.model)
				});
				return options;
			}, [
				groups,
				resolved,
				orphanRoute,
				routeValue,
				draft.provider,
				draft.model,
				t
			]);
			return (0, react_jsx_runtime.jsxs)("fieldset", {
				className: PlanExecuteRow_module_css_default.phase,
				disabled,
				children: [(0, react_jsx_runtime.jsx)("legend", {
					className: PlanExecuteRow_module_css_default.phaseLabel,
					children: label
				}), (0, react_jsx_runtime.jsxs)("div", {
					className: PlanExecuteRow_module_css_default.fields,
					children: [(0, react_jsx_runtime.jsxs)("label", {
						className: PlanExecuteRow_module_css_default.field,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: PlanExecuteRow_module_css_default.fieldLabel,
							children: t("plan-execute.model")
						}), (0, react_jsx_runtime.jsx)("select", {
							className: PlanExecuteRow_module_css_default.select,
							"aria-label": t("plan-execute.model"),
							value: routeValue,
							disabled,
							onChange: (event) => {
								onDraftChange(draftFromRoute(groups, event.target.value, draft));
							},
							children: modelOptions.map((option) => (0, react_jsx_runtime.jsx)("option", {
								value: option.value,
								children: option.label
							}, option.value === "" ? "__inherit__" : option.value))
						})]
					}), (0, react_jsx_runtime.jsxs)("label", {
						className: PlanExecuteRow_module_css_default.field,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: PlanExecuteRow_module_css_default.fieldLabel,
							children: t("plan-execute.reasoningEffort")
						}), (0, react_jsx_runtime.jsxs)("select", {
							className: PlanExecuteRow_module_css_default.select,
							"aria-label": t("plan-execute.reasoningEffort"),
							value: draft.reasoningEffort,
							disabled: effortDisabled,
							onChange: (event) => {
								onDraftChange({
									...draft,
									reasoningEffort: event.target.value
								});
							},
							children: [
								(0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: inheritEffortLabel(catalogModel, t("plan-execute.inheritEffort"))
								}),
								efforts.map((level) => (0, react_jsx_runtime.jsx)("option", {
									value: level.id,
									children: level.name === level.id ? level.id : `${level.name} (${level.id})`
								}, level.id)),
								draft.reasoningEffort !== "" && !efforts.some((level) => level.id === draft.reasoningEffort) && (0, react_jsx_runtime.jsx)("option", {
									value: draft.reasoningEffort,
									children: t("plan-execute.currentEffort").replace("{effort}", draft.reasoningEffort)
								})
							]
						})]
					})]
				})]
			});
		}
		/**
		* Render the plan/execute model settings row.
		* @param props - composed slot props.
		* @returns the row element tree.
		*/
		function PlanExecuteRow({ t, controller, useSnapshot }) {
			const state = useSnapshot((s) => s);
			const [open, setOpen] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)(state.draft);
			const [syncedRevision, setSyncedRevision] = (0, react.useState)(state.revision);
			const editable = state.status === "ready" && state.writable && !state.saving;
			(0, react.useEffect)(() => {
				if (open && state.status === "idle") controller.load();
			}, [
				open,
				state.status,
				controller
			]);
			(0, react.useEffect)(() => {
				if (!open || state.status !== "ready" || state.revision === syncedRevision) return;
				setDraft(state.draft);
				setSyncedRevision(state.revision);
			}, [
				open,
				state.status,
				state.revision,
				state.draft,
				syncedRevision
			]);
			const applyDraft = async () => {
				if (await controller.save(draft)) setOpen(false);
			};
			const reset = async () => {
				if (await controller.reset()) setOpen(false);
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PlanExecuteRow_module_css_default.row,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: PlanExecuteRow_module_css_default.rowText,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: PlanExecuteRow_module_css_default.title,
						children: t("plan-execute.title")
					}), open && (0, react_jsx_runtime.jsxs)("div", {
						className: PlanExecuteRow_module_css_default.panel,
						children: [
							state.status === "error" && (0, react_jsx_runtime.jsxs)("div", {
								className: PlanExecuteRow_module_css_default.error,
								children: [
									t("plan-execute.loadFailed"),
									"：",
									state.error
								]
							}),
							state.status === "ready" && !state.writable && (0, react_jsx_runtime.jsx)("div", {
								className: PlanExecuteRow_module_css_default.error,
								children: t("plan-execute.unavailable")
							}),
							(0, react_jsx_runtime.jsx)(PhaseEditor, {
								label: t("plan-execute.planner"),
								draft: draft.planner,
								resolved: state.resolved.planner,
								groups: state.groups,
								disabled: !editable,
								onDraftChange: (planner) => {
									setDraft((s) => ({
										...s,
										planner
									}));
								},
								t
							}),
							(0, react_jsx_runtime.jsx)(PhaseEditor, {
								label: t("plan-execute.executor"),
								draft: draft.executor,
								resolved: state.resolved.executor,
								groups: state.groups,
								disabled: !editable,
								onDraftChange: (executor) => {
									setDraft((s) => ({
										...s,
										executor
									}));
								},
								t
							}),
							(0, react_jsx_runtime.jsx)("div", {
								className: PlanExecuteRow_module_css_default.hint,
								children: t("plan-execute.pickerHint")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: PlanExecuteRow_module_css_default.actions,
								children: [
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										disabled: !editable,
										onClick: () => {
											applyDraft();
										},
										children: t("plan-execute.apply")
									}),
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										disabled: !editable,
										onClick: () => {
											reset();
										},
										children: t("plan-execute.reset")
									}),
									state.saved && (0, react_jsx_runtime.jsx)("span", {
										className: PlanExecuteRow_module_css_default.saved,
										children: t("plan-execute.saved")
									}),
									state.saveError !== null && (0, react_jsx_runtime.jsx)("span", {
										className: PlanExecuteRow_module_css_default.error,
										children: t("plan-execute.saveFailed")
									})
								]
							})
						]
					})]
				}), (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: PlanExecuteRow_module_css_default.expander,
					"aria-expanded": open,
					"aria-label": t("plan-execute.title"),
					onClick: () => {
						setOpen((v) => !v);
					},
					children: (0, react_jsx_runtime.jsx)("svg", {
						className: PlanExecuteRow_module_css_default.chevron,
						width: "14",
						height: "14",
						viewBox: "0 0 14 14",
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)("path", {
							d: "M4 5.5 7 8.5 10 5.5",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							strokeLinecap: "round",
							strokeLinejoin: "round"
						})
					})
				})]
			});
		}
		//#endregion
		//#region lib/types/client/settings-store.js
		/** The wire namespace id owned by `@deepseek-ai/dsh-plan-execute`. */
		const PLAN_EXECUTE_SETTINGS_NS = "plan-execute";
		const EMPTY_PHASE = {
			provider: "",
			model: "",
			reasoningEffort: ""
		};
		function emptyDraft() {
			return {
				planner: { ...EMPTY_PHASE },
				executor: { ...EMPTY_PHASE }
			};
		}
		function draftOf(value) {
			const section = value ?? {};
			return {
				planner: {
					provider: section.planner?.provider ?? "",
					model: section.planner?.model ?? "",
					reasoningEffort: section.planner?.reasoningEffort ?? ""
				},
				executor: {
					provider: section.executor?.provider ?? "",
					model: section.executor?.model ?? "",
					reasoningEffort: section.executor?.reasoningEffort ?? ""
				}
			};
		}
		/**
		* Build the deep-merge patch for one draft: blank fields are omitted so the
		* stored section keeps whatever it had (the row's Reset clears the whole
		* section), and each kept field is trimmed.
		* @param draft - the draft the user is applying.
		* @returns the settings.update patch.
		*/
		function patchOf(draft) {
			const patch = {};
			for (const phase of ["planner", "executor"]) {
				const fields = {};
				const entry = draft[phase];
				if (entry.provider.trim() !== "") fields.provider = entry.provider.trim();
				if (entry.model.trim() !== "") fields.model = entry.model.trim();
				if (entry.reasoningEffort.trim() !== "") fields.reasoningEffort = entry.reasoningEffort.trim();
				if (Object.keys(fields).length > 0) patch[phase] = fields;
			}
			return patch;
		}
		/**
		* One row controller: load/apply/reset over the settings wire, with the
		* latest load winning (an older response never overwrites a newer one).
		*/
		var PlanExecuteSettingsController = class {
			api;
			store;
			generation = 0;
			/**
			* @param api - the wire face (settings + llm catalog).
			*/
			constructor(api) {
				this.api = api;
				this.store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
					status: "idle",
					error: null,
					writable: false,
					revision: 0,
					draft: emptyDraft(),
					resolved: emptyDraft(),
					groups: [],
					saving: false,
					saveError: null,
					saved: false
				});
			}
			/** Adopt one namespace view into the snapshot; missing view = not composed. */
			applyView(view, writable, groups) {
				if (view === void 0) {
					this.store.update((s) => {
						s.status = "ready";
						s.error = null;
						s.writable = false;
						s.revision = 0;
						s.draft = emptyDraft();
						s.resolved = emptyDraft();
						s.groups = groups;
					});
					return;
				}
				this.store.update((s) => {
					s.status = "ready";
					s.error = null;
					s.writable = writable;
					s.revision = view.revision;
					s.draft = draftOf(view.user);
					s.resolved = draftOf(view.value);
					s.groups = groups;
				});
			}
			/**
			* Load the plan-execute settings section and the host model catalog in
			* parallel. Catalog failure leaves an empty groups list so the row still
			* opens on the settings fact (with inherit options only).
			* @returns nothing; the snapshot carries the outcome.
			*/
			async load() {
				const generation = ++this.generation;
				this.store.update((s) => {
					s.status = "loading";
				});
				let view;
				let writable = false;
				let groups = [];
				try {
					const [settingsResponse, modelsResponse] = await Promise.all([this.api.settings.describe({}), this.api.llm.models({}).catch(() => void 0)]);
					if (!settingsResponse.result.ok) throw new Error(settingsResponse.result.error.message);
					writable = settingsResponse.result.value.writable;
					view = settingsResponse.result.value.namespaces.find((ns) => ns.ns === PLAN_EXECUTE_SETTINGS_NS);
					if (modelsResponse !== void 0 && modelsResponse.result.ok) groups = modelsResponse.result.value.groups;
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((s) => {
						s.status = "error";
						s.error = error instanceof Error ? error.message : String(error);
					});
					return;
				}
				if (generation !== this.generation) return;
				this.applyView(view, writable, groups);
			}
			/**
			* Apply one draft through settings.update and adopt the returned view.
			* A refused write keeps the previous snapshot and reports the failure.
			* @param draft - the draft to persist.
			* @returns whether the write committed.
			*/
			async save(draft) {
				const generation = ++this.generation;
				this.store.update((s) => {
					s.saving = true;
					s.saveError = null;
					s.saved = false;
				});
				const patch = patchOf(draft);
				let view;
				try {
					const response = await this.api.settings.update({
						ns: PLAN_EXECUTE_SETTINGS_NS,
						patch,
						expectedRevision: this.store.getSnapshot().revision
					});
					if (!response.result.ok) throw new Error(response.result.error.message);
					view = response.result.value;
				} catch (error) {
					if (generation !== this.generation) return false;
					this.store.update((s) => {
						s.saving = false;
						s.saveError = error instanceof Error ? error.message : String(error);
					});
					return false;
				}
				if (generation !== this.generation) return false;
				const snap = this.store.getSnapshot();
				this.applyView(view, snap.writable, snap.groups);
				this.store.update((s) => {
					s.saving = false;
					s.saved = true;
				});
				return true;
			}
			/**
			* Clear the user section (restoring composition defaults) through
			* settings.replace.
			* @returns whether the write committed.
			*/
			async reset() {
				const generation = ++this.generation;
				this.store.update((s) => {
					s.saving = true;
					s.saveError = null;
					s.saved = false;
				});
				let view;
				try {
					const response = await this.api.settings.replace({
						ns: PLAN_EXECUTE_SETTINGS_NS,
						section: {},
						expectedRevision: this.store.getSnapshot().revision
					});
					if (!response.result.ok) throw new Error(response.result.error.message);
					view = response.result.value;
				} catch (error) {
					if (generation !== this.generation) return false;
					this.store.update((s) => {
						s.saving = false;
						s.saveError = error instanceof Error ? error.message : String(error);
					});
					return false;
				}
				if (generation !== this.generation) return false;
				const snap = this.store.getSnapshot();
				this.applyView(view, snap.writable, snap.groups);
				this.store.update((s) => {
					s.saving = false;
					s.saved = true;
				});
				return true;
			}
		};
		//#endregion
		//#region lib/types/client/locales.js
		/**
		* Plan/execute settings row copy. Product copy is Chinese; the English side
		* mirrors it for the locale switch.
		*/
		/** Simplified Chinese dictionary. */
		const zh = {
			"plan-execute.title": "规划/执行模型",
			"plan-execute.planner": "规划模型",
			"plan-execute.executor": "执行模型",
			"plan-execute.model": "模型",
			"plan-execute.reasoningEffort": "思考档位",
			"plan-execute.apply": "应用",
			"plan-execute.reset": "恢复默认",
			"plan-execute.saved": "已保存",
			"plan-execute.saveFailed": "保存失败，已保留原配置",
			"plan-execute.loadFailed": "设置加载失败",
			"plan-execute.unavailable": "未装配 dsh-plan-execute",
			"plan-execute.inheritDefault": "使用默认配置",
			"plan-execute.inheritEffort": "使用模型默认",
			"plan-execute.pickerHint": "从已配置的模型目录中选择；思考档位随所选模型变化。",
			"plan-execute.currentRoute": "当前：{provider} / {model}",
			"plan-execute.currentEffort": "当前：{effort}"
		};
		/** English dictionary. */
		const en = {
			"plan-execute.title": "Plan/Execute models",
			"plan-execute.planner": "Planner",
			"plan-execute.executor": "Executor",
			"plan-execute.model": "Model",
			"plan-execute.reasoningEffort": "Reasoning effort",
			"plan-execute.apply": "Apply",
			"plan-execute.reset": "Reset",
			"plan-execute.saved": "Saved",
			"plan-execute.saveFailed": "Save failed; the previous configuration is kept",
			"plan-execute.loadFailed": "Failed to load settings",
			"plan-execute.unavailable": "dsh-plan-execute is not composed",
			"plan-execute.inheritDefault": "Use defaults",
			"plan-execute.inheritEffort": "Model default",
			"plan-execute.pickerHint": "Pick from the configured model catalog; effort options follow the selected model.",
			"plan-execute.currentRoute": "Current: {provider} / {model}",
			"plan-execute.currentEffort": "Current: {effort}"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.plan-execute";
		/**
		* Required services (cordis fiber inject). The target slot is declared by
		* ui-settings-general's General entry, whose activation order relative to
		* this one is NOT constrained; registration depends on it through
		* `slots.inject()`.
		*/
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/**
		* Register the plan/execute settings row once the `settings.general.item`
		* declaration is on the ledger and wire its store to the connection. The row
		* loads lazily — a closed row never fetches; pushed invalidations refresh it
		* only after its first load.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-plan-execute: copy dictionaries");
			const controller = new PlanExecuteSettingsController(ctx.get("connection").api);
			const useSnapshot = (0, _deepseek_ai_dsh_client_web_react.bindSnapshotSelector)(controller.store);
			const injected = () => ({
				controller,
				useSnapshot
			});
			ctx.effect(() => {
				const refresh = () => {
					if (controller.store.getSnapshot().status !== "idle") controller.load();
				};
				const disposers = [ctx.on("settings/changed", refresh), ctx.on("connection/reset", refresh)];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "ui-plan-execute: pushed invalidations");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "plan-execute-models",
				order: 25,
				locale: NS,
				inject: injected
			}, PlanExecuteRow));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map