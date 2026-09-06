/**
 * Replacing one line of a note, safely, as pure text.
 *
 * The decision "may this write happen, and what exactly comes out" is the part
 * worth testing, and it needs no vault to be made — so it is made here, and
 * `vault/writeback` is left with nothing but the file handling. Three things
 * this has to get right, all of which got caught once:
 *
 *  - **The line must still be the line.** The wheel draws from a scan that may
 *    be minutes old. If the note has been edited since, the write is abandoned
 *    rather than applied to whatever now sits at that index.
 *  - **Line endings.** A CRLF note splits with the carriage return attached,
 *    and the task pattern refuses such a line — so every review action on a
 *    Windows-authored or synced note was silently dropped. The ending comes off
 *    before the edit and goes back on after, on every line produced.
 *  - **One line may become several.** Ticking a recurring task off through the
 *    Tasks plugin yields the finished line and its next occurrence.
 *  - **The byte-order mark.** Some editors start a UTF-8 file with an invisible
 *    `U+FEFF`. It belongs to the encoding, not to the first line, and the parser
 *    reads without it — so it comes off here too and goes back on afterwards,
 *    or the first line would never match what the wheel is showing and the file
 *    would lose its mark on the first edit (BC_E3_S49).
 */

import { bomOf, withoutBom } from "./lines";

/**
 * A line the wheel is acting on, and what stood there when it was chosen.
 *
 * The line the reader is standing on is not the only line an edit depends on.
 * "Move this task under *that* heading" names a second one, chosen from a
 * picker, and until BC_E3_S44 nothing checked that the second one was still
 * itself: the edits ask only whether there is *a* heading on that line, never
 * which. So a note that shifted while the picker was open could take the task
 * to the wrong section and report that all was well (audit, 23 aug 2026).
 */
export interface LineAnchor {
	/** Zero-based, as the parser counts. */
	line: number;
	/** The line as it was read. */
	raw: string;
}

/**
 * Whether that line still says what it said.
 *
 * Trailing whitespace is ignored, for the same reason it is ignored below: a
 * carriage return is not somebody having edited the line.
 */
export function stillThere(lines: readonly string[], at: LineAnchor): boolean {
	const current = lines[at.line];
	return current !== undefined && current.trimEnd() === at.raw.trimEnd();
}

export type SpliceOutcome =
	/** The note was changed. */
	| "written"
	/** The line is not what we read; the caller should rescan. */
	| "stale"
	/** The line already said what we wanted it to say. */
	| "unchanged";

export interface SpliceResult {
	outcome: SpliceOutcome;
	/** The whole note, changed or exactly as it came in. */
	data: string;
}

/**
 * @param edit receives the line without its ending, and returns the lines to
 *   put in its place, or `null` to leave the note alone.
 */
export function spliceLine(
	data: string,
	index: number,
	expected: string,
	edit: (line: string) => string[] | null,
): SpliceResult {
	const mark = bomOf(data);
	const lines = withoutBom(data).split("\n");
	const current = lines[index];

	// Compared ignoring trailing whitespace only: a carriage return is not
	// somebody having edited the line, and neither is a stray trailing space.
	if (current === undefined || current.trimEnd() !== expected.trimEnd()) {
		return { outcome: "stale", data };
	}

	const ending = current.endsWith("\r") ? "\r" : "";
	const bare = ending === "" ? current : current.slice(0, -1);

	const next = edit(bare);
	if (next === null) return { outcome: "unchanged", data };

	lines.splice(index, 1, ...next.map((line) => line + ending));
	return { outcome: "written", data: mark + lines.join("\n") };
}

/**
 * Which ending this note is written with, read from the note as a whole.
 *
 * Asked of every line rather than of the one being edited. A note split on
 * `\n` gives its **last** line no `\r`, so a CRLF note without a closing
 * newline looked like an LF note whenever the edit stood on its last line: the
 * ending came out empty, the other lines kept their `\r` into the callback —
 * where `^…$` then matched no heading at all — and the note was written back
 * with the two kinds mixed and a stray `\r` at the end of the file (found by
 * audit, 6 sep 2026).
 */
function endingOf(raw: readonly string[]): string {
	return raw.some((line) => line.endsWith("\r")) ? "\r" : "";
}

/** The same lines with that ending taken off, so an edit sees bare text. */
function withoutEndings(raw: readonly string[], ending: string): string[] {
	return ending === ""
		? [...raw]
		: raw.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * Rewrite a whole note, having first checked that one line is still itself.
 *
 * Moving a task or adding one below it changes more than the line the reader
 * is standing on, so `spliceLine` cannot express it. The safety is the same and
 * for the same reason: the wheel draws from a scan that may be minutes old, so
 * the line it thinks it is acting on has to still be there.
 *
 * The endings come off every line and go back on afterwards, rather than only
 * off the one being edited — a note is written with one ending throughout, and
 * a mix would already be broken before we touched it.
 *
 * @param edit receives every line of the note without its ending, and returns
 *   the whole note back, or `null` to leave it alone.
 * @param also other lines this edit depends on — the heading or the parent task
 *   a picker named. Every one of them has to be what it was, or the edit is
 *   abandoned as stale: an edit that lands somewhere the reader did not choose
 *   is worse than one that refuses and asks again.
 */
export function spliceNote(
	data: string,
	index: number,
	expected: string,
	edit: (lines: string[]) => string[] | null,
	also: readonly LineAnchor[] = [],
): SpliceResult {
	const mark = bomOf(data);
	const raw = withoutBom(data).split("\n");
	const current = raw[index];

	if (current === undefined || current.trimEnd() !== expected.trimEnd()) {
		return { outcome: "stale", data };
	}

	if (!also.every((at) => stillThere(raw, at))) {
		return { outcome: "stale", data };
	}

	const ending = endingOf(raw);
	const bare = withoutEndings(raw, ending);

	const next = edit(bare);
	if (next === null) return { outcome: "unchanged", data };

	// Joined *between* the lines rather than appended to each of them. A note
	// ending in a newline splits with a final empty element, and giving that one
	// an ending too left a stray carriage return at the end of the file.
	const joined = mark + next.join(`${ending}\n`);
	return joined === data
		? { outcome: "unchanged", data }
		: { outcome: "written", data: joined };
}

/**
 * Rewrite a whole note with nothing to check first.
 *
 * The note something is being carried *into* has no line the wheel is standing
 * on — it may not even be open. There is nothing to go stale, because the write
 * only ever adds: whatever else changed in that note in the meantime is still
 * there afterwards. Endings are handled exactly as above.
 */
export function reshapeNote(
	data: string,
	edit: (lines: string[]) => string[] | null,
): SpliceResult {
	const mark = bomOf(data);
	const raw = withoutBom(data).split("\n");
	const ending = endingOf(raw);
	const bare = withoutEndings(raw, ending);

	const next = edit(bare);
	if (next === null) return { outcome: "unchanged", data };

	const joined = mark + next.join(`${ending}\n`);
	return joined === data
		? { outcome: "unchanged", data }
		: { outcome: "written", data: joined };
}
