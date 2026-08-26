/**
 * Changing the *outline* of a note: what a task says, where it sits, what
 * follows it.
 *
 * The wheel's rule for the vault is that it reviews and does not edit. Inside a
 * wheel over one note that rule loses its footing, because there the wheel is
 * not a view *of* an outline — it is the outline: headings are the wedges,
 * indentation is the depth. So one line is drawn instead:
 *
 *   **structure in the wheel, prose in the note.**
 *
 * Position and order are structure, and the wheel shows them better than the
 * editor does. Renaming is the single deliberate exception: a typo is too small
 * a thing to open a tab for (kaderdocument §4.2).
 *
 * Everything here is pure text in, pure text out. The whole note comes in as a
 * `string[]` of lines without their endings — `vault/writeback` takes the
 * endings off and puts them back, so a CRLF note travels through untouched.
 *
 * A move carries the task's **block**: itself plus everything indented under
 * it, checkbox or not. A note that reads
 *
 *     - [ ] Bellen
 *         some note about the call
 *         - [ ] Nummer opzoeken
 *     - [ ] Mailen
 *
 * has to move all three lines or none, or the prose ends up under the wrong
 * task and a subtask is orphaned.
 */

import { headingsOf, type NoteHeading } from "./outline";
import {
	baseIndent,
	fold,
	nearestHeadingAbove,
	ownBody,
	separatesHeadings,
	subLevel,
} from "./sections";
import { findSignifiers, indentWidth, TASK_LINE } from "./task-line";

/** What a line looks like when there is nothing to move it past. */
export type MoveDirection = "up" | "down";

/**
 * How far a task's block reaches.
 *
 * From the task's own line to the last line indented deeper than it. A blank
 * line inside the block belongs to it; a blank line that trails the block does
 * not, or every move would drag a growing tail of empty lines around.
 */
export function blockLength(lines: readonly string[], index: number): number {
	const start = indentOf(lines[index]);
	if (start === null) return 1;

	let end = index + 1;
	let lastFilled = index;

	while (end < lines.length) {
		const line = lines[end];
		if (line.trim().length === 0) {
			end += 1;
			continue;
		}

		const indent = indentWidth(leadingSpace(line));
		if (indent <= start) break;

		end += 1;
		lastFilled = end - 1;
	}

	return lastFilled - index + 1;
}

/**
 * Swap a task's block with the sibling block before or after it.
 *
 * Siblings only: a task never moves out of the list it is in, or under a
 * different heading, because that is a different operation and the reader did
 * not ask for it. Returns `null` when there is nothing to swap with, which is
 * how the caller knows to say "already at the top" rather than write.
 */
export function moveBlock(
	lines: readonly string[],
	index: number,
	direction: MoveDirection,
): string[] | null {
	const indent = indentOf(lines[index]);
	if (indent === null) return null;

	const length = blockLength(lines, index);

	// Both directions are the same operation on two adjacent sibling blocks, so
	// they are worked out as one. They used to be written separately and had
	// drifted apart: down refused over a blank line between two tasks — with the
	// untrue "already at the end of its list" — while up stepped over it and
	// carried the blank to the end, moving a separator a heading below relied on
	// (found by audit, 17 aug 2026).
	const pair =
		direction === "down"
			? pairWith(lines, index, length, nextSibling(lines, index + length, indent))
			: pairWith(lines, previousSibling(lines, index, indent), null, index);

	if (pair === null) return null;

	// Whatever lies between the two — blank lines, and only blank lines — stays
	// between them. A list written airy stays airy and the gap does not travel.
	const { first, firstEnd, second, secondEnd } = pair;
	return [
		...lines.slice(0, first),
		...lines.slice(second, secondEnd),
		...lines.slice(firstEnd, second),
		...lines.slice(first, firstEnd),
		...lines.slice(secondEnd),
	];
}

/** Why a move was refused, so the wheel can say the true thing about it. */
export type MoveRefusal =
	/** The only item in its list — nothing to swap with, either way. */
	| "alone"
	/** There is something below it, but nothing above. */
	| "first"
	/** There is something above it, but nothing below. */
	| "last"
	/** Not a task line at all; the caller is standing somewhere odd. */
	| "not-a-task";

