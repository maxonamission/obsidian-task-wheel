/**
 * Turning parsed notes into the wheel's tree.
 *
 * Hierarchy follows the order of precedence from the build brief (§4):
 * indentation under a parent task beats headings, headings beat the note, and
 * the note sits inside a domain that comes from the folder or a tag.
 *
 * Two properties matter more than anything else here, because the whole
 * concept rests on them:
 *
 *  - **Identity survives edits.** A node's id is built from its position in
 *    the tree and its text, never from a line number. Insert a line above a
 *    task and its id is unchanged, so its seen-flag and collapsed state
 *    survive the rescan.
 *  - **Order is structural.** Siblings are ordered by document position and
 *    path, not by due date. Sorting by deadline would move every task every
 *    night; urgency belongs to the colour channel (§2.1, §2.4).
 */

import {
	hasHeadingPath,
	headingsOf,
	type NoteHeading,
	outlineNote,
	titleHeadingOf,
	type OutlinedTask,
} from "./outline";
import { linesOf } from "./lines";
import {
	isExcluded,
	isExcludedHeading,
	projectLabel,
	resolveWedge,
	type Wedge,
} from "./domain";
import { isFiltering, matches } from "./filter";
import { showsFinishedWork, withinBlikveld } from "./round";
// A note has no brackets, but everything downstream — the badge, the started
// ring, the status filter — reads `state`, and `statusChar` beside it keeps the
// shape of a task whole rather than half-filled. The table itself lives beside
// `stateOf`, its inverse (BC_E3_S172).
import { STATUS_CHAR, TASK_LINE } from "./task-line";
import { isTaskNote, taskNoteLabel, taskNoteState } from "./task-note";
import {
	isFinished,
	isRoundItem,
	type NoteInput,
	type ParseOptions,
	type TaskFields,
	type TaskState,
	type WheelNode,
	type WheelScope,
	type WheelTree,
} from "../model/types";

/** Separator for id segments. Never occurs in note text in practice. */
const SEP = "\u001f";

/** Width the line number is padded to, so string compare equals numeric order. */
const LINE_PAD = 6;

/**
 * A note with its checkboxes already found.
 *
 * The split exists for one reason: **reading a note's outline is the only part
 * of building the wheel that depends on nothing but that note's text.** Which
 * makes it the only part worth keeping between scans — a vault of five thousand
 * notes costs about a tenth of a second to outline, and re-outlining all of it
 * because one note was saved is the bulk of what a rescan wastes (measured
 * 17 aug 2026). `vault/scan` keeps these and hands back the ones it already had.
 */
export interface OutlinedNote {
	note: NoteInput;
	tasks: OutlinedTask[];
}

/** Find the checkboxes in a set of notes, without building anything yet. */
export function outlineNotes(notes: readonly NoteInput[]): OutlinedNote[] {
	return notes.map((note) => ({ note, tasks: outlineNote(note.content) }));
}

/** Build the whole wheel from a set of notes. */
export function buildTree(notes: NoteInput[], options: ParseOptions): WheelTree {
	return buildTreeFrom(outlineNotes(notes), options);
}

/**
 * Build the wheel from notes whose outlines are already in hand.
 *
 * Everything from here on depends on the *options* as well as the text — the
 * skip rules, the filter, the grouping — so none of it can be kept between
 * scans, and none of it is.
 */
