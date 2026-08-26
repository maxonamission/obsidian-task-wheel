/**
 * What a round is about — in one place, asked the same way by everyone.
 *
 * "Is this task part of this round" is not one question but three, and they are
 * asked in order by `build-tree` as it builds the wheel:
 *
 *  1. **Skip rules.** Checkboxes under a heading that names a checklist belong
 *     to the document, not to anybody's plate. They were never in the round.
 *  2. **Finished work.** Off by default; the setting is the standing answer and
 *     the status filter overrules it for one round.
 *  3. **The filter.** What the reader narrowed this round to.
 *
 * Carrying work into another note has to ask the same question, and it asked
 * only the third — so a branch carried finished tasks the wheel was not showing,
 * and checkboxes from under a skipped heading with them (found by audit, 17 aug
 * 2026). The wheel carrying more than it shows is the same broken promise as
 * carrying less; §3.3 does not care which direction the lie runs.
 *
 * So the question lives here, and both callers ask it. This module is pure and
 * knows no vault: a line's fields and where it sits, in — yes or no, out.
 */

import { isExcludedHeading } from "./domain";
import { matches } from "./filter";
import { isFinished, type ParseOptions, type TaskFields } from "../model/types";

/**
 * Whether finished work is part of this round at all.
 *
 * The setting is the standing answer; the filter overrules it for one round,
 * because asking for finished work in the filter is asking for it.
 */
export function showsFinishedWork(options: ParseOptions): boolean {
	return options.includeCompleted || options.filter.status === "finished";
}

/**
 * Whether one task belongs to this round **in its own right**.
 *
 * "In its own right" is the load-bearing part. The tree also holds *carriers* —
 * tasks that fail the filter but are drawn anyway so the kept work below them
 * can be reached. A carrier is scaffolding: it may not be counted as work, and
 * it may certainly not be carried into another note, because that would move
 * exactly what the filter set aside.
 */
export function inRound(
	fields: TaskFields,
	headingPath: readonly string[],
	notePath: string,
	options: ParseOptions,
): boolean {
	if (isExcludedHeading(headingPath, options)) return false;
	if (!showsFinishedWork(options) && isFinished(fields)) return false;
	return matches(fields, options.filter, options.today, notePath);
}
