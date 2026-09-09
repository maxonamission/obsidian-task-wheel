import { describe, expect, it } from "vitest";
import { removeTaskLine } from "../parse/outline-edit";

/**
 * Taking one task line out of a note (BC_E3_S91).
 *
 * A forum report of "random empty checkboxes" from a misfired paste, set
 * against the README's own case for having no delete at all: cancelling
 * (`[-]`) already says "not doing this", and a decision like that is worth
 * keeping — but a `- [ ]` with no words was never a decision. The owner's
 * answer was narrow, "beperkt akkoord, en terughoudend", and the hard part of
 * that is the boundary: removing may never orphan a subtask or a note, so it
 * refuses outright the moment anything hangs under the line, and it hangs
 * that refusal on `blockLength` — the same count the moves already trust —
 * rather than writing a second definition of "what belongs to this task".
 */

describe("removeTaskLine — the boundary that keeps nothing orphaned", () => {
	it("refuses a task with a subtask hanging under it", () => {
		const lines = ["- [ ] Bellen", "    - [ ] Nummer opzoeken", "- [ ] Mailen"];

		// Removing line 0 would either take the subtask with it, unasked, or
		// leave it behind with no parent — neither is a thing this action may
		// ever do, so it does not get as far as deciding which.
		expect(removeTaskLine(lines, 0)).toBeNull();
	});

	it("refuses a task with an indented prose line hanging under it", () => {
		const lines = ["- [ ] Boodschappen", "    even bellen of de winkel open is"];

		// A note under a task is not a checkbox, but it is still the task's own
		// block — `blockLength` counts it, and so does this guard, on purpose.
		expect(removeTaskLine(lines, 0)).toBeNull();
	});

	it("removes a bare checkbox with nothing under it, leaving every other line exactly as it was", () => {
		const lines = ["- [ ] Bellen", "- [ ] ", "- [ ] Mailen"];

		const next = removeTaskLine(lines, 1);

		expect(next).toEqual(["- [ ] Bellen", "- [ ] Mailen"]);
	});

	it("leaves a prose line that follows the task, at the same or a shallower indent, untouched and unclaimed", () => {
		const lines = ["- [ ] Bellen", "even nadenken over de agenda"];

		// A line at column 0 after the task is not indented under it — it is the
		// next thing in the note, and the guard must not mistake it for a child
		// the way a naive "does anything follow" check would.
		const next = removeTaskLine(lines, 0);

		expect(next).toEqual(["even nadenken over de agenda"]);
	});

	it("refuses an index that is not a task line at all", () => {
		const lines = ["# Vandaag", "- [ ] Bellen"];

		expect(removeTaskLine(lines, 0)).toBeNull();
	});
});
