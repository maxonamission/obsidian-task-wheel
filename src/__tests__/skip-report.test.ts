import { describe, expect, it } from "vitest";
import { NO_HEADING, skipReport } from "../parse/skip-report";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

/**
 * The report exists because the skip rules are silent by design.
 *
 * What falls outside them was never part of a round, so it is not counted as
 * left out — right for the wheel, but it means a pattern that matches nothing
 * looks exactly like one that works. The report is the difference.
 */

function options(over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, ...over };
}

const RECIPE: NoteInput = {
	path: "Recepten/Stoofperen.md",
	content: [
		"## Ingrediënten",
		"- [ ] 12 stoofperen",
		"- [ ] 1 fles rode wijn",
		"## Bereiding",
		"- [ ] Schil de peren",
	].join("\n"),
};

const STORY: NoteInput = {
	path: "stories/BC_E3_S6.md",
	content: ["## Acceptatiecriteria", "- [ ] Een criterium", "- [x] Afgevinkt"].join(
		"\n",
	),
	frontmatterType: "story",
};

const PLAIN: NoteInput = {
	path: "Werk/Plan.md",
	content: "- [ ] Loodgieter bellen",
};

describe("what each rule takes out", () => {
	it("counts nothing skipped when nothing is typed", () => {
		const report = skipReport([RECIPE, PLAIN], options());
		expect(report.total).toBe(4);
		expect(report.skipped).toBe(0);
		expect(report.headings).toEqual([]);
	});

	it("says how much a pattern takes out, and names what it hit", () => {
		const report = skipReport([RECIPE, PLAIN], options({ excludeHeadings: ["ingredi*"] }));
		expect(report.skipped).toBe(2);
		expect(report.headings).toEqual([
			{ pattern: "ingredi*", tasks: 2, examples: ["Ingrediënten"] },
		]);
	});

	it("says so in as many words when a pattern takes out nothing", () => {
		// This is the case the report exists for: from the wheel, a rule that
		// matches nothing and a rule that works look identical.
		const report = skipReport(
			[RECIPE, PLAIN],
			options({ excludeHeadings: ["accepta*", "ingredi*", "boodschap*"] }),
		);
		expect(report.headings.map((hit) => [hit.pattern, hit.tasks])).toEqual([
			["accepta*", 0],
			["ingredi*", 2],
			["boodschap*", 0],
		]);
	});

	it("keeps every typed entry, in the order it was typed", () => {
		// A comma-separated line is read as a list; a report that quietly dropped
		// the entries after the first would be the very thing under suspicion.
		const typed = "accepta*, leestip*, ingredi*, boodschap*, recommendati*";
		const report = skipReport(
			[RECIPE],
			options({ excludeHeadings: typed.split(",").map((entry) => entry.trim()) }),
		);
		expect(report.headings.map((hit) => hit.pattern)).toEqual([
			"accepta*",
			"leestip*",
			"ingredi*",
			"boodschap*",
			"recommendati*",
		]);
	});

	it("counts each pattern on its own, overlaps and all", () => {
		// 'Does my line do anything?' does not depend on what the line next to
		// it does, so two rules that cover the same checkbox each claim it.
		const report = skipReport(
			[RECIPE],
			options({ excludeHeadings: ["ingredi*", "*iënten"] }),
		);
		expect(report.headings.map((hit) => hit.tasks)).toEqual([2, 2]);
		// ...but the total counts it once.
		expect(report.skipped).toBe(2);
	});

	it("reports the note-type rule by the checkboxes it removes", () => {
		const report = skipReport([STORY, PLAIN], options({ excludeNoteTypes: ["story"] }));
		expect(report.total).toBe(2);
		expect(report.skipped).toBe(1);
		expect(report.types).toEqual([
			{ pattern: "story", tasks: 1, examples: ["story"] },
		]);
	});
});

describe("the headings still in play", () => {
	it("lists what is left, biggest first", () => {
		const busy: NoteInput = {
			path: "Werk/Kanban.md",
			content: ["## Focus", "- [ ] Een", "- [ ] Twee", "- [ ] Drie"].join("\n"),
		};
		const report = skipReport(
			[RECIPE, PLAIN, busy],
			options({ excludeHeadings: ["ingredi*"] }),
		);
		expect(report.remaining).toEqual([
			{ heading: "Focus", tasks: 3 },
			// A tie falls back to the name, so the order is at least stable.
			{ heading: NO_HEADING, tasks: 1 },
			{ heading: "Bereiding", tasks: 1 },
		]);
	});

	it("names a checkbox that sits under no heading at all", () => {
		// The failure that looks like a broken pattern: a checklist nobody put a
		// heading above cannot be caught by a heading rule, whatever you type.
		const report = skipReport([PLAIN], options({ excludeHeadings: ["*"] }));
		expect(report.skipped).toBe(0);
		expect(report.remaining).toEqual([{ heading: NO_HEADING, tasks: 1 }]);
	});

	it("counts a nested checkbox under its deepest heading", () => {
		const nested: NoteInput = {
			path: "Werk/Diep.md",
			content: ["# Project", "## Taken", "- [ ] Een", "    - [ ] Twee"].join("\n"),
		};
		expect(skipReport([nested], options()).remaining).toEqual([
			{ heading: "Taken", tasks: 2 },
		]);
	});

	it("leaves completed work out of all of it", () => {
		// The report answers a question about the wheel, and the wheel is about
		// open work.
		expect(skipReport([STORY], options()).total).toBe(1);
	});
});

describe("what the report is not about", () => {
	it("ignores notes the folder lists put out of reach", () => {
		// An excluded folder is a different setting with its own visible list;
		// counting its checkboxes here would make every pattern look weaker than
		// it is.
		const report = skipReport(
			[RECIPE, PLAIN],
			options({ excludeFolders: ["Recepten"] }),
		);
		expect(report.total).toBe(1);
		expect(report.remaining).toEqual([{ heading: NO_HEADING, tasks: 1 }]);
	});
});