/**
 * Why `moveBlock` said no.
 *
 * Worked out separately rather than returned by the move itself, because it is
 * only ever wanted on a refusal and the move is on the hot path. The reason it
 * exists at all: one message did for every refusal — *"nothing to move past —
 * it is already at the end of its list"* — which is untrue when you asked to go
 * up, and doubly untrue for the only task under a heading, where "its list"
 * has one item and the real answer is a different operation (owner, 18 aug
 * 2026, on a branch holding a single task).
 */
export function whyNotMoved(
	lines: readonly string[],
	index: number,
	direction: MoveDirection,
): MoveRefusal {
	const indent = indentOf(lines[index]);
	if (indent === null) return "not-a-task";

	const before = previousSibling(lines, index, indent);
	const after = nextSibling(lines, index + blockLength(lines, index), indent);

	if (before === null && after === null) return "alone";
	if (before === null) return direction === "up" ? "first" : "last";
	return direction === "down" ? "last" : "first";
}

interface Pair {
	first: number;
	firstEnd: number;
	second: number;
	secondEnd: number;
}

/** The two blocks to swap, in document order, or `null` when there is only one. */
function pairWith(
	lines: readonly string[],
	first: number | null,
	firstLength: number | null,
	second: number | null,
): Pair | null {
	if (first === null || second === null) return null;

	const firstEnd = first + (firstLength ?? blockLength(lines, first));
	return {
		first,
		firstEnd,
		second,
		secondEnd: second + blockLength(lines, second),
	};
}

/**
 * Move a task's block out of its section and into another one.
 *
 * The sibling move above never leaves the list it is in, on purpose. This is
 * the other operation, and it is a different one: the task loses its parent, so
 * it lands at the **end of the target section, at that section's own level**.
 * There is no such thing as "the same place" in a section it has never been in.
 *
 * Re-indenting is done on the *string* rather than on a column count. A block
 * indented with tabs and one indented with spaces both keep their shape that
 * way, and the relative depth inside the block — a subtask stays a subtask —
 * survives untouched, because every line has the same prefix swapped for the
 * same new one.
 */
export function moveToSection(
	lines: readonly string[],
	index: number,
	headingLine: number,
): string[] | null {
	const match = TASK_LINE.exec(lines[index] ?? "");
	if (match === null) return null;

	const headings = headingsOf(lines);
	const target = headings.find((heading) => heading.line === headingLine);
	if (target === undefined) return null;

	const length = blockLength(lines, index);

	// The section a task is *in* is the nearest heading above it, not every
	// heading whose range covers it. A parent's range covers its subsections, so
	// asking "is the task inside the target's range" refused every move from a
	// subheading up to its own parent (found by the owner, 15 aug 2026).
	const owner = nearestHeadingAbove(headings, index);
	if (owner !== null && owner.line === target.line) return null;

	const body = ownBody(lines, headings, target);

	const oldPrefix = match[1];
	const newPrefix = baseIndent(lines, body);
	const block = lines
		.slice(index, index + length)
		.map((line) =>
			line.startsWith(oldPrefix) ? newPrefix + line.slice(oldPrefix.length) : line,
		);

	// Where it lands: after the last line of the section's *own* content that
	// says anything — so it joins that list, rather than beyond the blank line
	// before the next section or, worse, inside a subsection.
	let after = target.line;
	for (let i = target.line + 1; i <= body.end && i < lines.length; i++) {
		if (lines[i].trim().length > 0) after = i;
	}

	const rest = [...lines.slice(0, index), ...lines.slice(index + length)];
	const at = (after > index ? after - length : after) + 1;
	rest.splice(at, 0, ...block);
	return rest;
}

