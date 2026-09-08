import { type App, TFile } from "obsidian";
import { setDate, setDone, setPriority, setStatus } from "../parse/edit-line";
import {
	addSubheading,
	addTaskToSection,
	insertTask,
	moveHeading,
	moveHeadingUnder,
	type MoveDirection,
	moveBlock,
	moveToNewSection,
	moveUnderTask,
	moveToSection,
	setText,
} from "../parse/outline-edit";
import { type Extracted, pasteInto, removeBlocks } from "../parse/cross-note";
import { linesOf } from "../parse/lines";
import {
	type LineAnchor,
	reshapeNote,
	spliceLine,
	spliceNote,
} from "../parse/splice";
import { type Priority, TASKS_PLUGIN_ID } from "../model/types";

/**
 * Writing a review action back to the markdown.
 *
 * The only module in the plugin that changes somebody's notes, and it is built
 * to refuse rather than to guess. Two safeguards carry that:
 *
 *  - **Every write is checked against what we read.** The wheel is drawn from
 *    a scan that may be minutes old; the note may have been edited since, by
 *    hand or by sync. So the line is compared with the exact text the wheel is
 *    showing, and a write that does not match is abandoned and reported as
 *    stale. The caller rescans instead — nothing is written blind.
 *  - **One line, one field.** The surgery itself is `parse/edit-line`, which is
 *    pure and heavily tested; this module only decides *whether* to apply it.
 *
 * The read-modify-write runs inside `vault.process`, which Obsidian serialises
 * per file — so two actions in quick succession cannot interleave and lose one
 * another's change.
 */

export type WriteOutcome =
	/** The line was rewritten. */
	| "written"
	/** The note has changed since the scan; the caller should rescan. */
	| "stale"
	/** The reader asked for something the file system cannot carry out. */
	| "refused"
	/** The note is gone. */
	| "missing"
	/** The line already said what we wanted it to say. */
	| "unchanged";

/**
 * Where a task sits, as the wheel remembers it.
 *
 * An anchor with a note attached: the line, and the text that was on it. The
 * text is what makes the write refuse rather than guess.
 */
export interface LineRef extends LineAnchor {
	path: string;
}

export type { LineAnchor };

/** Raise or lower a task's priority. */
export async function writePriority(
	app: App,
	ref: LineRef,
	priority: Priority,
): Promise<WriteOutcome> {
	return rewrite(app, ref, (line) => setPriority(line, priority));
}

/** Move a task's due date, or clear it. */
export async function writeDue(
	app: App,
	ref: LineRef,
	date: string | null,
): Promise<WriteOutcome> {
	return rewrite(app, ref, (line) => setDate(line, "due", date));
}

/**
 * Park a task: set its scheduled date (⏳).
 *
 * This is what *Push a week out* writes since BC_E3_S65. It used to move the
 * due date, which falsified a fact — when something must be done — to record
 * a decision about attention; and the wheel's own "parked for later" lens,
 * which deliberately reads only 🛫/⏳ (kaderdocument §10), then failed to
 * recognise the wheel's own deferrals. The scheduled date is the field that
 * *means* "not before this day", so it is the one an attention decision may
 * write. The due date is never touched.
 */
export async function writeScheduled(
	app: App,
	ref: LineRef,
	date: string | null,
): Promise<WriteOutcome> {
	return rewrite(app, ref, (line) => setDate(line, "scheduled", date));
}

/**
 * Tick a task off.
 *
 * Through the Tasks plugin when it is installed, so a recurring task rolls
 * over into its next occurrence exactly as Tasks would do it — including the
 * completion date its own settings ask for. Tasks may answer with two lines
 * (the finished one and the next), which is why this replaces one line with
 * whatever it hands back rather than assuming a single line comes out.
 *
 * Without the plugin we tick the box ourselves and leave any recurrence alone:
 * rolling a repeat over is Tasks' own logic, and reimplementing it from the
 * outside is exactly the kind of guessing this module is built to avoid.
 */
export async function writeDone(app: App, ref: LineRef): Promise<WriteOutcome> {
	const viaTasks = tasksToggle(app, ref.raw, ref.path);
	if (viaTasks !== null) return replace(app, ref, viaTasks);

	return rewrite(app, ref, (line) => setDone(line, true));
}

/**
 * Set a task's status character to something other than done.
 *
 * Not through the Tasks plugin: its public handle is a *toggle done* command,
 * and there is nothing in it for "start" or "cancel". So this writes the one
 * character and leaves the rest of the line alone, which is what the review
 * actions do everywhere else.
 */
