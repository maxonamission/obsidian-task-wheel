import { Menu } from "obsidian";
import { putIcon } from "./icon";
import { nodeColour } from "../layout/colour";
import { ancestorsOf, type LaidOutNode, type WheelLayout } from "../layout/radial";
import { plainText, splitLinks } from "../parse/links";
import { textEnd } from "../parse/outline-edit";
import { TASK_LINE } from "../parse/task-line";
import type { TaskFields } from "../model/types";

/**
 * The reading card, taken from the Instrument impression (kaderdocument §4).
 *
 * The wheel's own labels are short by necessity — a ring only has so much room
 * — so the item under the reading wedge is written out here in fuller than the
 * disc can manage.
 *
 * It floats over the wheel rather than sitting above it: a block above the
 * drawing has to be given room whether it needs it or not, and every stop that
 * changed its height walked the wheel up and down the pane.
 *
 * Floating brought its own trouble, though, and the fix for it is the rule this
 * card is now built on: **one fixed frame, always**. Same size at every stop,
 * same lines in the same places, the button in the same spot. A panel that
 * grows and shrinks over a drawing is worse than one that sits still and clips,
 * because the drawing underneath keeps appearing and disappearing. So the
 * height is fixed, the text clips, and nothing here reflows.
 */
/**
 * What the card can do with the item under the wedge.
 *
 * Five actions and no more (kaderdocument §5): the wheel reviews work, it does
 * not author it. Anything that needs typing belongs in the note, which is what
 * the last one opens.
 */
export interface CardActions {
	/**
	 * Offer notes while a link is being typed in the rename box.
	 *
	 * Handed in rather than built here: the card is a drawing of a node and does
	 * not know the vault. Answers a handle so the box can take the list down
	 * again when it closes (BC_E3_S29).
	 */
	suggestLinks?: (field: HTMLTextAreaElement) => { detach: () => void };
	/** Tick the task off. */
	done?: () => void;
	/** Mark the task as started, or take that mark off again. */
	start?: () => void;
	/** Cancel the task, or bring it back. */
	cancel?: () => void;
	/** Park it a week out: sets the scheduled date (⏳), never the deadline. */
	defer?: () => void;
	/** Move the priority one step up (+1) or down (-1). */
	priority?: (step: number) => void;
	/** Open the note at this line. */
	open?: () => void;
	/** Fold the branch away, or unfold it. */
	fold?: (id: string) => void;
	/**
	 * One item along this ring, forwards or back.
	 *
	 * The same move the left and right arrow keys make: sideways within the ring
	 * you are already reading. A phone has no arrow keys, and turning is a coarse
	 * instrument for moving by one (owner, 18 aug 2026).
	 *
	 * Deliberately *not* the flat order, though that is the walk that skips
	 * nothing. Tried it first, and as a button it reads as chaos — every press
	 * jumps a ring in or out and the eye loses its place (owner, 18 aug 2026).
	 * The round's guarantee lives in turning; these two are for reading.
	 */
	alongRing?: (delta: number) => void;
	/**
	 * Follow a link written inside the task's own words.
	 *
	 * Handed in rather than done here, because resolving a link is Obsidian's
	 * job and this file knows no vault.
	 */
	follow?: (target: string, external: boolean, event: MouseEvent) => void;
	/**
	 * Editing the outline of the note this wheel is about.
	 *
	 * Only ever handed in by a wheel over one note: there the wheel *is* the
	 * outline, so position and order are things it can show better than the
	 * editor. Absent everywhere else, which is what keeps the vault wheel a
	 * review instrument (kaderdocument §4.2).
	 */
	outline?: OutlineActions;
	/** Editing a heading, in a wheel over one note. */
	section?: SectionActions;
	/**
	 * Carrying this into another note, copy or move.
	 *
	 * Handed in by **both** wheels, unlike the two above. Editing a note's
	 * outline only makes sense where the wheel is that outline, but a task you
	 * come across while reviewing the whole vault is exactly the one you want to
	 * pull onto your list — and where you came across it is the vault wheel
	 * (owner, 17 aug 2026).
	 */
	carry?: CarryActions;
}

