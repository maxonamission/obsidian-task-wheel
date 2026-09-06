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
	type DomainSource,
	NO_FILTER,
	outward,
	type Priority,
	scopeKey,
	type TaskState,
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
	editThroughTasks,
	renameNoteTask,
	writeNoteStatus,
	editsThroughTasks,
	writeDone,
	writeInsertAfter,
	writeLine,
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
import {
	buildDetents,
	type Detent,
	indexOfId,
	nextMatching,
} from "../layout/detents";
import { type SidewaysAlong, sidewaysFrom, taskAfter } from "../layout/order";
import { prune } from "../layout/sweep";
import {
	type AfterWrite,
	carryFocus,
	carrySeen,
	landAfter,
} from "../model/carry";
import { aWeekOut, today } from "../model/dates";
import {
	activates,
	isNoteTask,
	isRefused,
	type NoRename,
	type NoScope,
	renameRefusal,
	scopeFor,
} from "../model/scope";
import { paneChange } from "../model/detour";
import { type Landing, landingId, readLanding } from "../model/landing";
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
	everyState,
	filterOf,
	parseOptionsOf,
	setFilter,
	stateFor,
	visibleBudgetOf,
} from "../settings";
import { WheelRenderer } from "./render-wheel";
import {
	type CardActions,
	type CardHandle,
	foldTarget,
	renderReadingCard,
} from "./reading-card";
import { renderLegend } from "./legend";
import type { HelpAction, HelpRoundState } from "./help-content";
import { type FilterPanelHandle, renderFilterPanel } from "./filter-panel";
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
	/** A whole line, finished elsewhere — the Tasks modal hands one back. */
	| { kind: "line"; text: string }
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
	/** Counts the wheels opened this session, to keep their ids apart. */
	private static descriptions = 0;

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

	/** The last viewport reading, so an unchanged one is not repeated. */
	private lastViewport = "";
	/** Id the current drawing was laid out around. */
	private laidOutFor: string | null = null;
	/**
	 * A task the reader asked to edit, waiting for the card to reach it.
	 *
	 * Cleared as soon as the card is drawn for it, and cleared again when the
	 * wheel settles on anything else — a request that never arrived must not
	 * spring open the next time that item happens to come round.
	 */
	private editWhenShown: string | null = null;
	/**
	 * Where this wheel was told to come to rest, before it had a tree to look in.
	 *
	 * One-shot: used by the first layout that can resolve it and then dropped,
	 * because it describes the act that opened the wheel and not a preference.
	 */
	private landing: Landing | null = null;

	private cardEl: HTMLElement | null = null;
	private canvasEl: HTMLElement | null = null;
	private legendEl: HTMLElement | null = null;
	private controlsEl: HTMLElement | null = null;
	/** The filter panel's own handle, so Ctrl+F can reach its search box. */
	private panel: FilterPanelHandle | null = null;
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
		const asked = readLanding(state);
		if (asked !== null) this.landing = asked;
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

	/**
	 * Go and stand on what this landing names — for a wheel already open.
	 *
	 * Revealing an existing leaf does not re-read its state, so the plugin
	 * hands the landing over directly. If the wheel is already drawn we can go
	 * there now; if it is still opening, the first layout will pick it up.
	 */
	landOn(landing: Landing): void {
		this.landing = landing;

		const tree = this.tree;
		if (tree === null) return;

		const id = landingId(tree, landing);
		this.landing = null;
		if (id === null || !tree.byId.has(id)) return;

		this.focusId = id;
		this.laidOutFor = null;
		this.relayout();
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

		// How the wheel works, for someone who cannot see it — and *only* for
		// them. This used to be an `aria-label` on the canvas, which Obsidian
		// turns into a hover tooltip: a paragraph of forty-five words, over the
		// whole playing field, every time a mouse came to rest. "The
		// help-mouse-over popped up again and again. After reading it twice I
		// don't feel like it offers anything anymore" (gebruiker, 31 aug 2026).
		//
		// It was never a tooltip. A hidden element plus `aria-labelledby` gives a
		// screen reader exactly the same sentence and gives a mouse nothing,
		// which is why this needs no setting to turn off: there is nothing left
		// to turn off (BC_E3_S89).
		// The id has to be unique in the document, and two wheels can be open at
		// once — a vault in one tab and a project in the next is the ordinary
		// case here, not an edge one.
		TaskWheelView.descriptions += 1;
		const described = stage.createDiv({
			cls: "task-wheel-sr-only",
			text: "Task wheel. Drag or scroll to turn through every item in order. Left and right move sideways along the ring you are on, wherever the next item on it lives; up moves out to a child, down moves in to the parent. Tap an item to bring it under the reading wedge. Enter opens what you are on: a wheel over a folder, note or heading, or the task itself for editing. Backspace comes back out, and control with enter opens the note the item is written in. Space folds the branch you are in away.",
			attr: { id: `task-wheel-canvas-description-${TaskWheelView.descriptions}` },
		});

		this.canvasEl = stage.createDiv({
			cls: "task-wheel-canvas",
			attr: {
				tabindex: "0",
				role: "group",
				"aria-labelledby": described.id,
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
			onSideways: (delta, other) => this.stepSideways(delta, other),
			onActivate: (id) => this.activate(id),
			onOut: () => this.stepOut(),
			onOpenNote: () => this.openFocusedNote(),
			onZoom: (zoom) => this.onZoom(zoom),
			onTrace: (line) => this.onTrace(line),
			onMove: (direction) => this.moveFocused(direction),
			onSearch: () => this.openSearch(),
			onAdd: (asChild) => this.addFromKey(asChild),
			covered: (x, y) => this.coveredAt(x, y),
			panels: () => this.panelState(),
			restorePanels: (was) => this.restorePanels(was),
		});

		this.watchVault();
		this.watchViewport();
		this.watchActivation();
		this.controller.setZoom(stateFor(this.plugin.settings, this.wheelScope).zoom);
		await this.refresh();

		// A wheel that looks ready and is not: a task on the wedge, a card
		// beside it, and nothing listening until you click the drawing
		// (eigenaar, 2 sep 2026). Deferred by a frame because a leaf is not
		// always the active one yet at the moment its view opens — the event
		// above catches that case, and this one catches an open into a tab that
		// is already in front.
		// The view's own window: a torn-off tab has one of its own.
		this.containerEl.ownerDocument.defaultView?.requestAnimationFrame(() =>
			this.claimKeyboard(),
		);
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
		this.panel = null;
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
	 * Take the keyboard when this wheel is the one in front.
	 *
	 * Only then: a wheel opening in a background tab, or in the other half of a
	 * split while you are typing in this one, must not pull the keys over. That
	 * half of the rule is `takeBackKeyboard`, which already refuses to take
	 * focus off anything you could still be typing in; this half asks the
	 * workspace whether we are the view being looked at.
	 */
	private claimKeyboard(): void {
		if (this.app.workspace.getActiveViewOfType(TaskWheelView) !== this) return;
		this.takeBackKeyboard();
	}

	/** Switching to the tab a wheel is in gives the wheel its keys. */
	private watchActivation(): void {
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) this.claimKeyboard();
			}),
		);
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
			// So the next reading is printed rather than dropped as a repeat of
			// one the reader just wiped (BC_E3_S96).
			this.lastViewport = "";
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

		// How long the read takes is the one number nobody here can guess: it
		// depends on the vault in front of the reader, not on this code. Asked
		// for because opening a wheel somewhere else "duurt wel even" and the
		// wheel cannot land on an item before it has a tree to find it in
		// (eigenaar, 2 sep 2026) — and the wrong half to optimise is the one
		// you assumed.
		const began = Date.now();
		this.tree = await scanVault(
			this.app,
			parseOptionsOf(this.plugin.settings, this.wheelScope),
			this.plugin.scanCache,
		);
		this.onTrace(
			`scan: ${this.tree.root.shownTaskCount} in the round, ` +
				`${this.plugin.scanCache.reused} notes reused, ${Date.now() - began}ms`,
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
				case "line":
					outcome = await writeLine(this.app, ref, what.text);
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
		const { rename, moved } = after;
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
		state.seen = carrySeen(before, grown, state.seen, rename, moved);
		this.plugin.persist();

		// The item this action was aimed past, if it is still on the wheel. It
		// wins over carrying the old focus across: the point of aiming was to
		// leave that item behind.
		const wanted = landAfter(
			land,
			carryFocus(before, grown, this.focusId, rename, moved),
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
	 * Which blikveld an item stands for is decided in `model/scope.ts`, where a
	 * test can reach it; the view's share is the sentence it says when there is
	 * nothing to open. A wedge that came from a tag or from a front-matter
	 * property stands for no place on disk, and then the honest answer is to say
	 * so rather than to go looking for a folder of that name.
	 */
	private openScopeFor(id: string): void {
		const laid = this.layout?.byId.get(id);
		if (laid === undefined) return;

		const scope = scopeFor(
			{
				kind: laid.node.kind,
				depth: laid.depth,
				label: laid.node.label,
				source: laid.node.source,
			},
			this.wheelScope,
			this.plugin.settings.domainSource,
		);

		if (isRefused(scope)) {
			new Notice(`Task wheel: ${refusalText(scope)}`);
			return;
		}

		if (scopeKey(scope) === scopeKey(this.wheelScope)) {
			new Notice("Task wheel: this wheel is already about that.");
			return;
		}

		void this.plugin.openScoped(scope, this.leaf);
	}

	/**
	 * Open the note the wheel is standing on — Ctrl/Cmd with Enter.
	 *
	 * Answers whether there was one, so the key stays unclaimed on an item that
	 * lives nowhere: a folder wedge is not written down anywhere, and a key that
	 * swallows itself to do nothing is worse than one that never took the press.
	 */
	private openFocusedNote(): boolean {
		const laid = this.focusId === null ? undefined : this.layout?.byId.get(this.focusId);
		if (laid === undefined || laid.node.source === undefined) return false;

		this.openNote(laid);
		return true;
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
		void this.plugin.openScoped(wider, this.leaf, this.leaving());
	}

	/**
	 * What a step out should land on: what you were reading, seen from further out.
	 *
	 * The wider wheel holds everything the narrower one did, so the plainest
	 * answer is also the right one — stay on the item. Landing on the blikveld
	 * you left instead puts you on the branch that item hangs from: close enough
	 * to look deliberate, wrong enough to confuse (eigenaar, 2 sep 2026).
	 *
	 * The item is named by its **line**, not by its id: an id is built from the
	 * path down the tree, and that path is a different one in a wider wheel. The
	 * line in the note is the same either way.
	 *
	 * Standing on something without a line of its own — a folder wedge — leaves
	 * only the blikveld itself to name, and that is what it falls back to.
	 */
	private leaving(): Landing {
		const laid = this.focusId === null ? undefined : this.layout?.byId.get(this.focusId);
		const source = laid?.node.source;

		return source === undefined
			? { kind: "scope", scope: this.wheelScope }
			: { kind: "line", path: source.path, line: source.line };
	}

	/**
	 * The same move, for a key rather than for a button or a command.
	 *
	 * The difference is what happens when there is nowhere wider. A command and
	 * a button were both asked for on purpose, so they answer — "this wheel is
	 * already about the whole vault". A key press is cheap and repeatable, and
	 * a notice for every stray Backspace on the vault wheel would be noise. So
	 * this one says no by answering false, and the key stays unclaimed.
	 */
	private stepOut(): boolean {
		const wider = outward(this.wheelScope);
		if (wider === null) return false;

		void this.plugin.openScoped(wider, this.leaf, this.leaving());
		return true;
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
	/**
	 * Change what the angle is made of, from the wheel rather than the settings
	 * (BC_E3_S148).
	 *
	 * The same write the settings tab does, and the same round boundary with it:
	 * a different source does not re-deal the same wedges, it replaces them, so
	 * the frozen order of the old set has to go or the wheel would keep dealing
	 * wedges of a set that no longer exists (BC_E3_S82).
	 *
	 * Every wheel is redrawn, not only this one: the source is one setting for
	 * the whole plugin, and a second wheel left on the old angle would be a lie
	 * about what the setting says.
	 */
	private async changeAngle(source: DomainSource): Promise<void> {
		if (this.plugin.settings.domainSource === source) return;

		this.plugin.settings.domainSource = source;
		for (const state of everyState(this.plugin.settings)) {
			state.roundWeights = null;
			state.roundDomains = null;
		}
		// `saveSettings` re-reads every open wheel, which is exactly the redraw
		// this needs: a new angle is a new tree, not a new drawing of the old one.
		await this.plugin.saveSettings();
	}

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
			angle: this.plugin.settings.domainSource,
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
			case "angle-folder":
				void this.changeAngle("folder");
				return;
			case "angle-tag":
				void this.changeAngle("tag");
				return;
			case "angle-property":
				void this.changeAngle("property");
				return;
			case "angle-heading":
				void this.changeAngle("heading");
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

	/** Say why this title cannot be rewritten from here (BC_E3_S118). */
	private explainNoRename(laid: LaidOutNode): void {
		const refusal = renameRefusal(
			{
				kind: laid.node.kind,
				depth: laid.depth,
				label: laid.node.label,
				source: laid.node.source,
			},
			this.wheelScope,
			this.plugin.settings.domainSource,
		);
		new Notice(`Task wheel: ${noRenameText(refusal)}`);
	}

	/**
	 * Whether a panel of ours lies over the wheel at this point (BC_E3_S118).
	 *
	 * The card is see-through to the hand on purpose — it covers a good part of
	 * the drawing, and a drag across it has to keep turning the wheel, or a
	 * phone loses half its handle. But see-through means a *tap* on it fell
	 * through as well, and landed on whatever was drawn behind it: standing on
	 * a heading and tapping the words on the card opened a task inside that
	 * branch, because that is what the card was covering (eigenaar, 2 sep 2026).
	 *
	 * So a drag still goes through and a tap no longer does. The card is asked
	 * for its own rectangle rather than the DOM for what is on top: the parts of
	 * the card that *do* take taps — the buttons, an editable title — have
	 * already had them by the time this is asked.
	 */
	private coveredAt(x: number, y: number): boolean {
		for (const el of [this.cardEl, this.controlsEl, this.outEl, this.scopeEl]) {
			if (el === null) continue;
			const box = el.getBoundingClientRect();
			if (box.width === 0 && box.height === 0) continue;
			if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
				return true;
			}
		}
		return false;
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
		// The wedge order is dealt once per round and then held, whatever the
		// division: a domain that turns up mid-round — one property away, since
		// BC_E3_S81 — must not take the hue and the place of a wedge the reader
		// has been navigating by (BC_E3_S82). Unlike the weights this is dealt in
		// both divisions, because order is not a property of the division.
		if (state.roundDomains === null || state.roundDomains === undefined) {
			state.roundDomains = [...tree.domains];
			this.plugin.persist();
		}

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
			roundDomains: state.roundDomains,
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
			// What opened this wheel, if it said anything, before what the wheel
			// remembered. A step out names the blikveld you left; the editor
			// names the task your cursor was on. Both are a sentence the reader
			// just spoke; the memory is a sentence from last time (BC_E3_S107,
			// S108). One-shot, so a later rescan resumes normally.
			const asked = this.landing === null ? null : landingId(tree, this.landing);
			this.landing = null;

			const kept = openAround(asked ?? this.focusId, state.reading, (id) =>
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
		// A reading beside every draw, so the trace holds one even on a device
		// where nothing this watches ever fires (BC_E3_S96).
		this.reportViewport("draw");

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

		this.panel = renderFilterPanel(
			el,
			this.plugin.settings,
			filterOf(this.plugin.settings, this.wheelScope),
			{
				open: this.plugin.settings.filterPanelOpen,
				left: this.tree?.filteredOut ?? 0,
				// Only when it is narrower than the vault: on the vault wheel the
				// answer would be "everything", which is not worth a row.
				scope:
					this.wheelScope.kind === "vault"
						? null
						: scopeLabel(this.wheelScope),
				onToggleOpen: (open: boolean) => {
					this.plugin.settings.filterPanelOpen = open;
					this.plugin.persist();
					this.drawControls();
				},
				onChange: (next) => void this.changeFilter(next),
				onSubmit: (text) => void this.jumpToSearch(text),
				onEscape: () => this.takeBackKeyboard(),
			},
		);
	}

	/**
	 * `a` and `Shift+A`: add a task beside this one, or a step inside it.
	 *
	 * Answers whether the item under the wedge could take it. Only a wheel over
	 * one note hands in outline actions, so on the vault wheel these letters are
	 * not ours — and a key that swallows itself to do nothing is worse than one
	 * that never took the press (BC_E3_S113).
	 */
	private addFromKey(asChild: boolean): boolean {
		const laid = this.focusId === null ? null : (this.layout?.byId.get(this.focusId) ?? null);
		const add = this.actionsFor(laid).outline?.add;
		if (add === undefined) return false;

		add(asChild);
		return true;
	}

	/**
	 * Open the filter and put the cursor in its search box (BC_E3_S120).
	 *
	 * Answers whether it did, so Ctrl+F stays unclaimed on a wheel that has no
	 * panel to open — a key that swallows itself to do nothing is worse than one
	 * that never took the press.
	 */
	openSearch(): boolean {
		if (this.controlsEl === null) return false;

		if (!this.plugin.settings.filterPanelOpen) {
			this.plugin.settings.filterPanelOpen = true;
			this.plugin.persist();
			this.drawControls();
		}
		// Already open counts too: the point of the key is the cursor, not the
		// panel, and pressing it twice should not close what it just opened.
		this.panel?.focusSearch();
		return true;
	}

	/**
	 * Enter in the search box: go to what was searched for (BC_E3_S121).
	 *
	 * The words are already applied by the time this runs, so every stop left on
	 * the wheel is a match and "the next match" is simply the next task stop in
	 * the turn direction (`nextMatching`). Forward from here rather than back to
	 * the start of the circle: a round you are halfway through should move on,
	 * and pressing Enter again walks the matches (eigenaarsbesluit 3 sep 2026).
	 *
	 * The rescan is awaited first — the filter has to have been applied before
	 * there is anything to jump *to*.
	 */
	private async jumpToSearch(text: string): Promise<void> {
		await this.refresh();

		const layout = this.layout;
		if (layout === null) return;

		const detents = buildDetents(layout);
		const from = this.focusId === null ? -1 : indexOfId(detents, this.focusId);
		const next = nextMatching(detents, from, (id) => {
			return layout.byId.get(id)?.node.kind === "task";
		});

		if (next === null) {
			new Notice(
				text.length > 0
					? `Task wheel: nothing in this round matches "${text}".`
					: "Task wheel: nothing in this round to jump to.",
			);
			return;
		}

		this.controller?.goTo(next.id);
		this.takeBackKeyboard();
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

		this.drawCard(detent?.id ?? null);
	}

	/**
	 * Draw the card for one item, and open its editor if that was asked for.
	 *
	 * Split out of `onFocus` because the same drawing is now wanted from two
	 * places: the wheel arriving somewhere, and a request to edit the item it
	 * is already on.
	 */
	private drawCard(id: string | null): void {
		const { cardEl, layout } = this;
		if (cardEl === null || layout === null) return;

		const laid = id === null ? null : (layout.byId.get(id) ?? null);
		let card: CardHandle = {};
		this.safely("drawing the card", () => {
			card = renderReadingCard(cardEl, layout, laid, this.actionsFor(laid));
		});

		// A task asked to be edited, and the card that can do it has only now
		// been drawn for it. The wait is what makes a double-click work: the
		// first press turns the wheel there and the second says "open it", and
		// between those the card is still showing where you came from.
		if (this.editWhenShown !== null && this.editWhenShown === id) {
			this.editWhenShown = null;
			card.editTitle?.();
		}
	}

	/**
	 * Open what this item **is** — the one rule behind Enter and a double-click.
	 *
	 * A folder, a note, a heading: those have an inside, so opening one means a
	 * wheel over it, and that is the ladder the wheel has always walked. A task
	 * has no inside. Opening a task used to mean "a wheel over the note it
	 * lives in", which is not the task and, in a wheel over that note already,
	 * was a key that answered *this wheel is already about that* and did
	 * nothing else (eigenaar, 2 sep 2026).
	 *
	 * So a task opens for editing instead, by the same setting that decides
	 * what clicking its title opens — one rule for "what does editing open",
	 * and it works with or without the Tasks plugin.
	 *
	 * Enter and the double-click come through here together, deliberately. The
	 * whole point of BC_E3_S99 was that the keyboard should not be poorer than
	 * the mouse; letting only one of them learn this would put that back.
	 */
	private activate(id: string): void {
		const laid = this.layout?.byId.get(id);
		if (laid === undefined) return;

		if (activates(laid.node.kind) === "wheel") {
			this.openScopeFor(id);
			return;
		}

		const ref = lineRefOf(laid);
		if (ref === null) {
			// A task note is the one task with a whole file behind it, so the
			// sentence says where its text lives rather than that there is none
			// (BC_E3_S130). Every refusal has a reason and every reason has a
			// sentence the reader can act on.
			new Notice(
				isNoteTask(laid.node)
					? "Task wheel: this task is a note — open it to edit its text."
					: "Task wheel: that task has no line to edit.",
			);
			return;
		}

		if (
			this.plugin.settings.editTask === "tasks" &&
			editsThroughTasks(this.app)
		) {
			void this.editInTasks(ref, laid);
			return;
		}

		// The card's own box belongs to the item under the wedge, so say where
		// we want to be and let the card open it when it gets there. Already
		// there is the common case — Enter always acts on the stop you are on —
		// and then this is one redraw away rather than a wait.
		this.editWhenShown = id;
		if (this.focusId === id) {
			this.drawCard(id);
			return;
		}
		this.controller?.goTo(id);
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

		// A task document is a task, so it does what a task does — it just does it
		// in front matter rather than between brackets (BC_E3_S132). The three
		// status actions and renaming are handed in here instead of the line
		// versions below; deferring and priority are not, because the wheel reads
		// no date or priority from a note's front matter and writing one would be
		// inventing a convention for vaults that have none.
		if (isNoteTask(laid.node)) return this.noteTaskActions(laid, state, on);

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
			onTitleRefused:
				ref !== null ? undefined : () => this.explainNoRename(laid),
			open: laid.node.source === undefined ? undefined : () => this.openNote(laid),
			follow:
				laid.node.source === undefined
					? undefined
					: (target, external, event) =>
							this.follow(laid, target, external, event),
			fold: (id) => this.toggleFold(id),
			// The same move the arrow keys make: sideways on this ring. A phone
			// has no arrow keys, and turning is a coarse instrument for one step.
			alongRing: (delta) => this.stepFromCard(delta),
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
							// Only offered when the Tasks plugin is there *and* carries
							// the modal. Asked per draw rather than remembered: a plugin
							// can be switched on while a wheel stands open.
							editInTasks: editsThroughTasks(this.app)
								? () => void this.editInTasks(ref, laid)
								: undefined,
							titleOpensTasks: this.plugin.settings.editTask === "tasks",
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
			// Not on a note that is itself a task (BC_E3_S130). Carrying lifts the
			// task *lines* out of a note and leaves the file behind — on a task
			// document that empties the very thing the reader asked to move,
			// which is the surprise the owner hit on 4 sep 2026. A file is moved
			// in the file list, not by the wheel; the row is absent rather than
			// present-and-refusing, the way every other impossible action here is.
			// Where carrying cannot mean anything, moving the file can. Obsidian's
			// own menu rather than a folder picker of ours (BC_E3_S131).
			// Only on a task document, where there is no other way to move the
			// thing the wheel is pointing at. It was briefly offered on every
			// note ring as well, and the owner's first use of it created a
			// duplicate folder tree: Android's file system is case-sensitive, so
			// a folder typed with the wrong capital is a *new* folder, and
			// Obsidian's dialog said nothing (4 sep 2026).
			//
			// The dialog is Obsidian's and the hazard is the file system's, but
			// the invitation was ours: reviewing is quick and half-attentive,
			// and making folders is not. On a note ring the same menu is one
			// right-click away in the file list, so the convenience was not
			// worth the tap. Here it is the only way, so it stays.
			file: isNoteTask(laid.node)
				? (event: MouseEvent) => {
						this.openFileMenu(laid.node.source?.path ?? "", event);
					}
				: undefined,
			carry:
				laid.node.source === undefined ||
				laid.node.kind === "root" ||
				isNoteTask(laid.node)
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
	 * What the card may do with a task that is a whole note (BC_E3_S132).
	 *
	 * The same four gestures as on a line — tick, start, cancel, rename — writing
	 * the reader's own words into the reader's own property. Pressing the status
	 * a document already carries takes it off again, exactly as it does for a
	 * checkbox: on a phone that is the only way back from a mis-tap.
	 *
	 * What it cannot give back is a status the wheel does not know. A document
	 * that read `on hold` and is ticked off becomes `done`, and un-ticking it
	 * writes the open word rather than `on hold` — the wheel never saw that word
	 * and cannot invent it back. The same loss a checkbox has always had, and the
	 * reason the four words are settings: the fewer of your statuses fall outside
	 * them, the less there is to lose.
	 */
	private noteTaskActions(
		laid: LaidOutNode,
		state: TaskState | undefined,
		on: AfterWrite,
	): CardActions {
		const path = laid.node.source?.path ?? "";
		const settings = this.plugin.settings;
		const property = settings.taskNoteDoneProperty;

		const set = (value: string, after: AfterWrite = {}): void => {
			void this.writeNoteStatus(path, property, value, after);
		};

		return {
			done: () =>
				set(
					state === "done" ? settings.taskNoteOpenValue : settings.taskNoteDoneValue,
					on,
				),
			start: () =>
				set(
					state === "in-progress"
						? settings.taskNoteOpenValue
						: settings.taskNoteDoingValue,
				),
			cancel: () =>
				set(
					state === "cancelled"
						? settings.taskNoteOpenValue
						: settings.taskNoteCancelledValue,
					on,
				),
			rename: (text: string) => {
				void this.renameNoteTask(path, text);
			},
			suggestLinks: (field) => attachLinkSuggest(this.app, field),
			file: (event: MouseEvent) => {
				this.openFileMenu(path, event);
			},
			open: laid.node.source === undefined ? undefined : () => this.openNote(laid),
			follow: (target, external, event) =>
				this.follow(laid, target, external, event),
			fold: (id) => this.toggleFold(id),
			alongRing: (delta) => this.stepFromCard(delta),
		};
	}

	/** Write a task document's status, and say so when nothing happened. */
	private async writeNoteStatus(
		path: string,
		property: string,
		value: string,
		after: AfterWrite,
	): Promise<void> {
		if (property.trim() === "" || value.trim() === "") {
			new Notice(
				"Task wheel: there is no status word set for that — see the settings.",
			);
			return;
		}

		let outcome: WriteOutcome;
		try {
			outcome = await writeNoteStatus(this.app, path, property, value);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Task wheel: could not write to ${path} — ${message}`);
			return;
		}

		if (outcome === "missing") {
			new Notice(`Task wheel: ${path} is gone. Rescanned.`);
		} else if (outcome === "unchanged") {
			new Notice("Task wheel: it already says that.");
			return;
		}
		await this.refreshCarrying(after);
	}

	/** Rename the note a task document is, links and all. */
	private async renameNoteTask(path: string, title: string): Promise<void> {
		let outcome: WriteOutcome;
		try {
			outcome = await renameNoteTask(this.app, path, title);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Task wheel: could not rename ${path} — ${message}`);
			return;
		}

		if (outcome === "refused") {
			// The characters a file name cannot hold. Said out loud rather than
			// stripped: a title quietly missing its slash is a rename the reader
			// did not ask for.
			new Notice(
				'Task wheel: a note name cannot hold \\ / : * ? " < > | # ^ [ ].',
			);
			return;
		}
		if (outcome === "missing") {
			new Notice(`Task wheel: ${path} is gone. Rescanned.`);
		} else if (outcome === "unchanged") {
			return;
		}
		await this.refreshCarrying();
	}

	/**
	 * Obsidian's own menu for a file, opened on a task that is a whole note.
	 *
	 * `file-menu` is the event every part of Obsidian uses to build that menu —
	 * the file explorer, a tab header, a link. Triggering it hands us *Move file
	 * to…*, *Rename…* and the rest as the reader knows them, kept in step with
	 * their Obsidian version and whatever their other plugins add. Building a
	 * folder picker here would be a second way to do a thing the app already
	 * does well, and a worse one (eigenaar, 4 sep 2026).
	 */
	private openFileMenu(path: string, event: MouseEvent): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice("Task wheel: that note is no longer in the vault.");
			return;
		}

		const menu = new Menu();
		this.app.workspace.trigger("file-menu", menu, file, "task-wheel-card");
		menu.showAtMouseEvent(event);
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
	 * Hand the line to the Tasks plugin's own modal, and write back what returns.
	 *
	 * The round is not left: no note is opened, no editor gets the cursor. That
	 * is the whole reason this goes through the API rather than through Tasks'
	 * own command, which works on wherever the cursor happens to be and would
	 * therefore mean opening the note first (and losing the wedge you were on).
	 *
	 * **The indentation is ours, not the modal's.** A subtask is a task with two
	 * spaces in front of it, and those spaces are its place in the outline — the
	 * modal edits a task, and has no reason to know that this one is a step of
	 * something above it. So the line goes over without its indentation and
	 * comes back wearing it again. Getting this wrong would not look like a bug:
	 * the task would simply have become a sibling of its own parent.
	 */
	private async editInTasks(ref: LineRef, laid: LaidOutNode): Promise<void> {
		const indent = ref.raw.slice(0, ref.raw.length - ref.raw.trimStart().length);

		const edited = await editThroughTasks(this.app, ref.raw.trimStart());
		// Cancelled, or the plugin declined. Either way the note is untouched and
		// there is nothing to say about it.
		if (edited === null) return;

		const lines = edited.split("\n").map((line) => indent + line.trimStart());
		// Opening the modal and pressing OK without changing anything is not an
		// edit. Writing it anyway would be harmless but would claim, in a notice,
		// that something happened.
		if (lines.join("\n") === ref.raw) return;

		await this.act({ kind: "line", text: lines.join("\n") }, ref, {
			// Same reason as the rename above: the wheel's label is the *parsed*
			// description, and the modal may well have moved a date or a tag out
			// of the words. Only the real parser can say what it will be called.
			rename: {
				path: ref.path,
				from: laid.node.label,
				to: labelOfLine(lines[0] ?? ""),
			},
		});
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

		// A request to edit that the wheel never reached. Dropping it here is
		// what keeps it from springing open the next time that item comes round.
		if (this.editWhenShown !== null && this.editWhenShown !== id) {
			this.editWhenShown = null;
		}

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

		// Before the re-layout, not after: the layout is adopted with `focusId`
		// as the stop to keep, so leaving it on where we came *from* would put
		// the rotation back there — a visible rewind at the end of every quiet
		// turn (BC_E3_S104). The controller reports the same id straight after
		// this, and finds nothing left to say.
		this.focusId = id;
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
	/**
	 * One step sideways: the next item on the reader's own ring (BC_E3_S93).
	 *
	 * Answered from the **tree**, because that is where a ring is complete. The
	 * drawing holds only part of it — the fisheye gives the branch under the
	 * reading wedge two rings the rest of the wheel does not get, so on those
	 * rings the drawing knows of no neighbour at all. Reading the step off the
	 * drawing therefore produced a step that changed the reader's ring, and a
	 * step that changes ring cannot be undone by the opposite key: the way back
	 * is computed from a different picture (eigenaar, 1 sep 2026).
	 *
	 * From the tree the rule is one sentence — *the next node on this ring* —
	 * and it is its own inverse. Whether that node happens to be drawn decides
	 * only **how** the wheel gets there: a stop it already has is a turn, and
	 * one it has not is a redraw around it, which is the same move the wheel
	 * makes when the cursor lands somewhere in the note.
	 *
	 * Answers whether it handled the step; `false` hands the arrows back to the
	 * drawing-only rule, which is right when there is no tree yet.
	 */
	/**
	 * The two buttons beside the card, which are the whole of sideways on a
	 * phone (BC_E3_S94, eigenaarsbesluit 1 sep 2026).
	 *
	 * On mobile they always walk **every task**, whatever the setting says. The
	 * reasoning is about which movement is which there: the coarse one is a
	 * finger on the disc, and turning already walks everything. So the fine one
	 * beside the card should be the one that cannot trap you either — and there
	 * is no Shift to borrow the other with, so a phone that had the ring
	 * selected would have only the ring.
	 *
	 * On a desktop they follow the setting, exactly like the arrow keys they are
	 * the twin of.
	 */
	private stepFromCard(delta: number): void {
		if (this.stepSideways(delta, false, Platform.isMobile ? "tasks" : undefined)) {
			return;
		}
		this.controller?.walkRing(delta);
	}

	private stepSideways(
		delta: number,
		other = false,
		forced?: SidewaysAlong,
	): boolean {
		const tree = this.tree;
		const layout = this.layout;
		const from = this.focusId;
		if (tree === null || layout === null || from === null) return false;

		// Shift asks for the ring the reader did not choose. Both are the same
		// order through a different filter, so neither can reach anything the
		// other cannot — this only changes which items the step stops on
		// (BC_E3_S94).
		const chosen = this.plugin.settings.arrowStep;
		const along: SidewaysAlong =
			forced ??
			(other ? (chosen === "tasks" ? "ring" : "tasks") : chosen);

		// What this round has already been past is stepped over rather than
		// stopped on (BC_E3_S138). Read fresh on every press: the round is being
		// written to as the reader walks, and a set captured earlier would be
		// one item behind by the time the arrow is let go.
		const round = new Set(stateFor(this.plugin.settings, this.wheelScope).seen);

		const to = sidewaysFrom(
			tree.root,
			layout.budgets.map((budget) => budget.domain),
			from,
			delta,
			along,
			(id) => round.has(id),
		);
		if (to === null || to === from) return false;

		if (this.controller?.goTo(to) === true) return true;

		this.focusId = to;
		this.laidOutFor = null;
		this.relayout();
		return true;
	}

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
	/**
	 * What the pane measures while the keyboard comes and goes (BC_E3_S96).
	 *
	 * The owner reports a band of empty space between the wheel and the
	 * keyboard, appearing a moment *after* the keyboard does. Two things fit
	 * that, and they want opposite repairs: the pane scrolls the focused box
	 * into view and we are looking at the bottom of a scrolled column, or the
	 * room this view holds back for Obsidian's own mobile bar
	 * (`--safe-area-inset-bottom` plus `--tw-bottom-bar`) grows to the height of
	 * the keyboard because Android counts the keyboard as an inset.
	 *
	 * `scrollTop` tells the first from the second, the padding says how big the
	 * second would be, and a visual viewport much shorter than the pane would
	 * mean a third thing: nothing resized at all and the drawing is simply
	 * behind the keyboard. None of it can be read from here — the wheel has to
	 * work on devices this code never runs on, which is the whole reason the
	 * diagnostics panel exists (BC_E3_S76).
	 *
	 * **Four moments, because the first attempt caught none.** A keyboard on
	 * Obsidian mobile need not resize the visual viewport at all, so a reading
	 * is taken when the pane is drawn, when anything inside it takes focus —
	 * that is the keyboard arriving — again half a second later, once it has
	 * finished animating, and on any viewport or window resize. Repeats are
	 * dropped, so the four never bury the rest of the trace.
	 *
	 * Measured off the *view's own* window: a torn-off tab has a window of its
	 * own, and the main one would report a viewport nobody is looking at.
	 */
	private watchViewport(): void {
		const view = this.containerEl.ownerDocument.defaultView;
		if (view === null) return;

		const visual = view.visualViewport;
		if (visual !== null) {
			const onResize = (): void => this.reportViewport("visual", true);
			visual.addEventListener("resize", onResize);
			this.register(() => visual.removeEventListener("resize", onResize));
		}

		this.registerDomEvent(view, "resize", () => this.reportViewport("window", true));

		// Focus moving into the pane is the keyboard arriving, on a device that
		// has one. The second reading is the one that matters: the owner's gap
		// appears *after* what looks like a first step, which is the keyboard
		// finishing its animation.
		this.registerDomEvent(this.contentEl, "focusin", () => {
			this.markTyping();
			this.reportViewport("focus");
			view.setTimeout(() => this.reportViewport("focus+500"), 500);
		});

		// After the move, not during it: `focusout` fires before the next
		// element has focus, so asking then would say "nothing" on every step
		// from one field to the next.
		this.registerDomEvent(this.contentEl, "focusout", () => {
			view.setTimeout(() => {
				this.markTyping();
				this.reportViewport("blur");
			}, 0);
		});
	}

	/**
	 * Whether a text field in this pane has the keyboard (BC_E3_S96).
	 *
	 * The room the pane holds back at the bottom is for Obsidian's own mobile
	 * bar. While you are typing there is no bar to duck — the keyboard is
	 * standing where it would be — so the reservation is not merely too big
	 * then, it is unwanted. Which field it is does not matter: the rename box
	 * and the filter's search box both bring the same keyboard.
	 */
	private markTyping(): void {
		const active = this.contentEl.ownerDocument.activeElement;
		const typing =
			active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;

		this.contentEl.toggleClass("is-typing", typing && this.contentEl.contains(active));
	}

	/**
	 * One reading of the pane, into the trace.
	 *
	 * **Recorded whether or not diagnostics are on**, like every other line: the
	 * buffer keeps them and the panel merely shows them. The first version
	 * checked the setting before recording, so switching diagnostics on *after*
	 * the thing you were trying to catch left you with a trace that had
	 * everything except the measurement — which is what the owner got back on
	 * the first try (1 sep 2026). An instrument that is only running when you
	 * remembered to arm it is not an instrument.
	 *
	 * `quiet` drops a reading identical to the last one, and is for the resize
	 * events, which can fire in bursts. The deliberate moments — a draw, a focus
	 * — always print. They did not, in the second attempt, and the result was an
	 * instrument that says nothing precisely when the answer is *"nothing
	 * changed"*: the owner cleared the panel, worked the keyboard, and got back
	 * a trace with no reading in it at all. A measurement of "the same as
	 * before" is a measurement.
	 */
	private reportViewport(why: string, quiet = false): void {
		const view = this.containerEl.ownerDocument.defaultView;
		if (view === null) return;

		const pane = this.contentEl;
		const style = view.getComputedStyle(pane);
		const box = pane.getBoundingClientRect();
		const visual = view.visualViewport;
		const safe = style.getPropertyValue("--safe-area-inset-bottom").trim();

		// What has the keyboard, if anything. The first capture came back with
		// `focus` lines that turned out to be the canvas taking focus on a tap —
		// no keyboard involved — which looked like a reading of the moment we
		// were after and was not (BC_E3_S96).
		const active = pane.ownerDocument.activeElement;
		const focused =
			active === null
				? "none"
				: `${active.tagName.toLowerCase()}${
						active.className.length > 0 ? `.${active.className.split(" ")[0]}` : ""
					}`;

		const line =
			`window ${view.innerHeight}` +
			(visual === null
				? ""
				: ` · visual ${Math.round(visual.height)}@${Math.round(visual.offsetTop)}`) +
			` · pane ${Math.round(box.top)}+${Math.round(box.height)}` +
			` · scroll ${Math.round(pane.scrollTop)}/${Math.round(pane.scrollHeight)}` +
			` · pad-bottom ${style.paddingBottom}` +
			` · safe-area ${safe.length > 0 ? safe : "unset"}` +
			` · bottom-bar ${style.getPropertyValue("--tw-bottom-bar").trim() || "unset"}` +
			` · focus ${focused}`;

		if (quiet && line === this.lastViewport) return;
		this.lastViewport = line;
		this.onTrace(`viewport ${why}: ${line}`);
	}

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
 * The same question, of a finished line rather than of the words for one.
 *
 * `labelAfter` builds the checkbox itself because it is handed a description;
 * what comes back from the Tasks modal is already a whole line, checkbox and
 * fields and all, so building another one around it would ask the parser about
 * the wrong text.
 */
function labelOfLine(line: string): string {
	return parseTaskLine(line.trim())?.fields.description ?? "";
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
	// A heading wheel: one name, and the folder it stays inside — empty for the
	// whole vault (BC_E3_S146). Read back exactly as strictly as the rest: a
	// state that does not say both is no state at all.
	if (kind === "heading" && typeof heading === "string" && typeof path === "string") {
		return { kind, heading, path };
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

/**
 * Where a task's line sits, if this item is a task on a line at all.
 *
 * A task note is a task without a line (BC_E3_S130): it has fields, because its
 * tags and its status are real, but nothing to quote and nothing to write back
 * to. `source.raw === null` is what says so — the same signal a note ring has
 * always carried — and every edit path funnels through here, so testing it once
 * keeps a rewrite off line 0 of somebody's note.
 */
function lineRefOf(laid: LaidOutNode): LineRef | null {
	const source = laid.node.source;
	const raw = laid.node.fields?.raw;
	if (source === undefined || raw === undefined) return null;
	if (source.raw === null) return null;

	return { path: source.path, line: source.line, raw };
}

/** One step up or down the priority ladder, stopping at the ends. */
function shift(from: Priority, step: number): Priority {
	const order = PRIORITY_LADDER;
	const at = order.indexOf(from);
	const next = Math.min(Math.max(at - step, 0), order.length - 1);
	return order[next];
}

/**
 * What to say when a second tap has nothing to open.
 *
 * The decision is `model/scope.ts`'s; the wording is the view's, because it is
 * the view that has a notice to put it in. Each refusal says what the item is
 * rather than what the wheel would not do — "there is no folder called that" is
 * a fact the reader can act on; "cannot open" is not.
 */
function refusalText(refusal: NoScope): string {
	switch (refusal.refused) {
		case "no-section":
			return "these tasks sit above the first heading — there is no section to open for them.";
		case "not-a-folder":
			// One arm per source, because a two-way ternary here quietly called a
			// heading wedge a property when the fourth source arrived (BC_E3_S144).
			return refusal.source === "tag"
				? "a tag domain is not a folder, so there is no wheel to open for it."
				: refusal.source === "heading"
					? "this wedge is a heading, not a folder, so there is no folder to open for it."
					: "this wedge comes from a note property, not from a folder, so there is no folder to open for it.";
		case "no-source":
			return "nothing on this item says which note it came from.";
	}
}

/**
 * What to say when a title has no editor behind it (BC_E3_S118).
 *
 * The same division as `refusalText`: the rule is `model/scope.ts`'s, the words
 * are the view's. And the same standard — where the thing *can* be renamed, but
 * not from here, the sentence says where. "Cannot rename" would leave the
 * reader with the same question they tapped with.
 */
function noRenameText(refusal: NoRename): string {
	switch (refusal.refused) {
		case "heading":
			return "a heading is renamed in the note itself — open it from the card.";
		case "note":
			return "a note is renamed in the file list, so that its links follow.";
		case "folder":
			return "a folder is renamed in the file list.";
		case "wedge":
			return refusal.source === "tag"
				? "this wedge comes from a tag, so there is no name written down to change."
				: refusal.source === "heading"
					? "this wedge is a heading in several notes at once, so there is no one name to change. Rename it in a note, and the wheel follows."
					: "this wedge comes from a note property, so there is no name written down to change.";
		case "nameless":
			return "there is nothing here to rename.";
	}
}