export async function writeStatus(
	app: App,
	ref: LineRef,
	statusChar: string,
): Promise<WriteOutcome> {
	return rewrite(app, ref, (line) => setStatus(line, statusChar));
}

/**
 * Rewrite what a task says, leaving its fields and its place alone.
 *
 * Never through the Tasks plugin, and never near a date: this is the one prose
 * edit the wheel makes, and it is deliberately the smallest possible one.
 */
export async function writeText(
	app: App,
	ref: LineRef,
	text: string,
): Promise<WriteOutcome> {
	return rewrite(app, ref, (line) => setText(line, text));
}

/**
 * Replace the whole line, rather than the words on it.
 *
 * `writeText` above keeps the checkbox and the fields and swaps the
 * description; this one takes a finished line from somewhere else — the Tasks
 * modal — and puts it down as it stands. Same anchor check either way: what is
 * written is only written if the line is still the one we read.
 */
export async function writeLine(
	app: App,
	ref: LineRef,
	text: string,
): Promise<WriteOutcome> {
	return replace(app, ref, text);
}

/**
 * Move a task, with everything under it, to the end of another section.
 *
 * The heading is named by anchor rather than by line number: it was chosen from
 * a picker, and between the choosing and the writing the note may have shifted
 * under it. `moveToSection` asks only whether there is *a* heading on that line,
 * so without this the task would land under whichever heading had moved into
 * its place, silently and with a cheerful notice (audit, 23 aug 2026).
 */
export async function writeMoveTo(
	app: App,
	ref: LineRef,
	heading: LineAnchor,
): Promise<WriteOutcome> {
	return reshape(
		app,
		ref,
		(lines) => moveToSection(lines, ref.line, heading.line),
		[heading],
	);
}

/** Hang a task under another task in the same note, one level deeper. */
export async function writeMoveUnder(
	app: App,
	ref: LineRef,
	parent: LineAnchor,
): Promise<WriteOutcome> {
	return reshape(
		app,
		ref,
		(lines) => moveUnderTask(lines, ref.line, parent.line),
		[parent],
	);
}

/** Make a heading that is not there yet, and move the task under it. */
export async function writeMoveToNew(
	app: App,
	ref: LineRef,
	title: string,
): Promise<WriteOutcome> {
	return reshape(app, ref, (lines) => moveToNewSection(lines, ref.line, title));
}

/** Move a task, with everything under it, past the sibling before or after. */
export async function writeMove(
	app: App,
	ref: LineRef,
	direction: MoveDirection,
): Promise<WriteOutcome> {
	return reshape(app, ref, (lines) => moveBlock(lines, ref.line, direction));
}

/**
 * Add a task beside this one, or a step inside it.
 *
 * Returns where it landed in `outcome` terms only; the caller rescans, and the
 * new line is found again by its text like every other node.
 */
export async function writeInsert(
	app: App,
	ref: LineRef,
	text: string,
	asChild: boolean,
): Promise<WriteOutcome> {
	return (await writeInsertAfter(app, ref, text, asChild)).outcome;
}

/**
 * The same write, saying which line it wrote.
 *
 * That answer is what lets a second task be added straight after the first
 * (BC_E3_S24). A task always goes in after the *whole block* of the line it is
 * given, so handing the same reference in twice would put the second task
 * above the first: the order they were typed in is only preserved by walking
 * the reference along.
 */
export async function writeInsertAfter(
	app: App,
	ref: LineRef,
	text: string,
	asChild: boolean,
): Promise<{ outcome: WriteOutcome; at: LineRef | null }> {
	let at: LineRef | null = null;

	const outcome = await reshape(app, ref, (lines) => {
		const done = insertTask(lines, ref.line, text, asChild);
		if (done === null) return null;
		at = { path: ref.path, line: done.line, raw: done.lines[done.line] ?? "" };
		return done.lines;
	});

	return { outcome, at: outcome === "written" ? at : null };
}

/** What a heading edit asks for. One shape, so the view keeps one path. */
export type SectionEdit =
	| { kind: "move"; line: number; direction: MoveDirection }
	/** The heading it goes under was picked, so it is named by anchor. */
	| { kind: "under"; line: number; target: LineAnchor }
	| { kind: "task"; line: number; text: string }
	| { kind: "sub"; line: number; title: string };

/** Move a heading, or add to what it holds. */
export async function writeSection(
	app: App,
	ref: LineRef,
	edit: SectionEdit,
): Promise<WriteOutcome> {
	return reshape(
		app,
		ref,
		(lines) => {
			switch (edit.kind) {
				case "move":
					return moveHeading(lines, edit.line, edit.direction);
				case "under":
					return moveHeadingUnder(lines, edit.line, edit.target.line);
				case "task":
					return addTaskToSection(lines, edit.line, edit.text);
				case "sub":
					return addSubheading(lines, edit.line, edit.title);
			}
		},
		// Getting this one wrong is the loudest of the family: the whole section
		// is re-levelled to fit the parent it landed under.
		edit.kind === "under" ? [edit.target] : [],
	);
}

