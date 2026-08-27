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
 * Whether a note still holds a section with exactly this heading path.
 *
 * A section wheel is anchored to a path of titles, and a title is something a
 * writer renames without a thought. This is how the wheel tells "the section
 * is empty" apart from "the section is gone" — the difference between an
 * honest empty circle and one that quietly stopped being about anything
 * (BC_E3_S64).
 */
export function hasHeadingPath(
	content: string,
	heading: readonly string[],
): boolean {
	if (heading.length === 0) return false;
	return headingsOf(linesOf(content)).some(
		(found) =>
			found.path.length === heading.length &&
			found.path.every((step, i) => step === heading[i]),
	);
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
