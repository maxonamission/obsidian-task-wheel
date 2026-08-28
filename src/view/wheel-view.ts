import {
	apiVersion,
	ItemView,
	MarkdownView,
	Menu,
	Notice,
	Platform,
	TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from "obsidian";
import { putIcon } from "./icon";
import {
	type CarryPreset,
	NO_FILTER,
	outward,
	type Priority,
	scopeKey,
	scopeLabel,
	VAULT_SCOPE,
	type TaskFilter,
	type WheelScope,
	type WheelTree,
} from "../model/types";
import { scanVault } from "../vault/scan";
import {
	type CarryMode,
	type LineAnchor,
	type LineRef,
	writeDone,
	writeInsertAfter,
	writeMove,
	writeMoveTo,
	writeMoveToNew,
	writeMoveUnder,
	writeStatus,
	writeText,
	writeScheduled,
	writePriority,
	type WriteOutcome,
} from "../vault/writeback";
import {
	type Palette,
	paletteOf,
	PRIORITY_LADDER,
} from "../layout/colour";
import { domainWeights, type WedgeDivision } from "../layout/budgets";
import { type LaidOutNode, layoutWheel, type WheelLayout } from "../layout/radial";
import { buildDetents, type Detent } from "../layout/detents";
import { taskAfter } from "../layout/order";
import { prune } from "../layout/sweep";
import {
	type AfterWrite,
	carryFocus,
	carrySeen,
	landAfter,
} from "../model/carry";
import { aWeekOut, today } from "../model/dates";
import { paneChange } from "../model/detour";
import { openAround } from "../model/resume";
import { inScope } from "../parse/domain";
import { headingsOf } from "../parse/outline";
import { linesOf } from "../parse/lines";
import { parseTaskLine } from "../parse/task-line";
import { describe, isFiltering } from "../parse/filter";
import {
	levelForNewSection,
	type MoveDirection,
	whyNotMoved,
} from "../parse/outline-edit";
import {
	filterOf,
	parseOptionsOf,
	setFilter,
	stateFor,
	visibleBudgetOf,
} from "../settings";
import { WheelRenderer } from "./render-wheel";
import { type CardActions, foldTarget, renderReadingCard } from "./reading-card";
import { renderLegend } from "./legend";
import type { HelpAction, HelpRoundState } from "./help-content";
import { renderFilterPanel } from "./filter-panel";
import { pickHeading } from "./heading-picker";
import { parentCandidates, pickTask } from "./task-picker";
import { attachLinkSuggest } from "./link-suggest";
import { promptForTasks } from "./prompt";
import { type DomRegistrar, WheelController } from "./wheel-controller";
import { type CarryHost, carryTo, carryToPreset } from "./carry-flow";
import {
	actOnSection,
	addSubheadingTo,
	addToSection,
	moveSectionUnder,
	type SectionHost,
} from "./section-edits";
import { nodeAtLine, watchVault } from "./vault-watch";
import {
	drawSweep,
	markSeen,
	progressOf,
	type RoundHost,
	startRound,
} from "./round";
import {
	type RoundAction,
	roundMenu,
	type RoundMenuState,
} from "./round-menu";
import type TaskWheelPlugin from "../main";

export const VIEW_TYPE_TASK_WHEEL = "task-wheel-view";

/** How many lines the diagnostics panel keeps. */
/**
 * How many lines the trace keeps.
 *
 * Fourteen, back when the panel was there to be photographed and a screen
 * only held so much. One gesture costs about eleven of them — down, canvas,
 * begin, start, first move, up, end, place, rim, frame, draw — so a second
 * gesture pushed the first one out, and the reader kept losing exactly the
 * one that had gone wrong (eigenaar, 28 aug 2026: *"bij de eerste ging het
 * paneel open"*, and its lines were already gone).
 *
 * Now that the panel is bounded, scrolls on its own and is copied by a
 * button rather than by hand, keeping more costs nothing anyone can feel:
 * two hundred lines is some twenty gestures, which is a session of trying to
 * reproduce something rather than a single lucky attempt.
 */
const TRACE_LINES = 200;

/**
 * When this bundle was built, stamped in by esbuild.
 *
 * The version cannot tell two test builds apart — a dozen of them carry the
 * same one between releases — and a round was spent reading a trace for a fix
 * that build did not contain (28 aug 2026). Declared with a fallback so the
 * tests, which never go through esbuild, do not have to know about it.
 */
declare const __TASK_WHEEL_BUILD__: string | undefined;
const BUILD =
	typeof __TASK_WHEEL_BUILD__ === "string" ? __TASK_WHEEL_BUILD__ : "dev";

/**
 * One review action, and everything it needs.
 *
 * A union rather than a name plus five bags of optional parameters. The old
 * shape took `(kind, ref, due?, change?, status?, outline?)` where `outline`
 * held five more optionals, so what a call *meant* could only be read off which
 * positions were `undefined` — and a new action had to be threaded through the
 * signature, the if-ladder and every caller before the compiler had an opinion
 * (audit, 23 aug 2026). Here a `moveTo` without a target does not compile.
 *
 * Writing it down also settled a question: there was an `insert` branch that
 * nothing had called since BC_E3_S24 replaced it with the walking
 * `writeInsertAfter`. Adding a case for it would have been inventing a caller.
 */
type Act =
	| { kind: "done" }
	| { kind: "status"; char: string }
	/** No date is not an error: a task without one is deferred from today. */
	| { kind: "defer"; scheduled?: string }
	| { kind: "priority"; from: Priority; step: number }
	| { kind: "text"; text: string }
	| { kind: "move"; direction: MoveDirection }
	/** The heading or parent task a picker named, with the text it showed. */
	| { kind: "moveTo"; target: LineAnchor }
	| { kind: "moveUnder"; target: LineAnchor }
	| { kind: "moveToNew"; title: string };


/**
 * The wheel's workspace view.
 *
 * Its whole job is plumbing: scan the vault, hand the tree to the pure layout,
 * hand the layout to the renderer and the controller. No angle, radius, colour
 * or stop is decided here — that all lives in `layout/`, where it can be tested
 * without an Obsidian window (kaderdocument §7).
 *
 * Three things trigger work, and they cost very different amounts:
 *
 *  - **A rescan** re-reads the vault. Only on demand or on a settings change.
 *  - **A re-layout** re-opens the fisheye around a new focus and redraws. Once
 *    per stop the wheel comes to rest on, never during a gesture.
 *  - **A turn** is a transform on the rotor and a redrawn card. Every frame.
 */
export class TaskWheelView extends ItemView {
	/**
	 * How much of the vault this wheel is about.
	 *
	 * Lives on the view rather than in the settings because two wheels can be
	 * open at once — the vault in one tab, a project in the next — and Obsidian
	 * hands each leaf its own state back after a restart.
	 */
	private wheelScope: WheelScope = VAULT_SCOPE;

	private tree: WheelTree | null = null;
	private layout: WheelLayout | null = null;
	private renderer: WheelRenderer | null = null;
	private controller: WheelController | null = null;

	/** Id under the reading wedge right now, kept across a rescan. */
	private focusId: string | null = null;
	/** Id the current drawing was laid out around. */
	private laidOutFor: string | null = null;

	private cardEl: HTMLElement | null = null;
	private canvasEl: HTMLElement | null = null;
	private legendEl: HTMLElement | null = null;
	private controlsEl: HTMLElement | null = null;
	/** The button in the pane that goes one step wider, under the filter panel. */
	private outEl: HTMLElement | null = null;
	private scopeEl: HTMLElement | null = null;
	private traceEl: HTMLElement | null = null;
	/** The lines themselves, inside the panel — the toolbar above them stays. */
	private traceTextEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;

	/** Rolling log of what the device sent, newest last. */
	private readonly trace: string[] = [];

	/** Something changed in the vault that this wheel has not read yet. */
	private stale = false;
	/** Whether the missing-section notice has been given for the current gap. */
	private saidSectionMissing = false;

	/** The header button that opens the note, in a wheel over one note. */
	private headerAction: HTMLElement | null = null;

	/**
	 * The note pane the reader was last in, of the ones this wheel is about.
	 *
	 * Only consulted when they come back to the wheel — see `leafChanged`.
	 */
	private cameFrom: WorkspaceLeaf | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TaskWheelPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_WHEEL;
	}

	getDisplayText(): string {
		return scopeLabel(this.wheelScope);
	}

	/**
	 * The scope, as Obsidian persists it per leaf.
	 *
	 * This is what makes a local wheel survive a restart: the workspace file
	 * remembers which folder or note the tab was showing, and hands it back
	 * before the first draw.
	 */
	getState(): Record<string, unknown> {
		return { ...super.getState(), scope: this.wheelScope };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// Before the await, deliberately. Obsidian asks `getDisplayText()` for the
		// tab title around this call, and everything after an `await` happens a
		// turn later — which is how a wheel over one note ended up with "Task
		// wheel" over it instead of the note's name (owner, 19 aug 2026).
		const scope = readScope(state);
		const changed = scope !== null && scopeKey(scope) !== scopeKey(this.wheelScope);
		if (changed && scope !== null) {
			this.wheelScope = scope;
			this.focusId = null;
			this.laidOutFor = null;
			this.syncHeaderAction();
		}

		await super.setState(state, result);

		if (changed && this.canvasEl !== null) await this.refresh();
	}

	getIcon(): string {
		return "disc-3";
	}

	/** Which wheel this is, for finding an already-open one. */
	scopeKey(): string {
		return scopeKey(this.wheelScope);
	}

	/**
	 * What this wheel is about, for the commands that act on the active one.
	 *
	 * Not `scope()` — Obsidian's own `View` already has one of those, and it is
	 * a keymap scope.
	 */
	currentScope(): WheelScope {
		return this.wheelScope;
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("task-wheel-view");
		this.addRoundAction();
		this.syncHeaderAction();

		// The wheel and its card share one box: the card floats over the empty
		// middle of the disc rather than taking a block of its own above it.
		// That gives the drawing the whole pane, and lets the card be any height
		// it likes without moving anything (kaderdocument §4, the Instrument
		// impression).
		const stage = container.createDiv({ cls: "task-wheel-stage" });

		this.canvasEl = stage.createDiv({
			cls: "task-wheel-canvas",
			attr: {
				tabindex: "0",
				role: "group",
				"aria-label":
					"Task wheel. Drag or scroll to turn through every item in order. Left and right move along the current ring, up moves out to a child, down moves in to the parent. Tap an item to bring it under the reading wedge. Space folds the branch you are in away.",
			},
		});

		// The card announces itself: it is the only place the focused item is
		// written out, so a screen reader turning the wheel with the arrow keys
		// hears what it landed on.
		this.cardEl = stage.createDiv({ attr: { "aria-live": "polite" } });

		// The filter belongs to the round, not to the configuration, so it sits
		// in the pane the way the graph view keeps its own controls. Under it the
		// way one step out: the header has that button too, but the corner of the
		// wheel is where the hand already is — on a phone especially (eigenaar,
		// 22 aug 2026).
		const corner = stage.createDiv({ cls: "task-wheel-corner" });
		this.controlsEl = corner.createDiv();
		this.outEl = corner.createDiv();

		// And opposite it, what this wheel is about. Obsidian's own title bar is
		// not ours to write in — see `drawScopeTitle`.
		this.scopeEl = stage.createDiv();

		this.legendEl = container.createDiv({ cls: "task-wheel-legend" });
		this.errorEl = container.createDiv({ cls: "task-wheel-error" });
		this.traceEl = container.createDiv({ cls: "task-wheel-trace" });
		this.drawTracePanel();

		this.controller = new WheelController({
			surface: this.canvasEl,
			register: this.registrar(),
			onFocus: (detent) => this.onFocus(detent),
			onSettle: (detent) => this.onSettle(detent),
			onToggle: () => this.toggleFold(),
			onActivate: (id) => this.openScopeFor(id),
			onZoom: (zoom) => this.onZoom(zoom),
			onTrace: (line) => this.onTrace(line),
			onMove: (direction) => this.moveFocused(direction),
			panels: () => this.panelState(),
			restorePanels: (was) => this.restorePanels(was),
		});

		this.watchVault();
		this.controller.setZoom(stateFor(this.plugin.settings, this.wheelScope).zoom);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		// A closed wheel is the commonest end of a round, and it is not an
		// unload — so what the round collected is written here rather than
		// waiting for a timer that outlives the view.
		await this.plugin.flushState();

		this.controller?.stop();
		this.controller = null;
		this.renderer = null;
		this.contentEl.empty();
		this.cardEl = null;
		this.canvasEl = null;
		this.controlsEl = null;
		this.legendEl = null;
		this.errorEl = null;
		this.traceEl = null;
		this.traceTextEl = null;
	}

	/**
	 * Keep up with edits made outside the wheel (see `vault-watch.ts`).
	 *
	 * A button was the other option and it is the wrong one. The wheel's whole
	 * promise is that a round is complete; a promise you have to remember to
	 * refresh is not one the instrument keeps, it is one it hands back to you.
	 */
	private watchVault(): void {
		watchVault({
			app: this.app,
			scope: () => this.wheelScope,
			options: () => parseOptionsOf(this.plugin.settings),
			markStale: () => {
				this.stale = true;
			},
			isStale: () => this.stale,
			catchUp: () => void this.catchUp(),
			leafChanged: (leaf) => this.leafChanged(leaf),
			own: (ref) => this.registerEvent(ref),
		});
	}

	/**
	 * Follow a link written inside a task.
	 *
	 * Through Obsidian's own resolution, from the note the task lives in, so it
	 * lands exactly where the same link would from the note itself: same
	 * aliases, same headings, same rules for a name that appears in two folders.
	 * Rebuilding any of that here would be a second answer to a question the
	 * app already answers.
	 *
	 * A modifier opens it beside rather than in place, the way a link does
	 * everywhere else in Obsidian.
	 */
	private follow(
		laid: LaidOutNode,
		target: string,
		external: boolean,
		event: MouseEvent,
	): void {
		if (external) {
			// Without a target: on desktop it makes no difference, and in the
			// mobile WebView `"_blank"` behaves differently from one platform to
			// the next (audit, 23 aug 2026).
			window.open(target);
			return;
		}

		const from = laid.node.source?.path ?? "";
		const beside = event.ctrlKey || event.metaKey || event.button === 1;
		void this.app.workspace.openLinkText(target, from, beside);
	}

	/**
	 * The reader moved to another pane.
	 *
	 * Two things can be happening, and telling them apart is the whole point.
	 * Going *to* a note in this wheel's scope is the start of the round's one
	 * detour, so the note is remembered; coming back *to this wheel* is the end
	 * of it, and then the wheel lands on whatever the cursor was left on.
	 *
	 * It used to fire on every leaf change and read the cursor of the **first**
	 * open note in scope, whichever pane that happened to be. On the vault wheel
	 * every note is in scope, so any note open anywhere decided where the wheel
	 * stood — and a note that was merely opened has its cursor at the top, which
	 * is why the wheel kept returning to the same item (eigenaar, 24 aug 2026).
	 */
	private leafChanged(leaf: WorkspaceLeaf | null): void {
		const view = leaf?.view;
		const notePath =
			view instanceof MarkdownView ? (view.file?.path ?? null) : null;

		const change = paneChange(notePath, leaf === this.leaf, (path) =>
			inScope(path, this.wheelScope),
		);

		if (change.kind === "into") this.cameFrom = leaf;
		else if (change.kind === "back") this.followCursor();
	}

	/**
	 * Come back to the wheel on the item the cursor was left on.
	 *
	 * Opening the note and coming back is the round's one detour, and landing
	 * where you started rather than where you left is what makes it a detour
	 * instead of a restart.
	 */
	private followCursor(): void {
		if (!this.containerEl.isShown()) return;

		const tree = this.tree;
		const from = this.cameFrom;
		const view = from?.view;
		if (tree === null || !(view instanceof MarkdownView)) return;

		const path = view.file?.path;
		if (path === undefined || !inScope(path, this.wheelScope)) return;

		const id = nodeAtLine(tree, path, view.editor.getCursor().line);
		if (id === null || id === this.focusId) return;

		this.focusId = id;
		this.laidOutFor = null;
		this.relayout();
	}

	/**
	 * Re-read, unless doing so would take something away from the reader.
	 *
	 * A redraw replaces the card, so a rename half typed would vanish under the
	 * hands of the person typing it. That is worth staying stale for: the flag
	 * survives, and the next event — or finishing the rename, which writes and
	 * refreshes anyway — picks it up.
	 */
	private async catchUp(): Promise<void> {
		if (!this.stale) return;
		if (!this.containerEl.isShown()) return;
		if (this.cardEl?.querySelector(".task-wheel-card-rename") != null) return;

		await this.refresh();
	}

	/**
	 * Give the wheel the keyboard back after you have done something to an item.
	 *
	 * The arrow keys are bound to the canvas, and the canvas loses focus the
	 * moment you press a button on the card or answer a picker — so after one
	 * edit the arrows stopped working and the reader had to click the drawing to
	 * get going again (owner, 18 aug 2026).
	 *
	 * Only ever taken back from our own controls, and never from anything you
	 * could still be typing in: a filter box, a dropdown, an editor in the next
	 * pane. Stealing focus is worse than not returning it.
	 */
	private takeBackKeyboard(): void {
		const canvas = this.canvasEl;
		if (canvas === null) return;

		const active = canvas.ownerDocument.activeElement;
		const nobody = active === null || active === canvas.ownerDocument.body;
		if (!nobody && !this.containerEl.contains(active)) return;

		if (
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement ||
			active instanceof HTMLSelectElement ||
			(active instanceof HTMLElement && active.isContentEditable)
		) {
			return;
		}

		canvas.focus();
	}

	/**
	 * Say the true thing about a move that did not happen.
	 *
	 * One sentence used to cover every refusal — "already at the end of its
	 * list" — which is wrong when you asked to go up, and wrong again for the
	 * only task under a heading, where the real answer is that this is a
	 * different operation (owner, 18 aug 2026). The note is read again here
	 * because a refusal is a dead end anyway; one cached read is cheaper than
	 * carrying the answer along the whole write path for the rare case.
	 */
	private async whyNotMoved(
		ref: LineRef,
		direction: MoveDirection,
	): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(ref.path);
		if (!(file instanceof TFile)) return "Task wheel: that note is gone.";

		const lines = linesOf(await this.app.vault.cachedRead(file));
		switch (whyNotMoved(lines, ref.line, direction)) {
			case "alone":
				return "Task wheel: this is the only item in its list. Use “Move to another heading” to take it somewhere else.";
			case "first":
				return "Task wheel: it is already the first in its list.";
			case "last":
				return "Task wheel: it is already the last in its list.";
			case "not-a-task":
				return "Task wheel: that line has changed since the scan.";
		}
	}

	/**
	 * Run one step of the drawing without letting it take the others with it.
	 *
	 * A view that half-renders and says nothing is the worst possible outcome
	 * on a device the developer cannot reach: the reader sees something, so it
	 * looks deliberate. Every step reports its own failure, on screen, whether
	 * or not the diagnostics panel is switched on.
	 */
	private safely(step: string, run: () => void): void {
		try {
			run();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.onTrace(`FAILED ${step}: ${message}`);
			this.showError(`${step} failed: ${message}`);
			console.error(`Task Wheel: ${step} failed`, error);
		}
	}

	private showError(message: string): void {
		const el = this.errorEl;
		if (el === null) return;
		el.empty();
		el.addClass("is-on");
		el.createEl("p", { text: message });
	}

	private clearError(): void {
		this.errorEl?.empty();
		this.errorEl?.removeClass("is-on");
	}

	/**
	 * What the device sent, when the reader asked to see it.
	 *
	 * Kept deliberately dumb: a list of lines, newest last, capped. It is a
	 * window onto a machine we cannot reach, not a logging framework.
	 */
	private onTrace(line: string): void {
		this.trace.push(line);
		while (this.trace.length > TRACE_LINES) this.trace.shift();
		if (!this.plugin.settings.diagnostics) return;

		const el = this.traceTextEl;
		if (el === null) return;
		el.setText(this.trace.join("\n"));

		// The newest line is the one being read, and the panel is short enough
		// now that the rest scrolls out of sight above it.
		const panel = this.traceEl;
		if (panel !== null) panel.scrollTop = panel.scrollHeight;
	}

	/**
	 * The diagnostics panel: a way to take the lines with you, then the lines.
	 *
	 * The panel was built to be *photographed* — a `Notice` is gone in eight
	 * seconds, which is the wrong property for something you are trying to
	 * capture. Photographing turned out to be the wrong verb: what the reader
	 * actually wants is the text, and on a phone selecting it out of a scrolling
	 * pane is a fight (eigenaar, 28 aug 2026: *"ik kan de diagnostics niet copy
	 * pasten"*).
	 *
	 * So there is a button. What it copies carries a short header — plugin
	 * version, Obsidian's API version, desktop or mobile — because a trace
	 * without those needs a second round of questions before it can be read.
	 */
	private drawTracePanel(): void {
		const el = this.traceEl;
		if (el === null) return;

		el.empty();
		const bar = el.createDiv({ cls: "task-wheel-trace-bar" });
		bar.createSpan({
			cls: "task-wheel-trace-title",
			text: "Diagnostics",
		});

		const copy = bar.createEl("button", {
			cls: "task-wheel-trace-copy",
			attr: { type: "button", "aria-label": "Copy the diagnostics" },
		});
		putIcon(copy, "copy", "task-wheel-trace-icon");
		copy.createSpan({ text: "Copy" });
		copy.addEventListener("click", () => void this.copyTrace());

		const clear = bar.createEl("button", {
			cls: "task-wheel-trace-copy",
			attr: { type: "button", "aria-label": "Clear the diagnostics" },
		});
		putIcon(clear, "eraser", "task-wheel-trace-icon");
		clear.createSpan({ text: "Clear" });
		clear.addEventListener("click", () => {
			this.trace.length = 0;
			this.traceTextEl?.setText("");
		});

		this.traceTextEl = el.createEl("pre", { text: this.trace.join("\n") });
	}

	/** Put the trace on the clipboard, header and all. */
	private async copyTrace(): Promise<void> {
		const header = [
			`Task Wheel ${this.plugin.manifest.version} (build ${BUILD})`,
			`Obsidian API ${apiVersion}`,
			Platform.isMobile ? "mobile" : "desktop",
			scopeLabel(this.wheelScope),
		].join(" · ");

		try {
			await navigator.clipboard.writeText(`${header}\n${this.trace.join("\n")}`);
			new Notice("Task wheel: diagnostics copied.");
		} catch {
			// Some surfaces refuse the clipboard outright. Saying so beats a
			// button that looks like it worked.
			new Notice("Task wheel: this device would not let the plugin copy.");
		}
	}

	/**
	 * A line in this wheel's trace, from outside the wheel.
	 *
	 * The help panel beside it has nothing of its own to report into, and a
	 * `Notice` is gone in eight seconds — which is exactly the wrong property
	 * for something the reader is trying to photograph (eigenaar, 25 aug 2026).
	 * This window is already on their screen and it keeps its lines.
	 */
	note(line: string): void {
		this.onTrace(line);
	}

	/** Re-read the vault and redraw. Safe to call repeatedly. */
	async refresh(): Promise<void> {
		// Cleared before the read rather than after it: an edit that lands while
		// the scan is running has to leave the flag set, or it would be swallowed
		// by the very scan that was too early to see it.
		this.stale = false;

		this.tree = await scanVault(
			this.app,
			parseOptionsOf(this.plugin.settings, this.wheelScope),
			this.plugin.scanCache,
		);
		this.onTrace(
			`scan: ${this.tree.root.shownTaskCount} in the round, ${this.plugin.scanCache.reused} notes reused`,
		);

		// A section wheel's anchor is a path of titles, and a rename quietly
		// takes it away. Said out loud once, on the scan that finds it gone —
		// an empty circle that stopped being *about* anything must not look
		// like a section that is merely finished (BC_E3_S64).
		if (this.tree.sectionMissing === true && !this.saidSectionMissing) {
			new Notice(
				"Task wheel: the heading this wheel is about is no longer in the note — renamed or removed. Go out to the note to find it back.",
			);
		}
		this.saidSectionMissing = this.tree.sectionMissing === true;

		this.relayout();
	}

	/** Rescan, redraw and say so — the command-palette entry point. */
	async refreshWithNotice(): Promise<void> {
		await this.refresh();
		const shown = this.tree?.root.shownTaskCount ?? 0;
		// Same word the hub uses, and for the same reason: the count is items of
		// the round, which in a round that holds finished work are not all open.
		new Notice(
			this.tree?.showsFinished === true
				? `Task Wheel: ${shown} ${shown === 1 ? "item" : "items"} shown`
				: `Task Wheel: ${shown} open ${shown === 1 ? "task" : "tasks"}`,
		);
	}

	/**
	 * Carry out a review action, and say what came of it.
	 *
	 * Every write goes through the same door so the aftermath is handled once:
	 * a changed note means a rescan, and a stale line means the wheel was
	 * showing something the vault no longer says — which is not an error but a
	 * reason to look again.
	 */
	private async act(
		what: Act,
		ref: LineRef,
		after: AfterWrite = {},
	): Promise<void> {
		let outcome: WriteOutcome;

		try {
			switch (what.kind) {
				case "done":
					outcome = await writeDone(this.app, ref);
					break;
				case "status":
					outcome = await writeStatus(this.app, ref, what.char);
					break;
				case "text":
					outcome = await writeText(this.app, ref, what.text);
					break;
				case "move":
					outcome = await writeMove(this.app, ref, what.direction);
					break;
				case "moveTo":
					outcome = await writeMoveTo(this.app, ref, what.target);
					break;
				case "moveUnder":
					outcome = await writeMoveUnder(this.app, ref, what.target);
					break;
				case "moveToNew":
					outcome = await writeMoveToNew(this.app, ref, what.title);
					break;
				case "defer":
					// A deferral is a decision about attention, not a change to the
					// deadline: it writes ⏳ and leaves 📅 alone, so the "parked for
					// later" lens recognises the wheel's own deferrals and the
					// overdue lens keeps telling the truth (BC_E3_S65).
					outcome = await writeScheduled(
						this.app,
						ref,
						aWeekOut(what.scheduled, today()),
					);
					break;
				case "priority":
					outcome = await writePriority(
						this.app,
						ref,
						shift(what.from, what.step),
					);
					break;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
			return;
		}

		if (outcome === "stale") {
			new Notice("Task wheel: that line has changed since the scan. Rescanned.");
		} else if (outcome === "missing") {
			new Notice(`Task wheel: ${ref.path} is gone. Rescanned.`);
		} else if (outcome === "unchanged") {
			// A press that changes nothing has to say so. Silence here is what hid
			// the CRLF defect: every action on a Windows-authored note was dropped
			// without a word, and the button simply appeared to be dead.
			new Notice(
				what.kind === "move"
					? await this.whyNotMoved(ref, what.direction)
					: what.kind === "moveUnder"
						? // The picker leaves out the task itself and everything under
							// it, so the only refusal left is the one that changes nothing.
							"Task wheel: it already hangs under that task."
						: "Task wheel: nothing to change on that line.",
			);
		}

		// Renaming and moving hand back a node the wheel has never met, because a
		// node's id is its place plus its text. Carrying the round's marks — and
		// the reading wedge — across is what keeps an edit from quietly undoing
		// part of a round (kaderdocument §5).
		if (outcome !== "unchanged") await this.refreshCarrying(after);
	}

	/**
	 * Re-read, and move this round's marks onto whatever the items became.
	 *
	 * Every id the mapping does not recognise is kept as it is, so an edit in
	 * one note never disturbs a round's memory of another.
	 */
	private async refreshCarrying(after: AfterWrite = {}): Promise<void> {
		const { rename } = after;
		const before = this.tree;

		// Worked out from the tree as it was, before the write is read back —
		// "the next item along this ring" is a question about the ring the
		// reader was just looking at.
		const land =
			after.advance === true && before !== null
				? taskAfter(before.root, this.focusId)
				: null;

		await this.refresh();

		const grown = this.tree;
		if (before === null || grown === null) return;

		const state = stateFor(this.plugin.settings, this.wheelScope);
		state.seen = carrySeen(before, grown, state.seen, rename);
		this.plugin.persist();

		// The item this action was aimed past, if it is still on the wheel. It
		// wins over carrying the old focus across: the point of aiming was to
		// leave that item behind.
		const wanted = landAfter(
			land,
			carryFocus(before, grown, this.focusId, rename),
			(id) => grown.byId.has(id),
		);

		if (wanted !== null && wanted !== this.focusId) {
			this.focusId = wanted;
			this.laidOutFor = null;
			this.relayout();
		}

		// The wheel came to rest on it because you finished with the one before,
		// and coming to rest on something is having reviewed it (see `markSeen`).
		// Only for a landing this action asked for: an ordinary rescan lands the
		// wedge back where it already was, which was marked when you turned there.
		if (land !== null && wanted === land) markSeen(this.roundHost(), land);

		// You pressed a button or answered a picker, so the canvas lost the
		// keyboard. Give it back, or the next arrow key goes nowhere.
		this.takeBackKeyboard();
	}

	/**
	 * A second tap: open a wheel over this item.
	 *
	 * The natural next question after "what is under here" is "show me only
	 * this", and it is the same move as right-clicking the folder or note in
	 * the file list — reached from where the reader is already looking.
	 *
	 * Which blikveld an item stands for depends on what it is: a domain is a
	 * folder, everything else belongs to a note. A domain that came from a tag
	 * stands for no place on disk, and then the honest answer is to say so
	 * rather than to open something arbitrary.
	 */
	private openScopeFor(id: string): void {
		const laid = this.layout?.byId.get(id);
		if (laid === undefined) return;

		const scope = this.scopeOf(laid);
		if (scope === null) {
			new Notice(
				this.wheelScope.kind === "note" || this.wheelScope.kind === "section"
					? "Task wheel: these tasks sit above the first heading — there is no section to open for them."
					: "Task wheel: a tag domain is not a folder, so there is no wheel to open for it.",
			);
			return;
		}

		if (scopeKey(scope) === scopeKey(this.wheelScope)) {
			new Notice("Task wheel: this wheel is already about that.");
			return;
		}

		void this.plugin.openScoped(scope, this.leaf);
	}

	/** The folder, note or section an item stands for, if it stands for one. */
	private scopeOf(laid: LaidOutNode): WheelScope | null {
		const here = this.wheelScope.kind;

		// In a wheel over one note or one section, the wedges and rings *are*
		// headings, so "a wheel over it" means the section — the fourth rung of
		// the blikveld ladder (kaderdocument §4.1, BC_E3_S64). The source's
		// heading path is absolute, so the anchor is complete whatever depth
		// this wheel already sits at.
		if (
			(here === "note" || here === "section") &&
			(laid.node.kind === "group" ||
				(laid.depth === 1 && laid.node.kind === "domain"))
		) {
			const source = laid.node.source;
			// A wedge without a heading line is the bucket for tasks above the
			// first heading — there is no section to open for that.
			if (source === undefined || source.raw === null) return null;
			return {
				kind: "section",
				path: source.path,
				heading: [...source.headingPath, laid.node.label],
			};
		}

		// A wedge that is a note is handled below, by its source, like any other
		// note: in a folder wheel the outermost ring holds both (BC_E3_S35).
		if (laid.depth === 1 && laid.node.kind === "domain") {
			if (this.plugin.settings.domainSource === "tag") return null;

			// A domain's label is a folder name; under a folder wheel it is a
			// name inside that folder, so the path grows with the scope.
			const base =
				this.wheelScope.kind === "folder" ? `${this.wheelScope.path}/` : "";
			return { kind: "folder", path: `${base}${laid.node.label}` };
		}

		const source = laid.node.source;
		return source === undefined ? null : { kind: "note", path: source.path };
	}

	/** Open the note this item came from, at its own line. */
	private openNote(laid: LaidOutNode): void {
		const source = laid.node.source;
		if (source === undefined) return;
		this.showNote(source.path, source.line);
	}

	/**
	 * The button in the pane's header that opens the note this wheel is about.
	 *
	 * Only a wheel over one note has such a note, so only that wheel gets the
	 * button: a folder and a vault are not things you can open (BC_E3_S25).
	 * `addAction` has no counterpart, so the element is kept and detached when
	 * the blikveld moves on.
	 *
	 * The way *out* was here too for a day. It moved into the wheel itself, next
	 * to the filter panel, after the owner tested it (22 aug 2026): the corner is
	 * where the hand already is mid-round, and the header is a journey on a
	 * phone. Three doors to one move was one too many, so this one closed.
	 */
	private syncHeaderAction(): void {
		// The title over the pane comes from `getDisplayText()`, and Obsidian
		// decides for itself when to ask. Setting the scope before the first
		// `await` is what makes the answer right in time; this is the belt to
		// that pair of braces, for the case where it has already asked.
		// `updateHeader` is not in the public typings, so it is called only if it
		// happens to be there.
		const leaf = this.leaf as unknown as { updateHeader?: () => void };
		leaf.updateHeader?.();

		this.headerAction?.detach();
		this.headerAction = null;

		if (this.wheelScope.kind !== "note" && this.wheelScope.kind !== "section") {
			return;
		}

		this.headerAction = this.addAction("file-text", "Open this note", () => {
			const scope = this.wheelScope;
			if (scope.kind === "note" || scope.kind === "section") {
				this.showNote(scope.path, null);
			}
		});
	}

	/**
	 * Open the wheel one step wider, reusing the one you came from.
	 *
	 * `openScoped` reveals a wheel that is already open for that blikveld, which
	 * is nearly always the case going out: it is the wheel you were in when you
	 * tapped your way in. Only when it has since been closed does a tab appear.
	 *
	 * Public, because the command palette offers this too — a move you make
	 * often enough to want a key on it.
	 */
	goWider(): void {
		const wider = outward(this.wheelScope);
		if (wider === null) {
			new Notice("Task wheel: this wheel is already about the whole vault.");
			return;
		}
		void this.plugin.openScoped(wider, this.leaf);
	}

	/**
	 * The round's own actions, in the pane's header.
	 *
	 * Every one of these existed already — as a command, which is a fine home on
	 * a desktop and no home at all on a phone, where there is no palette worth
	 * opening mid-round. They are also all about *this* wheel, and the commands
	 * have to guess which wheel that is; a button in a wheel's own header cannot
	 * guess wrong (BC_E3_S33).
	 */
	private addRoundAction(): void {
		// The way to the key, from the pane it explains. A command as well, but a
		// phone has no palette worth opening mid-round — the same reason the round
		// actions moved into this header (BC_E3_S33).
		this.addAction("help-circle", "Task wheel help", () => {
			void this.plugin.openHelp();
		});

		this.addAction("more-vertical", "Round and filter", (event) => {
			const menu = new Menu();
			for (const row of roundMenu(this.roundMenuState())) {
				if (row.separator === true) {
					menu.addSeparator();
					continue;
				}
				menu.addItem((item) => {
					item.setTitle(row.title);
					if (row.icon !== undefined) item.setIcon(row.icon);
					if (row.disabled === true) item.setDisabled(true);
					if (row.checked === true) item.setChecked(true);
					const action = row.action;
					if (action !== null && row.disabled !== true) {
						item.onClick(() => this.runRoundAction(action));
					}
				});
			}
			menu.showAtMouseEvent(event);
		});
	}

	/** What the menu has to know about this wheel to read correctly. */
	private roundMenuState(): RoundMenuState {
		const { seen, total } = progressOf(this.roundHost());
		const filter = filterOf(this.plugin.settings, this.wheelScope);
		const wider = outward(this.wheelScope);
		return {
			seen,
			total,
			filtering: isFiltering(filter),
			filterText: describe(filter),
			due: filter.due,
			folded: stateFor(this.plugin.settings, this.wheelScope).collapsed.length,
			stale: this.stale,
			outward: wider === null ? null : scopeLabel(wider),
		};
	}

	/**
	 * The same state, for the help panel beside the wheel.
	 *
	 * Deliberately built here rather than read out of the view by the panel: it
	 * is the wheel that knows how far its round has got, and a panel reaching
	 * into a view for six fields would be a second place to keep in step.
	 */
	helpState(): HelpRoundState {
		const { seen, total } = progressOf(this.roundHost());
		const wider = outward(this.wheelScope);
		return {
			read: this.tree !== null,
			seen,
			total,
			// Named as a blikveld rather than as a tab title: `scopeLabel` answers
			// "what does this tab say", and on the vault wheel that is the plugin's
			// own name, which reads as nothing at all under the word "Scope".
			scope:
				this.wheelScope.kind === "vault"
					? "The whole vault"
					: scopeLabel(this.wheelScope),
			filter: this.filterLine(),
			folded: stateFor(this.plugin.settings, this.wheelScope).collapsed.length,
			outward: wider === null ? null : scopeLabel(wider),
		};
	}

	/**
	 * The domains this wheel is drawing, in the order their hues are handed out.
	 *
	 * For the panel's colour key. Empty before the first draw, which is the
	 * honest answer: there are no domains until the vault has been read.
	 */
	domainNames(): string[] {
		return [...(this.layout?.budgets ?? [])]
			.sort((a, b) => a.index - b.index)
			.map((budget) => budget.domain);
	}

	/**
	 * The hues this wheel is handing out, for a key that explains it.
	 *
	 * Asked of the drawing rather than read from the settings a second time:
	 * a key showing colours the wheel is not using would be worse than no key
	 * (BC_E3_S72).
	 */
	palette(): Palette {
		return this.layout?.palette ?? paletteOf(this.plugin.settings.wedgePalette);
	}

	/**
	 * One row of the help panel, done by the wheel it is about.
	 *
	 * Handed straight to the round menu's own handler: a panel that repeated
	 * what "clear the filter" means would be a second implementation, and the
	 * two would drift on the first change.
	 */
	runFromHelp(action: Exclude<HelpAction, "open-wheel">): void {
		this.runRoundAction(action);
	}

	private runRoundAction(action: RoundAction): void {
		const filter = filterOf(this.plugin.settings, this.wheelScope);

		switch (action) {
			case "outward":
				this.goWider();
				return;
			case "new-round":
				this.startRound();
				new Notice("Task wheel: a new round. Nothing seen yet.");
				return;
			// A lens that is already on goes off again — the tick in the menu says
			// as much, and a second press that did nothing would make it a lie.
			case "overdue":
				void this.changeFilter({
					...filter,
					due: filter.due === "overdue" ? "any" : "overdue",
				});
				return;
			case "soon":
				void this.changeFilter({
					...filter,
					due: filter.due === "soon" ? "any" : "soon",
				});
				return;
			case "clear-filter":
				void this.changeFilter({ ...NO_FILTER });
				return;
			// This wheel's folds, not every wheel's: the row counts what is folded
			// here, so it has to undo exactly that. The command in the palette is
			// still the one that reaches them all.
			case "unfold": {
				const state = stateFor(this.plugin.settings, this.wheelScope);
				const folded = state.collapsed.length;
				state.collapsed = [];
				this.plugin.persist();
				this.redraw();
				new Notice(
					`Task wheel: unfolded ${folded} ${folded === 1 ? "branch" : "branches"}.`,
				);
				return;
			}
			case "rescan":
				void this.plugin.rescan();
				return;
			case "skip-report":
				void this.plugin.showSkipReport();
				return;
			case "duplicate-report":
				void this.plugin.showDuplicateReport();
				return;
			case "add-preset":
				void this.plugin.addPreset();
				return;
		}
	}

	/** Show a note beside the wheel, reusing a tab that already has it open. */
	private showNote(path: string, line: number | null): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(`Task wheel: ${path} is gone.`);
			return;
		}

		// Beside the wheel rather than over it: the point of opening the note is
		// to read it *and* keep your place in the round.
		//
		// A tab of its own, but only the first time. Opening the note from a dozen
		// stops in the same note used to leave a dozen tabs of that same note
		// behind — a round of reviewing turned the workspace into a wall of
		// duplicates (found by the owner, 15 aug 2026). If the note is already
		// open anywhere, that leaf is the one that gets shown and moved.
		const open = this.app.workspace
			.getLeavesOfType("markdown")
			.find((leaf) => (leaf.view as MarkdownView).file?.path === path);

		if (open !== undefined) {
			void this.app.workspace.revealLeaf(open);
			// A wheel's own note opens at the top: there is no one line it is
			// about, and jumping somewhere arbitrary in it would be a guess.
			//
			// Skipping this jump was tried, to stay out of *Remember cursor
			// position*'s way, and rejected on its price after a day's use (owner,
			// 20 aug 2026 — BC_E3_S30, cancelled). Landing in the note but not on
			// the task is worth less than the flicker costs.
			if (line !== null) open.view.setEphemeralState({ line });
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		void leaf.openFile(file, line === null ? undefined : { eState: { line } });
	}

	/**
	 * How Obsidian's own side panels stand, in a word.
	 *
	 * Handed to the controller so a gesture and what it opened land in the
	 * same trace line. `collapsed` is on the public sidedock; nothing here
	 * touches them, it only looks.
	 */
	private panelState(): string {
		const { leftSplit, rightSplit } = this.app.workspace;
		const side = (open: boolean): string => (open ? "open" : "shut");
		return `${side(!leftSplit.collapsed)}/${side(!rightSplit.collapsed)}`;
	}

	/**
	 * Close a side panel that opened under a finger that was turning the wheel.
	 *
	 * Only shut ones are re-shut, and only the side that changed: this puts
	 * back what the gesture knocked over, it does not impose a state. A panel
	 * the reader had open before they started turning stays open.
	 */
	private restorePanels(was: string): void {
		const [left, right] = was.split("/");
		const { leftSplit, rightSplit } = this.app.workspace;
		if (left === "shut" && !leftSplit.collapsed) leftSplit.collapse();
		if (right === "shut" && !rightSplit.collapsed) rightSplit.collapse();
	}

	/** Redraw from the settings as they now stand, without touching the vault. */
	redraw(): void {
		this.relayout();
	}

	/**
	 * Re-open the fisheye and redraw, without touching the vault.
	 *
	 * The layout depends on which item is in focus and which branches are
	 * folded, so both of those changing means new angles — but neither means
	 * the notes have changed. Keeping this separate from `refresh` is what
	 * makes stepping through a round cheap.
	 */
	private relayout(): void {
		const tree = this.tree;
		if (tree === null) return;

		const state = stateFor(this.plugin.settings, this.wheelScope);

		// When the wedges divide by open tasks, the weights are dealt once per
		// round and then frozen: this is the only place they are ever computed,
		// and only when the round has none yet. Ticking work off rescans the
		// vault, but it cannot reach these numbers — the drawing must not move
		// under the reader's hands mid-round (kaderdocument §3.1).
		let division: WedgeDivision | undefined;
		if (this.plugin.settings.wedgeDivision === "tasks") {
			if (state.roundWeights === null || state.roundWeights === undefined) {
				state.roundWeights = domainWeights(tree);
				this.plugin.persist();
			}
			division = {
				weights: state.roundWeights,
				minimum: this.plugin.settings.wedgeMinimum,
			};
		}

		const options = {
			budgets: state.domainBudgets,
			division,
			collapsed: new Set(state.collapsed),
			visibleBudget: visibleBudgetOf(this.plugin.settings),
			// Plugin-wide, unlike the filter and the round: a palette is about
			// how things look, not about what you are reviewing right now
			// (BC_E3_S72).
			palette: paletteOf(this.plugin.settings.wedgePalette),
		};

		// Which item the fisheye opens around. On a first draw there is nothing
		// in focus yet, so lay the wheel out plainly once to find out what the
		// first stop would be, and open around that. Without this the wheel
		// arrives flat and only comes alive after the first turn — which reads
		// as the feature being broken rather than as it not having started.
		if (this.laidOutFor === null || !tree.byId.has(this.laidOutFor)) {
			// Where the reader was: still in focus, else where this blikveld was
			// left, else nowhere — see `openAround` for why in that order.
			const kept = openAround(this.focusId, state.reading, (id) =>
				tree.byId.has(id),
			);

			// The controller is told where to come to rest by `focusId`, so a
			// remembered place has to become the focus as well as the fisheye's
			// centre — otherwise the wheel opens around it and then turns away.
			this.focusId ??= kept;
			this.laidOutFor =
				kept ?? buildDetents(layoutWheel(tree, options))[0]?.id ?? null;
		}

		this.layout = layoutWheel(tree, { ...options, focusId: this.laidOutFor });
		this.render();
	}

	private render(): void {
		const { cardEl, canvasEl, legendEl } = this;
		if (cardEl === null || canvasEl === null || legendEl === null) return;

		const tree = this.tree;
		const layout = this.layout;
		if (tree === null || layout === null) return;

		if (tree.root.shownTaskCount === 0) {
			this.renderEmptyState();
			return;
		}

		cardEl.removeClass("task-wheel-empty");
		canvasEl.removeClass("is-empty");
		this.clearError();

		const trace = this.traceEl;
		if (trace !== null) {
			trace.toggleClass("is-on", this.plugin.settings.diagnostics);
			// The lines go when the switch goes; the toolbar stays, so turning
			// diagnostics back on does not rebuild the panel.
			if (!this.plugin.settings.diagnostics) {
				this.trace.length = 0;
				this.traceTextEl?.setText("");
			}
		}

		const detents = buildDetents(layout);
		this.onTrace(
			`draw: ${layout.nodes.length} items, ${detents.length} stops, ` +
				`${tree.root.shownTaskCount} open, window ${layout.window}`,
		);

		this.safely("drawing the wheel", () => {
			this.renderer = new WheelRenderer(canvasEl, layout);
			// The drawing is the one layer no headless test can reach: the angles
			// are pure and have their own tests, but which of them reached the
			// screen is decided incrementally, in a browser. With diagnostics on
			// it says so itself (BC_E3_S70).
			this.renderer.watchPlacement(
				this.plugin.settings.diagnostics ? (line) => this.onTrace(line) : null,
			);
		});
		this.safely("wiring the turn", () => {
			if (this.renderer === null) return;
			this.controller?.adopt(this.renderer, detents, this.focusId);
		});
		this.safely("drawing the key", () =>
			renderLegend(legendEl, layout, this.filterLine()),
		);
		this.safely("drawing the filter panel", () => this.drawControls());
		this.safely("drawing the way out", () => this.drawOut());
		this.safely("naming the wheel", () => this.drawScopeTitle());

		// Ids of items the vault no longer holds would keep a round open for
		// ever, so the sweep is trimmed to what is actually on the disc.
		this.safely("drawing the sweep", () => {
			const state = stateFor(this.plugin.settings, this.wheelScope);
			if (tree !== null) state.seen = [...prune(tree, state.seen)];
			drawSweep(this.roundHost());
		});
	}

	/** The filter panel, as it stands. */
	/**
	 * Say which note this wheel is about, in the pane itself.
	 *
	 * The tab title says it too — but only sometimes. Obsidian asks
	 * `getDisplayText()` on its own schedule and does not ask again, so a wheel
	 * opened over a note kept "Task wheel" over it however early the blikveld
	 * was set (owner, 19 aug 2026, with the header button visible *and* the
	 * wrong title in the same screenshot: proof the scope was right and the bar
	 * was simply not redrawn). This line is in the pane, which is ours, so it
	 * cannot go stale. Tapping it opens the note.
	 *
	 * Only for a wheel over one note. A folder or the vault has no note to open,
	 * and "Task wheel" is the true name of the wheel over everything.
	 */
	private drawScopeTitle(): void {
		const el = this.scopeEl;
		if (el === null) return;

		el.empty();
		if (this.wheelScope.kind !== "note") return;

		const path = this.wheelScope.path;
		const button = el.createEl("button", {
			cls: "task-wheel-scope",
			attr: { type: "button", "aria-label": `Open ${path}` },
		});
		putIcon(button, "file-text", "task-wheel-scope-icon");
		button.createSpan({
			cls: "task-wheel-scope-name",
			text: scopeLabel(this.wheelScope),
		});
		button.addEventListener("click", () => this.showNote(path, null));
	}

	/**
	 * The way one step wider, in the corner of the wheel itself.
	 *
	 * The header has this button too, and the ⋯ menu has the row. It is here as
	 * well because this is where the hand already is: the filter panel is the
	 * other thing you reach for mid-round, and reaching to the top of the pane
	 * for one tap is a journey on a phone (eigenaar, 22 aug 2026).
	 *
	 * Under the filter panel rather than beside it, so it stays put when the
	 * panel opens — and gone entirely on the vault wheel, where there is nothing
	 * wider to go to.
	 */
	private drawOut(): void {
		const el = this.outEl;
		if (el === null) return;

		el.empty();
		const wider = outward(this.wheelScope);
		if (wider === null) return;

		const label = scopeLabel(wider);
		const button = el.createEl("button", {
			cls: "task-wheel-out",
			attr: { type: "button", "aria-label": `Out to ${label}` },
		});
		putIcon(button, "zoom-out", "task-wheel-out-icon");
		button.createSpan({ cls: "task-wheel-out-name", text: label });
		button.addEventListener("click", () => this.goWider());
	}

	private drawControls(): void {
		const el = this.controlsEl;
		if (el === null) return;

		renderFilterPanel(
			el,
			this.plugin.settings,
			filterOf(this.plugin.settings, this.wheelScope),
			{
				open: this.plugin.settings.filterPanelOpen,
				left: this.tree?.filteredOut ?? 0,
				onToggleOpen: (open: boolean) => {
					this.plugin.settings.filterPanelOpen = open;
					this.plugin.persist();
					this.drawControls();
				},
				onChange: (next) => void this.changeFilter(next),
			},
		);
	}

	/**
	 * A new selection, and therefore a new round.
	 *
	 * The two go together (eigenaarsbesluit 18 aug 2026). A round is a round *of
	 * that selection* (§4), so a different selection is a different round — and
	 * the marks could not have survived the change anyway, because the tree they
	 * are kept against is itself filtered. What used to happen was the worst of
	 * both: they quietly vanished and nothing said so.
	 *
	 * Only this wheel's round. Since the filter moved to the blikveld, the other
	 * panels keep theirs.
	 */
	private async changeFilter(next: TaskFilter): Promise<void> {
		const { restarted } = setFilter(this.plugin.settings, this.wheelScope, next);
		await this.plugin.saveSettings();

		if (restarted > 0) {
			new Notice(
				`Task wheel: a new selection is a new round — the ${restarted} item${
					restarted === 1 ? "" : "s"
				} you had already passed are no longer marked.`,
			);
		}
	}

	/** What the filter is leaving out, when it is leaving anything out. */
	private filterLine():
		| { text: string; shown: number; left: number }
		| undefined {
		const filter = filterOf(this.plugin.settings, this.wheelScope);
		if (!isFiltering(filter)) return undefined;

		return {
			text: describe(filter),
			shown: this.tree?.root.shownTaskCount ?? 0,
			left: this.tree?.filteredOut ?? 0,
		};
	}

	/** The wheel turned onto something else. Cheap: only the card changes. */
	private onFocus(detent: Detent | null): void {
		this.focusId = detent?.id ?? null;

		const { cardEl, layout } = this;
		if (cardEl === null || layout === null) return;

		const laid = detent === null ? null : (layout.byId.get(detent.id) ?? null);
		this.safely("drawing the card", () =>
			renderReadingCard(cardEl, layout, laid, this.actionsFor(laid)),
		);
	}

	/**
	 * What the card may do with this item.
	 *
	 * Assembled per item rather than fixed, so an action that cannot mean
	 * anything here is simply absent — a greyed-out row of five would say the
	 * wheel does more than it does.
	 */
	private actionsFor(laid: LaidOutNode | null): CardActions {
		if (laid === null) return {};

		const ref = lineRefOf(laid);
		const state = laid.node.fields?.state;

		const on = ADVANCING;

		return {
			done:
				ref === null
					? undefined
					: () => void this.act({ kind: "done" }, ref, on),
			// Pressing the status a task already carries takes it off again,
			// which is the only way back from a mis-tap on a phone.
			start:
				ref === null
					? undefined
					: () =>
							void this.act(
								{ kind: "status", char: state === "in-progress" ? " " : "/" },
								ref,
							),
			cancel:
				ref === null
					? undefined
					: () =>
							void this.act(
								{ kind: "status", char: state === "cancelled" ? " " : "-" },
								ref,
								on,
							),
			defer:
				ref === null
					? undefined
					: () =>
							void this.act(
								{ kind: "defer", scheduled: laid.node.fields?.scheduled },
								ref,
								on,
							),
			priority:
				ref === null
					? undefined
					: (step) => {
							void this.act(
								{ kind: "priority", from: laid.priority, step },
								ref,
							);
						},
			open: laid.node.source === undefined ? undefined : () => this.openNote(laid),
			follow:
				laid.node.source === undefined
					? undefined
					: (target, external, event) =>
							this.follow(laid, target, external, event),
			fold: (id) => this.toggleFold(id),
			// The same move the arrow keys make: sideways on this ring. A phone
			// has no arrow keys, and turning is a coarse instrument for one step.
			alongRing: (delta) => this.controller?.walkRing(delta),
			// On every wheel since 26 aug 2026 (kaderdocument §4.2, herzien):
			// each of these writes only into the task's own note — `ref.path`
			// is the boundary, not the wheel's scope — so hanging a task that
			// sits just wrong onto the right heading works mid-review, without
			// the detour through the note's own wheel. What stays note-wheel
			// only is editing *headings* (`section` below): those reshape a
			// document, and doing that is what the document's own wheel is for.
			outline:
				ref === null
					? undefined
					: {
							rename: (text) => {
								void this.act({ kind: "text", text }, ref, {
									// The label after the edit is the *parsed* description, not
									// what was typed: tags are lifted out of it. Reusing the
									// real parser is the only way the two agree.
									rename: {
										path: ref.path,
										from: laid.node.label,
										to: labelAfter(text),
									},
								});
							},
							add: (asChild) => {
								void this.addTask(ref, asChild);
							},
							move: (direction) => {
								void this.act({ kind: "move", direction }, ref);
							},
							moveTo: () => void this.moveToHeading(ref),
							moveUnder: () => void this.moveUnderTask(ref),
						},
			// The same offering Obsidian's own editor makes: type `[[` and the
			// notes come to you (BC_E3_S29).
			suggestLinks: (field: HTMLTextAreaElement) =>
				attachLinkSuggest(this.app, field),
			// A heading gets the same four moves, one level up. Only in a note
			// or section wheel — a section wheel is the document wheel one path
			// deeper (BC_E3_S64) — and only when the tree knows which line it
			// stands on. A wedge in those wheels is a heading, so it gets the
			// same menu as the rings inside it. A wedge anywhere else is a folder
			// or a tag and has no line to edit — which is exactly what the missing
			// source says.
			section:
				(this.wheelScope.kind !== "note" &&
					this.wheelScope.kind !== "section") ||
				(laid.node.kind !== "group" && laid.node.kind !== "domain") ||
				laid.node.source === undefined
					? undefined
					: {
							// A heading is a container, and every move here adjusts *it*.
							// Nothing is being finished, so nothing moves on.
							move: (direction) => {
								void actOnSection(this.sectionHost(), laid, (line) => ({
									kind: "move",
									line,
									direction,
								}));
							},
							moveUnder: () => void moveSectionUnder(this.sectionHost(), laid),
							addTask: () => void addToSection(this.sectionHost(), laid),
							addSubheading: () =>
								void addSubheadingTo(this.sectionHost(), laid),
							// The menu twin of the double tap, for whom a double
							// tap is not a discoverable thing (BC_E3_S64).
							openWheel: () => this.openScopeFor(laid.id),
						},
			// Both wheels, unlike the two above. A task you come across while
			// reviewing the whole vault is exactly the one you want to pull onto
			// your list, and where you came across it is the vault wheel.
			carry:
				laid.node.source === undefined || laid.node.kind === "root"
					? undefined
					: {
							copy: () => this.carryTo(laid, "copy"),
							move: () => this.carryTo(laid, "move"),
							presets: this.plugin.settings.presets.map((preset) => ({
								name: preset.name,
								how: preset.how,
								run: () => carryToPreset(this.carryHost(), laid, preset, on),
							})),
						},
		};
	}

	/**
	 * Carry a task, or a whole section, into another note.
	 *
	 * Two questions, in the order a reader thinks about them: *which note*, then
	 * *where in it* — with the second already answered by default, because the
	 * heading path something sits under is its category on the wheel and it
	 * should keep it. What of that path the other note lacks gets written; what
	 * it has is used, never doubled.
	 *
	 * Copy leaves the source alone entirely. Move takes it out only after the
	 * other note has it — see `writeCarry` for why that order and not the other.
	 */
	/** Carrying work to another note (see `carry-flow.ts`). */
	private carryTo(laid: LaidOutNode, mode: CarryMode): void {
		carryTo(this.carryHost(), laid, mode, ADVANCING);
	}

	private carryHost(): CarryHost {
		return {
			app: this.app,
			options: () => parseOptionsOf(this.plugin.settings, this.wheelScope),
			trace: (line) => this.onTrace(line),
			refresh: () => this.refresh(),
			refreshCarrying: () => this.refreshCarrying(),
		};
	}

	/** Editing a heading from the wheel (see `section-edits.ts`). */
	private sectionHost(): SectionHost {
		return {
			app: this.app,
			trace: (line) => this.onTrace(line),
			refresh: () => this.refresh(),
			refreshCarrying: () => this.refreshCarrying(),
		};
	}

	/**
	 * Alt with an arrow, on whatever is under the wedge.
	 *
	 * Refuses on anything that is not a task — the same rule the menu follows,
	 * so the key and the button can never disagree about what is allowed. On
	 * every wheel since 26 aug 2026, like the menu: the move stays inside the
	 * task's own note whatever the wheel's scope is.
	 */
	private moveFocused(direction: MoveDirection): void {
		const laid =
			this.focusId === null ? null : (this.layout?.byId.get(this.focusId) ?? null);
		const ref = laid === null ? null : lineRefOf(laid);
		if (ref === null) return;

		void this.act({ kind: "move", direction }, ref);
	}

	/**
	 * Send a task to another heading in this note.
	 *
	 * The note is read again here rather than taken from the tree: the tree
	 * knows a task's heading *path*, not which line each heading sits on, and a
	 * move has to name a line. One file, not the vault.
	 */
	private async moveToHeading(ref: LineRef): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ref.path);
		if (!(file instanceof TFile)) {
			new Notice(`Task wheel: ${ref.path} is gone.`);
			return;
		}

		const lines = linesOf(await this.app.vault.cachedRead(file));

		// A note with no headings is not a dead end any more: the picker offers
		// to make the first one, which is the only way this note ever gets one
		// from here.
		this.onTrace(`heading: asking, ${headingsOf(lines).length} to choose from`);
		const choice = await pickHeading(this.app, headingsOf(lines), (typed) =>
			levelForNewSection(lines, ref.line, typed),
		);
		if (choice === null) {
			this.onTrace("heading: nothing chosen");
			return;
		}
		this.onTrace(`heading: ${choice.kind}, writing`);

		await this.act(
			choice.kind === "existing"
				? { kind: "moveTo", target: anchorAt(lines, choice.heading.line) }
				: { kind: "moveToNew", title: choice.title },
			ref,
			ADVANCING,
		);
	}

	/**
	 * Hang this task under another task in the same note.
	 *
	 * The note is read again here rather than taken from the tree, for the same
	 * reason moving to a heading does: the tree knows a task's *place*, not which
	 * line every other task sits on, and this move has to name a line.
	 */
	private async moveUnderTask(ref: LineRef): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(ref.path);
		if (!(file instanceof TFile)) {
			new Notice(`Task wheel: ${ref.path} is gone.`);
			return;
		}

		const lines = linesOf(await this.app.vault.cachedRead(file));
		const candidates = parentCandidates(lines, ref.line);
		if (candidates.length === 0) {
			new Notice(
				"Task wheel: there is no other task in this note to hang it under.",
			);
			return;
		}

		this.onTrace(`subtask: asking, ${candidates.length} to choose from`);
		const parent = await pickTask(this.app, candidates);
		if (parent === null) {
			this.onTrace("subtask: nothing chosen");
			return;
		}

		this.onTrace(`subtask: under line ${parent.line}, writing`);
		await this.act(
			{ kind: "moveUnder", target: anchorAt(lines, parent.line) },
			ref,
			ADVANCING,
		);
	}

	/**
	 * Ask for the words, then write the line.
	 *
	 * A prompt rather than an empty line to fill in: an empty task written to the
	 * note first and named second leaves `- [ ]` behind whenever somebody changes
	 * their mind, and the wheel would have drawn it as "(empty task)".
	 */
	private async addTask(ref: LineRef, asChild: boolean): Promise<void> {
		// Where the next one goes, and how deep. After the first, "under this
		// task" has been honoured: number two is a sibling of number one, not a
		// subtask of it.
		let at = ref;
		let child = asChild;

		const written = await promptForTasks(
			this.app,
			asChild ? "New subtask" : "New task",
			async (text) => {
				const { outcome, at: landed } = await writeInsertAfter(
					this.app,
					at,
					text,
					child,
				);

				if (outcome === "stale" || outcome === "missing" || landed === null) {
					new Notice(
						outcome === "missing"
							? `Task wheel: ${at.path} is gone. Rescanned.`
							: "Task wheel: that line has changed since the scan. Rescanned.",
					);
					return false;
				}

				at = landed;
				child = false;
				return true;
			},
		).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Task wheel: could not write to ${ref.path} — ${message}`);
			return 0;
		});

		// Once, at the end. A rescan between two typed lines would be work
		// nobody is waiting for, and it would redraw the wheel under the box.
		if (written > 0) await this.refreshCarrying();
	}

	/**
	 * The reader closed in, or pulled back out.
	 *
	 * Written straight through: zoom changes on every frame of a pinch, but
	 * `saveData` on a handful of numbers is cheap and losing the level on a
	 * crash would be a small, silly annoyance.
	 */
	private onZoom(zoom: number): void {
		stateFor(this.plugin.settings, this.wheelScope).zoom = zoom;
		this.plugin.persist();
	}

	/** The wheel came to rest. Now the fisheye opens around where it landed. */
	private onSettle(detent: Detent | null): void {
		// Asked when the wheel has come to rest rather than per frame: a snap is
		// thirty frames, and thirty identical lines would bury the one that
		// matters. Does nothing unless diagnostics are on.
		this.renderer?.reportPlacement();

		const id = detent?.id ?? null;
		if (id === null) return;

		markSeen(this.roundHost(), id);

		// Where the reader is, kept so the round survives closing the tab and
		// closing Obsidian. Coming back to the start of a round you are halfway
		// through means finding your place again by hand (eigenaar, 23 aug 2026).
		// Cheap now that state changes are collected rather than written on the
		// spot (BC_E3_S45).
		const state = stateFor(this.plugin.settings, this.wheelScope);
		if (state.reading !== id) {
			state.reading = id;
			this.plugin.persist();
		}

		if (id === this.laidOutFor) return;

		this.laidOutFor = id;
		this.relayout();
	}

	/**
	 * The round: seen-marks, the sweep and the closing announcement.
	 *
	 * The decisions live in `round.ts`; the view owns the state they read and
	 * the renderer they paint on (see `RoundHost`).
	 */
	private roundHost(): RoundHost {
		return {
			settings: this.plugin.settings,
			scope: () => this.wheelScope,
			tree: () => this.tree,
			layout: () => this.layout,
			renderer: () => this.renderer,
			persist: () => this.plugin.persist(),
		};
	}

	/** Wipe the sweep and begin again — the command-palette entry point. */
	startRound(): void {
		startRound(this.roundHost());
	}

	/**
	 * Do to the item under the wedge what a button on the card would do.
	 *
	 * Handed the same `CardActions` the card is built from, so a command and a
	 * button can never disagree about what is allowed — the guards live in one
	 * place and both routes read them. Answers `false` when there is nothing
	 * under the wedge, or nothing of that kind to do to it; the caller says so.
	 */
	runOnFocus(pick: (actions: CardActions) => (() => void) | undefined): boolean {
		const laid =
			this.focusId === null ? null : (this.layout?.byId.get(this.focusId) ?? null);
		if (laid === null) return false;

		const run = pick(this.actionsFor(laid));
		if (run === undefined) return false;

		run();
		return true;
	}

	/** Carry the item under the wedge to a named destination. */
	runPreset(preset: CarryPreset): boolean {
		const laid =
			this.focusId === null ? null : (this.layout?.byId.get(this.focusId) ?? null);
		if (laid === null || laid.node.source === undefined) return false;

		// Same as the button on the card: carrying is finishing with this one.
		carryToPreset(this.carryHost(), laid, preset, ADVANCING);
		return true;
	}

	/** How far this round has got, for the command palette. */
	progress(): { seen: number; total: number } {
		return progressOf(this.roundHost());
	}

	/**
	 * Fold a branch away, or unfold it.
	 *
	 * Persisted per node id, so a fold survives a restart and a rescan — the id
	 * is built from the note path and the task text rather than from a line
	 * number, so editing around a task does not lose its state.
	 *
	 * The wheel then comes to rest on the branch that was folded, not on where
	 * it was standing. When the fold is the branch above the current item, that
	 * item is no longer on the disc; landing on the stump keeps the reader
	 * somewhere real, and puts the way back under the wedge straight away.
	 */
	private toggleFold(target?: string): void {
		const id = target ?? this.resolveFoldTarget();
		if (id === null) return;

		const node = this.tree?.byId.get(id);
		if (node === undefined || node.children.length === 0) return;

		const state = stateFor(this.plugin.settings, this.wheelScope);
		const folded = new Set(state.collapsed);
		if (folded.has(id)) folded.delete(id);
		else folded.add(id);

		state.collapsed = [...folded];
		this.takeBackKeyboard();
		this.plugin.persist();

		this.focusId = id;
		this.laidOutFor = id;
		this.relayout();
	}

	/** What the space bar folds: the same branch the card's button offers. */
	private resolveFoldTarget(): string | null {
		const { focusId, layout } = this;
		if (focusId === null || layout === null) return null;

		const laid = layout.byId.get(focusId);
		if (laid === undefined) return null;

		return foldTarget(layout, laid)?.node.id ?? null;
	}

	/**
	 * No tasks at all.
	 *
	 * An empty wheel would say "you are done" just as loudly as a wheel that
	 * failed to parse anything, so this says which syntax is being looked for
	 * rather than drawing rings around nothing.
	 */
	private renderEmptyState(): void {
		const { cardEl, canvasEl, legendEl } = this;
		if (cardEl === null || canvasEl === null || legendEl === null) return;

		this.renderer = null;
		this.controller?.stop();
		this.focusId = null;
		this.laidOutFor = null;

		canvasEl.empty();
		canvasEl.addClass("is-empty");
		legendEl.empty();
		// The panel stays: with a filter on it is the way back out, and an empty
		// wheel is exactly when the reader needs it. The same goes double for the
		// button that leaves this blikveld altogether.
		this.safely("drawing the filter panel", () => this.drawControls());
		this.safely("drawing the way out", () => this.drawOut());

		cardEl.empty();
		cardEl.removeClass("task-wheel-card");
		cardEl.addClass("task-wheel-empty");
		// A local wheel is far more likely to be empty than the vault wheel, and
		// then the reader needs to know *where* nothing was found — otherwise an
		// empty circle reads as "the plugin is broken".
		const where =
			this.wheelScope.kind === "vault"
				? "in this vault"
				: `in ${this.wheelScope.path}`;

		// With a filter on, "nothing found" almost always means the filter, not
		// an empty vault — and saying the wrong one sends the reader hunting in
		// the wrong place.
		const filtered = isFiltering(filterOf(this.plugin.settings, this.wheelScope));
		cardEl.createEl("p", {
			text: filtered
				? `No tasks ${where} match the filter.`
				: `No open tasks found ${where}.`,
		});
		cardEl.createEl("p", {
			cls: "task-wheel-empty-hint",
			text: filtered
				? `Filter: ${describe(filterOf(this.plugin.settings, this.wheelScope))}. Clear it in the panel, or from the command palette.`
				: "Task Wheel reads checkboxes in Obsidian Tasks syntax, for example: - [ ] Call the plumber 📅 2026-08-20",
		});
	}

	/**
	 * Hand the controller Obsidian's own listener bookkeeping.
	 *
	 * `registerDomEvent` unhooks on view close, so the controller never has to
	 * own a teardown path of its own.
	 */
	private registrar(): DomRegistrar {
		return (el, type, handler, options) => {
			this.registerDomEvent(el, type, handler, options);
		};
	}
}

/**
 * The scope out of a persisted leaf state.
 *
 * Anything unrecognised means the vault wheel rather than an error: a
 * workspace file written by a future version, or by hand, should still open a
 * wheel rather than a broken tab.
 */
/**
 * What a task will be called once these words are written to its line.
 *
 * Not the words themselves: the parser lifts tags out of the description, so
 * "Mailen #werk" becomes "Mailen" on the wheel. Asking the real parser is the
 * only way the rename hint and the rebuilt tree can agree.
 */
function labelAfter(text: string): string {
	const parsed = parseTaskLine(`- [ ] ${text.trim()}`);
	const label = parsed?.fields.description ?? "";
	return label.length > 0 ? label : text.trim();
}

/**
 * The scope inside a leaf's persisted state, if it holds one.
 *
 * Exported because the plugin has to ask this of a leaf whose view is not
 * loaded — see `wheelLeafFor` in `main.ts`.
 */
export function readScope(state: unknown): WheelScope | null {
	if (typeof state !== "object" || state === null) return null;

	const raw = (state as { scope?: unknown }).scope;
	if (typeof raw !== "object" || raw === null) return null;

	const { kind, path, heading } = raw as {
		kind?: unknown;
		path?: unknown;
		heading?: unknown;
	};
	if (kind === "vault") return VAULT_SCOPE;
	if ((kind === "folder" || kind === "note") && typeof path === "string") {
		return { kind, path };
	}
	if (
		kind === "section" &&
		typeof path === "string" &&
		Array.isArray(heading) &&
		heading.length > 0 &&
		heading.every((step): step is string => typeof step === "string")
	) {
		return { kind, path, heading };
	}
	return null;
}

/**
 * Move on to the next item along this ring once the write has landed.
 *
 * The actions that carry this are the ones that mean **"I am finished with this
 * one"**: ticked off, cancelled, pushed a week out, carried elsewhere, hung
 * under another task or heading. After those the reader wants the next card, and
 * on a filtered wheel the item is about to vanish anyway.
 *
 * The ones that do *not*: priority up and down (a ladder you step along),
 * marking as started (you note it and keep reading), renaming, adding, and
 * moving up or down among siblings — all of those are "adjust *this* one".
 *
 * **The next task with children before parents** (`taskAfter`, worked out in
 * `refreshCarrying` from the tree as it was): the deepest subtask of the next
 * branch, and the task it hangs under only once its own subtasks are behind you.
 * Not the sideways step the arrows and the card buttons make — that one walks a
 * single ring and steps over everything on the others, 144 tasks of 144 on a
 * measured wheel (20 aug 2026).
 *
 * An action must never carry the reader past work they have not seen, and this
 * walk holds every task exactly once, so it cannot (kaderdocument §5). It is
 * passed *to the write* for the same reason: worked out and stored when the
 * button was pressed, it outlived actions that never wrote — cancel the heading
 * picker, press Alt+↓, and the wheel jumped forward and marked an item seen the
 * reader had never turned to (audit, 23 aug 2026).
 */
const ADVANCING: AfterWrite = { advance: true };

/**
 * A line a picker offered, with the text it was offering.
 *
 * Built from the very read the picker was filled from, so the anchor and the
 * list the reader chose from can never disagree.
 */
function anchorAt(lines: readonly string[], line: number): LineAnchor {
	return { line, raw: lines[line] ?? "" };
}

/** Where a task's line sits, if this item is a task at all. */
function lineRefOf(laid: LaidOutNode): LineRef | null {
	const source = laid.node.source;
	const raw = laid.node.fields?.raw;
	if (source === undefined || raw === undefined) return null;

	return { path: source.path, line: source.line, raw };
}

/** One step up or down the priority ladder, stopping at the ends. */
function shift(from: Priority, step: number): Priority {
	const order = PRIORITY_LADDER;
	const at = order.indexOf(from);
	const next = Math.min(Math.max(at - step, 0), order.length - 1);
	return order[next];
}
