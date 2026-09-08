/**
 * Carrying work from one note to another.
 *
 * The edits in `outline-edit` all happen inside one note, where the wheel *is*
 * the outline. This is the other half of the same idea, and the one the owner
 * asked for (17 aug 2026): a task on the active list that turns out to be a
 * someday belongs in the someday note, and a task you come across elsewhere
 * belongs on the list — usually as a copy, because taking it out of a working
 * document breaks that document.
 *
 * The rule that makes it more than a cut and paste is that **the category
 * travels with it**. A wedge on the wheel is a heading path, so a task that sat
 * under `Werk › Klanten` lands under `Werk › Klanten` in the other note — and
 * if that path is not there yet it is made, the way Obsidian offers to make a
 * folder when you move a note into one that does not exist. A heading that is
 * already there is used, never duplicated.
 *
 * Everything here is pure: lines in, lines out, two notes at a time. Which of
 * the two writes happens first, and what to do when only one lands, is a
 * question for `vault/writeback` — not for this module.
 */

import { HEADING, headingsOf, type NoteHeading } from "./outline";
import {
	baseIndent,
	fitsAfterShift,
	fold,
	nearestHeadingAbove,
	ownBody,
	relevel,
	separatesHeadings,
	subLevel,
} from "./sections";
import { TASK_LINE } from "./task-line";
import { blockLength } from "./outline-edit";

/** What travels, and what it knew about where it came from. */
export interface Extracted {
	/**
	 * A task with everything under it, or a heading with its whole subtree.
	 *
	 * The distinction survives the journey because the two land differently: a
	 * task joins a list, a section becomes a section of whatever it lands under.
	 */
	kind: "task" | "section";
	/**
	 * The lines themselves, pulled back to their own left margin.
	 *
	 * A subtask three levels in should not arrive three levels in somewhere it
	 * has no parent. The shift is done on the prefix *string*, so a block written
	 * with tabs stays tabs and the relative depth inside it is untouched.
	 */
	block: string[];
	/**
	 * The same lines exactly as the source has them.
	 *
	 * `block` has been pulled to the margin, so it cannot be compared with the
	 * note. A move checks against this before taking anything out.
	 */
	raw: string[];
	/** Where they came from, so a move knows what to take out. */
	start: number;
	length: number;
	/**
	 * The heading path the block sat under, outermost first.
	 *
	 * For a section this is the path *above* it — the section itself is in the
	 * block and brings its own name along.
	 */
	path: string[];
}

/** What a paste did, so the caller can say it in one sentence. */
export interface Pasted {
	lines: string[];
	/** Where the first line of the block ended up. */
	line: number;
	/** Headings that had to be made, outermost first. Empty when none were. */
	created: string[];
	/**
	 * Why nothing was placed, when nothing was (BC_E3_S168).
	 *
	 * `too-deep`: the section holds headings of its own and the level it would
	 * land at leaves no room for them under the six markdown has. Flattening
	 * them into siblings is the thing this refuses to do quietly, and landing
	 * the section shallower than the parent it was aimed at would put it outside
	 * that parent — a different place from the one that was asked for. So it
	 * places nothing and says so, and `lines` comes back untouched.
	 */
	refused?: "too-deep";
}

/**
 * Lift a task's block, or a whole section, out of a note — without changing it.
 *
 * Reading and removing are separate on purpose: a copy never touches the source
 * at all, and a move only takes the lines out once the other note has them.
 */
export function extractBlock(
	lines: readonly string[],
	index: number,
): Extracted | null {
	if (index < 0 || index >= lines.length) return null;

	const headings = headingsOf(lines);
	const heading = headings.find((one) => one.line === index);

	if (heading !== undefined) {
		const raw = [...lines.slice(heading.line, heading.end + 1)];
		return {
			kind: "section",
			block: raw,
			raw,
			start: heading.line,
			length: raw.length,
			// Its own name is in the block; the path is where it hung.
			path: heading.path.slice(0, -1),
		};
	}

	return taskBlock(lines, headings, index);
}

