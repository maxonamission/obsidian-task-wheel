import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import type { NoteHeading } from "../parse/outline";
import { splitPath } from "../parse/outline-edit";
import { handBack } from "./hand-back";

/**
 * What the reader picked: a heading that exists, or one to make.
 *
 * Making one is offered the way Obsidian offers to make a folder when you move
 * a note into one that is not there — you type the name you wanted, and the
 * last row of the list is the offer to create it.
 */
export type HeadingChoice =
	| { kind: "existing"; heading: NoteHeading }
	| { kind: "new"; title: string };

/**
 * Which heading to send a task to.
 *
 * A suggester rather than a submenu: a note with three headings would be fine
 * either way, but one with thirty is a menu you scroll and a list you type two
 * letters into. It is also the control Obsidian uses everywhere else for
 * "choose one of these", so it needs no explaining — and on a phone it comes up
 * with the keyboard already open.
 */
export function pickHeading(
	app: App,
	headings: NoteHeading[],
	/** What a new heading with this name would become. Asked per keystroke. */
	shapeOf: (typed: string) => { level: number; under: string | null },
	/** Whether typing a name that is not there offers to make it. */
	allowNew = true,
): Promise<HeadingChoice | null> {
	return new Promise((resolve) => {
		new HeadingPicker(app, headings, shapeOf, allowNew, resolve).open();
	});
}

/**
 * Where something carried into another note should land there.
 *
 * The default is the first row and needs no typing: **keep the path it already
 * has**. A wedge on the wheel is a heading path, so a task that sat under
 * `Werk › Klanten` belongs under `Werk › Klanten` on the other side, and what is
 * missing of that path is written rather than found. Everything below it is the
 * other note's own headings, for the times you want it somewhere else.
 *
 * A typed name is read as a whole path from the top of the note — `Werk/Klanten`
 * is *Klanten* under *Werk* — because here there is no "the section you are in"
 * to be relative to.
 */
export function pickDestination(
	app: App,
	/** The headings of the note it is going *into*. */
	headings: NoteHeading[],
	/**
	 * The path each travelling block hangs under now, outermost first.
	 *
	 * More than one when a filter is running and a branch is being carried: then
	 * the tasks of the round come from several subsections at once, and *keep*
	 * means each of them keeps its own.
	 */
	sourcePaths: readonly (readonly string[])[],
): Promise<Destination> {
	return new Promise((resolve) => {
		new DestinationPicker(app, headings, sourcePaths, resolve).open();
	});
}

/**
 * What came back, and whether the reader ever got to answer.
 *
 * `shown` looks redundant next to a `null` choice and is not: this is the
 * *second* modal of a chain, and when that chain broke on the desktop it broke
 * by never appearing — which arrives as the same `null` that backing out does.
 * One of those is the reader deciding and the other is a fault, and telling them
 * apart is the difference between a silent give-up and a message that says what
 * went wrong (owner, 17 aug 2026).
 */
export interface Destination {
	shown: boolean;
	choice: HeadingChoice | { kind: "keep" } | null;
}

class DestinationPicker extends FuzzySuggestModal<
	HeadingChoice | { kind: "keep" }
> {
	/** What was picked, handed back only once the modal is really gone. */
	private chosen: HeadingChoice | { kind: "keep" } | null = null;
	private handed = false;
	/** When it opened, so a modal that never really appeared reads as a fault. */
	private openedAt: number | null = null;

	constructor(
		app: App,
		private readonly headings: NoteHeading[],
		private readonly sourcePaths: readonly (readonly string[])[],
		private readonly done: (destination: Destination) => void,
	) {
		super(app);
		this.setPlaceholder("Under which heading?  (Enter keeps the one it has)");
	}

	override onOpen(): void {
		void super.onOpen();
		this.openedAt = Date.now();
	}

	/**
	 * Whether the reader actually got to answer.
	 *
	 * Not simply "did `onOpen` fire": a modal killed by a stack that is still
	 * unwinding opens and closes within the same frame, and its `onOpen` fires
	 * all the same. What separates that from backing out is *time* — a person
	 * cannot see a dialogue and dismiss it inside a tenth of a second, and a
	 * teardown always beats that. The cost of the threshold being wrong is one
	 * misleading sentence, never a lost edit.
	 */
	private wasShown(): boolean {
		return this.openedAt !== null && Date.now() - this.openedAt > 120;
	}

	getItems(): (HeadingChoice | { kind: "keep" })[] {
		return [
			{ kind: "keep" },
			...this.headings.map((heading) => ({
				kind: "existing" as const,
				heading,
			})),
		];
	}

	getItemText(choice: HeadingChoice | { kind: "keep" }): string {
		if (choice.kind === "keep") return this.keepText();
		return choice.kind === "existing"
			? choice.heading.path.join(" › ")
			: choice.title;
	}

	override getSuggestions(
		query: string,
	): FuzzyMatch<HeadingChoice | { kind: "keep" }>[] {
		const found = super.getSuggestions(query);
		const wanted = query.trim();
		if (wanted.length === 0) return found;

		const taken = this.headings.some(
			(heading) => heading.path.join("/").toLowerCase() === wanted.toLowerCase(),
		);
		if (taken) return found;

		return [
			...found,
			{ item: { kind: "new", title: wanted }, match: { score: 0, matches: [] } },
		];
	}

	override renderSuggestion(
		match: FuzzyMatch<HeadingChoice | { kind: "keep" }>,
		el: HTMLElement,
	): void {
		if (match.item.kind === "existing") {
			super.renderSuggestion(match, el);
			el.addClass(`task-wheel-heading-level-${match.item.heading.level}`);
			return;
		}

		el.addClass("task-wheel-heading-new");
		if (match.item.kind === "keep") {
			el.createSpan({ text: this.keepText() });
			return;
		}

		// Said in full: whatever of this path the other note does not have will
		// be written into it, and a reader should know that before it happens.
		el.createSpan({ text: `Make “${splitPath(match.item.title).join(" › ")}”` });
	}

	/** What the default row says — and it has to say what it will do. */
	private keepText(): string {
		const shown = this.sourcePaths.map((path) => path.join(" › "));
		const one = new Set(shown);

		if (one.size > 1) {
			return `Keep the ${one.size} headings they have, making what is missing`;
		}

		const only = shown[0] ?? "";
		return only.length === 0
			? "No heading — at the end of the note"
			: `Keep “${only}”, making it if needed`;
	}

	/** Recorded, not answered — see `hand-back.ts` for why that matters. */
	onChooseItem(choice: HeadingChoice | { kind: "keep" }): void {
		this.chosen = choice;
	}

	override onClose(): void {
		super.onClose();
		if (this.handed) return;
		this.handed = true;
		handBack(
			() => this.done({ shown: this.wasShown(), choice: this.chosen }),
			this.containerEl,
		);
	}
}

