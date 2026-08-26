import { App, FuzzySuggestModal } from "obsidian";
import { blockLength } from "../parse/outline-edit";
import { headingsOf } from "../parse/outline";
import { nearestHeadingAbove } from "../parse/sections";
import { plainText } from "../parse/links";
import { parseTaskLine } from "../parse/task-line";
import { handBack } from "./hand-back";

/** A task in the note, as a line to hang something under. */
export interface TaskChoice {
	line: number;
	/** What it says, without its fields. */
	label: string;
	/** The headings above it, outermost first — two tasks often read alike. */
	path: string[];
	/** How deep it is indented, in columns, so the list reads as an outline. */
	depth: number;
}

/**
 * Which task should become the parent.
 *
 * Same note only (owner, 18 aug 2026): a subtask in a different file from its
 * parent is not a subtask, it is two tasks that look related. That also keeps
 * this to one picker — over the whole vault it would need a note picker first,
 * and the move would cost as much as it saves.
 *
 * A suggester rather than a submenu, for the same reason the heading picker is
 * one: a note with thirty tasks is a menu you scroll and a list you type two
 * letters into.
 */
export function pickTask(
	app: App,
	choices: TaskChoice[],
): Promise<TaskChoice | null> {
	return new Promise((resolve) => {
		new TaskPicker(app, choices, resolve).open();
	});
}

/**
 * Every task in the note that could take this one as a child.
 *
 * Not itself, and not anything inside it — hanging a branch under its own
 * descendant would take both of them out of the note. Nor the line directly
 * above it at the depth it would land on: that is where it already is, and
 * offering a move that changes nothing is offering a write for nothing.
 */
export function parentCandidates(
	lines: readonly string[],
	index: number,
): TaskChoice[] {
	const headings = headingsOf(lines);
	const length = blockLength(lines, index);
	const out: TaskChoice[] = [];

	for (let line = 0; line < lines.length; line++) {
		if (line >= index && line < index + length) continue;

		const parsed = parseTaskLine(lines[line] ?? "");
		if (parsed === null) continue;

		out.push({
			line,
			label: plainText(parsed.fields.description),
			path: nearestHeadingAbove(headings, line)?.path ?? [],
			depth: parsed.indent,
		});
	}

	return out;
}

class TaskPicker extends FuzzySuggestModal<TaskChoice> {
	/** What was picked, handed back only once the modal is really gone. */
	private chosen: TaskChoice | null = null;
	private handed = false;

	constructor(
		app: App,
		private readonly choices: TaskChoice[],
		private readonly done: (choice: TaskChoice | null) => void,
	) {
		super(app);
		this.setPlaceholder("Make it a subtask of which task?");
	}

	getItems(): TaskChoice[] {
		return this.choices;
	}

	/**
	 * Indented, and with the heading it sits under.
	 *
	 * Two tasks in one note often read alike — "Bellen", "Mailen" — and the
	 * heading is what tells them apart. The indent is what tells you whether the
	 * one you are about to pick is already a subtask of something else.
	 */
	getItemText(choice: TaskChoice): string {
		const under = choice.path.length === 0 ? "" : `  ·  ${choice.path.join(" › ")}`;
		return `${"    ".repeat(Math.min(3, Math.floor(choice.depth / 4)))}${choice.label}${under}`;
	}

	onChooseItem(choice: TaskChoice): void {
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
