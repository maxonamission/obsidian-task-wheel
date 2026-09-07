import { describe, expect, it } from "vitest";
import { restartRoundsForAngle, stateFor, DEFAULT_SETTINGS } from "../settings";
import { roundRestartedMessage } from "../view/round";
import { VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * A changed angle is a new round, and it has to say so (BC_E3_S160).
 *
 * A node's id carries the wedge key, so a different source — or tag namespace,
 * or property, or fallback name — does not re-label the same wedges, it
 * replaces them. Every mark of every round is then about ids that no longer
 * exist, and the next `prune` swept them away without a word: 180 of 200 seen
 * became 0. Since BC_E3_S148 the angle is one tap away in the ⋯ menu, in the
 * middle of a round.
 *
 * The filter had this settled on 18 aug 2026 and said so out loud; the angle
 * did the same damage in silence.
 */

const NOTE_SCOPE: WheelScope = { kind: "note", path: "Werk/Plan.md" };

function settingsWithRounds(): ReturnType<typeof structuredClone<typeof DEFAULT_SETTINGS>> {
	const settings = structuredClone(DEFAULT_SETTINGS);

	const vault = stateFor(settings, VAULT_SCOPE);
	vault.seen = ["a", "b", "c"];
	vault.sweepStartedAt = "2026-09-06T10:00:00.000Z";
	vault.reading = "c";
	vault.roundDomains = ["Werk", "Thuis"];
	vault.roundWeights = { Werk: 3, Thuis: 1 };

	const note = stateFor(settings, NOTE_SCOPE);
	note.seen = ["d", "e"];
	note.sweepStartedAt = "2026-09-06T11:00:00.000Z";
	note.reading = "e";
	note.roundDomains = ["Nu"];

	return settings;
}

describe("restartRoundsForAngle", () => {
	it("gives up every round, on every wheel, and says how many", () => {
		// Not only the wheel in front: the angle is a plugin-wide setting, so
		// every round it invalidates is invalidated at the same moment.
		const settings = settingsWithRounds();

		expect(restartRoundsForAngle(settings)).toEqual({ restarted: 5 });

		for (const scope of [VAULT_SCOPE, NOTE_SCOPE]) {
			const state = stateFor(settings, scope);
			expect(state.seen).toEqual([]);
			expect(state.sweepStartedAt).toBeNull();
		}
	});

	it("drops the remembered place too, because it names a wedge as well", () => {
		const settings = settingsWithRounds();
		restartRoundsForAngle(settings);

		expect(stateFor(settings, VAULT_SCOPE).reading).toBeNull();
		expect(stateFor(settings, NOTE_SCOPE).reading).toBeNull();
	});

	it("deals the wedges afresh: order and weights both", () => {
		// A wedge set that no longer exists would otherwise keep its dealt order
		// and append every real one behind it (BC_E3_S82).
		const settings = settingsWithRounds();
		restartRoundsForAngle(settings);

		const vault = stateFor(settings, VAULT_SCOPE);
		expect(vault.roundDomains).toBeNull();
		expect(vault.roundWeights).toBeNull();
	});

	it("costs nothing when there was no round to give up", () => {
		// Flipping a control back to what it already said must not report a loss.
		const settings = structuredClone(DEFAULT_SETTINGS);
		expect(restartRoundsForAngle(settings)).toEqual({ restarted: 0 });
	});
});

describe("roundRestartedMessage", () => {
	it("names the act and what it cost, in that order", () => {
		expect(roundRestartedMessage(12, "a new angle")).toBe(
			"Task wheel: a new angle is a new round — the 12 items you had already passed are no longer marked.",
		);
	});

	it("counts one item as one item", () => {
		expect(roundRestartedMessage(1, "a new selection")).toContain("the 1 item you");
	});

	it("is the same sentence for both boundaries", () => {
		// The filter settled this on 18 aug 2026; the angle now borrows the
		// wording rather than growing a second one that can drift from it.
		const angle = roundRestartedMessage(4, "a new angle");
		const filter = roundRestartedMessage(4, "a new selection");
		expect(angle.replace("a new angle", "X")).toBe(
			filter.replace("a new selection", "X"),
		);
	});
});