/**
 * Hang a task under another task, one level deeper.
 *
 * The third move, next to reordering (§4.2) and moving to another heading: from
 * a loose item to a step of something bigger (owner, 18 aug 2026). Same note
 * only — a subtask in a different file from its parent is not a subtask, it is
 * two tasks that look related.
 *
 * The block travels whole and lands **directly under its new parent**, at the
 * top of whatever that parent already holds rather than at the bottom. A step
 * you decide to add is a step you are about to take, and a list you are
 * building reads from the top; landing it last would bury it under work that
 * came before it existed.
 *
 * The indent is the parent's, plus one step in the parent's own character —
 * tabs stay tabs. Relative depth *inside* the block is untouched, so a task
 * with two subtasks arrives as a subtask with two of its own.
 *
 * Answers `null` when the move is refused, which is the same three cases a
 * reader would name: it is not a task, the target is not a task, or the target
 * is the task itself or something inside it. That last one is the one worth
 * guarding: hanging a branch under its own descendant would take both of them
 * out of the note.
 */
export function moveUnderTask(
	lines: readonly string[],
	index: number,
	parentLine: number,
): string[] | null {
	const match = TASK_LINE.exec(lines[index] ?? "");
	const parentMatch = TASK_LINE.exec(lines[parentLine] ?? "");
	if (match === null || parentMatch === null) return null;

	const length = blockLength(lines, index);
	// Itself, or anything under it. Either would lose the block.
	if (parentLine >= index && parentLine < index + length) return null;

	const oldPrefix = match[1];
	const parentPrefix = parentMatch[1];
	const newPrefix = `${parentPrefix}${stepIn(lines, parentPrefix)}`;

	// Already a child of that task, at that depth: nothing to do, and saying
	// "unchanged" beats writing the file for no reason.
	if (parentLine === index - 1 && oldPrefix === newPrefix) return null;

	const block = lines
		.slice(index, index + length)
		.map((line) =>
			line.startsWith(oldPrefix) ? newPrefix + line.slice(oldPrefix.length) : line,
		);

	const rest = [...lines.slice(0, index), ...lines.slice(index + length)];
	const parentAt = parentLine > index ? parentLine - length : parentLine;
	rest.splice(parentAt + 1, 0, ...block);
	return rest;
}

/**
 * Make a heading that is not there yet, and move the task under it.
 *
 * The same move as above, with the destination brought into being first — the
 * way Obsidian offers to make a folder when you move a note into one that does
 * not exist. One operation rather than two, so it is one write and one check:
 * a note that changed under us must not end up with a fresh empty heading and
 * the task still where it was.
 *
 * Two decisions, both made so the reader can predict them, and both shown in
 * the picker before it happens:
 *
 *  - **The level** is that of the section the task is in now, so the new one is
 *    its sibling. Somewhere in a note is not a level, and a new `##` under a
 *    `###` list would silently close the section the reader was working in.
 *  - **The place** is directly after that section ends, which is what makes it
 *    a sibling rather than a child of whatever came last.
 */
