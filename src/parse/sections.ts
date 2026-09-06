/**
 * The small questions about a section, asked once.
 *
 * Both `outline-edit` (moving things about inside one note) and `cross-note`
 * (carrying them into another) need the same handful of answers: what does this
 * heading own by itself, what level would a new one under it get, does this note
 * put a blank line above its headings, what indent do its tasks sit at.
 *
 * They had a copy each, "shared in spirit". Then one copy learned to clamp a
 * level at six and the other did not, and `addSubheading` under a `######` began
 * writing `#######` into people's notes — seven hashes is not a heading, so a
 * bare line of prose appeared and the section the reader asked for did not
 * (found by audit, 17 aug 2026). Sharing in spirit is how that happens; this
 * module is the fix.
 */

import { FENCE, HEADING, type NoteHeading } from "./outline";
import { indentWidth, TASK_LINE } from "./task-line";

/** Case- and space-insensitive, which is how headings are compared throughout. */
export function fold(text: string): string {
	return text.trim().toLowerCase();
}

/**
 * The level a new heading under this one gets.
 *
 * The level its existing children use, so a new section joins them rather than
 * introducing a second convention; one deeper than the parent when it has none.
 * **Clamped to the six markdown has** — a seventh hash is not a heading, and
 * writing one puts a line of prose in the note where a section was asked for.
 */
export function subLevel(
	headings: readonly NoteHeading[],
	parent: NoteHeading,
): number {
	const child = headings.find(
		(heading) => heading.line > parent.line && heading.line <= parent.end,
	);
	return Math.min(6, child?.level ?? parent.level + 1);
}

/**
 * Whether this note puts a blank line above its headings.
 *
 * Read from what is there rather than decided here: a note written tight should
 * not come back with gaps in it, and one written airy should not gain a heading
 * jammed against a list. With nothing to go on, airy — it is the commoner shape
 * and the easier of the two to undo by hand.
 */
export function separatesHeadings(
	lines: readonly string[],
	headings: readonly NoteHeading[],
): boolean {
	let seen = 0;
	let spaced = 0;

	for (const heading of headings) {
		// A heading on the first line has nothing above it to judge by.
		if (heading.line === 0) continue;
		seen += 1;
		if ((lines[heading.line - 1] ?? "").trim().length === 0) spaced += 1;
	}

	return seen === 0 || spaced * 2 >= seen;
}

/** The stretch of lines a section holds itself, before any subsection. */
export interface OwnBody {
	start: number;
	end: number;
}

/**
 * What a heading owns without its subsections.
 *
 * A section's range runs to the next heading of the same or shallower level,
 * which is right for "what is under this heading" and wrong for "where does
 * something added to this heading go". Adding at the end of the whole range
 * puts it inside the last subsection while claiming it went to the parent.
 */
export function ownBody(
	lines: readonly string[],
	headings: readonly NoteHeading[],
	target: NoteHeading,
): OwnBody {
	const next = headings.find((heading) => heading.line > target.line);
	const end =
		next === undefined ? target.end : Math.min(target.end, next.line - 1);
	return { start: target.line + 1, end: Math.min(end, lines.length - 1) };
}

/** The heading a line sits under: the nearest one above it, whatever its level. */
export function nearestHeadingAbove(
	headings: readonly NoteHeading[],
	line: number,
): NoteHeading | null {
	let found: NoteHeading | null = null;
	for (const heading of headings) {
		if (heading.line >= line) break;
		found = heading;
	}
	return found;
}

/**
 * The indentation a task in this stretch sits at.
 *
 * Taken from the shallowest task already there, so a list that hangs under
 * something keeps its shape; nothing at all means the left margin. Only the
 * section's own tasks count — a subsection's list says nothing about the level
 * the parent writes at.
 */
export function baseIndent(lines: readonly string[], body: OwnBody): string {
	let best: string | null = null;

	for (let i = Math.max(body.start, 0); i <= body.end && i < lines.length; i++) {
		const match = TASK_LINE.exec(lines[i]);
		if (match === null) continue;
		if (best === null || indentWidth(match[1]) < indentWidth(best)) best = match[1];
	}

	return best ?? "";
}

/**
 * Shift every heading in a block by `shift` levels, and nothing else.
 *
 * "Every heading" as `headingsOf` means it, which is the whole point: the two
 * copies this replaces used a pattern of their own that skipped no fences and
 * asked for no space after the hashes, so moving a section that held a shell
 * example re-levelled `# comment in code` to `## comment in code` and turned a
 * bare `#` into `##` — inside somebody else's note, with a notice saying all
 * had gone well (found by audit, 6 sep 2026). A block always starts at its own
 * heading, so the fence state at its first line is "outside".
 *
 * Levels are clamped to the six markdown has, for the reason in `subLevel`.
 */
export function relevel(block: readonly string[], shift: number): string[] {
	let fence: string | null = null;

	return block.map((line) => {
		if (fence !== null) {
			if (line.trimStart().startsWith(fence)) fence = null;
			return line;
		}

		const fenceMatch = FENCE.exec(line);
		if (fenceMatch !== null) {
			fence = fenceMatch[1];
			return line;
		}

		const match = HEADING.exec(line);
		if (match === null) return line;

		const wanted = Math.min(6, Math.max(1, match[1].length + shift));
		return `${"#".repeat(wanted)}${line.slice(match[1].length)}`;
	});
}
