import { describe as group, expect, it } from "vitest";
import { moveHeadingUnder, planMoveUnder } from "../parse/outline-edit";
import { pasteInto } from "../parse/cross-note";
import { fitsAfterShift, MAX_LEVEL, relevel } from "../parse/sections";
import { headingsOf } from "../parse/outline";
import { carryMessage } from "../view/carry-message";

/**
 * A section keeps its shape, or it does not move (BC_E3_S168, audit 6 sep 2026).
 *
 * `relevel` clamps at six, which is right — a seventh hash is not a heading —
 * but a clamp is silent and what it silenced here was a *structure*. Measured:
 * a `#####` holding two `######`, moved under another `#####`, came out as
 * three `######` side by side. Moving it back took only the heading; its
 * subsections stayed behind under the parent it had visited. No text lost,
 * nothing said, and a notice reporting success.
 */

const NOTE = [
	"# Titel", // 0
	"", // 1
	"##### Diep", // 2
	"- [ ] Werk hier", // 3
	"###### Dieper A", // 4
	"- [ ] A1", // 5
	"###### Dieper B", // 6
	"- [ ] B1", // 7
	"", // 8
	"##### Ander diep", // 9
	"- [ ] Iets anders", // 10
];

const shape = (lines: readonly string[]): string[] =>
	headingsOf(lines).map((h) => `${h.level}:${h.text}`);

group("moving a section within one note", () => {
	it("refuses the move that would flatten it", () => {
		expect(planMoveUnder(NOTE, 2, 9)).toEqual({ shift: 1, fits: false });
		expect(moveHeadingUnder(NOTE, 2, 9)).toBeNull();
	});

	it("leaves the note exactly as it was", () => {
		// The measured "after": Diep, Dieper A and Dieper B as three level-six
		// siblings under Ander diep. None of that happens now.
		expect(shape(NOTE)).toEqual([
			"1:Titel",
			"5:Diep",
			"6:Dieper A",
			"6:Dieper B",
			"5:Ander diep",
		]);
	});

	it("still moves a section that has room", () => {
		// The same section, under the title: three levels shallower, shape intact.
		const moved = moveHeadingUnder(NOTE, 2, 0);
		expect(moved).not.toBeNull();
		expect(shape(moved ?? [])).toEqual([
			"1:Titel",
			"5:Ander diep",
			"5:Diep",
			"6:Dieper A",
			"6:Dieper B",
		]);
	});

	/**
	 * A lone deep heading is not a shape, so it moves.
	 *
	 * The refusal is about what a section *holds*; refusing every move at level
	 * six would take away something that works, which is a worse trade than the
	 * bug it came from.
	 */
	it("lets a deep section without subsections move", () => {
		const flat = ["# Titel", "##### Alleen", "- [ ] Iets", "##### Doel", "- [ ] Ander"];
		const moved = moveHeadingUnder(flat, 1, 3);
		expect(moved).not.toBeNull();
		expect(shape(moved ?? [])).toEqual(["1:Titel", "5:Doel", "6:Alleen"]);
	});
});

group("carrying a section into another note", () => {
	const block = NOTE.slice(2, 9);

	it("refuses rather than flatten it there", () => {
		const into = ["# Ander", "##### Bestemming", "- [ ] Iets"];
		const pasted = pasteInto(into, ["Bestemming"], { kind: "section", block });

		expect(pasted.refused).toBe("too-deep");
		// And the note comes back untouched: half a carry is the worst outcome
		// of the three, because the sentence can only be true about one note.
		expect(pasted.lines).toEqual(into);
	});

	it("carries it where there is room", () => {
		const into = ["# Ander", "## Bestemming", "- [ ] Iets"];
		const pasted = pasteInto(into, ["Bestemming"], { kind: "section", block });

		expect(pasted.refused).toBeUndefined();
		expect(shape(pasted.lines)).toEqual([
			"1:Ander",
			"2:Bestemming",
			"3:Diep",
			"4:Dieper A",
			"4:Dieper B",
		]);
	});

	it("says which of the two notes was left alone", () => {
		const said = carryMessage({ kind: "refused", why: "too-deep" }, "move", "Ander", 0);
		expect(said).toContain("nothing was carried");
		expect(said).toContain("Ander was left alone");
		expect(said).toContain("six levels");
	});
});

group("fitsAfterShift", () => {
	it("counts the deepest heading, not the first", () => {
		const block = ["### Kop", "#### Kind", "##### Kleinkind"];
		expect(fitsAfterShift(block, 1)).toBe(true);
		expect(fitsAfterShift(block, 2)).toBe(false);
	});

	it("skips what stands inside a fence", () => {
		// The reason `relevel` was rewritten in the first place: a shell example
		// is not an outline (audit 6 sep 2026).
		const block = ["###### Kop", "```sh", "# echo hoi", "```"];
		expect(fitsAfterShift(block, 1)).toBe(false);
		expect(fitsAfterShift(["##### Kop", "```sh", "###### diep", "```"], 1)).toBe(true);
	});

	it("lets a shift upwards through, which has a floor of its own", () => {
		expect(fitsAfterShift(["###### Kop", "###### Ander"], -5)).toBe(true);
		expect(fitsAfterShift([], 3)).toBe(true);
	});

	it("agrees with what relevel would actually do", () => {
		// The two read one walk; this is the test that says the answer and the
		// action cannot part company.
		for (const shift of [1, 2, 3]) {
			const block = ["#### Kop", "##### Kind"];
			const done = relevel(block, shift);
			const clamped = headingsOf(done).some((h) => h.level === MAX_LEVEL)
				&& headingsOf(block).some((h) => h.level + shift > MAX_LEVEL);
			expect(fitsAfterShift(block, shift)).toBe(!clamped);
		}
	});
});