/** Copy or move, which differ in one thing: whether the source keeps it. */
export type CarryMode = "copy" | "move";

/** How much travelled, for whichever outcome carries it. */
export interface CarryAmount {
	/** Headings that had to be made in the other note, outermost first. */
	created: string[];
	/** Lines written into the other note. */
	lines: number;
	/** Blocks written, which is what the reader counts as "items". */
	blocks: number;
}

/**
 * What a carry actually did.
 *
 * Three outcomes and not one channel, because they are three different things
 * to tell somebody and squeezing them through a `WriteOutcome` meant the view
 * had to guess. It guessed wrong twice (found by audit, 17 aug 2026): a source
 * that changed while the pickers were open was reported as *"it landed in the
 * other note"* when nothing had been written anywhere, and a failure to empty
 * the source after a successful write was reported as *"nothing was carried"*
 * when the copy was already there. Both sent the reader looking for the wrong
 * thing.
 */
export type CarryOutcome =
	/** Nothing was written anywhere. */
	| { kind: "refused"; why: "stale" | "missing" | "nothing" | "too-deep" }
	/** It is in the other note, and the source was meant to keep it. */
	| ({ kind: "copied" } & CarryAmount)
	/** It is in the other note and gone from this one. */
	| ({ kind: "moved" } & CarryAmount)
	/**
	 * It landed, but the source could not be emptied — so the work is now in two
	 * places. Not a loss, and the reason the target is written first, but the
	 * reader has to be told or they will meet the second copy by surprise.
	 */
	| ({ kind: "twice" } & CarryAmount);

/**
 * Carry a task, or a whole section, into another note.
 *
 * The only write in the plugin that touches two files, so it is the only one
 * that can half-succeed. The order is chosen for that: **the other note is
 * written first, and the source is only emptied once it has landed.** A crash
 * or a refusal in between therefore leaves the work in two places, which the
 * reader can see and fix — the other order would lose it, which they could not.
 *
 * What travels is decided by the caller from the note it read, and then held to
 * that. Every block is compared with the source *before* the other note is
 * touched and again before anything is taken out, and one mismatch abandons the
 * whole carry: a filtered branch lifts blocks from all over a section, and half
 * a move is worse than none. So a subtask added while the pickers were open does
 * **not** travel with it — it makes the carry refuse, and the reader is told to
 * try again. That is the strict reading, and it is the right one for the only
 * two-file write there is.
 */
export async function writeCarry(
	app: App,
	ref: LineRef,
	targetPath: string,
	mode: CarryMode,
	/** Where it lands, or `null` to keep the heading path each block has. */
	headingPath: readonly string[] | null,
	/**
	 * What travels, worked out by the caller from the note it read.
	 *
	 * Several blocks when a filter is running and a whole branch is being
	 * carried: then only the tasks the round is showing travel, and they are
	 * scattered through the section rather than in one run.
	 */
	blocks: readonly Extracted[],
): Promise<CarryOutcome> {
	const source = app.vault.getAbstractFileByPath(ref.path);
	const target = app.vault.getAbstractFileByPath(targetPath);
	if (!(source instanceof TFile) || !(target instanceof TFile)) {
		return { kind: "refused", why: "missing" };
	}
	if (source.path === target.path || blocks.length === 0) {
		return { kind: "refused", why: "nothing" };
	}

	// Read rather than process — nothing changes here, and holding two files open
	// at once is the deadlock that avoids.
	const before = linesOf(await app.vault.read(source));
	if (removeBlocks(before, blocks) === null) {
		return { kind: "refused", why: "stale" };
	}

	// A box rather than plain locals: what the callback writes has to survive the
	// await, and a `let` assigned only inside a closure is a thing the type
	// checker is right to be suspicious of.
	const landing = { created: [] as string[], written: false, tooDeep: false };

	await app.vault.process(target, (current) => {
		const result = reshapeNote(current, (into) => {
			let out = into;
			const made: string[] = [];
			// One at a time and in order, so the second block finds the heading the
			// first one had to write rather than writing it again.
			for (const block of blocks) {
				const pasted = pasteInto(out, headingPath ?? block.path, block);
				// A section that cannot keep its shape where it is going stops the
				// whole carry, not just its own block (BC_E3_S168). Half a carry is
				// the worst of the three outcomes: work in two notes, and a sentence
				// that can only be true about one of them.
				if (pasted.refused !== undefined) {
					landing.tooDeep = true;
					return into;
				}
				out = pasted.lines;
				made.push(...pasted.created);
			}
			landing.created = made;
			return out;
		});
		landing.written = result.outcome === "written";
		return result.data;
	});

	if (landing.tooDeep) return { kind: "refused", why: "too-deep" };
	if (!landing.written) return { kind: "refused", why: "nothing" };

	const amount: CarryAmount = {
		created: landing.created,
		lines: blocks.reduce((sum, block) => sum + block.block.length, 0),
		blocks: blocks.length,
	};

	if (mode === "copy") return { kind: "copied", ...amount };

	// Only now, and only if the source still holds exactly what we carried.
	//
	// A throw here counts as "twice" like any other way the source refuses. It
	// used to travel out of this function, where the caller's catch said *"could
	// not write to <target>"* — naming the file that had in fact been written,
	// about work that now stood in two notes, and skipping the redraw (found by
	// audit, 6 sep 2026). The target is written; from here on the only honest
	// answers are "moved" and "twice".
	let removed: WriteOutcome;
	try {
		removed = await reshape(app, ref, (fresh) => removeBlocks(fresh, blocks));
	} catch (error) {
		console.error("Task wheel: the source of a carry could not be emptied", error);
		removed = "stale";
	}

	return removed === "written"
		? { kind: "moved", ...amount }
		: { kind: "twice", ...amount };
}