export function moveToNewSection(
	lines: readonly string[],
	index: number,
	title: string,
): string[] | null {
	const text = title.trim();
	if (text.length === 0) return null;
	if (TASK_LINE.exec(lines[index] ?? "") === null) return null;

	const headings = headingsOf(lines);
	const wanted = splitPath(text);
	const name = wanted[wanted.length - 1];

	// A heading that is already there is one to move into, not one to make a
	// second time. An *empty* heading is the case that bit: it holds no tasks, so
	// the wheel does not draw it, so the reader types the name they can see in
	// the note and gets a duplicate (owner, 18 aug 2026). The picker refuses an
	// exact name it can offer, but it cannot refuse a typed path — and this is
	// the layer that writes, so this is the layer that has to be sure.
	const already = existing(headings, wanted);
	if (already !== null) return moveToSection(lines, index, already.line);

	// `org/afdeling 2` means "afdeling 2, under org" — the same shape Obsidian
	// uses when you move a note into a folder that is not there yet. Without it
	// the reader got one heading literally called `org/afdeling 2`, which is
	// what they typed but never what they meant (found by the owner, 15 aug).
	const parent = resolveParent(headings, wanted.slice(0, -1));
	const owner = nearestHeadingAbove(headings, index);

	const level =
		parent === null
			? newSectionLevel(headings, owner)
			: subLevel(headings, parent);

	// A new subheading goes after everything its parent already holds, so it is
	// the last of that parent's sections. Without a parent named, after the
	// section the task is in — or at the end of the note when it is in none.
	const anchor = parent ?? owner;
	const at =
		anchor === null ? lines.length : Math.min(anchor.end + 1, lines.length);

	// Blank lines around the new heading follow the note's own habit rather than
	// a rule of ours. A note that separates its sections keeps doing so — and
	// the blank *after* matters as much as the one before: without it the
	// section that follows quietly loses the separator it already had, because
	// the new heading takes it over.
	const spaced = separatesHeadings(lines, headings);
	const before =
		spaced && (lines[at - 1] ?? "").trim().length > 0 ? [""] : [];
	const after = spaced && (lines[at] ?? "").trim().length > 0 ? [""] : [];

	const heading = `${"#".repeat(level)} ${name}`;
	const grown = [...lines];
	grown.splice(at, 0, ...before, heading, ...after);

	// The task has not moved yet, so its own line only shifted if the heading
	// went in above it.
	const headingLine = at + before.length;
	const moved = index >= at ? index + before.length + after.length + 1 : index;

	return moveToSection(grown, moved, headingLine);
}

/**
 * The heading a typed path already names, at full depth.
 *
 * Only an exact path match counts. A lone name is allowed to match anywhere,
 * the same latitude `resolveParent` takes, because typing one word to mean the
 * one section that answers to it is how people use this.
 */
function existing(
	headings: readonly NoteHeading[],
	wanted: readonly string[],
): NoteHeading | null {
	const folded = wanted.map(fold);
	const exact = headings.find((heading) => same(heading.path, folded));
	if (exact !== undefined) return exact;

	if (wanted.length === 1) {
		return headings.find((heading) => fold(heading.text) === folded[0]) ?? null;
	}
	return null;
}

/**
 * Split what the reader typed into a path.
 *
 * Slashes separate, blanks are dropped, and a lone name is a path of one. A
 * heading whose own text holds a slash is the price of this, and it is a small
 * one: naming a section `and/or` is rare, naming a section under another one is
 * not.
 */
export function splitPath(text: string): string[] {
	const parts = text
		.split("/")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return parts.length === 0 ? [text.trim()] : parts;
}

/**
 * The heading a typed path points at, when it exists.
 *
 * Matched on the whole path from the top, case-insensitively — `org/afdeling`
 * finds the *afdeling* under *org*, not one under something else. An empty path
 * means no parent was named at all.
 */
function resolveParent(
	headings: readonly NoteHeading[],
	path: readonly string[],
): NoteHeading | null {
	if (path.length === 0) return null;

	const wanted = path.map(fold);
	const exact = headings.find((heading) => same(heading.path, wanted));
	if (exact !== undefined) return exact;

	// A single name is allowed to match a heading anywhere: `afdeling 1/x` should
	// work without having to spell out every level above it.
	if (path.length === 1) {
		return headings.find((heading) => fold(heading.text) === wanted[0]) ?? null;
	}
	return null;
}

function same(path: readonly string[], wanted: readonly string[]): boolean {
	return (
		path.length === wanted.length &&
		path.every((step, index) => fold(step) === wanted[index])
	);
}

/**
 * What level a new heading would get, for a task at this line.
 *
 * Exported so the picker can say so *before* it happens — a reader should not
 * have to write into their note to find out what shape it will take.
 */
export function levelForNewSection(
	lines: readonly string[],
	index: number,
	/** What the reader has typed, which may name a parent with a slash. */
	typed = "",
): { level: number; under: string | null } {
	const headings = headingsOf(lines);
	const wanted = splitPath(typed.trim());
	const parent =
		typed.trim().length === 0 ? null : resolveParent(headings, wanted.slice(0, -1));

	if (parent !== null) {
		return { level: subLevel(headings, parent), under: parent.text };
	}

	return {
		level: newSectionLevel(headings, nearestHeadingAbove(headings, index)),
		under: null,
	};
}

