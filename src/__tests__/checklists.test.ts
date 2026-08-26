import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { isExcluded, isExcludedHeading } from "../parse/domain";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

/**
 * Telling a task from a checklist item.
 *
 * The two look identical — both are `- [ ]` — because the difference is intent,
 * not form. So the wheel does not guess: it is told, using structure the vault
 * already carries. A note says what kind of document it is in its front matter;
 * a heading says what its list is for.
 */

const STORY: NoteInput = {
	path: "stories/BC_E3_S6.md",
	content: [
		"# BC_E3_S6 Review-acties",
		"",
		"## Doel",
		"- [ ] Overleggen met de eigenaar over de sweep",
		"",
		"## Acceptatiecriteria",
		"- [ ] Vijf acties op het item bij de leeswig",
		"- [ ] Writeback laat de rest van de regel intact",
		"    - [ ] Tests op onbekende velden",
		"",
		"## Scope",
		"- [ ] Filteren valt buiten deze story",
	].join("\n"),
	frontmatterType: "story",
};

const REAL: NoteInput = {
	path: "Werk/Plan.md",
	content: "- [ ] Loodgieter bellen\n",
};

function options(over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, ...over };
}

function labels(notes: NoteInput[], opts: ParseOptions): string[] {
	return [...buildTree(notes, opts).byId.values()]
		.filter((node) => node.kind === "task")
		.map((node) => node.label)
		.sort();
}

describe("skipping a whole class of note", () => {
	it("draws everything when nothing is excluded", () => {
		expect(labels([STORY, REAL], options())).toHaveLength(6);
	});

	it("skips a note whose front matter says what it is", () => {
		const opts = options({ excludeNoteTypes: ["story"] });
		expect(labels([STORY, REAL], opts)).toEqual(["Loodgieter bellen"]);
	});

	it("ignores case and stray spacing, because people type both", () => {
		expect(
			isExcluded(STORY, options({ excludeNoteTypes: [" Story "] })),
		).toBe(true);
		expect(isExcluded(STORY, options({ excludeNoteTypes: ["STORY"] }))).toBe(true);
	});

	it("leaves a note without a type alone", () => {
		expect(isExcluded(REAL, options({ excludeNoteTypes: ["story"] }))).toBe(false);
	});

	it("does not match on a different type", () => {
		expect(isExcluded(STORY, options({ excludeNoteTypes: ["review"] }))).toBe(
			false,
		);
	});
});

describe("skipping the checklist inside a note that also holds work", () => {
	const opts = options({ excludeHeadings: ["Acceptatiecriteria"] });

	it("drops the checkboxes under that heading", () => {
		const kept = labels([STORY], opts);
		expect(kept).not.toContain("Vijf acties op het item bij de leeswig");
		expect(kept).not.toContain("Writeback laat de rest van de regel intact");
	});

	it("keeps the real task elsewhere in the same note", () => {
		expect(labels([STORY], opts)).toEqual([
			"Filteren valt buiten deze story",
			"Overleggen met de eigenaar over de sweep",
		]);
	});

	it("drops what is nested under it too", () => {
		// A checkbox three levels down still belongs to that checklist.
		expect(labels([STORY], opts)).not.toContain("Tests op onbekende velden");
	});

	it("matches the heading text, ignoring case and spacing", () => {
		expect(
			isExcludedHeading(["acceptatiecriteria"], options({ excludeHeadings: ["Acceptatiecriteria"] })),
		).toBe(true);
		expect(
			isExcludedHeading(["Doel"], options({ excludeHeadings: ["Acceptatiecriteria"] })),
		).toBe(false);
	});

	it("does nothing at all when the list is empty", () => {
		expect(isExcludedHeading(["Acceptatiecriteria"], options())).toBe(false);
		expect(isExcludedHeading(["Acceptatiecriteria"], options({ excludeHeadings: ["  "] }))).toBe(
			false,
		);
	});

	it("counts a skipped checkbox as absent, not as filtered out", () => {
		// Same as an excluded folder: it was never part of the round, so the
		// filter's "left out" number has nothing to say about it.
		const tree = buildTree([STORY], opts);
		expect(tree.filteredOut).toBe(0);
		expect(tree.root.shownTaskCount).toBe(2);
	});
});

describe("a star for everything like it", () => {
	// One vault holds Acceptatiecriteria, Acceptatie criteria and Acceptance
	// criteria — the same list under three spellings. Typing each of them is how
	// a skip list stops being maintained.

	it("takes a stem and covers what starts with it", () => {
		const opts = options({ excludeHeadings: ["accepta*"] });
		expect(isExcludedHeading(["Acceptatiecriteria"], opts)).toBe(true);
		expect(isExcludedHeading(["Acceptance criteria"], opts)).toBe(true);
		expect(isExcludedHeading(["Doel"], opts)).toBe(false);
	});

	it("leaves a bare word exact, so nothing widens without being asked", () => {
		const opts = options({ excludeHeadings: ["accepta"] });
		expect(isExcludedHeading(["Acceptatiecriteria"], opts)).toBe(false);
		expect(isExcludedHeading(["Acceptatie"], opts)).toBe(false);
		expect(isExcludedHeading(["accepta"], opts)).toBe(true);
	});

	it("takes the star at either end, or both", () => {
		const ends = options({ excludeHeadings: ["*criteria"] });
		expect(isExcludedHeading(["Acceptatiecriteria"], ends)).toBe(true);
		expect(isExcludedHeading(["Criteria voor later"], ends)).toBe(false);

		const anywhere = options({ excludeHeadings: ["*tip*"] });
		expect(isExcludedHeading(["Leestips voor deze week"], anywhere)).toBe(true);
		expect(isExcludedHeading(["Tips"], anywhere)).toBe(true);
		expect(isExcludedHeading(["Doel"], anywhere)).toBe(false);
	});

	it("refuses an entry that is nothing but stars", () => {
		// It would skip every heading in the vault, and skipped work is not
		// counted as left out — so the wheel would quietly empty itself. A box
		// holding only a star is a mistake or a half-typed thought, never that.
		expect(isExcludedHeading(["Doel"], options({ excludeHeadings: ["*"] }))).toBe(false);
		expect(isExcluded(STORY, options({ excludeNoteTypes: ["*"] }))).toBe(false);
	});

	it("still ignores case and stray spacing around the pattern", () => {
		const opts = options({ excludeHeadings: [" Leestip* "] });
		expect(isExcludedHeading(["LEESTIPS"], opts)).toBe(true);
	});

	it("works the same way on a note type", () => {
		const opts = options({ excludeNoteTypes: ["stor*"] });
		expect(isExcluded(STORY, opts)).toBe(true);
		expect(isExcluded(REAL, opts)).toBe(false);
	});

	it("drops the checkboxes it covers, through the whole tree", () => {
		const opts = options({ excludeHeadings: ["accepta*"] });
		const kept = labels([STORY], opts);
		expect(kept).toEqual([
			"Filteren valt buiten deze story",
			"Overleggen met de eigenaar over de sweep",
		]);
	});
});