class HeadingPicker extends FuzzySuggestModal<HeadingChoice> {
	/** What was picked, handed back only once the modal is really gone. */
	private chosen: HeadingChoice | null = null;
	private handed = false;

	constructor(
		app: App,
		private readonly headings: NoteHeading[],
		private readonly shapeOf: (typed: string) => {
			level: number;
			under: string | null;
		},
		private readonly allowNew: boolean,
		private readonly done: (choice: HeadingChoice | null) => void,
	) {
		super(app);
		this.setPlaceholder(
			headings.length === 0
				? "Type a name to make the first heading"
				: "Move to which heading?  (parent/name makes a new one under it)",
		);
	}

	getItems(): HeadingChoice[] {
		return this.headings.map((heading) => ({ kind: "existing", heading }));
	}

	/**
	 * The whole path, not just the heading's own text.
	 *
	 * Two sections called "Doel" under different parents are a normal thing in a
	 * long note, and picking between them by name alone is guessing. The path is
	 * also what the wheel itself shows on the card, so the two agree.
	 */
	getItemText(choice: HeadingChoice): string {
		return choice.kind === "existing"
			? choice.heading.path.join(" › ")
			: choice.title;
	}

	/**
	 * The offer to make one, last in the list.
	 *
	 * Only when the box holds something no heading already answers to — an exact
	 * name that exists is a heading you meant to pick, not one you meant to make
	 * a second time.
	 */
	override getSuggestions(query: string): FuzzyMatch<HeadingChoice>[] {
		const found = super.getSuggestions(query);
		const wanted = query.trim();
		if (!this.allowNew || wanted.length === 0) return found;

		const taken = this.headings.some(
			(heading) => heading.text.toLowerCase() === wanted.toLowerCase(),
		);
		if (taken) return found;

		return [
			...found,
			{
				item: { kind: "new", title: wanted },
				// Nothing to highlight: this row is not a match, it is an offer.
				match: { score: 0, matches: [] },
			},
		];
	}

	override renderSuggestion(
		match: FuzzyMatch<HeadingChoice>,
		el: HTMLElement,
	): void {
		if (match.item.kind === "existing") {
			super.renderSuggestion(match, el);
			el.addClass(`task-wheel-heading-level-${match.item.heading.level}`);
			return;
		}

		// Said in full, including where it will land and what level it will get:
		// a reader should know what will appear in their note before it does.
		// `org/afdeling 2` reads as "under org", so the row has to say so — the
		// name alone would look as though the slash had been taken literally.
		const shape = this.shapeOf(match.item.title);
		const name = splitPath(match.item.title).pop() ?? match.item.title;

		el.addClass("task-wheel-heading-new");
		el.createSpan({
			text:
				shape.under === null
					? `Make “${name}” · `
					: `Make “${name}” under ${shape.under} · `,
		});
		el.createEl("code", { text: "#".repeat(shape.level) });
	}

	/** Recorded, not answered — see `hand-back.ts` for why that matters. */
	onChooseItem(choice: HeadingChoice): void {
		this.chosen = choice;
	}

	override onClose(): void {
		super.onClose();
		// Escape and the X come through here too, with nothing chosen — and they
		// have to answer all the same, or the caller waits for ever.
		if (this.handed) return;
		this.handed = true;
		handBack(() => this.done(this.chosen), this.containerEl);
	}
}