export interface CarryActions {
	/** Put a copy in another note, leaving this one where it is. */
	copy: () => void;
	/** Take it out of here and put it there. */
	move: () => void;
	/**
	 * Destinations the reader has named, in their own order.
	 *
	 * Above the two open-ended entries rather than below them: sorting a day's
	 * work is mostly these four, and the picker is the exception you reach for
	 * when none of them fits.
	 */
	presets?: readonly { name: string; how: "move" | "copy"; run: () => void }[];
}

export interface OutlineActions {
	/** Rewrite what the task says. */
	rename: (text: string) => void;
	/** Add a task below this one, or under it. */
	add: (asChild: boolean) => void;
	/** Move it past the sibling before or after. */
	move: (direction: "up" | "down") => void;
	/** Send it to another heading in this note. */
	moveTo: () => void;
	/**
	 * Hang it under another task in this note, as a step of that one.
	 *
	 * The third move, next to reordering and moving to another heading: from a
	 * loose item to a deeper step of something bigger (owner, 18 aug 2026).
	 */
	moveUnder: () => void;
}

/**
 * The same four moves, one level up: for a heading rather than a task.
 *
 * In a wheel over one note the headings are the wedges, so standing on one and
 * having nothing to do with it was the odd gap out (kaderdocument §4.2).
 */
export interface SectionActions {
	/** Swap this section with the one before or after it. */
	move: (direction: "up" | "down") => void;
	/** Move the whole section under another heading. */
	moveUnder: () => void;
	/** Add a task at the end of this section. */
	addTask: () => void;
	/** Hang a new section under this one. */
	addSubheading: () => void;
	/** Open a wheel over this section — the menu twin of the double tap (BC_E3_S64). */
	openWheel?: () => void;
}

export function renderReadingCard(
	parent: HTMLElement,
	layout: WheelLayout,
	focus: LaidOutNode | null,
	actions: CardActions = {},
): void {
	parent.empty();
	parent.addClass("task-wheel-card");

	if (focus === null) {
		parent.createEl("p", {
			cls: "task-wheel-card-empty",
			text: "Nothing under the reading wedge.",
		});
		return;
	}

	// One item at a time, beside the reading matter rather than in the action
	// row: that row is full at eight buttons, and these two are not actions on
	// the task — they are how you get to the next one.
	renderSteps(parent, actions);

	// The reading matter goes in a body that is allowed to run out of room; the
	// fold button is pinned outside it. Folding a branch away is the one move
	// here that cannot be undone by turning the wheel — the branch is gone from
	// the disc, so the only way back is this button. When it sat at the end of
	// the text it was the first thing a long task pushed out of sight, which
	// left the wheel in a state the reader could not get out of by hand.
	const body = parent.createDiv({ cls: "task-wheel-card-body" });

	renderTrail(body, layout, focus);

	renderTitle(body, focus, actions);

	const fields = focus.node.fields;
	if (fields !== undefined) renderChips(body, focus, fields);
	else renderBranchCount(body, focus, layout.showsFinished);

	// One detail line, not two. The frame is fixed, so a second line does not
	// make the card taller — it makes the last line get sliced through the
	// middle, which reads as a bug. What is hidden below this item beats where
	// it lives whenever there is something hidden.
	if (focus.hiddenCount > 0) renderStump(body, focus, layout.showsFinished);
	else renderSource(body, focus);
	renderActions(parent, layout, focus, actions);
}

/**
 * Nudge the wheel one item sideways, without turning it.
 *
 * Pinned to the card's own left and right edges, so they read as "back" and
 * "on" rather than as two more things to do to this task. Shown on every
 * platform: the arrow keys have had this since the beginning, and a control
 * that exists on one platform only is not a control.
 */