/** Whether ticking a task off will go through the Tasks plugin. */
export function togglesThroughTasks(app: App): boolean {
	return api(app) !== null;
}

/**
 * The Tasks plugin's public toggle, if it is there.
 *
 * Wrapped in a try/catch because it is somebody else's code reached through an
 * untyped handle: a plugin update that changes the shape must not take a review
 * action down with it — the fallback below writes the checkbox itself.
 */
function tasksToggle(app: App, line: string, path: string): string | null {
	const toggle = api(app);
	if (toggle === null) return null;

	try {
		const result = toggle(line, path);
		return typeof result === "string" && result.length > 0 ? result : null;
	} catch (error) {
		console.error("Task Wheel: the Tasks plugin refused the toggle", error);
		return null;
	}
}

type ToggleFn = (line: string, path: string) => unknown;
type EditFn = (line: string) => unknown;

/**
 * What we use of the Tasks plugin's public API, as we hope to find it.
 *
 * Every member optional, on purpose: this is a description of somebody else's
 * object, not a contract we can hold them to. `editTaskLineModal` arrived in
 * Tasks 7.21.0, so a perfectly healthy installation may not have it — which is
 * why every accessor below asks whether the function is *there* rather than
 * asking the plugin how old it is. A version string is a promise about a
 * shape; the shape itself is the thing we can actually check.
 */
interface TasksApiV1 {
	executeToggleTaskDoneCommand?: ToggleFn;
	editTaskLineModal?: EditFn;
}

function tasksApi(app: App): TasksApiV1 | null {
	const plugins = (
		app as unknown as {
			plugins?: { plugins?: Record<string, unknown> };
		}
	).plugins?.plugins;

	const tasks = plugins?.[TASKS_PLUGIN_ID] as { apiV1?: TasksApiV1 } | undefined;
	return tasks?.apiV1 ?? null;
}

function api(app: App): ToggleFn | null {
	const found = tasksApi(app);
	const toggle = found?.executeToggleTaskDoneCommand;
	return typeof toggle === "function" ? toggle.bind(found) : null;
}

function editApi(app: App): EditFn | null {
	const found = tasksApi(app);
	const edit = found?.editTaskLineModal;
	return typeof edit === "function" ? edit.bind(found) : null;
}

/** Whether the Tasks plugin offers the modal that edits a whole task line. */
export function editsThroughTasks(app: App): boolean {
	return editApi(app) !== null;
}

/**
 * Open the Tasks plugin's own edit modal on a line, and hand back what it says.
 *
 * The one thing the wheel deliberately does not build. Its own affordances are
 * the reduced set a review needs — tick off, push a week out, raise a priority,
 * rewrite the words — and "no full task editor" is a non-goal we hold to
 * (kaderdocument §10). Borrowing the editor that is already installed costs us
 * no scope, because it is not ours: dates, recurrence, dependencies and the
 * user's own status set all come from the plugin that owns them.
 *
 * Null means "nothing to write": the plugin is not there, the reader cancelled,
 * or the call went wrong. All three end the same way — the note is untouched —
 * so they do not need telling apart at the call site.
 */
