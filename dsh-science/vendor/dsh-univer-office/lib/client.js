window.__ModuleLoader__.load({
  id: "dsh-univer-office",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);

    // src/client/components/sidebar-preview-tab.tsx
    var React4 = __toESM(require("react"), 1);

    // src/client/conversation/univer-turn-definition.ts
    var univerTurnDefinition = {
      kind: "univerTurn",
      match(event) {
        if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/call" || event.type === "tool/result") return { id: String(event.data.turn), role: "update" };
        return null;
      },
      start(_context, match) {
        if (match.event.type !== "turn/start") throw new Error("univerTurn start match must be turn/start");
        return { turn: match.event.data.turn, files: [] };
      },
      update(context, match) {
        if (match.event.type === "tool/call") return addCall(context.state, match.event.data);
        if (match.event.type === "tool/result") return applyResult(context.state, match.event.data);
        return context.state;
      },
      buildLocationData(context, scope) {
        if (scope !== "turn" || context.state === void 0) return null;
        return { kind: "turn", turn: context.state.turn, key: "univerTurn", value: { files: context.state.files } };
      }
    };
    function selectUniverTurn(owner) {
      const data = owner.turn.data.get("univerTurn");
      if (data === void 0 || data.files.length === 0) return null;
      return { turn: owner.turn.turn, files: data.files };
    }
    function resolveTurnFiles(files, cwd) {
      const unique = /* @__PURE__ */ new Map();
      for (const target of files) {
        const file = resolveTargetFile(target.file, cwd);
        const previous = unique.get(file);
        unique.set(file, {
          file,
          operations: [...previous?.operations ?? [], ...target.operations.map((operation) => ({ ...operation, file }))]
        });
      }
      return [...unique.values()];
    }
    function outcomeOfTurnFile(target) {
      let primaryWorktreeId = null;
      let lifecycle = "unchanged";
      let preferredUnitId = null;
      let changedContent = false;
      for (const operation of target.operations) {
        if (operation.phase !== "succeeded") continue;
        if (operation.unitId !== null) preferredUnitId = operation.unitId;
        if (operation.name === "new") {
          lifecycle = "trunk";
          primaryWorktreeId = null;
          changedContent = true;
          continue;
        }
        if (operation.name === "worktree") {
          if (operation.action === "create" || operation.action === "reopen") {
            primaryWorktreeId = operation.worktreeId;
            lifecycle = "draft";
          } else if (operation.action === "ready") {
            primaryWorktreeId = operation.worktreeId;
            lifecycle = "ready";
          } else if (operation.action === "merge") {
            primaryWorktreeId = operation.worktreeId;
            lifecycle = "merged";
          } else if (operation.action === "discard") {
            primaryWorktreeId = operation.worktreeId;
            lifecycle = "discarded";
          }
          continue;
        }
        if (isWrite(operation)) {
          changedContent = true;
          if (lifecycle === "unchanged" || lifecycle === "trunk" || lifecycle === "draft") {
            primaryWorktreeId = operation.worktreeId;
            lifecycle = "draft";
          }
          continue;
        }
        if (primaryWorktreeId === null && operation.worktreeId !== null) primaryWorktreeId = operation.worktreeId;
      }
      return { primaryWorktreeId, lifecycle, preferredUnitId, changedContent };
    }
    function turnFilesOfSession(session, cwd) {
      if (session === void 0) return [];
      const files = [];
      for (const turn of session.chat.timeline.turns.values()) {
        const data = turn.data.get("univerTurn");
        if (data !== void 0) files.push(...data.files);
      }
      return resolveTurnFiles(files, cwd);
    }
    function opensFloatingWindow(operation) {
      if (operation.name === "new") return true;
      if (operation.name === "worktree") {
        return operation.action === "create" || operation.action === "reopen" || operation.action === "ready";
      }
      return isWrite(operation);
    }
    function addCall(state, data) {
      const name = operationName(data.name);
      if (name === null) return state;
      const args = parseRecord(data.arguments);
      if (args === null || typeof args.file !== "string") return state;
      const operation = {
        callId: data.callId,
        name,
        action: typeof args.action === "string" ? args.action : null,
        file: args.file,
        worktreeId: typeof args.worktreeId === "string" ? args.worktreeId : null,
        unitId: typeof args.unitId === "string" ? args.unitId : null,
        phase: "pending"
      };
      return { ...state, files: appendOperation(state.files, operation) };
    }
    function applyResult(state, data) {
      const callId = data.message.content[0].toolCallId;
      const structured = structuredResult(data);
      let matched;
      for (const file2 of state.files) {
        const operation2 = file2.operations.find((entry) => entry.callId === callId);
        if (operation2 !== void 0) matched = operation2;
      }
      if (matched === void 0 && structured === null) return state;
      const result = structured === null || !isRecord(structured.result) ? null : structured.result;
      const name = matched?.name ?? operationName(typeof structured?.operation === "string" ? `univer_${structured.operation.replace("-", "_")}` : "");
      const file = typeof structured?.file === "string" ? structured.file : matched?.file;
      if (name === null || name === void 0 || file === void 0) return state;
      const operation = {
        callId,
        name,
        action: typeof result?.action === "string" ? result.action : matched?.action ?? null,
        file,
        worktreeId: typeof result?.worktreeId === "string" ? result.worktreeId : matched?.worktreeId ?? null,
        unitId: typeof result?.unitId === "string" ? result.unitId : matched?.unitId ?? null,
        phase: data.error === void 0 && data.message.content[0].isError !== true ? "succeeded" : "failed"
      };
      const withoutCall = state.files.flatMap((entry) => {
        const operations = entry.operations.filter((candidate) => candidate.callId !== callId);
        return operations.length === 0 ? [] : [{ ...entry, operations }];
      });
      return { ...state, files: appendOperation(withoutCall, operation) };
    }
    function appendOperation(files, operation) {
      const next = [...files];
      const index = next.findIndex((entry) => entry.file === operation.file);
      if (index === -1) next.push({ file: operation.file, operations: [operation] });
      else {
        const previous = next[index];
        if (previous !== void 0) next[index] = { ...previous, operations: [...previous.operations, operation] };
      }
      return next;
    }
    function structuredResult(data) {
      const text = data.message.content[0].content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
      const firstBrace = text.indexOf("{");
      return firstBrace === -1 ? null : parseRecord(text.slice(firstBrace));
    }
    function operationName(name) {
      if (!name.startsWith("univer_")) return null;
      const operation = name.slice("univer_".length).replaceAll("_", "-");
      if (operation === "new" || operation === "status" || operation === "worktree" || operation === "unit" || operation === "import" || operation === "inspect" || operation === "execute" || operation === "export" || operation === "lint" || operation === "screenshot" || operation === "compile-svg") return operation;
      return null;
    }
    function isWrite(operation) {
      return operation.name === "execute" || operation.name === "import" || operation.name === "unit" || operation.name === "compile-svg";
    }
    function parseRecord(text) {
      try {
        const value = JSON.parse(text);
        return isRecord(value) ? value : null;
      } catch {
        return null;
      }
    }
    function resolveTargetFile(file, cwd) {
      const windows = isWindowsPath(file) || cwd !== void 0 && isWindowsPath(cwd);
      if (isAbsolute(file) || cwd === void 0 || cwd === "") return normalizeSeparators(file, windows);
      const separator = windows ? "\\" : "/";
      const resolved = `${cwd.replace(/[\\/]+$/, "")}${separator}${file.replace(/^\.[\\/]/, "")}`;
      return normalizeSeparators(resolved, windows);
    }
    function isAbsolute(file) {
      return file.startsWith("/") || file.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(file);
    }
    function isWindowsPath(file) {
      return file.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(file);
    }
    function normalizeSeparators(file, windows) {
      return windows ? file.replaceAll("/", "\\") : file;
    }
    function basename(file) {
      const at = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
      return at === -1 ? file : file.slice(at + 1);
    }
    function isRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    function initialUniverFold(turn) {
      return { turn, files: [] };
    }
    function foldUniverEvent(state, event) {
      if (event.type === "tool/call") return addCall(state, event.data);
      if (event.type === "tool/result") return applyResult(state, event.data);
      return state;
    }

    // src/client/hooks/use-univer-state.ts
    var React = __toESM(require("react"), 1);

    // src/client/api/univer-api.ts
    var UniverApiError = class extends Error {
      code;
      status;
      constructor(message, code, status) {
        super(message);
        this.name = "UniverApiError";
        this.code = code;
        this.status = status;
      }
    };
    async function request(path, init) {
      const response = await fetch(`${window.location.origin}${path}`, init);
      const body = await response.json();
      if (!response.ok) {
        const error = body;
        throw new UniverApiError(error.message ?? `Univer API HTTP ${String(response.status)}`, error.code, response.status);
      }
      return body;
    }
    function startGateway() {
      return request("/univer-api/gateway/start", { method: "POST" });
    }
    function getFileState(file, sessionId) {
      return request(`/univer-api/state?file=${encodeURIComponent(file)}&sessionId=${encodeURIComponent(sessionId)}`);
    }
    function isMissingUniverFile(error) {
      return error instanceof UniverApiError && error.code === "INVALID_FILE_PATH";
    }

    // src/client/hooks/use-univer-state.ts
    function useUniverStates(files, sessionId, intervalMs = 900) {
      const [states, setStates] = React.useState({});
      const [missing, setMissing] = React.useState({});
      const key = files.join("\0");
      React.useEffect(() => {
        if (key === "") {
          setStates({});
          setMissing({});
          return;
        }
        const trackedFiles = key.split("\0");
        setStates({});
        setMissing({});
        let active = true;
        const poll = async () => {
          for (const file of trackedFiles) {
            try {
              const state = await getFileState(file, sessionId);
              if (!active) return;
              setStates((previous) => ({ ...previous, [file]: state }));
              setMissing((previous) => {
                if (previous[file] === void 0) return previous;
                const next = { ...previous };
                delete next[file];
                return next;
              });
            } catch (error) {
              if (!active) return;
              if (isMissingUniverFile(error)) {
                setStates((previous) => {
                  if (previous[file] === void 0) return previous;
                  const next = { ...previous };
                  delete next[file];
                  return next;
                });
                setMissing((previous) => previous[file] === true ? previous : { ...previous, [file]: true });
              }
            }
          }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), intervalMs);
        const onVisibility = () => {
          if (document.visibilityState === "visible") void poll();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
          active = false;
          window.clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisibility);
        };
      }, [key, sessionId, intervalMs]);
      return {
        states,
        missingFiles: React.useMemo(() => new Set(Object.keys(missing)), [missing]),
        applyState: React.useCallback((state) => {
          setStates((previous) => ({ ...previous, [state.file]: state }));
          setMissing((previous) => {
            if (previous[state.file] === void 0) return previous;
            const next = { ...previous };
            delete next[state.file];
            return next;
          });
        }, [])
      };
    }

    // src/client/target-feed.ts
    function foldHistoryToTargets(events, cwd) {
      const sorted = [...events].sort((a, b) => a.event.seq - b.event.seq);
      let fold = initialUniverFold(0);
      const touch = /* @__PURE__ */ new Map();
      for (const row of sorted) {
        const type = row.event.type;
        if (type === "turn/start") {
          const raw = row.event.data?.turn;
          const turn = typeof raw === "number" ? raw : Number(raw);
          fold = initialUniverFold(Number.isFinite(turn) ? turn : 0);
          continue;
        }
        if (type !== "tool/call" && type !== "tool/result") continue;
        let next;
        try {
          next = foldUniverEvent(fold, row.event);
        } catch {
          continue;
        }
        if (next === fold) continue;
        fold = next;
        for (const file of next.files) touch.set(file.file, row.event.seq);
      }
      const resolved = resolveTurnFiles(fold.files, cwd);
      const targets = resolved.map((file) => {
        const outcome = outcomeOfTurnFile(file);
        let order = 0;
        for (const operation of file.operations) {
          order = Math.max(order, touch.get(operation.file) ?? 0);
        }
        return {
          file: file.file,
          worktreeId: outcome.primaryWorktreeId,
          unitId: outcome.preferredUnitId,
          turn: fold.turn,
          order
        };
      });
      return targets.sort((a, b) => b.order - a.order);
    }
    async function collectHistoryEvents(fetchPage, pageCap = 4) {
      const out = [];
      let before;
      for (let page = 0; page < pageCap; page++) {
        let rows;
        try {
          rows = await fetchPage(before);
        } catch {
          break;
        }
        if (rows.length === 0) break;
        out.push(...rows);
        let minSeq = Number.POSITIVE_INFINITY;
        for (const row of rows) minSeq = Math.min(minSeq, row.event.seq);
        if (!Number.isFinite(minSeq) || minSeq === before) break;
        before = minSeq;
      }
      return out;
    }

    // src/client/components/review-panel.tsx
    var React3 = __toESM(require("react"), 1);

    // src/client/viewer-locale.ts
    var VIEWER_LOCALES = {
      zh: "zh-CN",
      en: "en-US"
    };
    function viewerLocaleOf(locale) {
      return VIEWER_LOCALES[locale];
    }
    function localizeViewerUrl(url, locale) {
      const target = new URL(url);
      target.searchParams.set("lang", locale);
      return target.toString();
    }

    // src/client/components/unit-chips.tsx
    var React2 = require("react");
    var import_jsx_runtime = require("react/jsx-runtime");
    var ICONS = { added: "\uFF0B", modified: "\u270E", deleted: "\uFF0D", conflict: "\u26A0" };
    function UnitChips(props) {
      if (props.units.length <= 1) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "uvf_units", children: props.units.map((unit) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: `uvf_unit${unit.unitId === props.selected ? " uvf_unit_on" : ""}`,
          "data-kind": unit.kind,
          title: props.t(`dock.unit.${unit.kind}`),
          onClick: () => props.onSelect(unit.unitId),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "uvf_unit_icon", children: ICONS[unit.kind] }),
            unit.name || props.t(`dock.unit.${unit.kind}`)
          ]
        },
        unit.unitId
      )) });
    }
    function unitViewerUrl(url, units, unitId, scope) {
      if (unitId === void 0) return url;
      const unit = units.find((entry) => entry.unitId === unitId);
      return scope === "merge" ? unit?.mergeUrl ?? url : unit?.worktreeUrl ?? url;
    }

    // src/client/components/review-panel.tsx
    var import_jsx_runtime2 = require("react/jsx-runtime");
    function ReviewPanel(props) {
      const [open, setOpen] = React3.useState(!props.historical);
      const [fullscreen, setFullscreen] = React3.useState(false);
      const [selected, setSelected] = React3.useState(props.preferredUnitId ?? void 0);
      const wasHistorical = React3.useRef(props.historical);
      const worktree = props.worktreeId === null ? void 0 : props.state?.worktrees.find((entry) => entry.worktreeId === props.worktreeId);
      const status = props.state === void 0 ? "loading" : props.worktreeId === null ? "trunk" : worktree?.status ?? "unavailable";
      const units = worktree?.units ?? [];
      const selectedUnit = selected !== void 0 && units.some((unit) => unit.unitId === selected) ? selected : props.preferredUnitId !== null && units.some((unit) => unit.unitId === props.preferredUnitId) ? props.preferredUnitId : units[0]?.unitId;
      const target = cardTarget(props.state, props.worktreeId, worktree, selectedUnit);
      const url = target === void 0 ? void 0 : localizeViewerUrl(reviewPageUrl(target), props.viewerLocale);
      const title = worktree?.name || worktree?.worktreeId || props.t("dock.currentVersion");
      const merged = status === "merged";
      const discarded = status === "discarded";
      React3.useEffect(() => {
        if (!wasHistorical.current && props.historical) setOpen(false);
        wasHistorical.current = props.historical;
      }, [props.historical]);
      React3.useEffect(() => {
        if (props.preferredUnitId !== null) setSelected(props.preferredUnitId);
      }, [props.preferredUnitId]);
      React3.useEffect(() => {
        if (!fullscreen) return;
        const onKeyDown = (event) => {
          if (event.key === "Escape") setFullscreen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [fullscreen]);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
        "section",
        {
          className: `uvf_panel${fullscreen ? " uvf_panel_fullscreen" : ""}${props.historical ? " uvf_panel_history" : ""}`,
          "data-status": status,
          "aria-label": basename(props.file),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "uvf_panelHead", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "uvf_panelGlyph", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(UniverMark, { merged, discarded }) }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "uvf_panelIdentity", children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "uvf_panelTitleRow", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "uvf_panelTitle", children: basename(props.file) }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "uvf_panelWorktree", children: title })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "uvf_panelMeta", title: props.file, children: props.file })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "uvf_panelChip", "data-status": status, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "uvf_panelStatusDot", "aria-hidden": "true" }),
                statusLabel(status, props.t)
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PanelControl, { action: "fullscreen", label: props.t(fullscreen ? "dock.exitFullscreen" : "dock.fullscreen"), onClick: () => {
                setOpen(true);
                setFullscreen((value) => !value);
              }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(FullscreenIcon, { restored: fullscreen }) }),
              fullscreen ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PanelControl, { action: "fold", label: props.t(open ? "dock.fold" : "dock.expand"), onClick: () => setOpen((value) => !value), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(FoldIcon, { open }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "uvf_panelContent", hidden: !open, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "uvf_panelBody", children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(UnitChips, { units, selected: selectedUnit, t: props.t, onSelect: setSelected }),
              url === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "uvf_panelUnavailable", children: props.t(status === "loading" ? "dock.loading" : "dock.unavailable") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("iframe", { className: "uvf_panelFrame", src: url, title })
            ] }) })
          ]
        }
      );
    }
    function cardTarget(state, worktreeId, worktree, selectedUnit) {
      if (state === void 0) return void 0;
      if (worktreeId === null) return withUnit(state.viewerUrl ?? void 0, selectedUnit);
      if (worktree === void 0) return void 0;
      if (worktree.status === "merged" || worktree.status === "discarded") return withUnit(state.viewerUrl ?? void 0, selectedUnit);
      return unitViewerUrl(worktree.status === "ready" ? worktree.mergeUrl : worktree.worktreeUrl, worktree.units, selectedUnit, worktree.status === "ready" ? "merge" : "worktree") ?? (worktree.status === "draft" ? worktree.openUrl : void 0);
    }
    function statusLabel(status, t) {
      if (status === "draft") return t("dock.draft");
      if (status === "ready") return t("dock.mergeReady");
      if (status === "merged") return t("dock.merged");
      if (status === "discarded") return t("dock.discarded");
      if (status === "trunk") return t("dock.currentVersion");
      if (status === "loading") return t("dock.loading");
      return t("dock.unavailable");
    }
    function withUnit(url, unitId) {
      if (url === void 0 || unitId === void 0) return url;
      const target = new URL(url);
      target.searchParams.set("unit", unitId);
      return target.toString();
    }
    function reviewPageUrl(url) {
      const target = new URL(url);
      target.searchParams.delete("mode");
      target.searchParams.set("sidebar", "collapsed");
      return target.toString();
    }
    function PanelControl(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "uvf_btn", "data-panel-action": props.action, title: props.label, "aria-label": props.label, onClick: props.onClick, children: props.children });
    }
    function FoldIcon(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: props.open ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4" }) });
    }
    function UniverMark(props) {
      if (props.merged) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 20 20", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "m5 10 3 3 7-7" }) });
      if (props.discarded) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 20 20", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6 10h8" }) });
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { viewBox: "0 0 20 20", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("rect", { x: "4", y: "4", width: "12", height: "12", rx: "2" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 8h12M8 4v12" })
      ] });
    }
    function FullscreenIcon(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: props.restored ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6 3v3H3m10 0h-3V3m0 10v-3h3M3 10h3v3" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M6 3H3v3m10 0V3h-3m0 10h3v-3M3 10v3h3" }) });
    }

    // src/client/components/sidebar-preview-tab.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    var COPY = {
      zh: {
        title: "Univer \u9884\u89C8",
        empty: "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709 Univer \u6587\u4EF6 \u2014 \u5728\u5BF9\u8BDD\u91CC\u521B\u5EFA\u6216\u7F16\u8F91 .univer \u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u4E0E\u5BF9\u8BDD\u4E00\u81F4\u7684\u5B9E\u65F6\u9884\u89C8\u5361\u7247\u3002",
        picker: "\u5207\u6362\u6587\u4EF6",
        loading: "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD\u5386\u53F2\u2026",
        error: "\u4F1A\u8BDD\u5386\u53F2\u8BFB\u53D6\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5",
        refresh: "\u5237\u65B0"
      },
      en: {
        title: "Univer Preview",
        empty: "No Univer files in this session yet \u2014 create or edit a .univer file in the conversation and the same live preview card appears here.",
        picker: "Switch file",
        loading: "Loading session history\u2026",
        error: "Failed to load session history \u2014 click to retry",
        refresh: "Refresh"
      }
    };
    function SidebarPreviewTab(props) {
      const { scope, visible, lang, t, viewerLocale, createHistoryFetcher, getCwd } = props;
      const [targets, setTargets] = React4.useState(null);
      const [failed, setFailed] = React4.useState(false);
      const load = React4.useCallback(async () => {
        if (createHistoryFetcher === void 0) return;
        try {
          const fetchPage = createHistoryFetcher(scope.sessionId);
          if (fetchPage === void 0) {
            setFailed(true);
            return;
          }
          const events = await collectHistoryEvents(fetchPage);
          setTargets(foldHistoryToTargets(events, getCwd?.()));
          setFailed(false);
        } catch {
          setFailed(true);
        }
      }, [createHistoryFetcher, scope.sessionId, getCwd]);
      React4.useEffect(() => {
        void load();
        const timer = window.setInterval(() => {
          if (visible !== false) void load();
        }, 5e3);
        return () => window.clearInterval(timer);
      }, [load, visible]);
      const copy = COPY[lang()];
      const list = targets ?? [];
      const [picked, setPicked] = React4.useState(void 0);
      const selected = picked !== void 0 && list.some((target) => target.file === picked) ? picked : list[0]?.file;
      const selectedTarget = list.find((target) => target.file === selected);
      const { states } = useUniverStates(selected !== void 0 ? [selected] : [], scope.sessionId);
      let body;
      if (failed && list.length === 0) {
        body = /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", className: "dxp-empty dxp-retry", onClick: () => void load(), children: [
          "\u26A0 ",
          copy.error
        ] });
      } else if (selected === void 0 || selectedTarget === void 0) {
        body = /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dxp-empty", children: list.length === 0 && !failed ? copy.empty : copy.loading });
      } else {
        body = /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          ReviewPanel,
          {
            file: selected,
            state: states[selected],
            worktreeId: selectedTarget.worktreeId,
            preferredUnitId: selectedTarget.unitId,
            historical: false,
            t,
            viewerLocale
          }
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dxp-root", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dxp-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dxp-title", children: copy.title }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dxp-headerRight", children: [
            list.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "select",
              {
                className: "dxp-select",
                value: selected ?? "",
                onChange: (event) => setPicked(event.target.value),
                "aria-label": copy.picker,
                children: list.map((target) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: target.file, children: [
                  basename(target.file),
                  target.worktreeId === null ? "" : ` \xB7 ${target.worktreeId}`
                ] }, target.file))
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dxp-refresh", onClick: () => void load(), children: copy.refresh })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dxp-body", children: body })
      ] });
    }
    var sidebarPreviewStyles = `
    .dxp-root{display:flex;flex-direction:column;height:100%;min-height:0;font:var(--dsw-font-xs-13,13px/1.5 sans-serif);color:var(--dsw-alias-label-primary,#1f2328);}
    .dxp-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);flex:none;}
    .dxp-title{font-weight:600;}
    .dxp-headerRight{display:inline-flex;align-items:center;gap:6px;min-width:0;}
    .dxp-select{max-width:220px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#f6f8fa);color:inherit;font:inherit;font-size:12px;}
    .dxp-refresh{padding:3px 10px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#f6f8fa);color:inherit;font:inherit;font-size:12px;cursor:pointer;}
    .dxp-refresh:hover{background:var(--dsw-alias-interactive-bg-hover,#eaeef2);}
    .dxp-body{display:flex;flex-direction:column;min-height:0;flex:1;}
    .dxp-body .uvf_panel{flex:1;min-height:0;}
    .dxp-empty{margin:auto;padding:24px 16px;text-align:center;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;background:none;border:none;}
    button.dxp-retry{cursor:pointer;border-radius:8px;border:1px dashed var(--dsw-alias-border-l2,#d0d7de);max-width:70%;}
    `;

    // src/client/components/preview-card.tsx
    var React5 = __toESM(require("react"), 1);
    var import_jsx_runtime4 = require("react/jsx-runtime");
    function PreviewCard(props) {
      const session = props.useSession((snapshot) => snapshot);
      const cwd = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
      const files = React5.useMemo(() => resolveTurnFiles(props.matched.files, cwd), [props.matched.files, cwd]);
      const { states, missingFiles } = useUniverStates(files.map((entry) => entry.file), props.sessionId);
      const latestTurns = React5.useMemo(() => latestWorktreeTurns(session), [session]);
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_jsx_runtime4.Fragment, { children: files.map((target) => {
        if (missingFiles.has(target.file)) return null;
        const outcome = outcomeOfTurnFile(target);
        const worktreeId = outcome.primaryWorktreeId ?? pendingWorktree(target);
        const historical = worktreeId !== null && latestTurns.get(worktreeId) !== props.matched.turn;
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ReviewPanel,
          {
            file: target.file,
            state: states[target.file],
            worktreeId,
            preferredUnitId: outcome.preferredUnitId,
            historical,
            t: props.t,
            viewerLocale: props.getViewerLocale()
          },
          target.file
        );
      }) });
    }
    function pendingWorktree(target) {
      for (let index = target.operations.length - 1; index >= 0; index -= 1) {
        const operation = target.operations[index];
        if (operation !== void 0 && operation.worktreeId !== null) return operation.worktreeId;
      }
      return null;
    }
    function latestWorktreeTurns(session) {
      const latest = /* @__PURE__ */ new Map();
      for (const [turnNumber, turn] of session.chat.timeline.turns) {
        const data = turn.data.get("univerTurn");
        if (data === void 0) continue;
        for (const file of data.files) {
          for (const operation of file.operations) {
            if (operation.worktreeId !== null) latest.set(operation.worktreeId, turnNumber);
          }
        }
      }
      return latest;
    }

    // src/client/components/univer-dock.tsx
    var React7 = __toESM(require("react"), 1);

    // src/client/components/worktree-window.tsx
    var React6 = __toESM(require("react"), 1);
    var import_jsx_runtime5 = require("react/jsx-runtime");
    var RESIZE_DIRECTIONS = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
    var VIEWPORT_GUTTER = 12;
    var DEFAULT_WIDTH = 560;
    var DEFAULT_HEIGHT = 420;
    var MIN_WIDTH = 360;
    var MIN_HEIGHT = 260;
    var CASCADE_OFFSET = 24;
    function WorktreeWindow(props) {
      const [folded, setFolded] = React6.useState(false);
      const [maximized, setMaximized] = React6.useState(false);
      const [interaction, setInteraction] = React6.useState(null);
      const [rect, setRect] = React6.useState(() => initialRect(props.stackIndex, viewportSize()));
      const [selected, setSelected] = React6.useState(props.preferredUnitId ?? void 0);
      const rectRef = React6.useRef(rect);
      const cancelPointerSessionRef = React6.useRef(() => void 0);
      React6.useLayoutEffect(() => {
        rectRef.current = rect;
      }, [rect]);
      React6.useEffect(() => {
        if (props.preferredUnitId !== null) setSelected(props.preferredUnitId);
      }, [props.preferredUnitId]);
      React6.useEffect(() => {
        const onViewportResize = () => setRect((current) => fitRect(current, viewportSize()));
        window.addEventListener("resize", onViewportResize);
        return () => window.removeEventListener("resize", onViewportResize);
      }, []);
      React6.useEffect(() => () => cancelPointerSessionRef.current(), []);
      const worktree = props.worktreeId === null ? void 0 : props.state?.worktrees.find((entry) => entry.worktreeId === props.worktreeId);
      const units = worktree?.units ?? [];
      const selectedUnit = selected !== void 0 && units.some((unit) => unit.unitId === selected) ? selected : units[0]?.unitId;
      const target = props.worktreeId === null ? props.state?.viewerUrl ?? void 0 : worktree === void 0 ? void 0 : unitViewerUrl(worktree.status === "ready" ? worktree.mergeUrl : worktree.worktreeUrl, units, selectedUnit, worktree.status === "ready" ? "merge" : "worktree");
      const url = target === void 0 ? void 0 : localizeViewerUrl(target, props.viewerLocale);
      const title = worktree?.name || worktree?.worktreeId || props.worktreeId || props.t("dock.currentVersion");
      const status = props.state === void 0 ? "loading" : props.worktreeId === null ? "trunk" : worktree?.status ?? "unavailable";
      const beginPointerSession = (event, kind) => {
        if (event.button !== 0 || maximized) return;
        event.preventDefault();
        event.stopPropagation();
        cancelPointerSessionRef.current();
        const view = event.currentTarget.ownerDocument.defaultView;
        if (view === null) return;
        const pointerId = event.pointerId;
        const origin = { x: event.clientX, y: event.clientY };
        const start = rectRef.current;
        const element = event.currentTarget;
        setInteraction(kind);
        try {
          element.setPointerCapture(pointerId);
        } catch {
        }
        const move = (next) => {
          if (next.pointerId !== pointerId) return;
          const dx = next.clientX - origin.x;
          const dy = next.clientY - origin.y;
          setRect(kind === "move" ? moveRect(start, dx, dy, viewportSize()) : resizeRect(start, kind, dx, dy, viewportSize()));
        };
        const cleanup = () => {
          view.removeEventListener("pointermove", move);
          view.removeEventListener("pointerup", finish);
          view.removeEventListener("pointercancel", finish);
          cancelPointerSessionRef.current = () => void 0;
          try {
            element.releasePointerCapture(pointerId);
          } catch {
          }
        };
        const finish = (next) => {
          if (next.pointerId !== pointerId) return;
          cleanup();
          setInteraction(null);
        };
        cancelPointerSessionRef.current = cleanup;
        view.addEventListener("pointermove", move);
        view.addEventListener("pointerup", finish);
        view.addEventListener("pointercancel", finish);
      };
      const toggleFolded = () => {
        setMaximized(false);
        setFolded((current) => !current);
      };
      const toggleMaximized = () => {
        setFolded(false);
        setMaximized((current) => !current);
      };
      const onHeaderPointerDown = (event) => {
        if (event.target.closest("[data-window-control]") !== null) return;
        beginPointerSession(event, "move");
      };
      const onHeaderDoubleClick = (event) => {
        if (event.target.closest("[data-window-control]") === null) toggleMaximized();
      };
      const className = [
        "uvf_win",
        folded ? "uvf_win_folded" : "",
        maximized ? "uvf_win_max" : ""
      ].filter(Boolean).join(" ");
      const style = {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height
      };
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className, style, "data-interaction": interaction ?? void 0, "aria-label": `${title} \xB7 ${basename(props.file)}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { className: "uvf_windowHeader", onPointerDown: onHeaderPointerDown, onDoubleClick: onHeaderDoubleClick, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "uvf_windowGlyph", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(GridIcon, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "uvf_windowIdentity", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "uvf_windowTitle", children: title }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "uvf_windowFile", children: basename(props.file) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "uvf_chip", "data-status": status, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "uvf_pulse", "aria-hidden": "true" }),
            status === "trunk" ? props.t("dock.currentVersion") : status === "loading" ? props.t("dock.loading") : status === "unavailable" ? props.t("dock.unavailable") : props.t(`dock.${status}`)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "uvf_windowControls", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(WindowControl, { action: "fold", label: props.t(folded ? "dock.expand" : "dock.fold"), onClick: toggleFolded, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(FoldIcon2, { expanded: folded }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(WindowControl, { action: "maximize", label: props.t(maximized ? "dock.restore" : "dock.maximize"), onClick: toggleMaximized, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(MaximizeIcon, { restored: maximized }) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(WindowControl, { action: "close", label: props.t("dock.close"), onClick: props.onDismiss, danger: true, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CloseIcon, {}) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "uvf_windowBody", hidden: folded, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(UnitChips, { units, selected: selectedUnit, t: props.t, onSelect: setSelected }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "uvf_viewerShell", children: url === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "uvf_note", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: props.t("dock.gatewayDown") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: () => void startGateway(), children: props.t("dock.startGateway") })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("iframe", { className: "uvf_frame", src: url, title }) })
        ] }),
        !folded && !maximized ? RESIZE_DIRECTIONS.map((direction) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "span",
          {
            className: `uvf_resizeHandle uvf_resize_${direction}`,
            "data-direction": direction,
            onPointerDown: (event) => beginPointerSession(event, direction)
          },
          direction
        )) : null
      ] });
    }
    function WindowControl(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: `uvf_windowControl${props.danger === true ? " uvf_windowControl_danger" : ""}`,
          "data-window-control": "",
          "data-window-action": props.action,
          title: props.label,
          "aria-label": props.label,
          onClick: props.onClick,
          children: props.children
        }
      );
    }
    function GridIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { viewBox: "0 0 18 18", "aria-hidden": "true", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: "3", y: "3", width: "12", height: "12", rx: "2" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M3 7h12M7 3v12" })
      ] });
    }
    function FoldIcon2(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: props.expanded ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "m4 10 4-4 4 4" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M4 9h8" }) });
    }
    function MaximizeIcon(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: props.restored ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: "3", y: "5", width: "8", height: "8", rx: "1" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "M5 5V3h8v8h-2" })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }) });
    }
    function CloseIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { d: "m4 4 8 8m0-8-8 8" }) });
    }
    function viewportSize() {
      return {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight)
      };
    }
    function initialRect(stackIndex, viewport) {
      const availableWidth = Math.max(1, viewport.width - VIEWPORT_GUTTER * 2);
      const availableHeight = Math.max(1, viewport.height - VIEWPORT_GUTTER * 2);
      const width = Math.min(DEFAULT_WIDTH, availableWidth);
      const height = Math.min(DEFAULT_HEIGHT, availableHeight);
      return fitRect({
        x: viewport.width - VIEWPORT_GUTTER - width - stackIndex * CASCADE_OFFSET,
        y: VIEWPORT_GUTTER + stackIndex * CASCADE_OFFSET,
        width,
        height
      }, viewport);
    }
    function fitRect(rect, viewport) {
      const availableWidth = Math.max(1, viewport.width - VIEWPORT_GUTTER * 2);
      const availableHeight = Math.max(1, viewport.height - VIEWPORT_GUTTER * 2);
      const width = clamp(rect.width, Math.min(MIN_WIDTH, availableWidth), availableWidth);
      const height = clamp(rect.height, Math.min(MIN_HEIGHT, availableHeight), availableHeight);
      return {
        x: clamp(rect.x, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, viewport.width - VIEWPORT_GUTTER - width)),
        y: clamp(rect.y, VIEWPORT_GUTTER, Math.max(VIEWPORT_GUTTER, viewport.height - VIEWPORT_GUTTER - height)),
        width,
        height
      };
    }
    function moveRect(start, dx, dy, viewport) {
      return fitRect({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
    }
    function resizeRect(start, direction, dx, dy, viewport) {
      const fitted = fitRect(start, viewport);
      const minWidth = Math.min(MIN_WIDTH, Math.max(1, viewport.width - VIEWPORT_GUTTER * 2));
      const minHeight = Math.min(MIN_HEIGHT, Math.max(1, viewport.height - VIEWPORT_GUTTER * 2));
      let left = fitted.x;
      let right = fitted.x + fitted.width;
      let top = fitted.y;
      let bottom = fitted.y + fitted.height;
      if (direction.includes("w")) left = clamp(fitted.x + dx, VIEWPORT_GUTTER, right - minWidth);
      if (direction.includes("e")) right = clamp(right + dx, left + minWidth, viewport.width - VIEWPORT_GUTTER);
      if (direction.includes("n")) top = clamp(fitted.y + dy, VIEWPORT_GUTTER, bottom - minHeight);
      if (direction.includes("s")) bottom = clamp(bottom + dy, top + minHeight, viewport.height - VIEWPORT_GUTTER);
      return { x: left, y: top, width: right - left, height: bottom - top };
    }
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    // src/client/components/univer-dock.tsx
    var import_jsx_runtime6 = require("react/jsx-runtime");
    function UniverDock(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(UniverSessionDock, { ...props }, props.sessionId);
    }
    function UniverSessionDock(props) {
      const cwd = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
      const turnFiles = React7.useMemo(() => turnFilesOfSession(props.session, cwd), [props.session, cwd]);
      const [open, setOpen] = React7.useState({});
      const seen = React7.useRef(/* @__PURE__ */ new Set());
      const running = props.session?.running === true;
      React7.useEffect(() => {
        const additions = [];
        for (const file of turnFiles) {
          for (const operation of file.operations) {
            if (operation.phase === "failed" || !opensFloatingWindow(operation)) continue;
            const candidate = openWindowOf(operation, file.file);
            if (candidate === null || seen.current.has(operation.callId)) continue;
            seen.current.add(operation.callId);
            additions.push(candidate);
          }
        }
        if (additions.length === 0) return;
        setOpen((previous) => {
          const next = { ...previous };
          for (const addition of additions) next[addition.file] = addition;
          return next;
        });
      }, [turnFiles]);
      const files = Object.keys(open);
      const { states } = useUniverStates(running ? files : [], props.sessionId);
      React7.useEffect(() => {
        setOpen((previous) => {
          let changed = false;
          const next = { ...previous };
          for (const target of Object.values(previous)) {
            if (target.worktreeId === null) continue;
            const worktree = states[target.file]?.worktrees.find((entry) => entry.worktreeId === target.worktreeId);
            if (worktree?.status === "merged" || worktree?.status === "discarded") {
              delete next[target.file];
              changed = true;
            }
          }
          return changed ? next : previous;
        });
      }, [states]);
      if (!running) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, {});
      const windows = Object.values(open);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, { children: windows.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "uvf_root", children: windows.map((target, stackIndex) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        WorktreeWindow,
        {
          file: target.file,
          state: states[target.file],
          worktreeId: target.worktreeId,
          preferredUnitId: target.preferredUnitId,
          stackIndex,
          t: props.t,
          viewerLocale: props.getViewerLocale(),
          onDismiss: () => setOpen((previous) => {
            const next = { ...previous };
            delete next[target.file];
            return next;
          })
        },
        target.file
      )) }) });
    }
    function openWindowOf(operation, file) {
      if (operation.name === "new") return { file, worktreeId: null, preferredUnitId: operation.unitId };
      if (operation.worktreeId === null) return null;
      return { file, worktreeId: operation.worktreeId, preferredUnitId: operation.unitId };
    }

    // src/client/locales/en.ts
    var en = {
      title: "Univer Preview",
      expand: "Expand preview",
      collapse: "Collapse preview",
      refresh: "Refresh",
      "gateway.running": "Univer Gateway running",
      "gateway.stopped": "Univer Gateway stopped \u2014 click to start",
      "gateway.starting": "Starting Univer Gateway\u2026",
      "gateway.checking": "Checking Univer Gateway\u2026",
      "gateway.failed": "Univer Gateway unavailable \u2014 click to retry",
      "dock.live": "live sync",
      "dock.draft": "Editing",
      "dock.ready": "Ready",
      "dock.mergeReady": "Ready",
      "dock.unit.added": "A",
      "dock.unit.modified": "M",
      "dock.unit.deleted": "D",
      "dock.unit.conflict": "Conflict",
      "dock.fold": "Collapse",
      "dock.expand": "Expand",
      "dock.maximize": "Maximize",
      "dock.restore": "Restore",
      "dock.close": "Close",
      "dock.gatewayDown": "Univer Gateway is not running; live preview is unavailable",
      "dock.startGateway": "Start Gateway",
      "dock.mergeTitle": "Merge preview",
      "dock.reviewTitle": "Modification in progress",
      "dock.markReady": "Submit for confirmation",
      "dock.merged": "Merged",
      "dock.discarded": "Discarded",
      "dock.mergedTitle": "Changes merged",
      "dock.discardedTitle": "Changes discarded",
      "dock.fullscreen": "Review fullscreen",
      "dock.exitFullscreen": "Exit fullscreen",
      "dock.currentVersion": "Current version",
      "dock.loading": "Loading",
      "dock.unavailable": "Unavailable",
      "dock.notReady": "Submit this modification for confirmation before merging or discarding it",
      "dock.merge": "Merge into current version",
      "dock.discard": "Discard",
      "exports.title": "Office exports",
      "exports.empty": "No Office files exported in this session yet",
      "exports.loading": "Loading export records\u2026",
      "exports.error": "Failed to load export records \u2014 click to retry",
      "exports.refresh": "Refresh",
      "exports.open": "Preview",
      "exports.download": "Download"
    };

    // src/client/locales/zh.ts
    var zh = {
      title: "Univer \u9884\u89C8",
      expand: "\u5C55\u5F00\u9884\u89C8",
      collapse: "\u6536\u8D77\u9884\u89C8",
      refresh: "\u5237\u65B0",
      "gateway.running": "Univer Gateway \u8FD0\u884C\u4E2D",
      "gateway.stopped": "Univer Gateway \u672A\u8FD0\u884C\uFF0C\u70B9\u51FB\u542F\u52A8",
      "gateway.starting": "\u6B63\u5728\u542F\u52A8 Univer Gateway\u2026",
      "gateway.checking": "\u6B63\u5728\u68C0\u67E5 Univer Gateway\u2026",
      "gateway.failed": "Univer Gateway \u4E0D\u53EF\u7528\uFF0C\u70B9\u51FB\u91CD\u8BD5",
      "dock.live": "\u5B9E\u65F6\u540C\u6B65",
      "dock.draft": "\u4FEE\u6539\u4E2D",
      "dock.ready": "\u5F85\u786E\u8BA4",
      "dock.mergeReady": "\u5F85\u786E\u8BA4",
      "dock.unit.added": "\u65B0",
      "dock.unit.modified": "\u6539",
      "dock.unit.deleted": "\u5220",
      "dock.unit.conflict": "\u51B2\u7A81",
      "dock.fold": "\u6298\u53E0",
      "dock.expand": "\u5C55\u5F00",
      "dock.maximize": "\u653E\u5927",
      "dock.restore": "\u8FD8\u539F",
      "dock.close": "\u5173\u95ED",
      "dock.gatewayDown": "Univer Gateway \u672A\u8FD0\u884C\uFF0C\u65E0\u6CD5\u5B9E\u65F6\u9884\u89C8",
      "dock.startGateway": "\u542F\u52A8 Gateway",
      "dock.mergeTitle": "\u5408\u5E76\u9884\u89C8",
      "dock.reviewTitle": "\u6B63\u5728\u8FDB\u884C\u7684\u4FEE\u6539",
      "dock.markReady": "\u63D0\u4EA4\u786E\u8BA4",
      "dock.merged": "\u5DF2\u5408\u5165",
      "dock.discarded": "\u5DF2\u4E22\u5F03",
      "dock.mergedTitle": "\u4FEE\u6539\u5DF2\u5408\u5165",
      "dock.discardedTitle": "\u4FEE\u6539\u5DF2\u4E22\u5F03",
      "dock.fullscreen": "\u5168\u5C4F\u5BA1\u9605",
      "dock.exitFullscreen": "\u9000\u51FA\u5168\u5C4F",
      "dock.currentVersion": "\u5F53\u524D\u7248\u672C",
      "dock.loading": "\u6B63\u5728\u52A0\u8F7D",
      "dock.unavailable": "\u6682\u4E0D\u53EF\u7528",
      "dock.notReady": "\u63D0\u4EA4\u786E\u8BA4\u540E\uFF0C\u53EF\u4EE5\u5408\u5165\u6216\u4E22\u5F03\u8FD9\u5904\u4FEE\u6539",
      "dock.merge": "\u5408\u5165\u5F53\u524D\u7248\u672C",
      "dock.discard": "\u4E22\u5F03",
      "exports.title": "Office \u5BFC\u51FA",
      "exports.empty": "\u672C\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5BFC\u51FA\u7684 Office \u6587\u4EF6",
      "exports.loading": "\u6B63\u5728\u52A0\u8F7D\u5BFC\u51FA\u8BB0\u5F55\u2026",
      "exports.error": "\u5BFC\u51FA\u8BB0\u5F55\u52A0\u8F7D\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5",
      "exports.refresh": "\u5237\u65B0",
      "exports.open": "\u9884\u89C8",
      "exports.download": "\u4E0B\u8F7D"
    };

    // src/client/locales/index.ts
    var UNIVER_LOCALE_NAMESPACE = "univer";

    // src/client/styles/worktree.ts
    var worktreeStyles = `
    .uvf_root{position:fixed;inset:0;z-index:1200;pointer-events:none}
    .uvf_win{--uvf-accent:#5b6cff;--uvf-positive:#20a66a;pointer-events:auto;position:fixed;isolation:isolate;display:flex;flex-direction:column;min-width:1px;min-height:1px;overflow:hidden;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#dfe3eb);border-radius:16px;box-shadow:0 1px 2px rgba(13,22,38,.08),0 18px 48px rgba(13,22,38,.2),0 0 0 1px rgba(255,255,255,.4) inset;transition:border-color .16s ease,box-shadow .16s ease}
    .uvf_win:hover{border-color:color-mix(in srgb,var(--uvf-accent) 28%,var(--dsw-alias-border-l2,#dfe3eb));box-shadow:0 2px 5px rgba(13,22,38,.1),0 22px 58px rgba(13,22,38,.24),0 0 0 1px rgba(255,255,255,.5) inset}
    .uvf_win[data-interaction]{transition:none;user-select:none}
    .uvf_win[data-interaction]::after{content:"";position:absolute;inset:0;z-index:18;background:transparent}
    .uvf_win_folded{height:48px!important}
    .uvf_win_max{inset:12px!important;width:auto!important;height:auto!important;border-radius:18px;z-index:1300}
    .uvf_windowHeader{position:relative;z-index:10;display:flex;align-items:center;gap:10px;height:48px;padding:0 8px 0 10px;flex:none;cursor:grab;touch-action:none;user-select:none;background:#f7f8fb;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 96%,#7583ff),color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,#dfe3f5));border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#dfe3eb) 78%,transparent)}
    .uvf_win[data-interaction=move] .uvf_windowHeader{cursor:grabbing}.uvf_win_max .uvf_windowHeader{cursor:default}.uvf_win_folded .uvf_windowHeader{border-bottom:0}
    .uvf_windowGlyph{display:grid;place-items:center;width:30px;height:30px;flex:none;border-radius:9px;color:#fff;background:linear-gradient(145deg,#7a87ff,#4f5fe7);box-shadow:0 5px 12px rgba(79,95,231,.25)}
    .uvf_windowGlyph svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
    .uvf_windowIdentity{display:flex;flex-direction:column;justify-content:center;min-width:0;flex:1;line-height:1.2}
    .uvf_windowTitle,.uvf_windowFile{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.uvf_windowTitle{font-size:12.5px;font-weight:650;letter-spacing:.01em;color:var(--dsw-alias-label-primary,#172033)}.uvf_windowFile{margin-top:2px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#7d8798)}
    .uvf_chip{display:inline-flex;align-items:center;gap:6px;flex:none;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#dfe3eb);border-radius:999px;font-size:10.5px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-secondary,#566174);background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 75%,transparent)}
    .uvf_pulse,.uvf_dot{position:relative;width:7px;height:7px;border-radius:50%;background:var(--uvf-positive);flex:none}.uvf_pulse::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1px solid currentColor;opacity:.24;animation:uvf-pulse 2s ease-out infinite}.uvf_chip[data-status=ready]{color:#16784d;border-color:color-mix(in srgb,#20a66a 30%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#20a66a 8%,var(--dsw-alias-bg-base,#fff))}.uvf_chip[data-status=draft]{color:#9a6114;border-color:color-mix(in srgb,#d78b25 34%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#d78b25 9%,var(--dsw-alias-bg-base,#fff))}.uvf_chip[data-status=draft] .uvf_pulse{background:#d78b25}
    .uvf_chip[data-status=trunk],.uvf_chip[data-status=loading],.uvf_chip[data-status=unavailable]{color:#566174}.uvf_chip[data-status=trunk] .uvf_pulse,.uvf_chip[data-status=loading] .uvf_pulse,.uvf_chip[data-status=unavailable] .uvf_pulse{background:#7d8798}
    @keyframes uvf-pulse{0%{transform:scale(.7);opacity:.35}70%,100%{transform:scale(1.65);opacity:0}}
    .uvf_windowControls{display:flex;align-items:center;gap:3px;flex:none}.uvf_windowControl{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary,#566174);background:transparent;cursor:pointer;transition:color .12s ease,background .12s ease,transform .12s ease}.uvf_windowControl:hover{color:var(--dsw-alias-label-primary,#172033);background:color-mix(in srgb,var(--dsw-alias-label-primary,#172033) 8%,transparent)}.uvf_windowControl:active{transform:scale(.92)}.uvf_windowControl:focus-visible{outline:2px solid color-mix(in srgb,var(--uvf-accent) 65%,transparent);outline-offset:1px}.uvf_windowControl_danger:hover{color:#d94242;background:rgba(217,66,66,.1)}.uvf_windowControl svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
    .uvf_windowBody{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}.uvf_windowBody[hidden]{display:none}
    .uvf_units{display:flex;align-items:center;gap:5px;min-height:36px;padding:5px 9px;border-bottom:1px solid var(--dsw-alias-border-l2,#dfe3eb);overflow-x:auto;scrollbar-width:thin;background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 94%,#edf0f8)}
    .uvf_unit{display:inline-flex;align-items:center;gap:4px;flex:none;max-width:220px;border:1px solid var(--dsw-alias-border-l2,#dfe3eb);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#566174);font:11px/20px inherit;padding:0 9px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:border-color .12s ease,color .12s ease,background .12s ease}.uvf_unit:hover{border-color:color-mix(in srgb,var(--uvf-accent) 35%,var(--dsw-alias-border-l2,#dfe3eb));color:var(--dsw-alias-label-primary,#172033)}.uvf_unit_on{border-color:color-mix(in srgb,var(--uvf-accent) 55%,var(--dsw-alias-border-l2,#dfe3eb));color:#4554d6;background:color-mix(in srgb,var(--uvf-accent) 9%,var(--dsw-alias-bg-base,#fff));box-shadow:0 0 0 1px color-mix(in srgb,var(--uvf-accent) 10%,transparent) inset}.uvf_unit_icon{font-size:10px;opacity:.82}
    .uvf_viewerShell{position:relative;display:flex;flex:1;min-width:0;min-height:0;background:#f1f3f7}.uvf_frame{display:block;flex:1;min-width:0;min-height:0;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base,#fff)}
    .uvf_note{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#7d8798)}.uvf_note button{border:1px solid color-mix(in srgb,var(--uvf-accent) 40%,var(--dsw-alias-border-l2,#dfe3eb));border-radius:8px;padding:6px 13px;color:#fff;background:var(--uvf-accent);font:12px/18px inherit;cursor:pointer}
    .uvf_resizeHandle{position:absolute;z-index:20;display:block;touch-action:none}.uvf_resize_n,.uvf_resize_s{left:16px;right:16px;height:10px;cursor:ns-resize}.uvf_resize_n{top:0}.uvf_resize_s{bottom:0}.uvf_resize_w,.uvf_resize_e{top:16px;bottom:16px;width:10px;cursor:ew-resize}.uvf_resize_w{left:0}.uvf_resize_e{right:0}.uvf_resize_nw,.uvf_resize_ne,.uvf_resize_sw,.uvf_resize_se{width:18px;height:18px}.uvf_resize_nw{left:0;top:0;cursor:nwse-resize}.uvf_resize_ne{right:0;top:0;cursor:nesw-resize}.uvf_resize_sw{left:0;bottom:0;cursor:nesw-resize}.uvf_resize_se{right:0;bottom:0;cursor:nwse-resize}.uvf_resize_se::after{content:"";position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-right:1.5px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#7d8798) 58%,transparent);border-bottom:1.5px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#7d8798) 58%,transparent);border-radius:0 0 2px}
    .uvf_panel{--uvf-review-accent:#5b63e8;display:flex;flex-direction:column;width:100%;max-width:1100px;margin:14px auto 6px;overflow:hidden;border:1px solid color-mix(in srgb,var(--uvf-review-accent) 18%,var(--dsw-alias-border-l2,#dfe3eb));border-radius:18px;color:var(--dsw-alias-label-primary,#172033);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 1px 2px rgba(13,22,38,.05),0 14px 40px rgba(13,22,38,.1)}
    .uvf_panel_fullscreen{position:fixed;inset:10px;z-index:1400;width:auto;height:auto;max-width:none;margin:0;border-radius:18px;box-shadow:0 28px 90px rgba(13,22,38,.36)}
    .uvf_panelHead{display:flex;align-items:center;gap:9px;height:58px;min-height:58px;box-sizing:border-box;padding:7px 10px;flex:none;background:linear-gradient(125deg,color-mix(in srgb,var(--uvf-review-accent) 8%,var(--dsw-alias-bg-base,#fff)),var(--dsw-alias-bg-base,#fff) 48%);border-bottom:1px solid var(--dsw-alias-border-l2,#dfe3eb)}
    .uvf_panelGlyph{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:9px;color:#fff;background:linear-gradient(145deg,#7279f4,#4d55d5);box-shadow:0 4px 10px rgba(77,85,213,.18)}.uvf_panelGlyph svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
    .uvf_panelIdentity{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}.uvf_panelTitleRow{display:flex;min-width:0;align-items:center;gap:8px}.uvf_panelTitle,.uvf_panelWorktree,.uvf_panelMeta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.uvf_panelTitle{flex:none;font-size:13.5px;font-weight:700;line-height:18px}.uvf_panelWorktree{min-width:0;color:var(--uvf-review-accent);font-size:11px;font-weight:600;line-height:16px}.uvf_panelMeta{color:var(--dsw-alias-label-tertiary,#7d8798);font-size:10px;line-height:14px}
    .uvf_panelChip{display:inline-flex;align-items:center;gap:6px;flex:none;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,#dfe3eb);border-radius:999px;font-size:11px;font-weight:650;line-height:16px}.uvf_panelStatusDot{width:7px;height:7px;flex:none;border-radius:50%;background:currentColor}.uvf_panelChip[data-status=ready],.uvf_panelChip[data-status=merged]{color:#16784d;border-color:color-mix(in srgb,#20a66a 32%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#20a66a 9%,var(--dsw-alias-bg-base,#fff))}.uvf_panelChip[data-status=draft]{color:#9a6114;border-color:color-mix(in srgb,#d78b25 34%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#d78b25 9%,var(--dsw-alias-bg-base,#fff))}.uvf_panelChip[data-status=discarded]{color:#697386;border-color:color-mix(in srgb,#7d8798 30%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#7d8798 8%,var(--dsw-alias-bg-base,#fff))}
    .uvf_panelChip[data-status=trunk],.uvf_panelChip[data-status=loading],.uvf_panelChip[data-status=unavailable]{color:#697386;border-color:color-mix(in srgb,#7d8798 30%,var(--dsw-alias-border-l2,#dfe3eb));background:color-mix(in srgb,#7d8798 8%,var(--dsw-alias-bg-base,#fff))}
    .uvf_panelContent{display:flex;height:590px;min-height:0;flex:none;flex-direction:column}.uvf_panelContent[hidden]{display:none}.uvf_panelBody{display:flex;min-height:0;flex:1;flex-direction:column;background:#f1f3f7}.uvf_panelFrame{display:block;width:100%;height:auto;min-height:0;flex:1;border:0;background:var(--dsw-alias-bg-base,#fff)}.uvf_panelUnavailable{display:grid;min-height:0;flex:1;place-items:center;color:var(--dsw-alias-label-tertiary,#7d8798);font-size:12px}.uvf_panel_fullscreen .uvf_panelContent{height:auto;flex:1}.uvf_panel_fullscreen .uvf_panelBody{flex:1}.uvf_panel_fullscreen .uvf_panelFrame{height:auto;min-height:0;flex:1}
    .uvf_btn{display:grid;place-items:center;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:9px;color:var(--dsw-alias-label-secondary,#566174);background:transparent;cursor:pointer;transition:color .12s ease,background .12s ease,transform .12s ease}.uvf_btn:hover{color:var(--dsw-alias-label-primary,#172033);background:color-mix(in srgb,var(--dsw-alias-label-primary,#172033) 8%,transparent)}.uvf_btn:active{transform:scale(.92)}.uvf_btn:focus-visible{outline:2px solid color-mix(in srgb,var(--uvf-review-accent) 65%,transparent);outline-offset:1px}.uvf_btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
    .uvf_panel[data-status=merged]{border-color:color-mix(in srgb,#20a66a 28%,var(--dsw-alias-border-l2,#dfe3eb))}.uvf_panel[data-status=merged] .uvf_panelGlyph{background:linear-gradient(145deg,#2bb373,#16784d);box-shadow:0 7px 16px rgba(22,120,77,.2)}.uvf_panel[data-status=discarded]{border-color:color-mix(in srgb,#7d8798 28%,var(--dsw-alias-border-l2,#dfe3eb));box-shadow:0 1px 2px rgba(13,22,38,.04)}.uvf_panel[data-status=discarded] .uvf_panelGlyph{color:#697386;background:color-mix(in srgb,#7d8798 11%,var(--dsw-alias-bg-base,#fff));box-shadow:none}
    .uvf_panel_history{box-shadow:0 1px 2px rgba(13,22,38,.04)}.uvf_panel_history .uvf_panelHead{border-bottom:0}
    @media (max-width:680px){.uvf_panelHead{align-items:flex-start;flex-wrap:wrap}.uvf_panelIdentity{min-width:calc(100% - 42px)}.uvf_panelChip{margin-left:41px}.uvf_panelContent{height:380px}}
    @media (prefers-reduced-motion:reduce){.uvf_win,.uvf_windowControl,.uvf_unit,.uvf_btn{transition:none}.uvf_pulse::after{animation:none}}
    `;

    // src/client/index.tsx
    var import_jsx_runtime7 = require("react/jsx-runtime");
    var inject = ["slots", "locale", "conversationEvents", "connection", "sessions"];
    function resolveBetterSidebar(ctx) {
      const candidate = ctx.get?.("betterSidebar");
      if (candidate === void 0 || candidate === null) return void 0;
      const sidebar = candidate;
      return typeof sidebar.registerTab === "function" && typeof sidebar.openFile === "function" ? sidebar : void 0;
    }
    function isRecord2(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    function resolveHistoryFactory(ctx) {
      const connection = ctx.connection;
      const raw = connection?.api?.sessions?.history;
      if (typeof raw !== "function") return void 0;
      const call = raw.bind(connection);
      return (sessionId) => {
        return async (beforeSeq) => {
          const response = await call({ sessionId, beforeSeq, maxMessages: 400 });
          window.__uvHistLast = {
            sessionId,
            beforeSeq: beforeSeq ?? null,
            type: typeof response,
            keys: isRecord2(response) ? Object.keys(response) : null,
            preview: JSON.stringify(response)?.slice(0, 500) ?? null
          };
          let value = response;
          if (isRecord2(value) && isRecord2(value.result)) {
            value = value.result.ok === true ? value.result.value : void 0;
          }
          if (isRecord2(value) && Array.isArray(value.events)) return value.events;
          window.__uvHistUnwrapFailed = true;
          return [];
        };
      };
    }
    function resolveSessionCwd(ctx) {
      return (sessionId) => {
        const list = ctx.sessions?.list;
        const byId = list?.getSnapshot?.()?.byId;
        const row = isRecord2(byId) ? byId[sessionId] : void 0;
        return typeof row?.cwd === "string" ? row.cwd : void 0;
      };
    }
    function apply(ctx) {
      const getViewerLocale = () => viewerLocaleOf(ctx.locale.getSnapshot().active);
      const lang = () => ctx.locale.getSnapshot().active === "zh" ? "zh" : "en";
      const translate = ((key) => (lang() === "zh" ? zh[key] : en[key]) ?? String(key));
      injectStyles("dsh-univer-office/styles", worktreeStyles);
      injectStyles("dsh-univer-office/sidebar-preview", sidebarPreviewStyles);
      try {
        ctx.conversationEvents.register(univerTurnDefinition);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("already registered")) throw error;
      }
      ctx.effect(() => ctx.locale.register(UNIVER_LOCALE_NAMESPACE, { zh, en }), "univer: dictionaries");
      ctx.effect(() => ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
        name: "conversation.chat.turnTail",
        priority: -10,
        locale: UNIVER_LOCALE_NAMESPACE,
        select: selectUniverTurn,
        inject: () => ({ getViewerLocale })
      }, PreviewCard)), "univer: turn preview");
      ctx.effect(() => ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
        name: "conversation.input.dock",
        id: "univer-dock",
        order: 400,
        locale: UNIVER_LOCALE_NAMESPACE,
        inject: () => ({ getViewerLocale })
      }, UniverDock)), "univer: worktree dock");
      const historyFactory = resolveHistoryFactory(ctx);
      const getCwd = resolveSessionCwd(ctx);
      ctx.effect(() => {
        let disposed = false;
        let registered = false;
        let tabDisposer;
        const deadline = Date.now() + 6e4;
        const attempt = () => {
          if (disposed || registered) return;
          const sidebar = resolveBetterSidebar(ctx);
          if (sidebar === void 0) {
            if (Date.now() > deadline) window.clearInterval(timer);
            return;
          }
          registered = true;
          window.clearInterval(timer);
          tabDisposer = sidebar.registerTab({
            id: "univer-office:preview",
            title: () => lang() === "zh" ? "Univer \u9884\u89C8" : "Univer Preview",
            order: 255,
            single: true,
            icon: "\u{1FA9F}",
            component: (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              SidebarPreviewTab,
              {
                scope: props.scope,
                visible: props.visible,
                lang,
                t: translate,
                viewerLocale: getViewerLocale(),
                createHistoryFetcher: historyFactory,
                getCwd: () => getCwd(props.scope.sessionId)
              }
            )
          });
        };
        const timer = window.setInterval(attempt, 300);
        attempt();
        return () => {
          disposed = true;
          window.clearInterval(timer);
          tabDisposer?.();
        };
      }, "univer: better-sidebar preview tab");
    }
    function injectStyles(id, css) {
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return;
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-univer-office";
      style.dataset.pluginCss = id;
      style.textContent = css;
      document.head.appendChild(style);
    }

    return module.exports;
  }
});