function renderSteps(parent: HTMLElement, actions: CardActions): void {
	const step = actions.alongRing;
	if (step === undefined) return;

	const make = (delta: number, icon: string, label: string): void => {
		const button = parent.createEl("button", {
			cls: delta < 0
				? ["task-wheel-nudge", "is-back"]
				: ["task-wheel-nudge", "is-forward"],
			attr: { "aria-label": label, title: label },
		});
		putIcon(button, icon, "task-wheel-nudge-icon");
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			step(delta);
		});
		// The card sits over the drawing, and a press here must not also start a
		// drag on the wheel underneath it.
		button.addEventListener("pointerdown", (event) => event.stopPropagation());
		// Passive: this listener only keeps the press from reaching the wheel, it
		// never cancels it. Saying so lets the browser scroll without waiting to
		// hear whether we will (Chrome flags a non-passive touch listener).
		button.addEventListener("touchstart", (event) => event.stopPropagation(), {
			passive: true,
		});
	};

	make(-1, "chevron-left", "Previous on this ring");
	make(1, "chevron-right", "Next on this ring");
}

/**
 * The title, and — in a wheel over one note — a way to change it.
 *
 * Click to edit, Enter to keep, Escape to drop it. Deliberately not a button
 * that opens a dialogue: the point of editing here rather than in the note is
 * that you do not leave the round, and a modal leaves the round.
 *
 * The card is a fixed frame, so the input takes exactly the space the title had
 * and the drawing underneath does not move.
 */
function renderTitle(
	parent: HTMLElement,
	focus: LaidOutNode,
	actions: CardActions,
): void {
	const outline = actions.outline;
	const editable = outline !== undefined && focus.node.fields !== undefined;

	const title = parent.createEl("p", {
		// An array, never a space-separated string: `cls` is handed to the class
		// list one token at a time, and a token holding a space is refused.
		cls: editable
			? ["task-wheel-card-title", "is-editable"]
			: ["task-wheel-card-title"],
		attr: editable
			? { title: "Click to rename", role: "button", tabindex: "0" }
			: {},
	});

	renderLabel(title, focus, actions);

	if (!editable || outline === undefined) return;

	const edit = (): void => {
		// Built on the parent and then swapped in, so the card's own helper does
		// the making — a plain `document.createElement` skips Obsidian's element
		// extensions that the rest of this file relies on.
		const input = parent.createEl("textarea", {
			cls: "task-wheel-card-rename",
			attr: { "aria-label": "Rename this task" },
		});
		input.value = textOf(focus);
		title.replaceWith(input);

		// Before the handlers below, deliberately: while the note list is up, the
		// arrows and Enter belong to it, and listeners on one element run in the
		// order they were added.
		const suggest =
			actions.suggestLinks === undefined ? null : actions.suggestLinks(input);

		input.focus();
		input.select();

		let settled = false;
		const finish = (keep: boolean): void => {
			if (settled) return;
			settled = true;
			suggest?.detach();
			const value = input.value;
			input.replaceWith(title);
			if (keep) outline.rename(value);
		};

		input.addEventListener("keydown", (event) => {
			// Enter keeps it; a newline in a task line would split the task in two.
			if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				finish(false);
			}
			event.stopPropagation();
		});
		// Clicking away keeps what was typed, which is what every other outliner
		// does and what a reader who turns the wheel away expects. A press on the
		// note list is not clicking away — that one keeps the focus deliberately.
		input.addEventListener("blur", () => finish(true));
	};

	title.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		edit();
	});
	title.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== "F2") return;
		event.preventDefault();
		edit();
	});
}

/**
 * The label, with the links inside it as links.
 *
 * `Sportprogramma [[week-01]]` says half of what it is about in the link, and
 * four square brackets is not what the reader wrote it for. Following one goes
 * through Obsidian's own resolution, so it lands where it would from the note
 * itself — same aliases, same headings, same folder rules.
 *
 * A link takes the tap it is given and lets nothing through: the card beneath
 * it turns the wheel, and the title above it opens the rename box. Both would
 * be the wrong answer to a tap on a link.
 */
