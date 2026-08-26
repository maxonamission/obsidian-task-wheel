/**
 * Possible duplicate tasks: the same words behind more than one checkbox.
 *
 * A duplicate quietly breaks the round's promise: tick one copy off and the
 * other stays on the wheel as open work, so a closed round overstates what is
 * left. Spotting them is review integrity, not task management — which is why
 * the report only *names* candidates and never hides or merges anything
 * (kaderdocument §1.1): two identical texts can legitimately be two tasks.
 *
 * Only exact matches after normalisation (case, whitespace). The compared text
 * is the description with fields and tags already stripped, so two copies of
 * which one later gained a due date still find each other — that is the likely
 * duplicate, not the exception. Fuzzy matching is deliberately out: a false
 * positive in an integrity report costs more than it earns.
 *
 * Counted on the wheel's own terms: open and in-progress work, inside the
 * skip rules and excluded folders. A checkbox with no words of its own (only
 * fields or tags) cannot match by text and is left aside — counted, so the
 * report can say so instead of going quiet about it.
 *
 * Like the skip report, deliberately its own pass rather than a by-product of
 * `buildTree`: a question you ask on purpose, at the cost of one scan.
 */

import {
	inScope,
	isExcludedFolder,
	isExcludedHeading,
	isExcludedType,
} from "./domain";
import { outlineNote } from "./outline";
import { isFinished, type NoteInput, type ParseOptions } from "../model/types";

/** One checkbox that shares its words with at least one other. */
export interface DuplicateOccurrence {
	/** Vault-relative path of the note it sits in. */
	path: string;
	/** Line index as the outline read it, for jumping straight to it. */
	line: number;
	/** The deepest heading above it, to tell two copies apart at sight. */
	heading: string | null;
}

export interface DuplicateGroup {
	/** The shared words, spelled as the first occurrence spells them. */
	description: string;
	/** Everywhere those words appear, in scan order. */
	occurrences: DuplicateOccurrence[];
}

export interface DuplicateReport {
	/** Open checkboxes considered: in scope, skip rules already applied. */
	total: number;
	/** Checkboxes left aside because the line holds no words of its own. */
	blank: number;
	/** Groups of two or more, biggest first. Complete — the view may cap. */
	groups: DuplicateGroup[];
}

export function duplicateReport(
	notes: NoteInput[],
	options: ParseOptions,
): DuplicateReport {
	const seen = new Map<
		string,
		{ description: string; occurrences: DuplicateOccurrence[] }
	>();

	let total = 0;
	let blank = 0;

	for (const note of notes) {
		// The same boundary as the wheel itself: what a scope, folder, type or
		// heading rule keeps out was never part of a round, so a copy hiding
		// there cannot break one either.
		if (!inScope(note.path, options.scope)) continue;
		if (isExcludedFolder(note.path, options)) continue;
		if (isExcludedType(note.frontmatterType, options)) continue;

		for (const task of outlineNote(note.content)) {
			if (isFinished(task.fields)) continue;
			if (isExcludedHeading(task.headingPath, options)) continue;

			total += 1;

			const key = task.fields.description
				.trim()
				.replace(/\s+/g, " ")
				.toLowerCase();
			if (key.length === 0) {
				blank += 1;
				continue;
			}

			const group = seen.get(key) ?? {
				description: task.fields.description.trim().replace(/\s+/g, " "),
				occurrences: [],
			};
			group.occurrences.push({
				path: note.path,
				line: task.line,
				heading: task.headingPath[task.headingPath.length - 1] ?? null,
			});
			seen.set(key, group);
		}
	}

	return {
		total,
		blank,
		groups: [...seen.values()]
			.filter((group) => group.occurrences.length > 1)
			.sort(
				(a, b) =>
					b.occurrences.length - a.occurrences.length ||
					compare(a.description, b.description),
			),
	};
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
