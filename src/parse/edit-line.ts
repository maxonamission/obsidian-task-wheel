/**
 * Rewriting one field of a task line, and nothing else.
 *
 * This is the module that touches somebody's notes, so it is built on one
 * rule: **whatever we do not understand, we do not move.** Unknown emoji,
 * plugin syntax we have never heard of, trailing comments, block references,
 * the exact spacing someone chose — all of it comes out the other side where
 * it went in. The wheel is a review instrument, not an editor (kaderdocument
 * §5, §10), and a review instrument that quietly reformats lines would be
 * worse than one that does nothing at all.
 *
 * Everything here is pure string work: no vault, no Obsidian, no file. That
 * makes the risky part testable without a window open — which is exactly the
 * part that deserves tests.
 */

import {
	BLOCK_REF,
	findSignifiers,
	type SignifierKind,
	TASK_LINE,
} from "./task-line";
import type { DateField, Priority } from "../model/types";

/** The glyph we write for each priority. Reading still accepts the others. */
export const PRIORITY_GLYPH: Readonly<Record<Priority, string>> = {
	highest: "🔺",
	high: "⏫",
	medium: "🔼",
	normal: "",
	low: "🔽",
	lowest: "⏬",
};

/** The date fields a review action may set. */
// Re-exported rather than re-declared: two identical unions in two files is
// one definition waiting to grow a fourth date in only one of them (found by
// audit, 6 sep 2026).
export type { DateField } from "../model/types";

const DATE_GLYPH: Readonly<Record<DateField, string>> = {
	due: "📅",
	scheduled: "⏳",
	start: "🛫",
};

const PRIORITY_KINDS: ReadonlySet<SignifierKind> = new Set([
	"priority-highest",
	"priority-high",
	"priority-medium",
	"priority-low",
	"priority-lowest",
]);

const DATE_KINDS: Readonly<Record<DateField, SignifierKind>> = {
	due: "due",
	scheduled: "scheduled",
	start: "start",
};

/** The pieces of a task line, so a rewrite can put back what it did not touch. */
interface Split {
	/** Everything up to and including `[x] `, verbatim. */
	head: string;
	body: string;
	statusChar: string;
}

function split(line: string): Split | null {
	const match = TASK_LINE.exec(line);
	if (match === null) return null;

	const [, , statusChar, body = ""] = match;
	// The head is whatever the line had before the body started, character for
	// character — including the list marker someone chose and the spacing after
	// the checkbox. Rebuilding it from parts would normalise it.
	return { head: line.slice(0, line.length - body.length), body, statusChar };
}

/**
 * Tick a task off, or untick it.
 *
 * Only the character between the brackets changes. A completion date is *not*
 * added here: Tasks writes one when it is configured to, and inventing our own
 * would put a field in the line that the user's own settings say should not be
 * there. Where the Tasks plugin is installed, the toggle goes through it
 * instead of through this function (kaderdocument §6).
 */
export function setDone(line: string, done: boolean): string {
	return setStatus(line, done ? "x" : " ");
}

/**
 * Set the character between the brackets to anything.
 *
 * The four Tasks defines are ` `, `/`, `x` and `-`. No field is written
 * alongside it, for the same reason `setDone` writes none: Tasks adds a
 * completion or cancellation date when it is configured to, and inventing one
 * here would put a field in the line that the user's own settings say should
 * not be there.
 */
export function setStatus(line: string, wanted: string): string {
	const parts = split(line);
	if (parts === null) return line;

	if (parts.statusChar === wanted) return line;

	// Walk back over the spacing after the checkbox; what is left is the closing
	// bracket, and the status character is the one before it. Searching for the
	// brackets by name instead looked safe and was not: the status character may
	// itself be a bracket, and `- [[] Bellen` then had the wrong pair replaced —
	// leaving a line that no longer parsed as a task at all.
	let at = parts.head.length - 1;
	while (at >= 0 && (parts.head[at] === " " || parts.head[at] === "\t")) at -= 1;
	if (at < 1 || parts.head[at] !== "]") return line;

	const status = at - 1;
	return parts.head.slice(0, status) + wanted + parts.head.slice(at) + parts.body;
}

/**
 * Set, change or remove the priority.
 *
 * `normal` means "no priority", which in Tasks syntax is the absence of a
 * glyph rather than a glyph of its own — so raising to normal removes the
 * marker instead of writing one.
 */
export function setPriority(line: string, priority: Priority): string {
	const parts = split(line);
	if (parts === null) return line;

	const glyph = PRIORITY_GLYPH[priority];
	const body = replaceOrAdd(
		parts.body,
		(kind) => PRIORITY_KINDS.has(kind),
		glyph === "" ? null : glyph,
		"",
	);

	return parts.head + body;
}