/**
 * What level a new section gets.
 *
 * A sibling of the section the task sits in. With no section to be a sibling of,
 * the level most of the note's headings already use — which in a note with a
 * single `#` title and `##` sections is `##`, the answer a reader expects.
 */
function newSectionLevel(
	headings: readonly NoteHeading[],
	owner: NoteHeading | null,
): number {
	if (owner !== null) return owner.level;
	if (headings.length === 0) return 2;

	const counts = new Map<number, number>();
	for (const heading of headings) {
		counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1);
	}

	let best = headings[0].level;
	for (const [level, count] of counts) {
		const winning = counts.get(best) ?? 0;
		// A tie goes to the shallower level: it is the one a reader would call
		// "a section of this note".
		if (count > winning || (count === winning && level < best)) best = level;
	}
	return best;
}

/* ------------------------------------------------------------------ */
/* editing a section rather than a task                                */
/* ------------------------------------------------------------------ */

/**
 * A heading is a thing on the wheel too, so it is a thing you can move.
 *
 * In a wheel over one note the headings are the wedges, so standing on one and
 * having nothing to do with it was the odd gap (found by the owner, 15 aug
 * 2026). These four are the same operations the tasks have, one level up.
 *
 * A section moves with everything under it: its own lines *and* its
 * subsections. Anything else would leave a subsection orphaned under whatever
 * heading happened to follow.
 */
export function moveHeading(
	lines: readonly string[],
	headingLine: number,
	direction: MoveDirection,
): string[] | null {
	const headings = headingsOf(lines);
	const self = headings.find((heading) => heading.line === headingLine);
	if (self === undefined) return null;

	const family = siblingsOf(headings, self);
	const at = family.findIndex((heading) => heading.line === self.line);
	const swap = family[direction === "up" ? at - 1 : at + 1];
	if (swap === undefined) return null;

	const first = direction === "up" ? swap : self;
	const second = direction === "up" ? self : swap;

	// Sibling sections are adjacent by construction: one ends where the next
	// begins, because a section runs to the next heading of its own level or
	// shallower.
	return [
		...lines.slice(0, first.line),
		...lines.slice(second.line, second.end + 1),
		...lines.slice(first.line, first.end + 1),
		...lines.slice(second.end + 1),
	];
}

/**
 * Move a whole section under another heading.
 *
 * Everything inside it is re-levelled by the same amount, so a `###` with two
 * `####` under it becomes a `##` with two `###` — the shape survives, only its
 * depth changes. Levels are clamped to the six markdown has; a section pushed
 * past that keeps its shape as far as markdown can express it.
 */