export function buildTreeFrom(
	outlinedNotes: readonly OutlinedNote[],
	options: ParseOptions,
): WheelTree {
	const root: WheelNode = node("root", "root", "", 0, "", "");
	const byId = new Map<string, WheelNode>([[root.id, root]]);
	const emptyNotes: string[] = [];
	let filteredOut = 0;
	const showsFinished = showsFinishedWork(options);

	// Notes are visited in a deterministic order so that first-seen wins are
	// reproducible, whatever order the vault hands them to us in.
	const ordered = [...outlinedNotes].sort((a, b) =>
		compare(a.note.path, b.note.path),
	);

	for (const { note, tasks: outlined } of ordered) {
		if (isExcluded(note, options)) continue;

		// A wheel over one heading holds what the heading wedge held, and that
		// wedge never held a task note (BC_E3_S149, herzien BC_E3_S150). A note
		// that is itself a task hangs in one wedge with everything under it —
		// its checkboxes are its subtasks, and the headings between them are its
		// own structure rather than domains of their own (BC_E3_S144). So on the
		// wider wheel that note and its work sit in *its* wedge, not in the ones
		// its inner headings name; stepping into a heading must therefore not
		// hand back work the wedge you tapped did not hold. A boundary like the
		// scope itself, so nothing here is counted as filtered out.
		if (options.scope.kind === "heading" && isTaskNote(note, options)) continue;

		// The document's own outline, on the wheels where the wheel *is* that
		// outline (BC_E3_S85). Before everything else: a note whose every heading
		// is empty is exactly the case this is for, and it must still draw its
		// frame.
		for (const group of outlineGroups(note, options)) {
			ensureContainers(root, byId, note, group, options);
		}

		// Checkboxes under a heading that names a checklist are not work on
		// anybody's plate: they belong to the document. Dropped before anything
		// else looks at them, exactly like an excluded folder — not counted as
		// filtered out, because they were never in the round to begin with.
		const excluded = outlined.filter(
			(task) => !isExcludedHeading(task.headingPath, options),
		);

		// A heading that only repeats the note's name gets no ring of its own
		// (BC_E3_S70). Dropped here, after the skip rules have read the full
		// paths — a rule the reader wrote means the same on every wheel — and
		// before anything else looks at them, so the section scope, the wedges
		// and the rings all see one and the same shape.
		const shaped = withoutTitleHeading(excluded, note);

		// A section wheel is about one subtree of headings: tasks elsewhere in
		// the note are a boundary like the scope itself, never counted as
		// filtered out (BC_E3_S64). A heading wheel is the same idea across
		// notes — everything under that heading, wherever it is written
		// (BC_E3_S146).
		const onTopic =
			options.scope.kind === "section"
				? withinSection(shaped, options.scope.heading)
				: options.scope.kind === "heading"
					? underHeading(shaped, options.scope)
					: shaped;

		const open = selectTasks(onTopic, options);
		const kept = selectFiltered(open, note, options);
		filteredOut +=
			countRoundItems(open, showsFinished) - countRoundItems(kept, showsFinished);

		// A note that says it is itself a task (BC_E3_S130). Decided *here*,
		// after the tasks inside it are known, because the answer depends on
		// them: a document the round leaves out still has to be drawn while open
		// work hangs inside it, or that work would have nothing to hang from.
		const asNoteTask = noteTaskOf(note, options, showsFinished, kept.length > 0);
		if (asNoteTask?.filteredOut === true) filteredOut += 1;
		const asTask = asNoteTask?.task;

		// A task note is work whether or not anybody wrote a checkbox in it, so
		// its node is made before the "nothing here" exit below. Without this a
		// one-line task note — the ordinary case — would be a note with no tasks,
		// and the wheel would drop the very thing it stands for.
		//
		if (asTask !== undefined) {
			ensureContainers(root, byId, note, noteGroup(note, options), options, asTask);
		}

		if (kept.length === 0) {
			if (asTask === undefined) emptyNotes.push(note.path);
			continue;
		}

		// A note that is itself a task hangs in **one** wedge, and everything
		// inside it hangs under it (BC_E3_S144). Its checkboxes cannot be sorted
		// into wedges of their own without cloning their parent into each one:
		// before this, a task note with a "Thuis" and a "Werk" heading drew three
		// copies of itself and counted five items for the three it holds — so the
		// round could only close by landing on the same note three times. The
		// wedge is the one the note itself resolved to, exactly as `noteGroup`
		// read it.
		const onePlace =
			asTask !== undefined && !scopedWheel(options)
				? noteGroup(note, options).wedge
				: undefined;

		// Ranked over the shaped outline, not over what the round kept: ticking a
		// twin off must not renumber the one below it (BC_E3_S166).
		const twins = rankTwins(shaped);

		for (const group of groupTasks(kept, note, options, onePlace)) {
			const container = ensureContainers(
				root,
				byId,
				note,
				group,
				options,
				asTask,
			);
			attachTasks(container, byId, note, group.tasks, twins);
		}
	}

	sortTree(root);
	countTasks(root, showsFinished);

	// "Empty" and "gone" are different answers on a section wheel: the anchor
	// is a path of titles, and a rename quietly takes it away. Checked against
	// the note's own text, not against whether any task survived — a section
	// with zero open tasks is an honestly empty circle, not a missing one.
	const scope = options.scope;
	const sectionMissing =
		scope.kind === "section"
			? !outlinedNotes.some(
					({ note }) =>
						note.path === scope.path &&
						hasHeadingPath(note.path, note.content, scope.heading),
				)
			: undefined;

	const domains = root.children.map((child) => child.label);
	return {
		root,
		domains,
		byId,
		emptyNotes,
		filteredOut,
		showsFinished,
		sectionMissing,
	};
}

/**
 * The same tasks, with a title-repeating top heading taken out of their paths.
 *
 * `titleHeadingOf` decides whether the note has one (see there for why, and for
 * how narrow the test is). All this does is drop that first step from every
 * path that starts with it, keeping the three arrays in step — heading titles,
 * their lines and their raw text are read together everywhere downstream, and a
 * path one shorter than its lines would send an edit at the wrong line.
 *
 * Tasks that sit *above* the heading — front matter aside, a note may open with
 * a checkbox before its first heading — have an empty path and are untouched.
 */
function withoutTitleHeading(
	tasks: OutlinedTask[],
	note: NoteInput,
): OutlinedTask[] {
	if (tasks.length === 0) return tasks;

	const title = titleHeadingOf(note.path, note.content);
	if (title === null) return tasks;

	return tasks.map((task) =>
		task.headingPath[0] === title
			? {
					...task,
					headingPath: task.headingPath.slice(1),
					headingLines: task.headingLines.slice(1),
					headingRaws: task.headingRaws.slice(1),
				}
			: task,
	);
}