/** Set a date field, or remove it when the date is null. */
export function setDate(
	line: string,
	field: DateField,
	date: string | null,
): string {
	const parts = split(line);
	if (parts === null) return line;

	const wanted = DATE_KINDS[field];
	const body = replaceOrAdd(
		parts.body,
		(kind) => kind === wanted,
		date === null ? null : DATE_GLYPH[field],
		date ?? "",
	);

	return parts.head + body;
}

/**
 * Put a field where the old one was, or at the end if there was none.
 *
 * In place, not appended, and that is not cosmetic. Our parser reads tags out
 * of the description — the part before the first field — so a line ending in
 * `📅 2026-08-20 #werk` whose date was removed and re-appended would leave the
 * tag stranded behind a signifier, where nothing reads it any more. Replacing
 * in place also keeps the field order somebody chose, which is the whole
 * promise of this module.
 */
function replaceOrAdd(
	body: string,
	matches: (kind: SignifierKind) => boolean,
	glyph: string | null,
	value: string,
): string {
	const hits = findSignifiers(body).filter((hit) => matches(hit.kind));
	const field = glyph === null ? "" : value === "" ? glyph : `${glyph} ${value}`;

	if (hits.length === 0) {
		return field === "" ? body.trimEnd() : insertField(body, field);
	}

	// Any duplicates go; only the first one is rewritten, in its own place.
	const stripped = removeFields(body, matches, hits.slice(1));
	const first = hits[0];
	if (field === "") return removeFields(stripped, matches);

	return seam(
		stripped.slice(0, first.index) + field,
		stripped.slice(valueEnd(stripped, first)),
	);
}

/**
 * Drop every field of a kind, taking only what belongs to it.
 *
 * Reading a line and rewriting it need opposite instincts here. The parser
 * gives a field everything up to the next signifier, because it has to put
 * stray text somewhere. A rewrite may not be that greedy: `📅 2026-08-20
 * #werk` would then lose the tag, and `📅 2026-08-20 <!-- later -->` the
 * comment. So a removal takes the glyph plus the value we actually understand
 * — a date for a date field, nothing at all for a priority — and leaves every
 * other character standing.
 */
function removeFields(
	body: string,
	matches: (kind: SignifierKind) => boolean,
	only?: ReadonlyArray<{ index: number }>,
): string {
	const hits = findSignifiers(body);
	const wanted =
		only === undefined
			? hits.filter((hit) => matches(hit.kind))
			: hits.filter(
					(hit) =>
						matches(hit.kind) && only.some((pick) => pick.index === hit.index),
				);

	const cuts: Array<[number, number]> = wanted.map((hit) => [
		hit.index,
		valueEnd(body, hit),
	]);

	// Right to left, so the indices of the cuts still to come stay valid.
	let out = body;
	for (const [start, end] of cuts.reverse()) {
		out = seam(out.slice(0, start), out.slice(end));
	}
	return out.trimEnd();
}

/** Where a field's own text stops. */
function valueEnd(body: string, hit: { index: number; glyph: string; kind: SignifierKind }): number {
	let cursor = hit.index + hit.glyph.length;
	// `📅️` — the same glyph with a variation selector. Tasks writes both.
	if (body.charCodeAt(cursor) === 0xfe0f) cursor += 1;
	if (PRIORITY_KINDS.has(hit.kind)) return cursor;

	const rest = body.slice(cursor);
	const date = /^[ \t]*(\d{4}-\d{2}-\d{2})/.exec(rest);
	return date === null ? cursor : cursor + date[0].length;
}

/**
 * Close the gap a removal leaves, and only that gap.
 *
 * Runs of spaces elsewhere in the line are somebody's choice — a formatter
 * that tidied them would be rewriting text nobody asked us to touch.
 */
function seam(left: string, right: string): string {
	const before = left.replace(/[ \t]+$/, "");
	const after = right.replace(/^[ \t]+/, "");
	if (before === "") return after;
	if (after === "") return before;
	return `${before} ${after}`;
}

/**
 * Put a field back, in front of a trailing block reference.
 *
 * A block ref has to stay the last thing on the line or Obsidian stops seeing
 * it as one, and a link to a task is exactly the kind of thing a review action
 * must not break.
 */
function insertField(body: string, field: string): string {
	const ref = BLOCK_REF.exec(body);

	if (ref === null) return `${body.trimEnd()} ${field}`;

	const before = body.slice(0, ref.index).trimEnd();
	return `${before} ${field} ${ref[0].trim()}`;
}