export function moveHeadingUnder(
	lines: readonly string[],
	headingLine: number,
	targetLine: number,
): string[] | null {
	const headings = headingsOf(lines);
	const self = headings.find((heading) => heading.line === headingLine);
	const target = headings.find((heading) => heading.line === targetLine);
	if (self === undefined || target === undefined) return null;

	// A section cannot be moved into itself, nor into anything it contains —
	// that would delete the note from under the reader.
	if (target.line >= self.line && target.line <= self.end) return null;

	const level = subLevel(headings, target);
	const shift = level - self.level;

	const block = lines.slice(self.line, self.end + 1).map((line) => {
		const match = /^(#{1,6})([ \t].*)?$/.exec(line);
		if (match === null) return line;
		const wanted = Math.min(6, Math.max(1, match[1].length + shift));
		return `${"#".repeat(wanted)}${match[2] ?? ""}`;
	});

	const rest = [
		...lines.slice(0, self.line),
		...lines.slice(self.end + 1),
	];

	// After everything the target already holds, so it joins that parent's
	// sections as the last of them.
	const at = target.end + 1 > self.line ? target.end + 1 - block.length : target.end + 1;
	rest.splice(Math.min(at, rest.length), 0, ...block);
	return rest;
}

/** Add a task at the end of a section's own content. */
export function addTaskToSection(
	lines: readonly string[],
	headingLine: number,
	text: string,
): string[] | null {
	const wanted = text.trim();
	if (wanted.length === 0) return null;

	const headings = headingsOf(lines);
	const target = headings.find((heading) => heading.line === headingLine);
	if (target === undefined) return null;

	const body = ownBody(lines, headings, target);
	const indent = baseIndent(lines, body);

	let after = target.line;
	for (let i = body.start; i <= body.end && i < lines.length; i++) {
		if (lines[i].trim().length > 0) after = i;
	}

	const out = [...lines];
	out.splice(after + 1, 0, `${indent}- [ ] ${wanted}`);
	return out;
}

/** Hang a new section under this one, after everything it already holds. */
export function addSubheading(
	lines: readonly string[],
	headingLine: number,
	title: string,
): string[] | null {
	const wanted = splitPath(title.trim()).pop() ?? "";
	if (wanted.length === 0) return null;

	const headings = headingsOf(lines);
	const target = headings.find((heading) => heading.line === headingLine);
	if (target === undefined) return null;

	// Already a section of this one? Then there is nothing to add. Making a
	// second heading of the same name under the same parent is never what was
	// meant, and an empty one is invisible on the wheel — so the reader cannot
	// see that it is already there (owner, 18 aug 2026).
	const twin = headings.some(
		(heading) =>
			heading.line > target.line &&
			heading.line <= target.end &&
			fold(heading.text) === fold(wanted),
	);
	if (twin) return null;

	const at = Math.min(target.end + 1, lines.length);
	const spaced = separatesHeadings(lines, headings);
	const before = spaced && (lines[at - 1] ?? "").trim().length > 0 ? [""] : [];

	const out = [...lines];
	out.splice(at, 0, ...before, `${"#".repeat(subLevel(headings, target))} ${wanted}`);
	return out;
}

/**
 * The sections that share a parent with this one, in document order.
 *
 * Same level and the same nearest shallower heading above them — two `###`
 * under different `##` are not siblings, however alike they look.
 */
function siblingsOf(
	headings: readonly NoteHeading[],
	self: NoteHeading,
): NoteHeading[] {
	const parent = parentOf(headings, self);
	return headings.filter(
		(heading) =>
			heading.level === self.level &&
			parentOf(headings, heading)?.line === parent?.line,
	);
}

/** The nearest heading above this one that is shallower than it. */
function parentOf(
	headings: readonly NoteHeading[],
	self: NoteHeading,
): NoteHeading | null {
	let found: NoteHeading | null = null;
	for (const heading of headings) {
		if (heading.line >= self.line) break;
		if (heading.level < self.level) found = heading;
	}
	return found;
}

/**
 * Put a new task line into the note.
 *
 * After the whole block of the task it is added to, so a new sibling lands
 * below that task's subtasks rather than between them. As a child it takes one
 * level more indentation, copying the parent's own list marker so a numbered
 * list stays numbered and a `*` list stays a `*` list.
 */
export function insertTask(
	lines: readonly string[],
	index: number,
	text: string,
	asChild: boolean,
): { lines: string[]; line: number } | null {
	const match = TASK_LINE.exec(lines[index] ?? "");
	if (match === null) return null;

	const whitespace = match[1];
	const indent = asChild ? `${whitespace}${step(whitespace)}` : whitespace;
	const marker = markerOf(lines[index]);

	const at = asChild ? index + 1 : index + blockLength(lines, index);
	const out = [...lines];
	out.splice(at, 0, `${indent}${marker} [ ] ${text.trim()}`);
	return { lines: out, line: at };
}

/**
 * Rewrite what a task *says*, leaving everything it *is* alone.
 *
 * The editable part is the text before the first field marker, tags included.
 * Not the parsed description: that has already had its tags lifted out of it,
 * so writing it back would quietly delete them. Dates, priority, recurrence,
 * dependencies and a trailing block reference all keep their place, because the
 * slice being replaced stops before them.
 */
export function setText(line: string, text: string): string {
	const match = TASK_LINE.exec(line);
	if (match === null) return line;

	const body = match[3] ?? "";
	const head = line.slice(0, line.length - body.length);
	const wanted = text.trim();

	// Everything from the first field marker onwards is kept verbatim, and so is
	// a block reference, which sits at the very end rather than in the fields.
	const rest = body.slice(textEnd(body));
	const tail = rest.trimStart();

	if (wanted.length === 0 && tail.length === 0) return line;

	// Joined with a single space, and with none at all when one side is empty —
	// otherwise clearing the words leaves `- [ ]  📅 2026-08-20` behind, which
	// reads as a fault in the plugin rather than as an empty description.
	const rebuilt = [wanted, tail].filter((part) => part.length > 0).join(" ");
	const next = `${head}${rebuilt}`.trimEnd();
	return next === line ? line : next;
}

/**
 * Where the free text of a task body ends and its fields begin.
 *
 * Uses the parser's own scanner rather than a second one: `findSignifiers` is
 * exported precisely so that reading a line and rewriting it cannot drift
 * apart, and the one that drifts is the one that writes to the vault.
 */
export function textEnd(body: string): number {
	const hits = findSignifiers(body);
	if (hits.length > 0) return hits[0].index;

	// No fields: a trailing block reference is still not part of the text.
	const ref = /\s*\^[\p{L}\p{N}-]+\s*$/u.exec(body);
	return ref === null ? body.length : ref.index;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function indentOf(line: string | undefined): number | null {
	if (line === undefined) return null;
	const match = TASK_LINE.exec(line);
	return match === null ? null : indentWidth(match[1]);
}

/**
 * Where the next sibling's block starts, or `null` when there is none.
 *
 * The mirror of `previousSibling`, and written to match it line for line: blank
 * lines are stepped over, prose at the same level or shallower ends the list,
 * and prose deeper in belongs to a block being stepped past.
 */
function nextSibling(
	lines: readonly string[],
	from: number,
	indent: number,
): number | null {
	for (let i = from; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().length === 0) continue;

		const found = indentOf(line);
		if (found === null) {
			if (indentWidth(leadingSpace(line)) <= indent) return null;
			continue;
		}

		if (found === indent) return i;
		if (found < indent) return null;
	}
	return null;
}

/** Where the previous sibling's block starts, or null when there is none. */
function previousSibling(
	lines: readonly string[],
	index: number,
	indent: number,
): number | null {
	for (let i = index - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.trim().length === 0) continue;

		const found = indentOf(line);
		if (found === null) {
			// Prose at the same level or shallower ends the list; prose deeper in
			// belongs to a block we are stepping over.
			if (indentWidth(leadingSpace(line)) <= indent) return null;
			continue;
		}

		if (found === indent) return i;
		if (found < indent) return null;
	}
	return null;
}