/**
 * The tasks whose outermost heading is this one, in whatever note.
 *
 * The mirror of `withinSection`: that one is a subtree of one note, this one is
 * the same name wherever it was written. Matched on the outermost step only,
 * because that is the step the wedge was made of — a deeper heading of the same
 * name belongs to its own branch and says something else.
 *
 * The **scope**, not its name. It used to take the heading and build a fresh
 * scope from it, which was the same thing right up to the moment the scope grew
 * a second field: the loose-work flag was dropped on the way in, so the wheel
 * over the fallback wedge stayed empty after the flag was added to fix exactly
 * that (BC_E3_S157). A value rebuilt from one of its own fields is a second
 * place deciding what a scope is.
 */
function underHeading(
	tasks: readonly OutlinedTask[],
	scope: WheelScope & { kind: "heading" },
): OutlinedTask[] {
	return tasks.filter((task) => withinBlikveld(task.headingPath, scope));
}

/**
 * The tasks that sit under a section's heading path, subheadings included.
 *
 * A plain prefix match on titles: the scope's identity is the full path, and
 * ``headingsOf`` never records empty titles, so element-wise equality is the
 * whole test.
 */
function withinSection(
	tasks: OutlinedTask[],
	heading: readonly string[],
): OutlinedTask[] {
	return tasks.filter((task) =>
		withinBlikveld(task.headingPath, { kind: "section", heading: [...heading], path: "" }),
	);
}

/* ------------------------------------------------------------------ */
/* selection                                                           */
/* ------------------------------------------------------------------ */

/**
 * Drop completed tasks — but never a completed task that still has open work
 * indented under it. Hiding such a parent would orphan its children, and
 * nothing may silently disappear from the wheel (§2.3).
 *
 * Asking for finished work in the filter is asking for it, whatever the setting
 * says (owner, 17 aug 2026). Without this the two rules cancel each other out:
 * the setting drops every finished task before the filter ever sees one, so
 * *finished* selected an empty wheel in a vault full of `[x]`. A control that
 * can only ever return nothing is a broken control, not a strict one.
 */
function selectTasks(tasks: OutlinedTask[], options: ParseOptions): OutlinedTask[] {
	if (showsFinishedWork(options)) return tasks;

	return tasks.filter((task, index) => {
		if (!isFinished(task.fields)) return true;
		return hasOpenDescendant(tasks, index);
	});
}

/**
 * Drop what the filter leaves out — but never a task with kept work under it.
 *
 * Same rule as for completed tasks, for the same reason: hiding a parent would
 * orphan its children, and a task that is only *there* because something below
 * it survived must still be drawn or the tree cannot be walked to it. Those
 * carriers are not counted as filtered out; they are part of what is shown.
 */
function selectFiltered(
	tasks: OutlinedTask[],
	note: NoteInput,
	options: ParseOptions,
): OutlinedTask[] {
	if (!isFiltering(options.filter)) return tasks;

	const wanted = tasks.map((task) =>
		matches(
			task.fields,
			options.filter,
			options.today,
			note.path,
			task.headingPath,
		),
	);

	return tasks.filter((task, index) => {
		if (wanted[index]) return true;

		const section = task.headingPath.join("");
		for (let i = index + 1; i < tasks.length; i++) {
			// Indentation only counts inside one section, exactly as in
			// `hasOpenDescendant` below: a deeper-indented task under the next
			// heading is not a child of the last task under this one, and reading
			// it as one kept a filtered-out task on the wheel as a carrier for
			// work that is not below it (found by audit, 6 sep 2026).
			if (tasks[i].headingPath.join("") !== section) break;
			if (tasks[i].indent <= task.indent) break;
			if (wanted[i]) return true;
		}
		return false;
	});
}

/**
 * Items of the round in a list — what the filter's count is about.
 *
 * The same meaning as `shownTaskCount` and for the same reason, which is why it
 * takes the same flag. Leaving it as "not ticked off" made the badge on the
 * filter panel say `0 out` while a filter quietly removed work from a round
 * that held finished tasks: the round would have shown five, the filter left
 * two out, and the panel reported none. That is the silent hiding §3.3 forbids,
 * and it survived because the tests only covered the direction where the old
 * meaning happened to give the right answer (found by audit, 17 aug 2026).
 */
function countRoundItems(
	tasks: OutlinedTask[],
	showsFinished: boolean,
): number {
	// Through `isRoundItem` rather than beside it (BC_E3_S172). The rule was
	// written out a second time here and the two happened to agree; a rule that
	// happens to agree is the state every drift in this repo started from. An
	// outlined task is a task by construction, which is the one thing
	// `isRoundItem` asks that this list cannot answer for itself.
	return tasks.filter((task) =>
		isRoundItem({ kind: "task", fields: task.fields }, showsFinished),
	).length;
}

