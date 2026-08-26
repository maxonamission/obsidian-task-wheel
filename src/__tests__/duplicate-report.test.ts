import { describe, expect, it } from "vitest";
import { duplicateReport } from "../parse/duplicate-report";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

/**
 * The report names candidates, never verdicts: two identical texts can
 * legitimately be two tasks, so everything it does is grouping and pointing —
 * the judgement stays with the reader (kaderdocument §1.1).
 */

function options(over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, ...over };
}

function note(path: string, ...lines: string[]): NoteInput {
	return { path, content: lines.join("\n") };
}

describe("what counts as the same words", () => {
	it("groups identical descriptions across notes, and leaves singles alone", () => {
		const report = duplicateReport(
			[
				note("Werk/Plan.md", "- [ ] Loodgieter bellen", "- [ ] Offerte lezen"),
				note("Huis/Klussen.md", "- [ ] Loodgieter bellen"),
			],
			options(),
		);

		expect(report.total).toBe(3);
		expect(report.groups).toHaveLength(1);
		expect(report.groups[0].description).toBe("Loodgieter bellen");
		expect(report.groups[0].occurrences.map((at) => at.path)).toEqual([
			"Werk/Plan.md",
			"Huis/Klussen.md",
		]);
	});

	it("sees through case and stray whitespace, and spells the group like the first copy", () => {
		const report = duplicateReport(
			[
				note("A.md", "- [ ] Loodgieter  bellen"),
				note("B.md", "- [ ] loodgieter bellen"),
			],
			options(),
		);

		expect(report.groups).toHaveLength(1);
		expect(report.groups[0].description).toBe("Loodgieter bellen");
	});

	it("sees through fields and tags: a copy that later gained a date still matches", () => {
		// The description under comparison has the emoji fields stripped, so
		// the likely duplicate — one copy edited afterwards — is exactly the
		// one that is found.
		const report = duplicateReport(
			[
				note("A.md", "- [ ] Loodgieter bellen 📅 2026-09-01 #huis"),
				note("B.md", "- [ ] Loodgieter bellen"),
			],
			options(),
		);

		expect(report.groups).toHaveLength(1);
	});

	it("does not group different words", () => {
		const report = duplicateReport(
			[note("A.md", "- [ ] Bel Jan"), note("B.md", "- [ ] Jan bellen")],
			options(),
		);

		expect(report.groups).toEqual([]);
	});
});

describe("counted on the wheel's own terms", () => {
	it("counts open and in-progress, never done or cancelled", () => {
		const report = duplicateReport(
			[
				note(
					"A.md",
					"- [ ] Loodgieter bellen",
					"- [/] Loodgieter bellen",
					"- [x] Loodgieter bellen",
					"- [-] Loodgieter bellen",
				),
			],
			options(),
		);

		expect(report.total).toBe(2);
		expect(report.groups[0].occurrences).toHaveLength(2);
	});

	it("stays inside the skip rules: a copy under an excluded heading cannot break a round", () => {
		const report = duplicateReport(
			[
				note(
					"A.md",
					"## Acceptatiecriteria",
					"- [ ] Loodgieter bellen",
					"## Werk",
					"- [ ] Loodgieter bellen",
				),
			],
			options({ excludeHeadings: ["accepta*"] }),
		);

		expect(report.total).toBe(1);
		expect(report.groups).toEqual([]);
	});

	it("skips excluded note types entirely", () => {
		const story: NoteInput = {
			...note("S.md", "- [ ] Loodgieter bellen"),
			frontmatterType: "story",
		};
		const report = duplicateReport(
			[story, note("A.md", "- [ ] Loodgieter bellen")],
			options({ excludeNoteTypes: ["story"] }),
		);

		expect(report.total).toBe(1);
		expect(report.groups).toEqual([]);
	});

	it("leaves wordless checkboxes aside, and says how many", () => {
		// Only fields or tags on the line: nothing to match by. Counted rather
		// than dropped in silence — the report must not go quiet about work.
		const report = duplicateReport(
			[note("A.md", "- [ ] #huis", "- [ ] #huis")],
			options(),
		);

		expect(report.total).toBe(2);
		expect(report.blank).toBe(2);
		expect(report.groups).toEqual([]);
	});
});

describe("what the reader gets to judge with", () => {
	it("carries the line and the deepest heading of every place", () => {
		const report = duplicateReport(
			[
				note(
					"A.md",
					"## Werk",
					"### KNSB",
					"- [ ] Loodgieter bellen",
					"- [ ] Loodgieter bellen",
				),
			],
			options(),
		);

		expect(report.groups[0].occurrences).toEqual([
			{ path: "A.md", line: 2, heading: "KNSB" },
			{ path: "A.md", line: 3, heading: "KNSB" },
		]);
	});

	it("puts the biggest group first", () => {
		const report = duplicateReport(
			[
				note(
					"A.md",
					"- [ ] Twee keer",
					"- [ ] Drie keer",
					"- [ ] Twee keer",
					"- [ ] Drie keer",
					"- [ ] Drie keer",
				),
			],
			options(),
		);

		expect(report.groups.map((group) => group.description)).toEqual([
			"Drie keer",
			"Twee keer",
		]);
	});
});