/** One task with everything under it, pulled to the margin. */
function taskBlock(
	lines: readonly string[],
	headings: readonly NoteHeading[],
	index: number,
): Extracted | null {
	const match = TASK_LINE.exec(lines[index] ?? "");
	if (match === null) return null;

	const length = blockLength(lines, index);
	const prefix = match[1];
	const raw = [...lines.slice(index, index + length)];

	return {
		kind: "task",
		block: raw.map((line) =>
			line.startsWith(prefix) ? line.slice(prefix.length) : line,
		),
		raw,
		start: index,
		length,
		path: nearestHeadingAbove(headings, index)?.path ?? [],
	};
}

/**
 * Whether a task line is part of the round in its own right.
 *
 * Handed the heading path as well as the line, because round membership turns
 * on it — a checkbox under a heading that names a checklist was never in the
 * round — and working it out again on the caller's side means a second walk
 * over the same headings this module has already read.
 */
export type InRound = (line: number, headingPath: readonly string[]) => boolean;

/**
 * What a section carries while a filter is running.
 *
 * Carrying a whole section carries every line under it, which is right when the
 * wheel is showing every line under it — and wrong the moment a filter is on.
 * Filtering on *finished* and moving a branch to an archive took the open work
 * along with it, which is exactly the silent surprise the wheel is not allowed
 * to spring (owner, 17 aug 2026). So with a filter running, **what travels is
 * what the round is showing**, and the heading itself stays where it is: it
 * still holds the work that was left out.
 *
 * Two rules decide it, both about not orphaning anything:
 *
 *  - A task that is in the round travels with its **whole block** — subtasks and
 *    prose included, in the round or not. A block is indivisible everywhere else
 *    in the plugin and it is indivisible here.
 *  - A task that is **staying** takes everything under it with it, even a
 *    subtask that is in the round. Pulling that subtask out from under a parent
 *    that stays would leave it hanging under whatever followed.
 *
 * Blocks come back in document order, each with the heading path it hung under
 * — so a section with subsections arrives on the other side as a section with
 * subsections rather than as one flat list.
 */
export function extractFiltered(
	lines: readonly string[],
	headingLine: number,
	inRound: InRound,
): FilteredCarry {
	const headings = headingsOf(lines);
	const target = headings.find((one) => one.line === headingLine);
	if (target === undefined) return { blocks: [], held: 0 };

	return walkRange(lines, headings, target.line + 1, target.end, inRound);
}

/**
 * What a **task branch** carries while a filter is running.
 *
 * The heading version above shipped first and covered only half the cases: a
 * task branch was carried whole whatever the filter said. That was the same
 * silent surprise one level down, and worse — filter on *finished*, grab a
 * branch, and the open parent came along with every open child under it
 * (owner, 18 aug 2026).
 *
 * The two rules are the same ones, applied to a task instead of a heading:
 *
 *  - A task that is in the round **in its own right** travels with its whole
 *    block, subtasks and prose included. A block is indivisible everywhere else
 *    in the plugin and it stays indivisible here.
 *  - A task that is **not** in the round is only on the disc as a *carrier* —
 *    drawn so the round's work underneath it can be reached. Carrying a carrier
 *    must not carry the carrier: only what the round shows under it leaves, and
 *    the carrier stays where it is, still holding the rest.
 */
export function extractFilteredTask(
	lines: readonly string[],
	taskLine: number,
	inRound: InRound,
): FilteredCarry {
	const headings = headingsOf(lines);
	if (TASK_LINE.exec(lines[taskLine] ?? "") === null) {
		return { blocks: [], held: 0 };
	}

	const path = nearestHeadingAbove(headings, taskLine)?.path ?? [];
	if (inRound(taskLine, path)) {
		const block = taskBlock(lines, headings, taskLine);
		return { blocks: block === null ? [] : [block], held: 0 };
	}

	const length = blockLength(lines, taskLine);
	return walkRange(lines, headings, taskLine + 1, taskLine + length - 1, inRound);
}

