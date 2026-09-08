import type { CarryMode, CarryOutcome } from "../vault/writeback";

/**
 * What to tell the reader after carrying work into another note.
 *
 * A pure function on purpose. This is the one message in the plugin that has to
 * describe a write that can half-succeed, and it got that wrong in both
 * directions while it was buried in the view where no test could reach it — it
 * said *"it landed"* when nothing had been written, and *"nothing was carried"*
 * when the copy was already there (found by audit, 17 aug 2026). Logic that
 * subtle belongs somewhere it can be pinned down.
 *
 * Four things it has to get right:
 *
 *  - **Never claim a landing that did not happen**, and never deny one that did.
 *  - **Say the amount in items**, not lines: a reader counts tasks, and the
 *    lines are only worth adding because a block carries its subtasks along.
 *  - **Name the headings it had to write**, because they appear in a note the
 *    reader is not looking at.
 *  - **Say what stayed behind**, when a filtered branch had to leave part of the
 *    round under a task that is staying.
 */
export function carryMessage(
	outcome: CarryOutcome,
	mode: CarryMode,
	/** The other note's name, as the reader would say it. */
	target: string,
	/** Items of the round that stayed with the task they sit under. */
	held: number,
): string {
	if (outcome.kind === "refused") {
		switch (outcome.why) {
			case "missing":
				return "Task wheel: one of those notes is gone. Rescanned.";
			case "stale":
				// Nothing was written anywhere — the pre-check runs before the other
				// note is touched, which is the whole point of having one.
				return `Task wheel: nothing was carried — ${target} was left alone, because this note changed while you were choosing. Try again.`;
			case "nothing":
				return "Task wheel: nothing to carry there.";
			case "too-deep":
				// Nothing was written anywhere: the paste puts the note back
				// untouched rather than place half a shape (BC_E3_S168).
				return `Task wheel: nothing was carried — ${target} was left alone, because that section holds headings of its own and there they would run past the six levels markdown has. Carry it to a shallower place, or move its subsections first.`;
		}
	}

	const items = `${outcome.blocks} item${outcome.blocks === 1 ? "" : "s"}`;
	const lines =
		outcome.lines === outcome.blocks
			? ""
			: ` (${outcome.lines} line${outcome.lines === 1 ? "" : "s"})`;

	const made =
		outcome.created.length === 0
			? ""
			: `, making ${[...new Set(outcome.created)]
					.map((name) => `“${name}”`)
					.join(" › ")}`;

	const stayed =
		held === 0
			? ""
			: ` ${held} stayed with the task${held === 1 ? "" : "s"} they sit under.`;

	if (outcome.kind === "twice") {
		// The half-state the write order is built to allow. It is not a loss, but
		// the reader has to hear it or they meet the second copy by surprise.
		return `Task wheel: ${items}${lines} landed in ${target}${made}, but this note could not be emptied — the work is now in both. Remove it here by hand.${stayed}`;
	}

	const verb = mode === "copy" ? "Copied" : "Moved";
	return `Task wheel: ${verb.toLowerCase()} ${items}${lines} to ${target}${made}.${stayed}`;
}
