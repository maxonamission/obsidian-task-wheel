/**
 * What the skip rules actually take out.
 *
 * The two "not every checkbox is a task" rules are a boundary rather than a
 * filter: what falls outside was never part of a round, so it is not counted as
 * left out either. That is the right accounting, but it leaves the rules
 * completely silent — a pattern that matches nothing looks exactly like one
 * that matches everything you hoped for, and the only visible evidence is a
 * number in the hub that you have to remember from before.
 *
 * So they get a report. Per pattern: how much it takes out, and which headings
 * it hit. And then the headings that are *still* in play, biggest first, which
 * is the list you actually need in order to write the next pattern — a heading
 * that is not in it is a heading you spelled differently than you thought.
 *
 * Deliberately its own pass rather than a by-product of `buildTree`: it is a
 * question you ask on purpose, at the cost of one scan, and nothing on the hot
 * path pays for it.
 */

import {
	inScope,
	isExcludedFolder,
	isExcludedType,
	matchesPattern,
} from "./domain";
import { outlineNote } from "./outline";
import { isFinished, type NoteInput, type ParseOptions } from "../model/types";

/** How many headings to name as examples of what a pattern caught. */
const EXAMPLES = 3;

/** How many surviving headings to list. */
const REMAINING = 20;

export interface PatternHit {
	/** The entry as the reader typed it. */
	pattern: string;
	/** Open checkboxes it takes out. */
	tasks: number;
	/** A few of the names it matched, so a pattern can be recognised at sight. */
	examples: string[];
}

export interface HeadingCount {
	heading: string;
	tasks: number;
}

export interface SkipReport {
	/** Open checkboxes in scope before any skip rule runs. */
	total: number;
	/** Open checkboxes the rules take out together, counted once each. */
	skipped: number;
	types: PatternHit[];
	headings: PatternHit[];
	/** Headings still in play, biggest first: the list to write the next rule from. */
	remaining: HeadingCount[];
}

/** What a checkbox with no heading above it is called in the report. */
export const NO_HEADING = "(no heading)";

export function skipReport(
	notes: NoteInput[],
	options: ParseOptions,
): SkipReport {
	const types = new Map<string, Tally>(blank(options.excludeNoteTypes));
	const headings = new Map<string, Tally>(blank(options.excludeHeadings));
	const remaining = new Map<string, number>();

	let total = 0;
	let skipped = 0;

	for (const note of notes) {
		// Folders and the wheel's own scope are a different setting with its own
		// visible list; a note they exclude is not part of this question at all.
		if (!inScope(note.path, options.scope)) continue;
		if (isExcludedFolder(note.path, options, options.scope)) continue;

		const open = outlineNote(note.content).filter((task) => !isFinished(task.fields));
		if (open.length === 0) continue;

		total += open.length;

		if (isExcludedType(note.frontmatterType, options)) {
			skipped += open.length;
			const type = (note.frontmatterType ?? "").trim().toLowerCase();
			for (const [pattern, tally] of types) {
				if (!matchesPattern(type, pattern)) continue;
				tally.tasks += open.length;
				remember(tally, note.frontmatterType ?? type);
			}
			continue;
		}

		for (const task of open) {
			const hit = task.headingPath.filter((heading) =>
				[...headings.keys()].some((pattern) =>
					matchesPattern(heading.trim().toLowerCase(), pattern),
				),
			);

			if (hit.length === 0) {
				const deepest = task.headingPath[task.headingPath.length - 1];
				const key = deepest ?? NO_HEADING;
				remaining.set(key, (remaining.get(key) ?? 0) + 1);
				continue;
			}

			skipped += 1;

			// Counted per pattern, so two rules that overlap each show what they
			// would take out on their own. That is the question being asked —
			// "does this line of mine do anything?" — and the honest answer to it
			// does not depend on what the line next to it does.
			for (const [pattern, tally] of headings) {
				const matched = hit.filter((heading) =>
					matchesPattern(heading.trim().toLowerCase(), pattern),
				);
				if (matched.length === 0) continue;
				tally.tasks += 1;
				remember(tally, matched[0]);
			}
		}
	}

	return {
		total,
		skipped,
		types: [...types].map(hit),
		headings: [...headings].map(hit),
		remaining: [...remaining]
			.map(([heading, tasks]) => ({ heading, tasks }))
			.sort((a, b) => b.tasks - a.tasks || compare(a.heading, b.heading))
			.slice(0, REMAINING),
	};
}

interface Tally {
	tasks: number;
	examples: Set<string>;
}

/** One empty tally per entry the reader typed, blank ones dropped. */
function blank(patterns: readonly string[]): Array<[string, Tally]> {
	return patterns
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0)
		.map((pattern) => [pattern, { tasks: 0, examples: new Set<string>() }]);
}

function remember(tally: Tally, name: string): void {
	if (tally.examples.size < EXAMPLES) tally.examples.add(name.trim());
}

function hit([pattern, tally]: [string, Tally]): PatternHit {
	return { pattern, tasks: tally.tasks, examples: [...tally.examples] };
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