/**
 * What a **whole note** carries.
 *
 * A note is not a block, so `extractBlock` on its first line answered whatever
 * happened to be there — and that made carrying a note mean four different
 * things (measured 18 aug 2026):
 *
 * | The note begins with | It used to carry |
 * |---|---|
 * | `## Tuin`, with `## Binnen` below | **only `## Tuin`** |
 * | a task | **only that task** |
 * | `# Titel` | the whole note |
 * | prose, front matter or a blank line | **nothing**, claiming the line had changed |
 *
 * The first row is the worst of the four: it wrote, said it had moved things,
 * and quietly left two thirds of the note behind — the same family of untruth
 * as carrying a carrier, and the same rule it breaks (§3.3).
 *
 * So a note is walked like a heading: every task block in it travels, each with
 * the heading path it hung under, so the structure arrives on the other side.
 * The headings themselves stay — they may carry prose the wheel never saw, and
 * a note that is emptied of tasks is still a note.
 */
export function extractFilteredNote(
	lines: readonly string[],
	inRound: InRound,
): FilteredCarry {
	return walkRange(lines, headingsOf(lines), 0, lines.length - 1, inRound);
}

/**
 * The walk both of the above make: over a run of lines, one whole block at a
 * time, deciding for each whether it leaves or stays.
 *
 * Direct children only, because `i` steps over a whole block either way. A
 * grandchild is never pulled out from under a parent on its own — it travels
 * with that parent, or it is counted as held.
 */
function walkRange(
	lines: readonly string[],
	headings: readonly NoteHeading[],
	from: number,
	to: number,
	inRound: InRound,
): FilteredCarry {
	const blocks: Extracted[] = [];
	let held = 0;
	let i = from;

	while (i <= to && i < lines.length) {
		if (headings.some((one) => one.line === i)) {
			i += 1;
			continue;
		}

		if (TASK_LINE.exec(lines[i]) === null) {
			i += 1;
			continue;
		}

		const length = blockLength(lines, i);
		const path = nearestHeadingAbove(headings, i)?.path ?? [];

		if (inRound(i, path)) {
			const block = taskBlock(lines, headings, i);
			if (block !== null) blocks.push(block);
		} else {
			// Whatever of the round is inside a task that stays, stays with it. It
			// is counted so the caller can say so: a card with a finished checklist
			// under an open task is a normal shape, and "nothing here is in this
			// round" would be a plain untruth about it.
			for (let at = i + 1; at < i + length; at++) {
				if (inRound(at, nearestHeadingAbove(headings, at)?.path ?? [])) {
					held += 1;
				}
			}
		}
		// Either way the whole block is stepped over: taken as one, or left as one.
		i += length;
	}

	return { blocks, held };
}

/** What a filtered branch gives up, and what it had to leave behind. */
export interface FilteredCarry {
	blocks: Extracted[];
	/**
	 * Items of the round that stayed because the task they sit under is staying.
	 *
	 * Not a failure — pulling a finished subtask out from under an open one
	 * would orphan it — but it has to be said out loud, or a branch that carries
	 * nothing looks broken rather than principled.
	 */
	held: number;
}

/** Take the lifted lines out, for a move. Leaves an emptied heading standing. */
export function removeBlock(
	lines: readonly string[],
	start: number,
	length: number,
): string[] {
	return [...lines.slice(0, start), ...lines.slice(start + length)];
}

/**
 * Take several blocks out at once, or none of them.
 *
 * A filtered move lifts a handful of blocks scattered through a section, and
 * they have to come out together: half a move is worse than no move, because
 * the other note already has all of it. So every block is checked against the
 * note as it is now, and one mismatch abandons the lot — the caller then says
 * the work landed and the original was left alone.
 *
 * Removed from the bottom up, so the earlier positions are still themselves.
 */