function leadingSpace(line: string): string {
	return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/** One level deeper, in whatever the line is already indented with. */
function step(whitespace: string): string {
	return whitespace.includes("\t") ? "\t" : "    ";
}

/**
 * One level deeper, in the character the *note* indents with.
 *
 * A parent at the margin has no prefix, so it says nothing about the habit of
 * the note it sits in — and `step("")` would answer spaces for a note written
 * entirely in tabs. So when the parent is silent, the note is asked.
 *
 * Deliberately only used by `moveUnderTask`. `insertTask` has the same blind
 * spot and the same fix would suit it, but changing it is changing behaviour
 * that is not what this was about (BC_E3_S19).
 */
function stepIn(lines: readonly string[], parentPrefix: string): string {
	if (parentPrefix.length > 0) return step(parentPrefix);

	for (const line of lines) {
		const match = TASK_LINE.exec(line);
		if (match !== null && match[1].includes("\t")) return "\t";
	}
	return "    ";
}

/** The bullet or number a list is written with, so a new line matches it. */
function markerOf(line: string | undefined): string {
	const match = /^[ \t]*([-*+]|\d+[.)])/.exec(line ?? "");
	const marker = match?.[1] ?? "-";
	// A numbered list continues at the same number; Obsidian and every markdown
	// renderer renumber on the fly, so guessing the next one buys nothing.
	return marker;
}
