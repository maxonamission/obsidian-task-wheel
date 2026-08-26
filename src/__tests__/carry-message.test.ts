import { describe, expect, it } from "vitest";
import { carryMessage } from "../view/carry-message";
import type { CarryOutcome } from "../vault/writeback";

/**
 * The one message in the plugin that describes a write which can half-succeed.
 *
 * It was buried in the view where no test could reach it, and it got the two
 * interesting cases backwards: it claimed a landing that never happened, and
 * denied one that had (found by audit, 17 aug 2026). So the rule these tests
 * hold it to is blunt — **never claim a landing that did not happen, and never
 * deny one that did.**
 */

const amount = { created: [], lines: 1, blocks: 1 };

describe("when nothing was written anywhere", () => {
	it("does not say it landed, and says why", () => {
		const said = carryMessage(
			{ kind: "refused", why: "stale" },
			"move",
			"Ooit misschien",
			0,
		);

		expect(said).toContain("nothing was carried");
		expect(said).toContain("left alone");
		expect(said).not.toMatch(/\blanded\b/);
	});

	it("says a missing note is missing", () => {
		expect(
			carryMessage({ kind: "refused", why: "missing" }, "copy", "Later", 0),
		).toContain("gone");
	});

	it("says there was nothing to carry", () => {
		expect(
			carryMessage({ kind: "refused", why: "nothing" }, "copy", "Later", 0),
		).toContain("nothing to carry");
	});
});

describe("when it landed", () => {
	it("counts items rather than lines, and names the note", () => {
		const said = carryMessage(
			{ kind: "moved", created: [], lines: 3, blocks: 1 },
			"move",
			"Ooit misschien",
			0,
		);

		expect(said).toContain("1 item");
		// The lines are worth adding only because a block carries its subtasks.
		expect(said).toContain("(3 lines)");
		expect(said).toContain("Ooit misschien");
	});

	it("leaves the line count out when it says nothing extra", () => {
		expect(carryMessage({ kind: "moved", ...amount }, "move", "Later", 0)).not.toContain(
			"line",
		);
	});

	it("uses the reader's own verb", () => {
		expect(carryMessage({ kind: "copied", ...amount }, "copy", "Later", 0)).toContain(
			"copied",
		);
		expect(carryMessage({ kind: "moved", ...amount }, "move", "Later", 0)).toContain(
			"moved",
		);
	});

	it("names the headings it had to write, without repeating one", () => {
		const said = carryMessage(
			{ kind: "moved", created: ["Werk", "Werk", "Klanten"], lines: 1, blocks: 1 },
			"move",
			"Later",
			0,
		);

		expect(said).toContain("“Werk” › “Klanten”");
	});

	it("says what stayed behind under a task that is staying", () => {
		const said = carryMessage({ kind: "moved", ...amount }, "move", "Later", 2);
		expect(said).toContain("2 stayed with the tasks they sit under");
	});
});

describe("when it landed but the source could not be emptied", () => {
	const twice: CarryOutcome = { kind: "twice", created: [], lines: 2, blocks: 2 };

	it("says both halves of the truth", () => {
		const said = carryMessage(twice, "move", "Ooit misschien", 0);

		// The half-state the write order is built to allow. Denying the landing
		// would send the reader looking for work that is already there; denying
		// the failure would leave them to meet the second copy by surprise.
		expect(said).toContain("landed in Ooit misschien");
		expect(said).toContain("in both");
		expect(said).not.toContain("nothing was carried");
	});

	it("tells the reader what is left to do", () => {
		expect(carryMessage(twice, "move", "Later", 0)).toContain("by hand");
	});
});