function renderLabel(
	parent: HTMLElement,
	focus: LaidOutNode,
	actions: CardActions,
): void {
	const follow = actions.follow;
	const source = focus.node.source;

	for (const piece of splitLinks(focus.node.label)) {
		if (piece.kind === "text" || follow === undefined || source === undefined) {
			parent.createSpan({ text: piece.text });
			continue;
		}

		const link = parent.createEl("a", {
			cls: piece.external
				? ["task-wheel-card-link", "external-link"]
				: ["task-wheel-card-link", "internal-link"],
			text: piece.text,
			attr: { href: piece.target, "aria-label": `Open ${piece.target}` },
		});

		link.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			follow(piece.target, piece.external, event);
		});
		// A drag that begins on a link is still a drag of the wheel, but the
		// press must not reach the title underneath and open the rename box.
		link.addEventListener("mousedown", (event) => event.stopPropagation());
	}
}

/**
 * The words of a task as they stand in the note, tags and all.
 *
 * Not the parsed label: that has had its tags lifted out, and offering it for
 * editing would delete them the moment the reader pressed Enter.
 */
function textOf(focus: LaidOutNode): string {
	const raw = focus.node.fields?.raw ?? "";
	const match = TASK_LINE.exec(raw);
	if (match === null) return focus.node.label;

	const body = match[3] ?? "";
	return body.slice(0, textEnd(body)).trim();
}

/**
 * Which branch this card's button folds.
 *
 * The item under the wedge if it has anything under it, and otherwise the
 * branch it hangs off. On a phone you land on a leaf far more often than on a
 * container, and a button that comes and goes with the kind of item you happen
 * to be reading is not a control — it is a surprise. Folding "the branch I am
 * in" is the same move either way; only the label has to say which one.
 */
export function foldTarget(
	layout: WheelLayout,
	focus: LaidOutNode,
): LaidOutNode | null {
	if (focus.node.children.length > 0) return focus;

	const trail = ancestorsOf(layout, focus);
	for (let i = trail.length - 1; i >= 0; i--) {
		if (trail[i].node.children.length > 0) return trail[i];
	}
	return null;
}

/** How many steps of the trail are worth showing before it stops helping. */
const TRAIL_STEPS = 3;

/** And how long one step may be. Headings in the wild run to a whole sentence. */
const TRAIL_CHARS = 22;

/** Domain › project › heading, so the item is placed before it is read. */
function renderTrail(
	parent: HTMLElement,
	layout: WheelLayout,
	focus: LaidOutNode,
): void {
	const trail = parent.createDiv({ cls: "task-wheel-card-trail" });

	const swatch = trail.createSpan({ cls: "task-wheel-card-swatch" });
	swatch.style.setProperty(
		"--tw-colour",
		nodeColour(focus.domainIndex, focus.priority),
	);

	// The trail is plain text, so a link in a parent task's words is written out
	// as what it says rather than as its brackets.
	const steps = shorten(
		ancestorsOf(layout, focus).map((step) => clip(plainText(step.node.label))),
	);
	if (steps.length === 0) steps.push(focus.node.domain);

	steps.forEach((step, index) => {
		if (index > 0) trail.createSpan({ cls: "task-wheel-card-sep", text: "›" });
		trail.createSpan({ cls: "task-wheel-card-step", text: step });
	});

}

/**
 * The domain, and then the last steps before the item.
 *
 * A deeply nested vault produces trails of five or six headings that wrap to
 * three lines and push the wheel off the screen. What a reader needs is which
 * wedge they are in and what the item hangs off — the middle of a long path
 * answers neither.
 */
function shorten(steps: string[]): string[] {
	if (steps.length <= TRAIL_STEPS) return steps;
	return [steps[0], "…", ...steps.slice(-(TRAIL_STEPS - 1))];
}

function clip(step: string): string {
	const trimmed = step.trim();
	if (trimmed.length <= TRAIL_CHARS) return trimmed;
	return `${trimmed.slice(0, TRAIL_CHARS - 1).trimEnd()}…`;
}

/**
 * The Tasks fields, as chips.
 *
 * Read-only on purpose: editing a task belongs to the review actions in phase
 * 6, and a wheel that quietly became a task editor would be the scope creep
 * the kaderdocument rules out (§10).
 */