export async function editThroughTasks(
	app: App,
	line: string,
): Promise<string | null> {
	const edit = editApi(app);
	if (edit === null) return null;

	try {
		const result = await edit(line);
		return typeof result === "string" && result.trim().length > 0 ? result : null;
	} catch (error) {
		console.error("Task Wheel: the Tasks plugin refused the edit", error);
		return null;
	}
}

/**
 * Rewrite the whole note, if the line we are standing on is still itself.
 *
 * For the edits that move lines about rather than change one: the check is the
 * same, but what comes out is a new note rather than a new line.
 */
async function reshape(
	app: App,
	ref: LineRef,
	edit: (lines: string[]) => string[] | null,
	/** Lines the edit aims at, checked in the same read as the line itself. */
	also: readonly LineAnchor[] = [],
): Promise<WriteOutcome> {
	const file = app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) return "missing";

	let outcome: WriteOutcome = "unchanged";
	await app.vault.process(file, (data) => {
		const result = spliceNote(data, ref.line, ref.raw, edit, also);
		outcome = result.outcome;
		return result.data;
	});

	return outcome;
}

/** Rewrite one line in place, if it still says what we think it says. */
async function rewrite(
	app: App,
	ref: LineRef,
	edit: (line: string) => string,
): Promise<WriteOutcome> {
	return apply(app, ref, (current) => {
		const next = edit(current);
		return next === current ? null : [next];
	});
}

/** Replace one line with one or more lines, as Tasks hands them back. */
async function replace(
	app: App,
	ref: LineRef,
	text: string,
): Promise<WriteOutcome> {
	return apply(app, ref, (current) => {
		const lines = text.split("\n");
		return lines.length === 1 && lines[0] === current ? null : lines;
	});
}

async function apply(
	app: App,
	ref: LineRef,
	edit: (current: string) => string[] | null,
): Promise<WriteOutcome> {
	const file = app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) return "missing";

	let outcome: WriteOutcome = "unchanged";

	// `vault.process` is the atomic read-modify-write: Obsidian serialises it
	// per file, so two actions in quick succession cannot lose one another.
	// What happens *inside* it is pure and lives in `parse/splice`.
	await app.vault.process(file, (data) => {
		const result = spliceLine(data, ref.line, ref.raw, edit);
		outcome = result.outcome;
		return result.data;
	});

	return outcome;
}


/**
 * Set the status property of a note that is itself a task (BC_E3_S132).
 *
 * The counterpart of `writeStatus` one level up: a checkbox has brackets to
 * rewrite, a task document has a front-matter property. `processFrontMatter` is
 * Obsidian's own way in — it parses, hands over the object, and writes the file
 * back — so nothing here has to know how YAML is quoted, and a document with a
 * dozen other properties keeps every one of them.
 *
 * Deliberately no staleness check like the line paths make. There is no line to
 * have moved: the property is found by name, and if the reader changed it in the
 * editor a moment ago, writing the word the card just showed is what they asked
 * for either way.
 */
export async function writeNoteStatus(
	app: App,
	path: string,
	property: string,
	value: string,
): Promise<WriteOutcome> {
	const key = property.trim();
	if (key === "" || value.trim() === "") return "unchanged";

	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return "missing";

	let changed = false;
	await app.fileManager.processFrontMatter(file, (raw: unknown) => {
		// Obsidian hands over a plain object typed `any`; narrowing it here keeps
		// the one property we touch honest and leaves the rest untouched.
		const frontmatter = raw as Record<string, unknown>;
		if (frontmatter[key] === value) return;
		frontmatter[key] = value;
		changed = true;
	});

	return changed ? "written" : "unchanged";
}

/**
 * Rename the note a task document *is*.
 *
 * Through `fileManager.renameFile` rather than `vault.rename`, and that is the
 * whole point: the file manager updates every link that pointed at the old name.
 * Renaming a task from the card must not quietly break the four notes that
 * referred to it.
 *
 * The new name is a title, not a path: it keeps the folder it is in, and
 * anything that cannot live in a file name is refused rather than silently
 * mangled — a slash would move the note somewhere else, and moving is a
 * different act with a different menu entry (BC_E3_S131).
 */
export async function renameNoteTask(
	app: App,
	path: string,
	title: string,
): Promise<WriteOutcome> {
	const wanted = title.trim();
	if (wanted === "") return "unchanged";
	if (/[\\/:*?"<>|#^[\]]/.test(wanted)) return "refused";

	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return "missing";
	if (file.basename === wanted) return "unchanged";

	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	await app.fileManager.renameFile(file, `${folder}${wanted}.md`);
	return "written";
}
