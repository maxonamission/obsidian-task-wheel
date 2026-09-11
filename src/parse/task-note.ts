/**
 * A note that is not a place where tasks live, but one task itself.
 *
 * Some work is too big for a line. It gets its own note, with a body, notes to
 * self, references and a few checkboxes inside it. On the wheel that note was a
 * branch holding tasks — never a task — so the work itself could not be seen,
 * reviewed or counted (eigenaar, 2 sep 2026: *"wel de vraag wat file based
 * tasks zijn"*, besloten 4 sep).
 *
 * The decision, in one line each:
 *
 *  - such a note becomes **one task**, labelled with its title;
 *  - the checkboxes inside it become **its subtasks**;
 *  - everything else stays as it was — the folder still decides the domain and
 *    the note's own tags still count as the task's tags;
 *  - **finding them is all this does.** Making one, editing its front matter or
 *    turning a line into one is a task editor, and that is a non-goal
 *    (kaderdocument §10).
 *
 * ## Why the marker is a setting and not a constant
 *
 * There is no convention to hard-code. A vault with a document standard writes
 * `type: task`. [Operon](https://github.com/hasanyilmaz/operon) writes an
 * `operonId` and a `status`, and then lets the reader **rename those property
 * names**. Any single key we picked would be wrong for most vaults and would
 * break on the vault that renamed it, so the reader names the key and, when it
 * matters, the value.
 *
 * Off by default, and off means nothing changes.
 */

import type { NoteInput, ParseOptions, TaskState } from "../model/types";
import { projectLabel } from "./domain";

/**
 * Whether this note declares itself to be one task.
 *
 * Two readings of the same setting, because there are two conventions in the
 * wild: with a value it is `type: task`, without one it is "this note carries
 * an id, which is what makes it a task at all".
 *
 * The first reading takes a **list**, because one vault can have more than one
 * kind of note that is a piece of work: `task` beside `project`. It used to
 * take a single word, and a reader who wrote two of them separated by a comma
 * got a literal search for `task, project` — no note carries that, so nothing
 * appeared and nothing said why (eigenaar, 11 sep 2026; BC_E3_S189). Matching
 * any one of the words is enough, which is also how the front matter is
 * already read: a note whose own value is a list matches on any entry.
 */
export function isTaskNote(note: NoteInput, options: ParseOptions): boolean {
	const key = options.taskNoteProperty.trim();
	if (key === "") return false;

	const frontmatter = note.frontmatter;
	if (frontmatter === undefined) return false;
	if (!(key in frontmatter)) return false;

	const value = frontmatter[key];
	// Present but empty is not a declaration: a `type:` line with nothing after
	// it is a half-written note, not a task.
	if (value === undefined || value === null || value === "") return false;

	const wanted = options.taskNoteValues
		.map((word) => word.trim())
		.filter((word) => word !== "");
	if (wanted.length === 0) return true;

	return valueMatches(value, wanted);
}

/**
 * What state such a note is in — the counterpart of the brackets on a line.
 *
 * The four words are settings, because every vault spells them differently.
 * Anything the four do not cover reads as **open**, and deliberately so: a vault
 * that also knows `backlog` or `on hold` should keep seeing that work, not lose
 * it to a word the wheel failed to recognise. The same rule a custom checkbox
 * character already follows (`TaskState`).
 */
export function taskNoteState(
	note: NoteInput,
	options: ParseOptions,
): TaskState {
	const key = options.taskNoteDoneProperty.trim();
	if (key === "") return "open";

	const value = note.frontmatter?.[key];
	if (value === undefined || value === null) return "open";

	const extra = options.taskNoteDoneValues
		.map((word) => word.trim())
		.filter((word) => word !== "");

	if (word(options.taskNoteCancelledValue, value)) return "cancelled";
	if (word(options.taskNoteDoneValue, value)) return "done";
	if (word(options.taskNoteDoingValue, value)) return "in-progress";
	// The extra list is about being finished and says nothing finer, so it is
	// read as done — the round treats the two the same anyway.
	if (extra.length > 0 && valueMatches(value, extra)) return "done";

	return "open";
}

/** Whether one configured word matches this front-matter value. */
function word(configured: string, value: unknown): boolean {
	const wanted = configured.trim();
	return wanted !== "" && valueMatches(value, [wanted]);
}

/**
 * Whether such a note is off your plate.
 *
 * Done and cancelled are different things to a person and the same thing to a
 * round, exactly as they are for a checkbox (`isFinished`).
 */
export function isTaskNoteFinished(
	note: NoteInput,
	options: ParseOptions,
): boolean {
	const state = taskNoteState(note, options);
	return state === "done" || state === "cancelled";
}

/**
 * Whether a front-matter value is one of the wanted words.
 *
 * Two things this does beyond an equality test, and both earn their keep:
 *
 *  - **Case is ignored.** `Done` and `done` are the same answer, and no reader
 *    keeps that straight across a year of notes.
 *  - **A wanted word without a dot also matches the part after the last dot.**
 *    Statuses are not always bare words: Operon writes `Project.InProgress`, so
 *    a literal test on `done` would quietly miss every `Project.Done` in the
 *    vault — the note would keep coming back, and the reader would have no way
 *    to see why. Someone who wants the exact value simply writes it out in
 *    full, dot and all, and then it is compared whole.
 *
 * A list is accepted as well as a single value: front matter that reads
 * `status: [done, archived]` is unusual but legal, and answering "no" to it
 * would be an answer about YAML rather than about the task.
 */
function valueMatches(value: unknown, wanted: readonly string[]): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => valueMatches(item, wanted));
	}

	const text = textOf(value);
	if (text === null) return false;

	const lower = text.toLowerCase();
	const tail = lower.slice(lower.lastIndexOf(".") + 1);

	return wanted.some((word) => {
		const want = word.toLowerCase();
		return want.includes(".") ? lower === want : lower === want || tail === want;
	});
}

/** Front-matter scalars, as text. Anything else has no word to compare. */
function textOf(value: unknown): string | null {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return null;
}

/**
 * What to call the task this note is: its title, which is its file name.
 *
 * Deliberately not "the first heading". In Obsidian the file name *is* the
 * note's title — it is what a link carries, what the file list shows and what
 * the reader searches for — and the wheel's every other note ring is already
 * labelled this way (`projectLabel`). A first heading that says something else
 * would make the wheel and the file list disagree about the name of the same
 * thing; and where the heading and the file name *do* say the same, the wheel
 * has already decided the heading is not a ring of its own (BC_E3_S70), so
 * nothing is lost by not reading it here.
 */
export function taskNoteLabel(note: NoteInput): string {
	return projectLabel(note.path);
}