function renderChips(
	parent: HTMLElement,
	focus: LaidOutNode,
	fields: TaskFields,
): void {
	const chips = parent.createDiv({ cls: "task-wheel-card-chips" });

	// First, because it is the one thing on this card that is about *now*. A
	// cancelled task only ever gets here when completed work is being shown, but
	// then it has to say why it is on the wheel at all.
	if (fields.state === "in-progress") {
		chips.createSpan({
			cls: ["task-wheel-chip", "is-in-progress"],
			text: "in progress",
		});
	} else if (fields.state === "cancelled") {
		chips.createSpan({
			cls: ["task-wheel-chip", "is-cancelled"],
			text: "cancelled",
		});
	}

	if (fields.priority !== "normal") {
		const chip = chips.createSpan({
			cls: ["task-wheel-chip", "is-priority"],
			text: `${fields.priority} priority`,
		});
		chip.style.setProperty(
			"--tw-colour",
			nodeColour(focus.domainIndex, fields.priority),
		);
	}

	chip(chips, "Due", fields.due);
	chip(chips, "Scheduled", fields.scheduled);
	chip(chips, "Starts", fields.start);
	chip(chips, "Repeats", fields.recurrence);

	for (const tag of fields.tags) {
		chips.createSpan({ cls: ["task-wheel-chip", "is-tag"], text: `#${tag}` });
	}

	if (fields.dependsOn.length > 0) {
		chips.createSpan({
			cls: ["task-wheel-chip", "is-blocked"],
			text: `Waits on ${fields.dependsOn.length}`,
		});
	}

	if (chips.childElementCount === 0) chips.detach();
}

function chip(parent: HTMLElement, label: string, value?: string): void {
	if (value === undefined || value.length === 0) return;
	parent.createSpan({ cls: "task-wheel-chip", text: `${label} ${value}` });
}

/**
 * What a container has under it.
 *
 * The wheel stops on domains and projects too, not only on tasks — they are
 * items on the disc and the design lets nothing be unreachable. When the wheel
 * lands on one, the useful thing to say is how much work hangs off it.
 */
function renderBranchCount(
	parent: HTMLElement,
	focus: LaidOutNode,
	showsFinished: boolean,
): void {
	const open = focus.node.shownTaskCount;
	// "Open" is only true of a round that holds no finished work. Saying it of a
	// branch of ticked-off tasks made the reader expect five open tasks to be
	// there, and then to travel (owner, 17 aug 2026).
	parent.createEl("p", {
		cls: "task-wheel-card-count",
		text: showsFinished
			? `${open} ${open === 1 ? "item" : "items"} on this branch in this round`
			: `${open} open ${open === 1 ? "task" : "tasks"} on this branch`,
	});
}

/**
 * Folding a branch away, and unfolding it again.
 *
 * A button rather than only a key, because the keyboard is not available on a
 * phone and a control that exists on one platform only is not a control. It is
 * the single action the card offers: this changes what the wheel shows, not
 * what the vault says — writing back to markdown is phase 6.
 */