/**
 * Whether open work is nested under this task.
 *
 * Indentation only counts inside one section. A task under the next heading
 * that happens to be indented deeper is not a child of the last task under the
 * previous one — grouping by heading already keeps the two apart when the tree
 * is built (`groupTasks`), and reading them as parent and child here would keep
 * a completed task on the wheel as a carrier for work that is not below it.
 */
function hasOpenDescendant(tasks: OutlinedTask[], index: number): boolean {
	const parent = tasks[index];
	const section = parent.headingPath.join("");

	for (let i = index + 1; i < tasks.length; i++) {
		const candidate = tasks[i];
		if (candidate.headingPath.join("") !== section) return false;
		if (candidate.indent <= parent.indent) return false;
		if (!isFinished(candidate.fields)) return true;
	}
	return false;
}

/* ------------------------------------------------------------------ */
/* grouping                                                            */
/* ------------------------------------------------------------------ */

interface TaskGroup {
	/** The wedge this group hangs in: its name, its key and what it stands for. */
	wedge: Wedge;
	domain: string;
	headingPath: string[];
	/** Where each of those headings sits, so a heading node can be edited. */
	headingLines: number[];
	/** And what each of them read, so an edit can tell it is still that one. */
	headingRaws: string[];
	/** First line the group appears on; orders sibling groups deterministically. */
	firstLine: number;
	tasks: OutlinedTask[];
}

/** A note standing as one task: what to call it, and what it says about itself. */
interface NoteTask {
	label: string;
	fields: TaskFields;
}

/**
 * Whether this note stands on the wheel as a task, and what it then reads as.
 *
 * Three ways a marked note is *not* drawn as a task, and each of them is a
 * decision rather than an omission:
 *
 *  - **On a wheel over that very note.** There the wheel already *is* the note
 *    and its headings are the wedges (kaderdocument §4.1); a task in the middle
 *    standing for the whole thing would be the wheel inside itself.
 *  - **When it is finished** and the round is not about finished work. It falls
 *    back to being a plain note, so any checkbox still open inside it stays
 *    visible. Dropping the note whole would hide open work, and nothing may go
 *    quiet (§2.3).
 *  - **When the filter leaves it out.** Same fallback, and counted as filtered
 *    out — the tasks inside it are judged on their own, exactly as they were
 *    before this note ever claimed to be one.
 */
function noteTaskOf(
	note: NoteInput,
	options: ParseOptions,
	showsFinished: boolean,
	carries: boolean,
): { task?: NoteTask; filteredOut: boolean } | undefined {
	if (!isTaskNote(note, options)) return undefined;
	if (options.scope.kind === "note" || options.scope.kind === "section") {
		return undefined;
	}

	const label = taskNoteLabel(note);
	const state = taskNoteState(note, options);
	const fields = noteFields(note, label, state);
	const task: NoteTask = { label, fields };

	// Both cases below are the **carrier** rule the tasks one level down already
	// follow (`selectTasks`, `selectFiltered`): a parent the round is not about
	// stays on the wheel while work it holds is, because hiding it would leave
	// that work with nothing to hang from — and a carrier is *shown*, so it is
	// not counted as left out either.
	//
	// It used to fall back to being a plain note ring instead, which was wrong
	// twice over: the document stayed on screen under the same name while the
	// badge said one item had been filtered away, and a node quietly changed
	// kind because of a filter (eigenaar, 4 sep 2026).

	// Finished work is not part of an ordinary round. `isRoundItem` reads that
	// off the state, so a finished carrier costs the count nothing.
	if ((state === "done" || state === "cancelled") && !showsFinished) {
		return carries ? { task, filteredOut: false } : { filteredOut: false };
	}

	if (
		isFiltering(options.filter) &&
		!matches(fields, options.filter, options.today, note.path)
	) {
		return carries ? { task, filteredOut: false } : { filteredOut: true };
	}

	return { task, filteredOut: false };
}

/**
 * What a task note says about itself, in the shape every task is read in.
 *
 * Real fields, so the filter, the colour ramp and the status badge need no
 * special case — its tags are the note's own front-matter tags, which is what
 * "tags op documentniveau" was decided to mean (eigenaar, 4 sep 2026).
 *
 * `raw` is empty, and that is the one place this shape differs from a checkbox:
 * there is no line to quote. Nothing writes through it — `source.raw` is `null`
 * on this node, which is the wheel's existing signal for "stands for a whole
 * note", and the write paths test that.
 */
function noteFields(
	note: NoteInput,
	label: string,
	state: TaskState,
): TaskFields {
	return {
		statusChar: STATUS_CHAR[state],
		done: state === "done",
		state,
		dependsOn: [],
		priority: "normal",
		tags: note.frontmatterTags ?? [],
		description: label,
		raw: "",
	};
}

/**
 * The note itself as a group with nothing in it, so its node gets made.
 *
 * The same shape `groupTasks` builds, minus the tasks: one wedge, no heading
 * path. Its wedge is resolved from the note rather than from a task, which is
 * what makes the folder — or the tag, or the property — decide where a task
 * note hangs, exactly as it decides for every checkbox inside it.
 */
