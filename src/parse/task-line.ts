/**
 * Parsing a single markdown line in Obsidian Tasks syntax.
 *
 * We deliberately do not invent a format (build brief §4): the checkbox is
 * plain markdown, and the metadata are the emoji signifiers the Tasks plugin
 * established. What we cannot interpret we keep verbatim, so a review action
 * can rewrite one field without disturbing the rest of the line.
 */

import type { Priority, TaskFields, TaskState } from "../model/types";

/**
 * `- [ ] ...`, `* [x] ...`, `+ [/] ...`, `1. [ ] ...`, `2) [ ] ...`.
 *
 * The status character may be anything — Tasks supports custom statuses, and
 * refusing them would drop somebody's `- [/]` half-done items. But a checkbox
 * must be **followed by whitespace or nothing at all**, and that is what tells
 * it apart from a link: `- [R](https://…)` is a bullet holding a markdown
 * link, not a task with the status "R". Without that rule an ordinary prose
 * list on a wiki-style page turned into open work (found by the owner, 14 aug
 * 2026).
 */
export const TASK_LINE =
	/^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[(.)\](?:[ \t]+(.*)|[ \t]*$)/;

/** A tab counts as this many columns when comparing indentation. */
const TAB_WIDTH = 4;

/**
 * What the character between the brackets means.
 *
 * The four Tasks defines, and nothing else: `x` done, `-` cancelled, `/` in
 * progress, everything else open. Tasks lets a vault define its own statuses on
 * top of these, and those land on "open" on purpose — an unknown character is
 * not a reason to take work out of a round. Erring the other way would hide
 * somebody's work behind a setting they never made.
 */
export function stateOf(statusChar: string): TaskState {
	switch (statusChar) {
		case "x":
		case "X":
			return "done";
		case "-":
			return "cancelled";
		case "/":
			return "in-progress";
		default:
			return "open";
	}
}

/**
 * The bracket character each state wears on a line — the inverse of `stateOf`.
 *
 * Beside it, and exported, because three places knew this mapping and only one
 * of them said so: `stateOf` read it one way, a private table in `build-tree`
 * read it the other, and the card's own actions wrote the characters out as
 * literals (audit 6 sep 2026, BC_E3_S172). Three copies of an alphabet is how a
 * fifth status comes to mean two things.
 *
 * `stateOf` stays the wider of the two: it takes *any* character, because a
 * vault may define statuses of its own and an unknown one is open work rather
 * than a reason to drop it. This table is the narrow direction — what the wheel
 * writes when it is the one deciding.
 */
export const STATUS_CHAR: Readonly<Record<TaskState, string>> = {
	open: " ",
	"in-progress": "/",
	done: "x",
	cancelled: "-",
};

/**
 * Emoji signifiers, longest first so a two-code-point emoji is never shadowed
 * by a one-code-point prefix. Several dates accept more than one glyph because
 * Tasks itself does.
 */
const SIGNIFIERS: ReadonlyArray<readonly [string, SignifierKind]> = [
	["🔺", "priority-highest"],
	["⏫", "priority-high"],
	["🔼", "priority-medium"],
	["🔽", "priority-low"],
	["⏬", "priority-lowest"],
	["🔁", "recurrence"],
	["🛫", "start"],
	["⏳", "scheduled"],
	["⌛", "scheduled"],
	["📅", "due"],
	["📆", "due"],
	["🗓", "due"],
	["✅", "completed"],
	["❌", "cancelled"],
	["➕", "created"],
	["🆔", "taskId"],
	["⛔", "dependsOn"],
];

export type SignifierKind =
	| "priority-highest"
	| "priority-high"
	| "priority-medium"
	| "priority-low"
	| "priority-lowest"
	| "recurrence"
	| "start"
	| "scheduled"
	| "due"
	| "completed"
	| "cancelled"
	| "created"
	| "taskId"
	| "dependsOn";

const PRIORITY_BY_KIND: Readonly<Partial<Record<SignifierKind, Priority>>> = {
	"priority-highest": "highest",
	"priority-high": "high",
	"priority-medium": "medium",
	"priority-low": "low",
	"priority-lowest": "lowest",
};

/** `#tag`, `#nested/tag`. Not preceded by a word character, so `a#b` is safe. */
const TAG = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/** A trailing block reference such as `^a1b2c3`. */
export const BLOCK_REF = /\s*\^[\p{L}\p{N}-]+\s*$/u;

/** An ISO date at the start of a field value. */
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;

/** The result of looking at one line: a task, or not a task at all. */
export interface ParsedTaskLine {
	indent: number;
	fields: TaskFields;
}

/** Width of the leading whitespace in columns, with tabs expanded. */
export function indentWidth(whitespace: string): number {
	let width = 0;
	for (const ch of whitespace) {
		width += ch === "\t" ? TAB_WIDTH - (width % TAB_WIDTH) : 1;
	}
	return width;
}

