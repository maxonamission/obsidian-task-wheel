/**
 * Reading a note into a flat list of task lines with their heading context.
 *
 * The build brief (§4) fixes the order of precedence for hierarchy:
 * indentation under a parent task, then headings, then the note as project,
 * then the folder as domain. This module supplies the middle two — it records
 * which headings a task line sits under, and leaves the indentation
 * relationships to `build-tree`.
 */

import { linesOf } from "./lines";
import { parseTaskLine } from "./task-line";
import type { TaskFields } from "../model/types";

/** A task line found in a note, with everything needed to place it. */
export interface OutlinedTask {
	line: number;
	indent: number;
	headingPath: string[];
	/**
	 * Where each of those headings sits, same order, same length.
	 *
	 * Carried so the wheel's heading nodes know which line they stand for — a
	 * heading you can move or add to is a heading the editor has to be able to
	 * find again (kaderdocument §4.2).
	 */
	headingLines: number[];
	/**
	 * The heading lines themselves, same order, same length.
	 *
	 * The title alone cannot say whether a heading is still the one that was
	 * scanned — two sections may share a name, and a heading may have been
	 * re-levelled. So the wheel keeps the line as it read, and every edit that
	 * aims at a heading compares against it (BC_E3_S44).
	 */
	headingRaws: string[];
	fields: TaskFields;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*$/;
const FENCE = /^[ \t]*(```+|~~~+)/;
const FRONT_MATTER_DELIM = /^---[ \t]*$/;

/**
 * Walk a note and return its task lines in document order.
 *
 * Code fences and front matter are skipped: a `- [ ]` inside a fenced example
 * is documentation about tasks, not a task, and putting it on the wheel would
 * be a small lie about what is outstanding.
 */
export function outlineNote(content: string): OutlinedTask[] {
	const lines = linesOf(content);
	const tasks: OutlinedTask[] = [];
	const headings: string[] = [];
	const at: number[] = [];

	let index = skipFrontMatter(lines);
	let fence: string | null = null;

	for (; index < lines.length; index++) {
		const line = lines[index];

		if (fence !== null) {
			if (line.trimStart().startsWith(fence)) fence = null;
			continue;
		}

		const fenceMatch = FENCE.exec(line);
		if (fenceMatch !== null) {
			fence = fenceMatch[1];
			continue;
		}

		const headingMatch = HEADING.exec(line);
		if (headingMatch !== null) {
			const level = headingMatch[1].length;
			headings.length = Math.min(headings.length, level - 1);
			at.length = headings.length;
			while (headings.length < level - 1) {
				headings.push("");
				at.push(-1);
			}
			headings[level - 1] = headingMatch[2];
			at[level - 1] = index;
			continue;
		}

		const parsed = parseTaskLine(line);
		if (parsed !== null) {
			// The two arrays are filtered together, so they stay the same
			// length and the same order: a gap in the heading levels — an `h3`
			// with no `h2` above it — must not shift the lines out of step.
			const named = headings
				.map((heading, level) => ({ heading, line: at[level] ?? -1 }))
				.filter((step) => step.heading.length > 0);

			tasks.push({
				line: index,
				indent: parsed.indent,
				headingPath: named.map((step) => step.heading),
				headingLines: named.map((step) => step.line),
				headingRaws: named.map((step) => lines[step.line] ?? ""),
				fields: parsed.fields,
			});
		}
	}

	return tasks;
}

/** A heading in a note, and how far its section reaches. */
export interface NoteHeading {
	/** Zero-based line the heading itself sits on. */
	line: number;
	/** How many hashes. */
	level: number;
	text: string;
	/** Every heading above it, this one last — what the wheel calls a path. */
	path: string[];
	/** Last line belonging to this section, inclusive of the heading itself. */
	end: number;
}

/**
 * Every heading in a note, with the stretch of lines each one owns.
 *
 * Shares the fence and front-matter rules with `outlineNote` above, and for the
 * same reason: a `# comment` inside a fenced shell example is not a heading,
 * and moving a task "under" it would drop the task into a code block.
 */
export function headingsOf(lines: readonly string[]): NoteHeading[] {
	const found: NoteHeading[] = [];
	const path: string[] = [];

	let index = skipFrontMatter(lines);
	let fence: string | null = null;

	for (; index < lines.length; index++) {
		const line = lines[index];

		if (fence !== null) {
			if (line.trimStart().startsWith(fence)) fence = null;
			continue;
		}

		const fenceMatch = FENCE.exec(line);
		if (fenceMatch !== null) {
			fence = fenceMatch[1];
			continue;
		}

		const match = HEADING.exec(line);
		if (match === null) continue;

		const level = match[1].length;
		path.length = Math.min(path.length, level - 1);
		while (path.length < level - 1) path.push("");
		path[level - 1] = match[2];

		found.push({
			line: index,
			level,
			text: match[2],
			path: path.filter((step) => step.length > 0),
			// Filled in below, once the next heading of the same or shallower
			// level is known.
			end: lines.length - 1,
		});
	}

	for (let i = 0; i < found.length; i++) {
		for (let j = i + 1; j < found.length; j++) {
			if (found[j].level <= found[i].level) {
				found[i].end = found[j].line - 1;
				break;
			}
		}
	}

	return found;
}

/**
 * The heading that only says the note's own name again, if there is one.
 *
 * A great many notes open with a heading that repeats their title —
 * `VRG-019 Privacy by Design.md` beginning with `# VRG-019 Privacy by Design`.
 * Drawn as its own ring it is a container holding everything and saying
 * nothing, and it costs every task in that note a ring: notes that follow the
 * convention put their work one ring further out than notes that do not. On a
 * folder of both kinds the outermost occupied ring then moves in and out as
 * you turn, which is what the owner saw and reported as a shifting outer ring
 * (measured 27 aug 2026, BC_E3_S70: ring 3 for sixteen tasks, ring 4 for
 * twenty-four, same folder).
 *
 * So it gets no ring, and its children hang off the note directly — the same
 * rule the note wheel already applies to the project ring, for the same
 * reason: a ring with one node that adds nothing is a wasted ring.
 *
 * Only when it is the note's **one** outermost heading, and only when it
 * really is the title. Two top headings mean the first is a real division,
 * and a heading that differs from the name is saying something the name does
 * not — both keep their ring. Conservative on purpose: a wrongly dropped ring
 * would move work somewhere the reader did not put it.
 */
export function titleHeadingOf(path: string, content: string): string | null {
	const name = path
		.slice(path.lastIndexOf("/") + 1)
		.replace(/\.md$/i, "")
		.trim();
	if (name.length === 0) return null;

	// `path.length === 1` is the outermost heading of the note, whatever its
	// level: a note that starts at `##` has that as its top, exactly as the
	// tree reads it.
	const top = headingsOf(linesOf(content)).filter(
		(heading) => heading.path.length === 1,
	);
	if (top.length !== 1) return null;

	return top[0].text.trim().toLowerCase() === name.toLowerCase()
		? top[0].text
		: null;
}

/**
 * Whether a note still holds a section with exactly this heading path.
 *
 * A section wheel is anchored to a path of titles, and a title is something a
 * writer renames without a thought. This is how the wheel tells "the section
 * is empty" apart from "the section is gone" — the difference between an
 * honest empty circle and one that quietly stopped being about anything
 * (BC_E3_S64).
 */
export function hasHeadingPath(
	path: string,
	content: string,
	heading: readonly string[],
): boolean {
	if (heading.length === 0) return false;
	return headingsAt(path, content, heading).length > 0;
}

/**
 * The headings of a note that sit at exactly this path, as the wheel reads it.
 *
 * The same question `hasHeadingPath` asks, answered with the headings
 * themselves — because writing into a section needs the line, not a yes.
 * Sharing one walk is deliberate: the two were written out separately once and
 * the path-stripping drifted apart within a week (audit M2, 23 aug 2026).
 *
 * "As the wheel reads it" is the whole subtlety. A heading that merely repeats
 * the note's name gets no ring (BC_E3_S70), so it is not part of any path the
 * wheel shows — and a caller that asked the raw file would look for its section
 * one level too deep, and write into the wrong place or refuse to write at all.
 *
 * More than one answer is possible and is not an error: two identical headings
 * in one note are already **one wedge** on the wheel, because the wedge is
 * keyed on the text (`headingWedge`). This returns both, in document order, and
 * leaves the choosing to the caller — which for a write means the first, the
 * same one the reader has been looking at.
 */
export function headingsAt(
	path: string,
	content: string,
	heading: readonly string[],
): NoteHeading[] {
	if (heading.length === 0) return [];

	// Against the paths as the **wheel** reads them, not as the file writes
	// them: a title heading that gets no ring is not part of any anchor, so
	// asking the raw file would call every section of such a note missing.
	const title = titleHeadingOf(path, content);
	return headingsOf(linesOf(content)).filter((found) => {
		const steps =
			title !== null && found.path[0] === title ? found.path.slice(1) : found.path;
		return (
			steps.length === heading.length &&
			steps.every((step, i) => step === heading[i])
		);
	});
}

/** Index of the first line after a leading front-matter block, if any. */
function skipFrontMatter(lines: readonly string[]): number {
	if (lines.length === 0 || !FRONT_MATTER_DELIM.test(lines[0])) return 0;
	for (let index = 1; index < lines.length; index++) {
		if (FRONT_MATTER_DELIM.test(lines[index])) return index + 1;
	}
	// Unterminated front matter: treat the whole note as front matter rather
	// than reading YAML as prose.
	return lines.length;
}
