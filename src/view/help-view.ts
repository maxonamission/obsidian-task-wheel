import {
	ItemView,
	Modal,
	Notice,
	Platform,
	setIcon,
	type WorkspaceLeaf,
} from "obsidian";
import { helpSubject } from "../model/help";
import { nodeColour, PRIORITY_LADDER } from "../layout/colour";
import type TaskWheelPlugin from "../main";
import {
	cardActions,
	type GlyphName,
	type HelpAction,
	keyGroups,
	legendRows,
	roundBlock,
	type RoundRow,
} from "./help-content";
import { fmt, type HelpStrings } from "./help-strings";
import { TaskWheelView, VIEW_TYPE_TASK_WHEEL } from "./wheel-view";

export const VIEW_TYPE_TASK_WHEEL_HELP = "task-wheel-help";

/**
 * The help panel.
 *
 * The wheel lives in the main area because it needs the room; the sidebar is
 * the right size for the one thing the wheel cannot say about itself — what it
 * means (eigenaar, 25 aug 2026; kaderdocument §5.2).
 *
 * A reading glass, not a second set of controls. Everything it names can be
 * done elsewhere; the panel only makes it findable. An action whose only home
 * were here would not be help but a hiding place.
 *
 * Three blocks, and the live one is on top: what changes while you read should
 * not be the thing you have to scroll to.
 */
export class TaskWheelHelpView extends ItemView {
	/** The wheel this panel is about, by scope key. See `helpSubject`. */
	private subject: string | null = null;

	/**
	 * How wide the pane was the last time the panel drew into it.
	 *
	 * Zero means the drawing went nowhere: on a phone the sidebar is a drawer
	 * that slides open, and everything drawn before it has finished sliding goes
	 * into a pane of no size at all.
	 */
	private drawnInto = 0;

	/** A pending look-again, and how many are left. See `settle`. */
	private settleTimer: number | null = null;
	private settleTries = 0;

	/** Rebuilt from the subject on every refresh; the standing blocks are not. */
	private handles: HelpHandles = { round: null, hues: null };

