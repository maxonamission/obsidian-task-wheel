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
import {
	isFinished,
	type ParseOptions,
	type TaskFields,
	type WheelScope,
} from "../model/types";

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
 * Whether this task is inside what the wheel is looking at.
 *
 * A boundary rather than a rule: what falls outside was never in this round, so
 * it is not counted as filtered out either. Only two blikvelden narrow by
 * heading — a wheel over one section, and a wheel over one heading wherever it
 * is written (BC_E3_S146). The others narrow by *which notes are read*, which
 * is settled long before a task line is looked at.
 *
 * It lives here because two things ask it and they were not asking the same
 * one. `build-tree` had it and the carry did not, so on a heading wheel a
 * note-ring carry took every task out of the note — including the ones under
 * the headings this wheel is not about. Measured 6 sep 2026: the wheel showed
 * one task, the carry took two. The module docstring above says the wheel
 * carrying more than it shows is the same broken promise as carrying less, and
 * this is the half that was missing.
 *
 * Safe for a block: a task and everything indented under it share a heading
 * path, so this boundary never cuts a block in two.
 */
export function withinBlikveld(
	headingPath: readonly string[],
	scope: WheelScope,
): boolean {
	if (scope.kind === "section") {
		return scope.heading.every((step, i) => headingPath[i] === step);
	}
	if (scope.kind === "heading") {
		// The fallback wedge is the bucket for work under no heading, so a wheel
		// over it holds that work too (BC_E3_S157). Without this the step in
		// showed a wedge's other half only: measured, a fallback wedge of two
		// items opened on an empty wheel that said nothing about either of them.
		if (headingPath.length === 0) return scope.loose === true;
		return headingPath[0] === scope.heading;
	}
	return true;
}

/** Whether this blikveld leaves anything of a note's own outline out. */
export function narrowsByHeading(scope: WheelScope): boolean {
	return scope.kind === "section" || scope.kind === "heading";
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
	if (!withinBlikveld(headingPath, options.scope)) return false;
	if (isExcludedHeading(headingPath, options)) return false;
	if (!showsFinishedWork(options) && isFinished(fields)) return false;
	// The heading path goes to `matches` as well, not only to the skip rules.
	// Without it every task failed the `under` rule of BC_E3_S147 here while
	// passing it in `build-tree` — so with a heading filter on, a branch or a
	// note carried nothing at all and said "nothing to carry" about work the
	// wheel was showing (found by audit, 6 sep 2026).
	return matches(fields, options.filter, options.today, notePath, headingPath);
}