/**
 * Parse one line. Returns `null` when the line is not a task checkbox, which
 * is the common case — the caller walks every line of every note.
 */
export function parseTaskLine(line: string): ParsedTaskLine | null {
	const match = TASK_LINE.exec(line);
	if (match === null) return null;

	const [, whitespace, statusChar, body] = match;
	// The body is absent, not empty, when the line is a bare `- [x]`.
	const fields = parseTaskBody(body ?? "", statusChar, line);
	return { indent: indentWidth(whitespace), fields };
}

/**
 * Split the part after the checkbox into description, tags and fields.
 *
 * The scan is positional: everything up to the first signifier is the
 * description, and each signifier owns the text up to the next one. That
 * mirrors how Tasks itself reads a line and, unlike a set of independent
 * regexes, it cannot accidentally pick a date out of the description.
 */
function parseTaskBody(body: string, statusChar: string, raw: string): TaskFields {
	const fields: TaskFields = {
		statusChar,
		done: statusChar === "x" || statusChar === "X",
		state: stateOf(statusChar),
		priority: "normal",
		dependsOn: [],
		tags: [],
		description: "",
		raw,
	};

	const hits = findSignifiers(body);
	const descriptionEnd = hits.length > 0 ? hits[0].index : body.length;

	for (let i = 0; i < hits.length; i++) {
		const hit = hits[i];
		const valueStart = hit.index + hit.glyph.length;
		const valueEnd = i + 1 < hits.length ? hits[i + 1].index : body.length;
		applyField(fields, hit.kind, body.slice(valueStart, valueEnd).trim());
	}

	const descriptionRaw = body.slice(0, descriptionEnd).replace(BLOCK_REF, "");

	// Tags are read from the whole line, not only from the description. Tasks
	// itself accepts them anywhere, and people write them after the dates —
	// `- [ ] Bellen 📅 2026-08-20 #werk`. Reading only the description dropped
	// those silently, which with tag-based domains put the task in the wrong
	// wedge (found while testing the review actions, BC_E3_S6).
	fields.tags = collectTags(body.replace(BLOCK_REF, ""));
	fields.description = stripTags(descriptionRaw).replace(/\s+/g, " ").trim();

	return fields;
}

export interface SignifierHit {
	index: number;
	glyph: string;
	kind: SignifierKind;
}

/** All signifier occurrences in the body, in reading order, non-overlapping. */
/**
 * Every field marker in the body, in the order they appear.
 *
 * Exported because rewriting a field has to find it exactly the way reading it
 * did. Two scanners would drift, and the one that drifts is the one that
 * writes to the vault.
 */
export function findSignifiers(body: string): SignifierHit[] {
	const hits: SignifierHit[] = [];
	let cursor = 0;

	while (cursor < body.length) {
		let found: SignifierHit | null = null;
		for (const [glyph, kind] of SIGNIFIERS) {
			if (body.startsWith(glyph, cursor)) {
				found = { index: cursor, glyph, kind };
				break;
			}
		}
		if (found !== null) {
			hits.push(found);
			cursor += found.glyph.length;
			// Skip a trailing variation selector so `📅️ 2026-01-01` parses.
			if (body.charCodeAt(cursor) === 0xfe0f) cursor += 1;
		} else {
			cursor += 1;
		}
	}

	return hits;
}

function applyField(fields: TaskFields, kind: SignifierKind, value: string): void {
	const priority = PRIORITY_BY_KIND[kind];
	if (priority !== undefined) {
		fields.priority = priority;
		return;
	}

	switch (kind) {
		case "recurrence":
			if (value.length > 0) fields.recurrence = value;
			return;
		case "taskId":
			if (value.length > 0) fields.taskId = value;
			return;
		case "dependsOn":
			fields.dependsOn = value
				.split(",")
				.map((id) => id.trim())
				.filter((id) => id.length > 0);
			return;
		default:
			applyDate(fields, kind, value);
	}
}

function applyDate(fields: TaskFields, kind: SignifierKind, value: string): void {
	const date = ISO_DATE.exec(value)?.[1];
	if (date === undefined) return;

	switch (kind) {
		case "due":
			fields.due = date;
			break;
		case "scheduled":
			fields.scheduled = date;
			break;
		case "start":
			fields.start = date;
			break;
		case "created":
			fields.created = date;
			break;
		case "completed":
			fields.completed = date;
			break;
		case "cancelled":
			fields.cancelled = date;
			break;
		default:
			break;
	}
}

function collectTags(text: string): string[] {
	const tags: string[] = [];
	TAG.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG.exec(text)) !== null) {
		if (!tags.includes(match[1])) tags.push(match[1]);
	}
	return tags;
}

function stripTags(text: string): string {
	TAG.lastIndex = 0;
	return text.replace(TAG, (whole) => (whole.startsWith(" ") ? " " : ""));
}