export function removeBlocks(
	lines: readonly string[],
	blocks: readonly Extracted[],
): string[] | null {
	const ordered = [...blocks].sort((a, b) => b.start - a.start);

	for (const block of ordered) {
		const there = lines.slice(block.start, block.start + block.length);
		if (there.length !== block.raw.length) return null;
		if (there.some((line, at) => line.trimEnd() !== block.raw[at].trimEnd())) {
			return null;
		}
	}

	let out = [...lines];
	for (const block of ordered) {
		out = removeBlock(out, block.start, block.length);
	}
	return out;
}

/**
 * Put a block into another note, under a heading path, making what is missing.
 *
 * The path is matched from the top, case-insensitively, so `Werk › Klanten`
 * finds *Klanten* under *Werk* and not one under something else. Matching stops
 * at the first step that is not there and everything from that step down is
 * written; an empty path drops the block at the end of the note.
 *
 * A section arriving somewhere is re-levelled as a whole — a `###` with two
 * `####` under it becomes a `##` with two `###` if that is what fits — so the
 * shape it had survives even though its depth does not. Where it does *not*
 * fit, because the levels would run past the six markdown has, nothing is
 * placed and the answer says why (BC_E3_S168): a shape half kept is a shape
 * lost, and losing it in silence is what that story came from.
 */
export function pasteInto(
	lines: readonly string[],
	path: readonly string[],
	extracted: Pick<Extracted, "kind" | "block">,
	/** A blank note is legal input, and it is where a `[]` really means "the end". */
	options: { headingLevel?: number } = {},
): Pasted {
	const wanted = path.map((step) => step.trim()).filter((step) => step.length > 0);

	let out = [...lines];
	const created: string[] = [];

	// Walk the path as far as it exists, then build the rest of it.
	let parent: NoteHeading | null = null;
	let step = 0;

	for (; step < wanted.length; step++) {
		const found = findStep(headingsOf(out), parent, wanted[step]);
		if (found === null) break;
		parent = found;
	}

	for (; step < wanted.length; step++) {
		const made = addHeading(out, parent, wanted[step]);
		out = made.lines;
		created.push(wanted[step]);
		parent = headingsOf(out).find((heading) => heading.line === made.line) ?? null;
	}

	if (extracted.kind === "section") {
		return placeSection(out, parent, extracted.block, created, options.headingLevel);
	}
	return placeTask(out, parent, extracted.block, created);
}

/* ------------------------------------------------------------------ */
/* placing                                                             */
/* ------------------------------------------------------------------ */

/** A task joins the list a section already holds, at that list's own indent. */
function placeTask(
	lines: readonly string[],
	parent: NoteHeading | null,
	block: readonly string[],
	created: string[],
): Pasted {
	const headings = headingsOf(lines);

	// Under no heading at all, the list a task joins is whatever sits above the
	// note's first heading. A note that has none is all preamble.
	const body =
		parent === null
			? { start: 0, end: (headings[0]?.line ?? lines.length) - 1 }
			: ownBody(lines, headings, parent);

	const indent = baseIndent(lines, body);
	const shifted = block.map((line) =>
		line.trim().length === 0 ? line : `${indent}${line}`,
	);

	let after = parent === null ? -1 : parent.line;
	for (let i = Math.max(body.start, 0); i <= body.end && i < lines.length; i++) {
		if (lines[i].trim().length > 0) after = i;
	}

	// A note that opens straight into a heading has no preamble to join, and
	// dropping a task above its title would be a strange place to find it. The
	// end of the note is the honest answer there.
	const at =
		after < 0 && headings.length > 0
			? lines.length
			: Math.min(after + 1, lines.length);
	const out = [...lines];
	out.splice(at, 0, ...shifted);
	return { lines: out, line: at, created };
}

/**
 * A section becomes a section of what it landed under.
 *
 * Its level is the one its new siblings use, so it joins them instead of
 * introducing a second convention. Levels are clamped to the six markdown has.
 */