	/** Whether the reader has opened each block, kept across refreshes. */
	private readonly open = new Map<string, boolean>([
		["round", true],
		["keys", false],
		["legend", false],
	]);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TaskWheelPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_TASK_WHEEL_HELP;
	}

	getDisplayText(): string {
		return this.plugin.helpStrings().title;
	}

	getIcon(): string {
		return "help-circle";
	}

	/**
	 * Say something the panel itself cannot swallow.
	 *
	 * A `Notice` is drawn by Obsidian over everything, so it arrives even when
	 * this view draws nothing, is hidden, or never runs at all. That last case
	 * is the one that cost three rounds of the owner's evening: an empty panel
	 * and an error box that never appeared look exactly alike from the outside,
	 * and neither says whether any of this code ran (25 aug 2026).
	 *
	 * Behind the troubleshooting switch, so it is silent for everyone else.
	 */
	private say(message: string): void {
		this.plugin.sayHelp(message);
	}

	async onOpen(): Promise<void> {
		this.say("onOpen ran");
		this.contentEl.empty();
		this.contentEl.addClass("task-wheel-help");

		// Everything, not only the drawing. A blank panel on the owner's phone
		// (25 aug 2026) could have come from anywhere in here, and the two lines
		// before the drawing were the ones nothing was watching.
		try {
			// The panel follows the wheel in front of the reader, so it has to hear
			// about every change of pane. Registered here rather than in the plugin
			// so it goes when the panel goes.
			this.registerEvent(
				this.app.workspace.on("active-leaf-change", () => {
					this.follow();
					this.healIfEmpty();
				}),
			);
			this.registerEvent(
				this.app.workspace.on("layout-change", () => this.healIfEmpty()),
			);
			this.registerEvent(
				this.app.workspace.on("resize", () => this.healIfEmpty()),
			);

			// The browser's own answer to "when does this element get a size",
			// asked of the element itself. Obsidian's `onResize` hook was relied
			// on for this first and never arrived on the phone; whatever the
			// workspace does or does not relay, this fires the moment the pane
			// goes from nothing to something — a drawer done sliding, a stacked
			// section unfolded (eigenaar, 25 aug 2026, vijfde ronde).
			const observer = new ResizeObserver(() => {
				if (this.drawnInto > 0) return;
				const width = this.contentEl.getBoundingClientRect().width;
				if (width <= 0) return;
				this.say(`pane came alive at ${Math.round(width)}px`);
				this.redraw();
			});
			observer.observe(this.contentEl);
			this.register(() => observer.disconnect());

			this.follow();
			this.settleTries = 0;
			this.redraw();
		} catch (error) {
			this.sayItFailed("opening the help panel", error);
		}
	}

	async onClose(): Promise<void> {
		this.stopSettling();
		this.contentEl.empty();
	}

	/**
	 * Look again shortly, until the pane has a size to draw into.
	 *
	 * A sidebar on a phone is a drawer that slides, and everything drawn while
	 * it is still sliding lands in a pane of 0×0 — measured on the owner's
	 * device, twice (25 aug 2026). `onResize` is the hook meant for this and it
	 * did not arrive, so the panel stops waiting to be told: it looks again a
	 * few times over a second and a half, and stops the moment it has drawn into
	 * a pane with a width.
	 *
	 * Bounded on purpose. A panel that keeps redrawing for ever because the pane
	 * is genuinely closed would be a worse bug than the one it fixes.
	 */
	private settle(): void {
		if (this.settleTimer !== null || this.settleTries >= 8) return;

		this.settleTimer = window.setTimeout(() => {
			this.settleTimer = null;
			this.settleTries += 1;
			if (this.drawnInto > 0) return;
			this.redraw();
		}, 200);
	}

	private stopSettling(): void {
		if (this.settleTimer === null) return;
		window.clearTimeout(this.settleTimer);
		this.settleTimer = null;
	}

	/**
	 * Draw again, whatever state the pane was left in.
	 *
	 * `onOpen` runs once, when the view is built. Everything after that — a
	 * sidebar collapsed and swiped back open, a workspace shuffled, a pane
	 * hidden and shown — leaves the same instance in place, and if anything has
	 * emptied it in the meantime nothing ever fills it again. That is what the
	 * owner had: one leaf, awake, ours, and nothing in it (25 aug 2026).
	 *
	 * So the panel is drawn on the way in as well, not only on the way up.
	 */
	redraw(): void {
		this.render();

		// What actually landed in the pane, measured rather than assumed. Not the
		// content alone: a pane of 0×0 can mean the drawer is still sliding, a
		// leaf that is not the visible tab, or an element that hangs outside the
		// document altogether — and from the reader's side those look identical.
		const box = this.contentEl.getBoundingClientRect();
		const leaf = this.containerEl.getBoundingClientRect();
		this.drawnInto = box.width;

		this.say(
			`drew ${this.contentEl.childElementCount} blocks in ` +
				`${Math.round(box.width)}×${Math.round(box.height)}, ` +
				`leaf ${Math.round(leaf.width)}×${Math.round(leaf.height)}, ` +
				`attached=${this.contentEl.isConnected}, ` +
				`try ${this.settleTries}`,
		);

		if (this.drawnInto <= 0) this.settle();
	}

	/**
	 * Draw again once the pane actually has a size.
	 *
	 * A sidebar on a phone is a drawer that slides, and `revealLeaf` is done
	 * before the sliding is: the panel was drawing its three blocks into a pane
	 * of 0×0 and they were never seen (eigenaar, 25 aug 2026, measured on the
	 * device). This is Obsidian saying the pane has changed size, which is the
	 * one moment worth drawing again.
	 *
	 * Only while nothing has landed in a real box yet — a resize is otherwise
	 * something that happens on every rotation and every keyboard.
	 */
	onResize(): void {
		if (this.drawnInto > 0) return;
		this.redraw();
	}

	/**
	 * Drawn again on the way in, with the look-agains reset.
	 *
	 * The reader tapping the button is the one moment we know they want to see
	 * the panel, so it is also the moment to start counting from zero: a run of
	 * look-agains that gave up an hour ago must not decide what happens now.
	 */
	reopen(): void {
		this.settleTries = 0;
		this.stopSettling();
		this.redraw();
	}

	/**
	 * Fill the panel again the moment it is found empty.
	 *
	 * Not a patch over the cause but the same rule as above, applied where the
	 * plugin cannot reach: the workspace moves for reasons this view is never
	 * told about, and an empty panel is always wrong.
	 */
	private healIfEmpty(): void {
		// Empty, or drawn into nothing — the second looks exactly like the first
		// from the reader's side, and both are always wrong.
		if (this.contentEl.childElementCount > 0 && this.drawnInto > 0) return;
		this.redraw();
	}

	/**
	 * Work out which wheel this panel is about, and draw.
	 *
	 * The rule itself is in `helpSubject`; what happens here is only the two
	 * questions it asks — which wheel just became active, and whether the one we
	 * were showing is still open.
	 */
	private follow(): void {
		const active = this.app.workspace.getActiveViewOfType(TaskWheelView);
		const next = helpSubject(
			active === null ? null : active.scopeKey(),
			this.subject,
			(key) => this.wheelFor(key) !== null,
		);
		if (next === this.subject) return;

		this.subject = next;
		this.refresh();
	}

	/**
	 * Redraw what depends on the wheel. Called when a round moves on.
	 *
	 * The two standing blocks are left alone: rebuilding the whole panel on
	 * every stop would throw away the reader's scroll position and close nothing
	 * they had opened, which is a lot of work to look worse.
	 */
	refresh(): void {
		// Nothing to redraw into a block the reader has closed: it is not built
		// while it is closed, and opening it draws it fresh.
		if (this.handles.round === null || this.open.get("round") !== true) return;
		drawRound(this.handles.round, this.surface());
		if (this.handles.hues !== null) {
			drawHues(this.handles.hues, this.subjectWheel());
		}
	}

	/** This view, as the one thing the shared renderer needs to know about. */
	private surface(): HelpSurface {
		return {
			wheel: () => this.subjectWheel(),
			run: (action) => this.run(action),
			open: this.open,
			rebuild: () => this.render(),
			strings: () => this.plugin.helpStrings(),
		};
	}

	private wheelFor(key: string): TaskWheelView | null {
		const leaf = this.app.workspace
			.getLeavesOfType(VIEW_TYPE_TASK_WHEEL)
			.find(
				(one) => one.view instanceof TaskWheelView && one.view.scopeKey() === key,
			);
		return leaf?.view instanceof TaskWheelView ? leaf.view : null;
	}

	private subjectWheel(): TaskWheelView | null {
		return this.subject === null ? null : this.wheelFor(this.subject);
	}

	/* --------------------------------------------------------------------- */

	/**
	 * Draw the panel, and say so on the panel itself when that fails.
	 *
	 * The wheel learned this on its first Android test and the panel had not:
	 * a view that renders nothing and says nothing looks deliberate, which is
	 * the worst outcome on a device the developer cannot reach. The panel was
	 * blank on the owner's phone for a day before there was anything to go on
	 * (25 aug 2026).
	 */
	private render(): void {
		const root = this.contentEl;
		root.empty();
		// Arabic reads right to left; see the modal for why this is per-surface.
		root.setAttribute(
			"dir",
			this.plugin.helpLanguage() === "ar" ? "rtl" : "ltr",
		);

		try {
			this.handles = renderHelp(root, this.surface());
		} catch (error) {
			this.sayItFailed("drawing the help panel", error);
		}
	}

	/** On the panel, not only in a console no phone has. */
	private sayItFailed(step: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Task Wheel: ${step} failed`, error);
		// Twice on purpose: the box below is invisible if the panel itself is,
		// and that is exactly the case worth hearing about.
		new Notice(`Task wheel: ${step} failed — ${message}`, 10000);

		const box = this.contentEl.createDiv({ cls: "task-wheel-error" });
		box.addClass("is-on");
		box.createEl("p", { text: `${step} failed: ${message}` });
	}

	/**
	 * Do the one thing a row offers.
	 *
	 * Every one of these already exists as a command or a menu row; the panel
	 * hands the work straight over rather than repeating it, so a row and the
	 * menu beside it can never disagree about what happens.
	 */
	private run(action: HelpAction): void {
		if (action === "open-wheel") {
			void this.plugin.activateView();
			return;
		}

		const wheel = this.subjectWheel();
		if (wheel === null) return;
		wheel.runFromHelp(action);
		this.refresh();
	}
}

/**
 * The help, as a modal — the phone's surface.
 *
 * Not a stylistic choice but the outcome of a measured hunt (25 aug 2026, six
 * rounds): on a phone Obsidian keeps the pane of an unshown sidebar view
 * **detached from the document** — `attached=false`, `leaf 0×0` — and neither
 * `revealLeaf`, `loadIfDeferred`, `onResize` nor a `ResizeObserver` ever saw it
 * come alive. Everything the panel drew landed nowhere. A modal owns its own
 * surface, so there is nothing to be detached from; it is also how Voxtral's
 * help works on the same device, which is what pointed here.
 *
 * The subject is the wheel whose header button opened it, fixed for the
 * modal's short life — a modal covers the screen, so "the active wheel" cannot
 * change under it.
 */
export class TaskWheelHelpModal extends Modal {
	/** Same defaults as the panel: the live block open, the two references shut. */
	private readonly folds = new Map<string, boolean>([
		["round", true],
		["keys", false],
		["legend", false],
	]);

	private handles: HelpHandles = { round: null, hues: null };

	constructor(
		private plugin: TaskWheelPlugin,
		private wheel: TaskWheelView | null,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.titleEl.setText(this.plugin.helpStrings().title);
		this.contentEl.addClass("task-wheel-help");
		this.contentEl.addClass("task-wheel-help-modal");
		// Arabic reads right to left; the rest of Obsidian only follows when its
		// own language is Arabic, and the override has to work without that.
		this.contentEl.setAttribute(
			"dir",
			this.plugin.helpLanguage() === "ar" ? "rtl" : "ltr",
		);
		this.rebuild();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private rebuild(): void {
		this.contentEl.empty();
		this.handles = renderHelp(this.contentEl, this.surface());
	}

	private surface(): HelpSurface {
		return {
			wheel: () => this.wheel,
			run: (action) => this.run(action),
			open: this.folds,
			rebuild: () => this.rebuild(),
			strings: () => this.plugin.helpStrings(),
		};
	}

	private run(action: HelpAction): void {
		// The one row that means "take me somewhere": the modal is in the way of
		// exactly that, so it goes first.
		if (action === "open-wheel") {
			this.close();
			void this.plugin.activateView();
			return;
		}

		if (this.wheel === null) return;
		this.wheel.runFromHelp(action);
		if (this.handles.round !== null && this.folds.get("round") === true) {
			drawRound(this.handles.round, this.surface());
		}
	}
}

/* -------------------------------------------------------------------------
   The drawing, shared by the two surfaces. A function of the surface rather
   than a method of either, so the panel and the modal cannot drift apart —
   they already almost did, which is how the phone got its own copy of a bug.
   ------------------------------------------------------------------------- */

/** What the renderer needs to know about whoever is hosting it. */
interface HelpSurface {
	/** The wheel this help is about right now, if any. */
	wheel(): TaskWheelView | null;
	/** Do what a row offers. */
	run(action: HelpAction): void;
	/** Which blocks the reader has open, kept across rebuilds. */
	open: Map<string, boolean>;
	/** Rebuild the whole surface — a fold was toggled. */
	rebuild(): void;
	/** Every word the surface says, in the language the reader chose. */
	strings(): HelpStrings;
}

/** The two elements that change while the reader looks at the panel. */
interface HelpHandles {
	round: HTMLElement | null;
	hues: HTMLElement | null;
}

function renderHelp(root: HTMLElement, on: HelpSurface): HelpHandles {
	const handles: HelpHandles = { round: null, hues: null };
	const s = on.strings();

	handles.round = block(root, "round", s.blockRound, on, (body) =>
		drawRound(body, on),
	);
	block(root, "keys", s.blockKeys, on, (body) => drawKeys(body, s));
	block(root, "legend", s.blockLegend, on, (body) =>
		drawLegend(body, on, handles, s),
	);

	return handles;
}

/**
 * One block, as a fold.
 *
 * A button and a div, which is the fold this plugin already builds in the
 * filter panel. It was a `<details>` first, for the keyboard and the screen
 * reader it gives away for nothing; that was the one construct here that
 * appears nowhere else in this plugin, and it went while chasing the blank
 * phone panel. The `aria-expanded` is what it costs to keep the part that
 * mattered.
 */
function block(
	parent: HTMLElement,
	key: string,
	title: string,
	on: HelpSurface,
	draw: (body: HTMLElement) => void,
): HTMLElement {
	const open = on.open.get(key) === true;
	const fold = parent.createDiv({ cls: "task-wheel-help-block" });
	fold.toggleClass("is-open", open);

	const head = fold.createEl("button", {
		cls: "task-wheel-help-head",
		attr: { "aria-expanded": String(open) },
	});
	const caret = head.createSpan({ cls: "task-wheel-help-caret" });
	setIcon(caret, open ? "chevron-down" : "chevron-right");
	head.createSpan({ text: title });
	head.addEventListener("click", () => {
		on.open.set(key, on.open.get(key) !== true);
		on.rebuild();
	});

	const body = fold.createDiv({ cls: "task-wheel-help-body" });
	if (open) draw(body);
	return body;
}

/* --- block 3: where this round stands ------------------------------------ */

function drawRound(body: HTMLElement, on: HelpSurface): void {
	body.empty();
	const s = on.strings();
	const wheel = on.wheel();
	const { head, rows } = roundBlock(
		wheel === null ? null : wheel.helpState(),
		s,
	);

	if (head.kind === "progress") {
		const line = body.createDiv({ cls: "task-wheel-help-seen" });
		line.createEl("b", {
			text: fmt(s.seenOfTotal, { seen: head.seen, total: head.total }),
		});
		line.createSpan({ text: `${head.percent}%` });

		const meter = body.createDiv({ cls: "task-wheel-help-meter" });
		meter.createSpan().style.width = `${head.percent}%`;

		body.createEl("p", { cls: "task-wheel-help-note", text: s.seenNote });
	} else if (head.kind === "reading") {
		// Not "nothing to review": the wheel is still reading, and on a big
		// vault that is long enough for the wrong sentence to be read.
		body.createEl("p", { cls: "task-wheel-help-note", text: s.readingVault });
	} else if (head.kind === "empty") {
		body.createEl("p", {
			cls: "task-wheel-help-note",
			text: s.nothingToReview,
		});
	}

	for (const row of rows) drawRow(body, row, on);
}

function drawRow(parent: HTMLElement, row: RoundRow, on: HelpSurface): void {
	const line = parent.createDiv({ cls: "task-wheel-help-row" });
	if (row.label !== "") {
		line.createSpan({ cls: "task-wheel-help-label", text: row.label });
	}
	const text = line.createSpan({ cls: "task-wheel-help-text" });
	text.createSpan({ text: row.text });

	const link = row.link;
	if (link === undefined) return;

	const button = text.createEl("button", {
		cls: "task-wheel-help-link",
		text: link.text,
	});
	button.addEventListener("click", () => on.run(link.action));
}

/* --- block 1: keys and actions -------------------------------------------- */

function drawKeys(body: HTMLElement, s: HelpStrings): void {
	// The moves this device can make, and no others: a phone reading about
	// PgUp is noise exactly where this block weighs heaviest.
	const touch = Platform.isMobile;

	for (const group of keyGroups(touch, s)) {
		body.createDiv({
			cls: "task-wheel-help-group",
			text: group.heading,
		});
		for (const row of group.rows) {
			const line = body.createDiv({ cls: "task-wheel-help-row" });
			const keys = line.createSpan({ cls: "task-wheel-help-keys" });
			for (const key of row.keys) keys.createEl("kbd", { text: key });
			line.createSpan({ cls: "task-wheel-help-text", text: row.text });
		}
	}

	body.createEl("p", {
		cls: "task-wheel-help-note",
		text: touch ? s.keysNoteTouch : s.keysNote,
	});

	body.createDiv({ cls: "task-wheel-help-group", text: s.groupCard });
	const actions = body.createDiv({ cls: "task-wheel-help-actions" });
	for (const action of cardActions(s)) {
		const row = actions.createSpan({ cls: "task-wheel-help-action" });
		const icon = row.createSpan();
		setIcon(icon, action.icon);
		row.createSpan({ text: action.name });
	}

	body.createEl("p", {
		cls: "task-wheel-help-note",
		text: touch ? s.commandsNoteTouch : s.commandsNote,
	});
}

/* --- block 2: what the drawing means -------------------------------------- */

function drawLegend(
	body: HTMLElement,
	on: HelpSurface,
	handles: HelpHandles,
	s: HelpStrings,
): void {
	for (const row of legendRows(s)) {
		const line = body.createDiv({ cls: "task-wheel-help-row" });

		if (row.kind === "text") {
			line.createSpan({ cls: "task-wheel-help-label", text: row.label });
			line.createSpan({ cls: "task-wheel-help-text", text: row.text });
			continue;
		}

		if (row.kind === "hues") {
			const text = line.createSpan({ cls: "task-wheel-help-text" });
			text.createSpan({ text: row.text });
			handles.hues = text.createDiv({ cls: "task-wheel-help-hues" });
			drawHues(handles.hues, on.wheel());
			continue;
		}

		if (row.kind === "ramp") {
			const ramp = line.createSpan({ cls: "task-wheel-help-ramp" });
			for (const priority of PRIORITY_LADDER) {
				const step = ramp.createSpan({
					cls: "task-wheel-help-step",
					attr: { "aria-label": priority, title: priority },
				});
				// Drawn in the first domain's hue: it is the lightness that
				// carries the meaning, not the colour it is shown in.
				step.style.setProperty("--tw-colour", nodeColour(0, priority));
			}
			line.createSpan({ cls: "task-wheel-help-text", text: row.text });
			continue;
		}

		glyph(line, row.glyph);
		line.createSpan({ cls: "task-wheel-help-text", text: row.text });
	}
}

/**
 * The domains of the wheel in front of the reader, in their own colours.
 *
 * The strip in the wheel's own pane deliberately leaves these out — the
 * wheel writes them on its rim, and repeating them there cost five lines of
 * a phone screen. Here there is room, and a reader who has opened the key is
 * asking exactly this. Without a wheel the sentence above stands on its own.
 */
function drawHues(parent: HTMLElement, wheel: TaskWheelView | null): void {
	parent.empty();
	const domains = wheel?.domainNames() ?? [];

	for (const [index, name] of domains.entries()) {
		const one = parent.createSpan({ cls: "task-wheel-help-hue" });
		const swatch = one.createSpan({ cls: "task-wheel-help-swatch" });
		// `normal` is the absence of a priority marker, and so most of the
		// wheel: the swatch shows the hue as the reader mostly meets it.
		swatch.style.setProperty("--tw-colour", nodeColour(index, "normal"));
		one.createSpan({ text: name });
	}
}

/**
 * The four shapes the drawing uses that a colour cannot explain.
 *
 * Drawn rather than described: "a stump with a counter" is a phrase you can
 * only match to the drawing once you have seen the two side by side.
 */
function glyph(parent: HTMLElement, name: GlyphName): void {
	const svg = parent.createSvg("svg", {
		cls: "task-wheel-help-glyph",
		attr: { viewBox: "0 0 34 20", "aria-hidden": "true" },
	});

	if (name === "wedge") {
		svg.createSvg("path", {
			cls: "task-wheel-help-beam",
			attr: { d: "M4 20 L12 0 H22 L30 20 Z" },
		});
		return;
	}

	if (name === "stump") {
		svg.createSvg("line", {
			cls: "task-wheel-help-limb",
			attr: { x1: "3", y1: "10", x2: "16", y2: "10" },
		});
		svg.createSvg("line", {
			cls: "task-wheel-help-cap",
			attr: { x1: "18", y1: "5", x2: "18", y2: "15" },
		});
		return;
	}

	if (name === "ticks") {
		for (let i = 0; i < 5; i++) {
			svg.createSvg("line", {
				cls: "task-wheel-help-cap",
				attr: {
					x1: String(5 + i * 6),
					y1: "4",
					x2: String(5 + i * 6),
					y2: "16",
				},
			});
		}
		return;
	}

	svg.createSvg("path", {
		cls: "task-wheel-help-gap",
		attr: { d: "M4 18 A 16 16 0 0 1 30 18" },
	});
}