function renderActions(
	parent: HTMLElement,
	layout: WheelLayout,
	focus: LaidOutNode,
	actions: CardActions,
): void {
	const foot = parent.createDiv({ cls: "task-wheel-card-foot" });
	const fields = focus.node.fields;
	const isTask = fields !== undefined;

	if (isTask && actions.done !== undefined) {
		action(foot, "check", "Mark done", actions.done);
	}

	// The two other statuses Tasks defines, and both are toggles: pressing the
	// one a task already carries puts it back to open. A button that can only be
	// pressed one way is a trap on a review instrument, where the whole point is
	// going past things quickly.
	if (isTask && actions.start !== undefined) {
		const started = fields.state === "in-progress";
		action(
			foot,
			"play",
			started ? "No longer in progress" : "Mark in progress",
			actions.start,
			started,
		);
	}
	if (isTask && actions.cancel !== undefined) {
		const cancelled = fields.state === "cancelled";
		action(
			foot,
			"ban",
			cancelled ? "Bring back" : "Cancel",
			actions.cancel,
			cancelled,
		);
	}

	if (isTask && actions.defer !== undefined) {
		action(foot, "calendar-clock", "Push a week out", actions.defer);
	}
	if (isTask && actions.priority !== undefined) {
		const step = actions.priority;
		action(foot, "chevron-up", "Raise priority", () => step(1));
		action(foot, "chevron-down", "Lower priority", () => step(-1));
	}
	if (focus.node.source !== undefined && actions.open !== undefined) {
		action(foot, "file-text", "Open the note", actions.open);
	}

	// Editing the outline lives behind one button rather than four. The row is
	// full at eight, and the extra tap is the right way round: reviewing is what
	// this card is for, changing the note is what you go looking for.
	//
	// One button, whatever it holds. The vault wheel has no outline to edit but
	// can still carry work into another note, and giving that its own tenth
	// button would break a row that is already tight on a phone.
	const outline = actions.outline;
	const section = actions.section;
	const carry = focus.node.source === undefined ? undefined : actions.carry;

	if (isTask && outline !== undefined) {
		action(foot, "ellipsis", "Edit this outline", (event) => {
			openOutlineMenu(event, outline, carry);
		});
	} else if (!isTask && section !== undefined) {
		action(foot, "ellipsis", "Edit this heading", (event) => {
			openSectionMenu(event, section, carry);
		});
	} else if (carry !== undefined) {
		action(foot, "ellipsis", "Send this to another note", (event) => {
			const menu = new Menu();
			addCarry(menu, carry, false);
			menu.showAtMouseEvent(event);
		});
	}

	const target = actions.fold === undefined ? null : foldTarget(layout, focus);
	if (target === null || actions.fold === undefined) return;

	const fold = actions.fold;
	action(
		foot,
		target.collapsed ? "unfold-vertical" : "fold-vertical",
		target.collapsed
			? "Unfold this branch"
			: target === focus
				? "Fold this branch away"
				: `Fold ${clip(target.node.label)} away`,
		() => fold(target.node.id),
	);
}

/**
 * One action, as an icon.
 *
 * Icons rather than words because six labelled buttons do not fit across a
 * phone, and the card holds a fixed frame. The label lives on as the tooltip
 * and as the accessible name, so nothing is lost to a screen reader or to a
 * hovering mouse.
 */
function action(
	parent: HTMLElement,
	icon: string,
	label: string,
	run: (event: MouseEvent) => void,
	on = false,
): void {
	const button = parent.createEl("button", {
		cls: on ? ["task-wheel-action", "is-on"] : ["task-wheel-action"],
		attr: {
			"aria-label": label,
			title: label,
			"aria-pressed": String(on),
		},
	});
	putIcon(button, icon, "task-wheel-action-icon");
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		run(event);
	});
}

/**
 * The outline actions, as a menu.
 *
 * Obsidian's own menu rather than a row of buttons: it names each action in
 * words, which matters for moves — an icon for "move past the sibling above,
 * carrying everything under it" does not exist.
 */
