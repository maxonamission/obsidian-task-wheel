import { describe, expect, it } from "vitest";
import { hasHeadingPath, headingsAt } from "../parse/outline";

/**
 * Finding a section again by the name the wheel shows (BC_E3_S84).
 *
 * A wedge on a note wheel *is* a heading, but the wheel only learns headings as
 * the ancestors of tasks — so a heading whose last open task is ticked off
 * leaves no node behind, while the heading itself sits untouched in the
 * document. To put a task back into it, the write has to find it again, and the
 * only thing it has to go on is the name on the drawing.
 *
 * The subtlety is "as the wheel reads it": a heading that merely repeats the
 * note's name gets no ring (BC_E3_S70), so a caller asking the raw file would
 * look one level too deep.
 */

const PLAIN = ["## Work", "- [ ] a", "## Home", "- [ ] b"].join("\n");

// The note opens with a heading that is its own name — no ring, so the wheel's
// wedges are the two below it.
const TITLED = ["# Plan", "## Work", "- [ ] a", "## Home", "- [ ] b"].join("\n");

describe("finding a wedge's heading again", () => {
	it("answers with the heading, not merely with yes", () => {
		const found = headingsAt("Notes/Plain.md", PLAIN, ["Work"]);
		expect(found).toHaveLength(1);
		expect(found[0].text).toBe("Work");
		expect(found[0].line).toBe(0);
		// And the stretch of lines it owns, which is where a task goes.
		expect(found[0].end).toBe(1);
	});

	it("reads past a heading that only repeats the note's name", () => {
		// The wheel gives that heading no ring, so `Work` is a wedge and not a
		// child of one. A caller working from the raw file would miss it.
		const found = headingsAt("Notes/Plan.md", TITLED, ["Work"]);
		expect(found).toHaveLength(1);
		expect(found[0].line).toBe(1);

		expect(headingsAt("Notes/Plan.md", TITLED, ["Plan", "Work"])).toEqual([]);
	});

	it("finds a deeper section by its whole path", () => {
		const deep = ["## Work", "### Client", "- [ ] a"].join("\n");
		expect(headingsAt("N.md", deep, ["Work", "Client"])[0].line).toBe(1);
		expect(headingsAt("N.md", deep, ["Client"])).toEqual([]);
	});

	it("says nothing about a heading that is gone", () => {
		// Which is the whole point: gone is not the same as empty, and the write
		// has to be able to tell the reader which of the two it found.
		expect(headingsAt("Notes/Plain.md", PLAIN, ["Health"])).toEqual([]);
		expect(headingsAt("Notes/Plain.md", PLAIN, [])).toEqual([]);
	});

	it("hands back both when a note says the same thing twice", () => {
		// Two identical headings are already *one* wedge on the wheel, because a
		// wedge is keyed on its text. So this is not a new ambiguity — it is that
		// one, made visible. Document order, so a caller can take the first.
		const twice = ["## Work", "- [ ] a", "## Work", "- [ ] b"].join("\n");
		const found = headingsAt("N.md", twice, ["Work"]);
		expect(found.map((h) => h.line)).toEqual([0, 2]);
	});

	it("ignores a heading inside a fenced block", () => {
		const fenced = ["```", "## Work", "```", "## Home", "- [ ] b"].join("\n");
		expect(headingsAt("N.md", fenced, ["Work"])).toEqual([]);
		expect(headingsAt("N.md", fenced, ["Home"])).toHaveLength(1);
	});

	it("keeps answering the old question the same way", () => {
		// `hasHeadingPath` now runs on this walk. The two used to be written out
		// separately and their path-stripping drifted apart within a week.
		for (const heading of [["Work"], ["Health"], ["Plan", "Work"], []]) {
			expect(hasHeadingPath("Notes/Plan.md", TITLED, heading)).toBe(
				headingsAt("Notes/Plan.md", TITLED, heading).length > 0,
			);
		}
	});
});
