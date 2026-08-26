import { describe, expect, it } from "vitest";
import { openAround } from "../model/resume";

/**
 * Where a wheel opens (BC_E3_S52).
 *
 * The reader found this by restarting Obsidian halfway through a round and
 * landing back at the beginning (eigenaar, 23 aug 2026). The rule is small
 * enough to state in three lines and easy enough to break silently, which is
 * exactly the kind that belongs out here where it can be asked.
 */

const wheel = (...ids: string[]) => (id: string) => ids.includes(id);

describe("where a wheel opens", () => {
	it("does not move a reader who is already somewhere", () => {
		expect(openAround("t:hier", "t:daar", wheel("t:hier", "t:daar"))).toBe(
			"t:hier",
		);
	});

	it("goes back to where this blikveld was left", () => {
		expect(openAround(null, "t:daar", wheel("t:hier", "t:daar"))).toBe("t:daar");
	});

	it("starts at the first stop when nothing is remembered", () => {
		expect(openAround(null, null, wheel("t:hier"))).toBeNull();
		// A round that was just started afresh clears what it remembered, and an
		// older `data.json` has no such field at all.
		expect(openAround(null, undefined, wheel("t:hier"))).toBeNull();
	});

	it("ignores a place that is no longer on the wheel", () => {
		// The task was finished in the editor, renamed, or carried away while the
		// wheel was closed. Not an error — just not an answer.
		expect(openAround(null, "t:weg", wheel("t:hier"))).toBeNull();
		expect(openAround("t:weg", "t:daar", wheel("t:hier", "t:daar"))).toBe(
			"t:daar",
		);
	});
});