function openOutlineMenu(
	event: MouseEvent,
	outline: OutlineActions,
	carry?: CarryActions,
): void {
	const menu = new Menu();

	menu.addItem((item) =>
		item
			.setTitle("Add a task below")
			.setIcon("list-plus")
			.onClick(() => outline.add(false)),
	);
	menu.addItem((item) =>
		item
			.setTitle("Add a subtask")
			.setIcon("corner-down-right")
			.onClick(() => outline.add(true)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Move up")
			.setIcon("arrow-up")
			.onClick(() => outline.move("up")),
	);
	menu.addItem((item) =>
		item
			.setTitle("Move down")
			.setIcon("arrow-down")
			.onClick(() => outline.move("down")),
	);
	menu.addItem((item) =>
		item
			.setTitle("Move to another heading…")
			.setIcon("folder-input")
			.onClick(() => outline.moveTo()),
	);
	// Next to "another heading" rather than under the two moves above: both are
	// a change of parent, and the pair reads as one idea at two levels.
	menu.addItem((item) =>
		item
			.setTitle("Make a subtask of…")
			.setIcon("indent")
			.onClick(() => outline.moveUnder()),
	);
	addCarry(menu, carry);

	menu.showAtMouseEvent(event);
}

/**
 * The two that leave the note, at the bottom of whichever menu is open.
 *
 * Last and behind a separator, because they are the only entries here that
 * touch a second file. Copy is named first: it is the safe one, and the one
 * wanted most often — pulling something onto your list should not quietly take
 * it out of the document it was explaining something in.
 */
function addCarry(menu: Menu, carry?: CarryActions, separate = true): void {
	if (carry === undefined) return;

	if (separate) menu.addSeparator();

	// Named first, because a named place is the answer nine times out of ten.
	// The icon says which of the two verbs it is without spending a word on it.
	for (const preset of carry.presets ?? []) {
		menu.addItem((item) =>
			item
				.setTitle(preset.name)
				.setIcon(preset.how === "copy" ? "copy" : "file-output")
				.onClick(() => preset.run()),
		);
	}
	if ((carry.presets?.length ?? 0) > 0) menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Copy to another note…")
			.setIcon("copy")
			.onClick(() => carry.copy()),
	);
	menu.addItem((item) =>
		item
			.setTitle("Move to another note…")
			.setIcon("file-output")
			.onClick(() => carry.move()),
	);
}

/**
 * The same menu for a heading.
 *
 * Deliberately the same four words in the same order as the task menu, so the
 * two read as one idea at two levels rather than as two features.
 */
function openSectionMenu(
	event: MouseEvent,
	section: SectionActions,
	carry?: CarryActions,
): void {
	const menu = new Menu();

	if (section.openWheel !== undefined) {
		const open = section.openWheel;
		menu.addItem((item) =>
			item
				.setTitle("Open a wheel over this section")
				.setIcon("circle-dot")
				.onClick(() => open()),
		);
		menu.addSeparator();
	}

	menu.addItem((item) =>
		item
			.setTitle("Add a task here")
			.setIcon("list-plus")
			.onClick(() => section.addTask()),
	);
	menu.addItem((item) =>
		item
			.setTitle("Add a heading under this one")
			.setIcon("corner-down-right")
			.onClick(() => section.addSubheading()),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Move up")
			.setIcon("arrow-up")
			.onClick(() => section.move("up")),
	);
	menu.addItem((item) =>
		item
			.setTitle("Move down")
			.setIcon("arrow-down")
			.onClick(() => section.move("down")),
	);
	menu.addItem((item) =>
		item
			.setTitle("Move under another heading…")
			.setIcon("folder-input")
			.onClick(() => section.moveUnder()),
	);
	addCarry(menu, carry);

	menu.showAtMouseEvent(event);
}

/** What the rings could not reach still gets counted, never dropped (§3.3). */
function renderStump(
	parent: HTMLElement,
	focus: LaidOutNode,
	showsFinished: boolean,
): void {
	// `hiddenCount` counts items of the round, so "open" is only true of a round
	// that holds no finished work — the same small lie the hub and the branch
	// counter had already been cured of (found by audit, 17 aug 2026).
	const count = showsFinished
		? `${focus.hiddenCount} ${focus.hiddenCount === 1 ? "item" : "items"}`
		: `${focus.hiddenCount} open ${focus.hiddenCount === 1 ? "task" : "tasks"}`;

	parent.createEl("p", {
		cls: "task-wheel-card-stump",
		text: focus.collapsed
			? `Folded away: ${count} below this one.`
			: `${count} below this one, past the last ring.`,
	});
}

/**
 * Where it lives, in one line.
 *
 * The full vault path repeats what the trail above already says and wraps to
 * three lines while doing it. What it adds is the folders in between and the
 * line number, so that is what is kept.
 */
function renderSource(parent: HTMLElement, focus: LaidOutNode): void {
	const source = focus.node.source;
	if (source === undefined) return;

	const tail = source.path.split("/").slice(-2).join("/");
	parent.createEl("p", {
		cls: "task-wheel-card-source",
		text:
			focus.node.kind === "task" ? `${tail} · line ${source.line + 1}` : tail,
	});
}