function placeSection(
	lines: readonly string[],
	parent: NoteHeading | null,
	block: readonly string[],
	created: string[],
	forced?: number,
): Pasted {
	const headings = headingsOf(lines);
	const own = HEADING.exec(block[0] ?? "");
	const level =
		forced ?? (parent === null ? commonLevel(headings) : subLevel(headings, parent));
	const shift = level - (own === null ? level : own[1].length);

	// The shape is the promise this function makes, so it refuses rather than
	// keep half of it (BC_E3_S168). See `refused` on `Pasted`.
	if (!fitsAfterShift(block, shift)) {
		return { lines: [...lines], line: -1, created, refused: "too-deep" };
	}

	const shifted = relevel(block, shift);

	// After everything the parent already holds, so it is the last of its
	// sections; at the end of the note when it landed under nothing.
	const at = parent === null ? lines.length : Math.min(parent.end + 1, lines.length);

	const spaced = separatesHeadings(lines, headings);
	const before = spaced && (lines[at - 1] ?? "").trim().length > 0 ? [""] : [];

	const out = [...lines];
	out.splice(at, 0, ...before, ...shifted);
	return { lines: out, line: at + before.length, created };
}

/** Write one heading under another, or at the end of the note. */
function addHeading(
	lines: readonly string[],
	parent: NoteHeading | null,
	title: string,
): { lines: string[]; line: number } {
	const headings = headingsOf(lines);
	const level = parent === null ? commonLevel(headings) : subLevel(headings, parent);
	const at = parent === null ? lines.length : Math.min(parent.end + 1, lines.length);

	const spaced = separatesHeadings(lines, headings);
	const before = spaced && (lines[at - 1] ?? "").trim().length > 0 ? [""] : [];

	const out = [...lines];
	out.splice(at, 0, ...before, `${"#".repeat(level)} ${title}`);
	return { lines: out, line: at + before.length };
}

/* ------------------------------------------------------------------ */
/* small helpers, shared in spirit with outline-edit                   */
/* ------------------------------------------------------------------ */

/**
 * One step of a path, looked for under what the step before found.
 *
 * The first step is looked for anywhere in the note rather than at the top of
 * it, because the top of a note is usually its **title**: carrying something
 * whose path is `Klussen` into a note that opens with `# Archief` has to find
 * the `## Klussen` under that title. Comparing whole paths from the note's root
 * instead meant the walk could not even find a heading it had just written
 * itself, so a second block wrote a second copy of it.
 *
 * Every step after the first is confined to the parent's own range, which is
 * what keeps two sections of the same name under different parents apart.
 */
function findStep(
	headings: readonly NoteHeading[],
	parent: NoteHeading | null,
	name: string,
): NoteHeading | null {
	const inside =
		parent === null
			? headings
			: headings.filter(
					(heading) =>
						heading.line > parent.line && heading.line <= parent.end,
				);

	const hits = inside.filter((heading) => fold(heading.text) === fold(name));
	if (hits.length === 0) return null;

	// Shallowest first, then earliest: a section of the note beats one buried
	// inside another, and two equal candidates are settled by document order.
	return hits.reduce((best, one) =>
		one.level < best.level ? one : best,
	);
}

/**
 * The level this note's own sections are written at.
 *
 * The shallowest one in use, with a single exception: a lone `#` at the top of
 * a note is its *title*, not a section of it, so sections live one below it.
 * Getting that wrong writes a second `#` beside the title and silently ends the
 * document. With nothing to go on, `##` — the commoner shape by far.
 */
function commonLevel(headings: readonly NoteHeading[]): number {
	if (headings.length === 0) return 2;

	const levels = headings.map((heading) => heading.level);
	const top = Math.min(...levels);
	const deeper = levels.filter((level) => level > top);

	if (top === 1 && levels.filter((level) => level === 1).length === 1) {
		return deeper.length > 0 ? Math.min(...deeper) : 2;
	}
	return top;
}