function noteGroup(note: NoteInput, options: ParseOptions): TaskGroup {
	const wedge = resolveWedge(
		{
			notePath: note.path,
			frontmatterTags: note.frontmatterTags ?? [],
			taskTags: [],
			frontmatter: note.frontmatter,
		},
		options,
	);

	return {
		wedge,
		domain: wedge.label,
		headingPath: [],
		headingLines: [],
		headingRaws: [],
		firstLine: 0,
		tasks: [],
	};
}

/**
 * The note's own headings, as groups with no tasks in them (BC_E3_S85).
 *
 * On a wheel over one note or one section the wheel does not *show* an outline,
 * it **is** the outline — "kopjes zijn de wiggen, inspringing is de diepte"
 * (kaderdocument §4.2). But the wheel only ever met a heading as the ancestor
 * of a task, so a heading with no open work under it did not exist at all: the
 * owner's CRM note has seven phases and drew four wedges, and phases 3, 4 and 5
 * were not empty on the drawing — they were absent (29 aug 2026).
 *
 * For a pipeline that is a misreading. "Fase 3 is empty" is the finding, and a
 * review instrument that cannot tell *empty* from *absent* cannot make it. So
 * the frame comes from the document, and the work is drawn into it.
 *
 * Two things this deliberately does not do:
 *
 *  - **Nothing outside a note or section wheel.** A wedge there is a folder, a
 *    tag or a property value, and none of those is a written frame — the empty
 *    folders of a whole vault would be noise, not a finding.
 *  - **Nothing a skip rule has taken out.** The reader has already said that
 *    heading is not work (`accepta*` and the like); giving it a wedge anyway
 *    would make one rule mean two things on two wheels (eigenaarsbesluit
 *    29 aug 2026).
 *
 * The groups are empty by construction, so the round is untouched: no task, no
 * stop, and the hub still counts what it always counted.
 */
function outlineGroups(note: NoteInput, options: ParseOptions): TaskGroup[] {
	const scope = options.scope;
	if (scope.kind !== "note" && scope.kind !== "section") return [];
	if (note.path !== scope.path) return [];

	const base = sectionDepth(options);
	const title = titleHeadingOf(note.path, note.content);
	const lines = linesOf(note.content);
	const groups: TaskGroup[] = [];

	for (const found of headingsOf(lines)) {
		// The wheel's own reading of the path: a heading that merely repeats the
		// note's name gets no ring, so it is no step (BC_E3_S70).
		const path = title !== null && found.path[0] === title
			? found.path.slice(1)
			: found.path;
		if (path.length <= base) continue;

		// A section wheel is about one subtree: everything else in the note is a
		// boundary, exactly as it is for the tasks (BC_E3_S64).
		if (scope.kind === "section") {
			const within = scope.heading.every((step, at) => path[at] === step);
			if (!within) continue;
		}

		// The **full** path, title heading and all — the same reading the tasks
		// get, and the same one the skip report gives (BC_E3_S167). It used to
		// test the stripped path, which mattered for exactly one case and got it
		// wrong: a note whose own title matches a rule. Measured, a note titled
		// *Acceptatiecriteria* under a rule `*criteria` drew nothing on the vault
		// wheel and two empty wedges on its own — the same note, two answers.
		//
		// Stripping the title is a *drawing* decision (BC_E3_S70): a heading that
		// repeats the note's name costs a ring and says nothing. A skip rule is
		// the reader saying what is not work, and a note called *Acceptance
		// criteria* is a checklist however the wheel chooses to draw it.
		if (isExcludedHeading(found.path, options)) continue;

		const wedge = headingWedge(path[base], base + 1);
		groups.push({
			wedge,
			domain: wedge.label,
			headingPath: path,
			// The line each step of this path sits on. `headingsOf` gives the
			// path but not its lines, so they are read back off the heading's own
			// ancestors — which is what `ensureContainers` needs to make a
			// heading editable.
			headingLines: linesFor(lines, found, path.length),
			headingRaws: path.map((_, at) =>
				at === path.length - 1 ? lines[found.line] ?? "" : "",
			),
			firstLine: found.line,
			tasks: [],
		});
	}

	return groups;
}

/**
 * Where each step of a heading's path sits, innermost step last.
 *
 * Walked back from the heading itself: its own line is known, and each ancestor
 * is the nearest heading above it at a shallower level. Steps that cannot be
 * placed read -1, which is what `ensureContainers` already treats as "no line
 * to edit".
 */