describe("skipping more never shows more", () => {
	/**
	 * The invariant behind the two rules: the open count is exactly the number
	 * of unticked boxes whose heading survives, so adding a pattern can only
	 * ever take work off the wheel. Worth pinning down, because the wheel's one
	 * promise is that it does not lie about what it is not showing — and a
	 * count that went *up* when you skipped more would mean the rules interact
	 * somewhere they should not.
	 */
	const HEADINGS = [
		"Doel",
		"Acceptatiecriteria",
		"Ingrediënten",
		"Boodschappen",
		"Leestips",
		"Bereiding",
	];
	const PATTERNS = ["accepta*", "leestip*", "ingredi*", "boodschap*"];
	const WORDS = ["peren", "wijn", "bellen", "peren"];

	let seed = 12345;
	function rnd(n: number): number {
		// Deterministic, so a failure can be replayed rather than chased.
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed % n;
	}

	function note(index: number): NoteInput {
		const lines: string[] = [];
		for (let section = 0; section < 1 + rnd(4); section++) {
			lines.push(`## ${HEADINGS[rnd(HEADINGS.length)]}`);
			let indent = 0;
			for (let task = 0; task < 1 + rnd(5); task++) {
				// Walk the indent about, including jumps that skip a level.
				indent = Math.max(0, indent + rnd(3) - 1);
				const box = rnd(3) === 0 ? "x" : " ";
				lines.push(`${"    ".repeat(indent)}- [${box}] ${WORDS[rnd(WORDS.length)]}`);
			}
		}
		return { path: `Map${index % 3}/Note ${index}.md`, content: lines.join("\n") };
	}

	function open(notes: NoteInput[], excludeHeadings: string[]): number {
		return buildTree(notes, options({ excludeHeadings })).root.shownTaskCount;
	}

	it("holds for every subset of a skip list, over random notes", () => {
		for (let round = 0; round < 60; round++) {
			const notes = Array.from({ length: 1 + rnd(5) }, (_, i) => note(round * 10 + i));

			const counts = new Map<number, number>();
			for (let mask = 0; mask < 1 << PATTERNS.length; mask++) {
				counts.set(
					mask,
					open(
						notes,
						PATTERNS.filter((_, bit) => (mask & (1 << bit)) !== 0),
					),
				);
			}

			for (const [mask, count] of counts) {
				for (let bit = 0; bit < PATTERNS.length; bit++) {
					if ((mask & (1 << bit)) !== 0) continue;
					expect(counts.get(mask | (1 << bit))).toBeLessThanOrEqual(count);
				}
			}
		}
	});
});

describe("a completed task is only kept for work below it", () => {
	// Indentation only means parenthood inside one section. A task under the
	// next heading that happens to be indented deeper is not a child of the last
	// task under the previous one.
	const RECIPE: NoteInput = {
		path: "Recepten/Stoofperen.md",
		content: [
			"## Bereiding",
			"- [x] Schil de peren",
			"## Ingrediënten",
			"    - [ ] 12 stoofperen",
		].join("\n"),
	};

	it("does not carry a done task across a heading", () => {
		const tree = buildTree([RECIPE], options());
		expect(labels([RECIPE], options())).toEqual(["12 stoofperen"]);
		expect(tree.root.totalTaskCount).toBe(1);
	});

	it("still carries one for work genuinely nested under it", () => {
		const nested: NoteInput = {
			path: "Recepten/Appeltaart.md",
			content: ["## Bereiding", "- [x] Schil de appels", "    - [ ] Klokhuis eruit"].join(
				"\n",
			),
		};
		const tree = buildTree([nested], options());
		expect(tree.root.totalTaskCount).toBe(2);
		expect(tree.root.shownTaskCount).toBe(1);
	});
});

describe("the two rules together", () => {
	it("each covers what the other cannot", () => {
		// The note type is the blunt instrument: a whole class in one go, no
		// edits to any note. The heading is the surgical one: it keeps the real
		// task in a document that holds both.
		const byType = options({ excludeNoteTypes: ["story"] });
		const byHeading = options({ excludeHeadings: ["Acceptatiecriteria"] });

		expect(labels([STORY], byType)).toHaveLength(0);
		expect(labels([STORY], byHeading)).toHaveLength(2);
	});
});