function linesFor(
	lines: readonly string[],
	found: NoteHeading,
	steps: number,
): number[] {
	const at = new Array<number>(steps).fill(-1);
	if (steps > 0) at[steps - 1] = found.line;

	let level = found.level;
	let step = steps - 2;
	for (let index = found.line - 1; index >= 0 && step >= 0; index--) {
		const match = /^(#{1,6})[ \t]+\S/.exec(lines[index]);
		if (match === null) continue;
		if (match[1].length >= level) continue;
		level = match[1].length;
		at[step] = index;
		step -= 1;
	}

	return at;
}

/**
 * Split a note's tasks into groups that share a domain and a heading path.
 *
 * Grouping by heading before nesting by indentation keeps the two signals from
 * fighting: a task never becomes the child of a task under a different
 * heading, however deeply it happens to be indented.
 */
function groupTasks(
	tasks: OutlinedTask[],
	note: NoteInput,
	options: ParseOptions,
	/** One wedge for the whole note, when the note is itself a task. */
	fixed?: Wedge,
): TaskGroup[] {
	const groups = new Map<string, TaskGroup>();

	const base = sectionDepth(options);

	for (const task of tasks) {
		// A wheel over one note has no folders left to spread over the circle,
		// so its own headings become the angular axis (kaderdocument §4.1). A
		// wheel over one section starts that axis one path deeper: its
		// subheadings are the wedges (BC_E3_S64).
		const wedge: Wedge =
			fixed ??
			(options.scope.kind === "note" || options.scope.kind === "section"
				? headingWedge(task.headingPath[base] ?? options.fallbackDomain, base + 1)
				: resolveWedge(
						{
							notePath: note.path,
							frontmatterTags: note.frontmatterTags ?? [],
							taskTags: task.fields.tags,
							frontmatter: note.frontmatter,
							headingPath: task.headingPath,
						},
						options,
					));
		const headingPath = options.useHeadingsAsGroups ? task.headingPath : [];
		const headingLines = options.useHeadingsAsGroups ? task.headingLines : [];
		const headingRaws = options.useHeadingsAsGroups ? task.headingRaws : [];
		const key = `${wedge.key}${SEP}${headingPath.join(SEP)}`;


		const existing = groups.get(key);
		if (existing === undefined) {
			groups.set(key, {
				wedge,
				domain: wedge.label,
				headingPath,
				headingLines,
				headingRaws,
				firstLine: task.line,
				tasks: [task],
			});
		} else {
			existing.tasks.push(task);
		}
	}

	return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/* containers: domain → project → heading groups                       */
/* ------------------------------------------------------------------ */

function ensureContainers(
	root: WheelNode,
	byId: Map<string, WheelNode>,
	note: NoteInput,
	group: TaskGroup,
	options: ParseOptions,
	asTask?: NoteTask,
): WheelNode {
	// A wheel over one note is already inside that note: a project ring would
	// be one node with everything under it, a wasted ring on the smallest wheel
	// there is. Its first heading became the domain, so the groups start after
	// it. A section wheel is the same shape, one path deeper: the heading at
	// `base` became the domain, and the groups start after that (BC_E3_S64).
	const scoped =
		options.scope.kind === "note" || options.scope.kind === "section";
	const base = sectionDepth(options);

	const domain = ensureChild(byId, root, {
		// A wedge that *is* a note says so, because a whole note is carried, moved
		// and counted differently from a folder — and a wedge that lied about that
		// would carry one block out of the note instead of the note. When that
		// note is itself a task, the wedge is that task (BC_E3_S130).
		kind: group.wedge.note ? (asTask === undefined ? "project" : "task") : "domain",
		key: group.wedge.key,
		label: group.wedge.note && asTask !== undefined ? asTask.label : group.domain,
		domain: group.domain,
		// Folders and tags sort by name — that is what keeps a wedge in the same
		// place year after year. A note's own headings sort by where they are in
		// the note instead: there the wedge order *is* the document order, and
		// sorting those alphabetically would mean moving a heading in the note
		// changed nothing on the wheel.
		sortKey: scoped ? padLine(group.firstLine) : sortableText(group.domain),
	});

	// A note standing as its own wedge carries the note, from its first line —
	// exactly what the note ring would have carried had there been one.
	if (group.wedge.note) {
		// A whole note, not one line: there is nothing on line 0 to hold it to.
		domain.source ??= {
			path: note.path,
			line: 0,
			indent: 0,
			headingPath: [],
			raw: null,
		};
		if (asTask !== undefined) domain.fields ??= asTask.fields;
	}

	// The top heading of a note is a wedge rather than a ring, but it is still a
	// heading — so it carries the line it sits on, and can be moved and added to
	// like any other (found by the owner, 15 aug 2026). Only in a note wheel: a
	// wedge elsewhere is a folder or a tag, and neither is a line in a file.
	// The paths in these sources stay absolute whatever the wheel's scope —
	// they aim edits at lines in the real note, and they are what a section
	// scope is built from when a wedge is opened as a wheel of its own.
	if (
		scoped &&
		group.headingLines[base] !== undefined &&
		group.headingLines[base] >= 0
	) {
		domain.source ??= {
			path: note.path,
			line: group.headingLines[base],
			indent: 0,
			headingPath: group.headingPath.slice(0, base),
			raw: group.headingRaws[base] ?? null,
		};
	}

	let parent = domain;
	if (!scoped && !group.wedge.note) {
		// The note's own ring — or, when the note declares itself a task, that
		// task. Same node, same place, same id: what changes is that it is now
		// something to review rather than somewhere reviewing happens, so it
		// counts, colours and can be swept like any other task (BC_E3_S130).
		parent = ensureChild(byId, domain, {
			kind: asTask === undefined ? "project" : "task",
			key: `p:${note.path}`,
			label: asTask === undefined ? projectLabel(note.path) : asTask.label,
			domain: group.domain,
			sortKey: sortableText(note.path),
		});
		parent.source ??= {
			path: note.path,
			line: 0,
			indent: 0,
			headingPath: [],
			raw: null,
		};
		if (asTask !== undefined) parent.fields ??= asTask.fields;
	}

	if (!options.useHeadingsAsGroups) return parent;

	// Where the heading rings start: exactly where the wedge stopped. Drawing a
	// heading twice — once as the wedge, once as the ring right under it — would
	// be a ring that says what the wedge already said, and skipping one that
	// never became a wedge loses it altogether (BC_E3_S143, BC_E3_S144). The
	// wedge carries the number so the two cannot be derived apart.
	const from = group.wedge.headingSteps;
	for (let i = from; i < group.headingPath.length; i++) {
		const heading = group.headingPath[i];
		parent = ensureChild(byId, parent, {
			kind: "group",
			key: `h:${heading}`,
			label: heading,
			domain: group.domain,
			sortKey: padLine(group.firstLine),
		});

		// The line the heading itself is on, so the wheel can offer to move it,
		// add to it, or hang a new section under it. Set once: the first task
		// that reaches this heading names it, and every later one agrees.
		const line = group.headingLines[i] ?? -1;
		if (line >= 0) {
			parent.source ??= {
				path: note.path,
				line,
				indent: 0,
				headingPath: group.headingPath.slice(0, i),
				raw: group.headingRaws[i] ?? null,
			};
		}
	}

	return parent;
}

interface ChildSpec {
	kind: WheelNode["kind"];
	key: string;
	label: string;
	domain: string;
	sortKey: string;
}

function ensureChild(
	byId: Map<string, WheelNode>,
	parent: WheelNode,
	spec: ChildSpec,
): WheelNode {
	const id = `${parent.id}${SEP}${sanitise(spec.key)}`;
	const existing = byId.get(id);
	if (existing !== undefined) return existing;

	const created = node(
		id,
		spec.kind,
		spec.label,
		parent.depth + 1,
		spec.domain,
		spec.sortKey,
	);
	parent.children.push(created);
	byId.set(id, created);
	return created;
}

/* ------------------------------------------------------------------ */
/* tasks: nesting by indentation                                       */
/* ------------------------------------------------------------------ */

/**
 * Which of the identical siblings this one is, counted over the whole note.
 *
 * Two tasks can carry the same text, and the id has to tell them apart. It used
 * to do that by counting the nodes already *made*, which is a number that moves:
 * tick the first of two `- [ ] Bellen` off and the second stops being `#2` and
 * becomes the plain id the first one had — inheriting its seen mark, so a round
 * could close over a task that was never under the reading wedge (found by
 * audit, 6 sep 2026).
 *
 * Counted over the note's shaped outline instead, which still holds the
 * finished and the filtered-out: what the round is about changes as the reader
 * works, what the note *contains* does not. `model/carry.ts` documents that
 * which of two twins is which is arbitrary; that stays true, and the count
 * stops being wrong.
 *
 * The key is structural (§3.2): the headings above, the indent, and the label.
 * It can group two tasks that would not have collided anyway — same depth, same
 * words, different parent task — and then hands one of them a `#2` it did not
 * need. Harmless: the id is still stable and still unique, which is all it has
 * to be.
 */
function rankTwins(tasks: readonly OutlinedTask[]): Map<OutlinedTask, number> {
	const seen = new Map<string, number>();
	const rank = new Map<OutlinedTask, number>();

	for (const task of tasks) {
		const key = [
			task.headingPath.join(SEP),
			task.indent,
			sanitise(sortableText(labelFor(task))),
		].join(SEP);

		const nth = seen.get(key) ?? 0;
		rank.set(task, nth);
		seen.set(key, nth + 1);
	}

	return rank;
}

function attachTasks(
	container: WheelNode,
	byId: Map<string, WheelNode>,
	note: NoteInput,
	tasks: OutlinedTask[],
	twins: Map<OutlinedTask, number>,
): void {
	/** Open ancestors, outermost first, with the indent each was found at. */
	const stack: Array<{ indent: number; node: WheelNode }> = [];

	for (const task of tasks) {
		while (stack.length > 0 && task.indent <= stack[stack.length - 1].indent) {
			stack.pop();
		}
		const parent = stack.length > 0 ? stack[stack.length - 1].node : container;
		const created = createTask(byId, parent, note, task, twins.get(task) ?? 0);
		stack.push({ indent: task.indent, node: created });
	}
}

/**
 * What to call a task whose description is empty.
 *
 * The description is what is left after the tags and the fields are taken out,
 * so a line like `- [ ] #werk 📅 2026-08-20` has none — and the wheel used to
 * label it "(no description)", which tells the reader nothing and looks like a
 * fault in the plugin. The line itself always says *something*, so fall back to
 * what it actually says before falling back to an apology.
 */
function labelFor(task: OutlinedTask): string {
	if (task.fields.description.length > 0) return task.fields.description;

	const body = (TASK_LINE.exec(task.fields.raw)?.[3] ?? "").trim();
	return body.length > 0 ? body : "(empty task)";
}

function createTask(
	byId: Map<string, WheelNode>,
	parent: WheelNode,
	note: NoteInput,
	task: OutlinedTask,
	twin: number,
): WheelNode {
	const label = labelFor(task);
	const base = `${parent.id}${SEP}t:${sanitise(sortableText(label))}`;

	// Two siblings can carry the same text. Disambiguated by which of them this
	// is in the note, counted before the round narrowed anything down — see
	// `rankTwins` for why that number has to come from outside this loop.
	let id = twin === 0 ? base : `${base}#${twin + 1}`;

	// A collision the ranking did not foresee would otherwise overwrite a node
	// in `byId` and lose it from the wheel, so the old counter stays as a floor
	// under it. It should never run.
	let occurrence = twin + 2;
	while (byId.has(id)) {
		id = `${base}#${occurrence}`;
		occurrence += 1;
	}

	const created = node(
		id,
		"task",
		label,
		parent.depth + 1,
		parent.domain,
		padLine(task.line),
	);
	created.source = {
		path: note.path,
		line: task.line,
		indent: task.indent,
		headingPath: task.headingPath,
		raw: task.fields.raw,
	};
	created.fields = task.fields;

	parent.children.push(created);
	byId.set(id, created);
	return created;
}

/* ------------------------------------------------------------------ */
/* finishing passes                                                    */
/* ------------------------------------------------------------------ */

/** Sort every sibling list by its stable key, then by id as a tiebreaker. */
function sortTree(current: WheelNode): void {
	current.children.sort(
		(a, b) => compare(a.sortKey, b.sortKey) || compare(a.id, b.id),
	);
	for (const child of current.children) sortTree(child);
}

/**
 * Roll task counts up from the leaves. Returns this node's totals.
 *
 * `shownTaskCount` is what every count on the wheel is drawn from: the hub, the
 * number on a stump, the remainder, and whether there is anything to review at
 * all. It means *items this round is about*, which is not the same as "not
 * ticked off". With finished work in play a finished task is one of those
 * items; without it, the only finished tasks left on the tree are carriers for
 * open work below them, and counting a carrier would count a scaffold as work.
 */
function countTasks(
	current: WheelNode,
	showsFinished: boolean,
): { open: number; total: number } {
	let open = 0;
	let total = 0;

	if (current.kind === "task") {
		total += 1;
		if (isRoundItem(current, showsFinished)) open += 1;
	}

	for (const child of current.children) {
		const counts = countTasks(child, showsFinished);
		open += counts.open;
		total += counts.total;
	}

	current.shownTaskCount = open;
	current.totalTaskCount = total;
	return { open, total };
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function node(
	id: string,
	kind: WheelNode["kind"],
	label: string,
	depth: number,
	domain: string,
	sortKey: string,
): WheelNode {
	return {
		id,
		kind,
		label,
		depth,
		domain,
		sortKey,
		children: [],
		shownTaskCount: 0,
		totalTaskCount: 0,
	};
}

/**
 * Plain code-unit comparison rather than `localeCompare`.
 *
 * `localeCompare` depends on the ICU data of the host, which differs between
 * a desktop Electron build, a mobile WebView and the test runner. Ordering has
 * to be reproducible everywhere, so we accept a slightly less human sort.
 */
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sortableText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function padLine(line: number): string {
	return String(line).padStart(LINE_PAD, "0");
}

function sanitise(text: string): string {
	return text.split(SEP).join(" ");
}

/**
 * A wedge that is one of a note's own headings — the note wheel's angular axis.
 *
 * `steps` is how much of the heading path it ate, so the rings under it start
 * where it stopped and can never be worked out differently (BC_E3_S144).
 */
function headingWedge(heading: string, steps: number): Wedge {
	return { label: heading, key: `d:${heading}`, note: false, headingSteps: steps };
}

/**
 * How many heading-path steps the scope itself already spends.
 *
 * Zero everywhere except on a section wheel, where the wedges start below the
 * section's own heading. Kept as one function so the wedge choice and the
 * ring start can never disagree about where "below" begins.
 */
/** Whether the wheel is already inside one note — then there is no note ring. */
function scopedWheel(options: ParseOptions): boolean {
	return options.scope.kind === "note" || options.scope.kind === "section";
}

function sectionDepth(options: ParseOptions): number {
	return options.scope.kind === "section" ? options.scope.heading.length : 0;
}
