import { describe, expect, it } from "vitest";
import {
	extractBlock,
	extractFiltered,
	pasteInto,
	removeBlock,
	removeBlocks,
} from "../parse/cross-note";
import { parseTaskLine } from "../parse/task-line";
import {
	DEFAULT_PARSE_OPTIONS,
	isFinished,
	type ParseOptions,
} from "../model/types";
import { inRound } from "../parse/round";

/**
 * Carrying work from one note to another.
 *
 * The thing being tested is not "the lines arrived" — it is that **the category
 * arrived with them**. A wedge on the wheel is a heading path, so a task that
 * sat under `Werk › Klanten` has to land under `Werk › Klanten` on the other
 * side: the path reused where it exists, written where it does not, and never
 * doubled.
 */

function lines(...text: string[]): string[] {
	return text;
}

/** Move as the plugin does it: extract, paste, then take the source out. */
function move(
	from: string[],
	index: number,
	to: string[],
): { source: string[]; target: string[]; created: string[] } {
	const lifted = extractBlock(from, index);
	if (lifted === null) throw new Error("nothing to lift");
	const pasted = pasteInto(to, lifted.path, lifted);
	return {
		source: removeBlock(from, lifted.start, lifted.length),
		target: pasted.lines,
		created: pasted.created,
	};
}

describe("lifting a block out", () => {
	it("takes a task with everything indented under it", () => {
		const note = lines(
			"- [ ] Bellen",
			"    wat context bij het gesprek",
			"    - [ ] Nummer opzoeken",
			"- [ ] Mailen",
		);

		const lifted = extractBlock(note, 0);
		expect(lifted?.kind).toBe("task");
		expect(lifted?.length).toBe(3);
		expect(lifted?.block).toEqual([
			"- [ ] Bellen",
			"    wat context bij het gesprek",
			"    - [ ] Nummer opzoeken",
		]);
	});

	it("pulls a subtask back to the margin, keeping its own shape", () => {
		const note = lines(
			"- [ ] Project",
			"    - [ ] Deeltaak",
			"        - [ ] Nog dieper",
		);

		// A subtask three levels in must not arrive three levels in somewhere it
		// has no parent — but what hangs under it stays hanging under it.
		expect(extractBlock(note, 1)?.block).toEqual([
			"- [ ] Deeltaak",
			"    - [ ] Nog dieper",
		]);
	});

	it("remembers the heading path it hung under", () => {
		const note = lines("# Werk", "## Klanten", "- [ ] Offerte sturen");
		expect(extractBlock(note, 2)?.path).toEqual(["Werk", "Klanten"]);
	});

	it("takes a whole section, subsections and all", () => {
		const note = lines(
			"# Werk",
			"## Klanten",
			"- [ ] Offerte",
			"### Grote klant",
			"- [ ] Bellen",
			"## Intern",
			"- [ ] Urenlijst",
		);

		const lifted = extractBlock(note, 1);
		expect(lifted?.kind).toBe("section");
		expect(lifted?.block).toEqual([
			"## Klanten",
			"- [ ] Offerte",
			"### Grote klant",
			"- [ ] Bellen",
		]);
		// Its own name travels in the block, so the path is where it hung.
		expect(lifted?.path).toEqual(["Werk"]);
	});

	it("refuses a line that is neither", () => {
		expect(extractBlock(lines("gewone prozaregel"), 0)).toBeNull();
		expect(extractBlock(lines("- [ ] Iets"), 7)).toBeNull();
	});
});

describe("the category travels with the task", () => {
	it("uses a heading path that is already there", () => {
		const from = lines("# Werk", "## Klanten", "- [ ] Offerte sturen");
		const to = lines("# Werk", "## Klanten", "- [ ] Iets ouds", "## Intern");

		const { target, created } = move(from, 2, to);

		expect(created).toEqual([]);
		expect(target).toEqual([
			"# Werk",
			"## Klanten",
			"- [ ] Iets ouds",
			"- [ ] Offerte sturen",
			"## Intern",
		]);
	});

	it("writes the path when the other note has none of it", () => {
		const from = lines("# Werk", "## Klanten", "- [ ] Offerte sturen");
		const to = lines("# Ooit misschien", "", "- [ ] Iets anders");

		const { target, created } = move(from, 2, to);

		expect(created).toEqual(["Werk", "Klanten"]);
		expect(target.join("\n")).toContain("## Werk");
		expect(target.join("\n")).toContain("### Klanten");
		expect(target[target.length - 1]).toBe("- [ ] Offerte sturen");
	});

	it("writes only the part of the path that is missing", () => {
		const from = lines("# Werk", "## Klanten", "- [ ] Offerte sturen");
		const to = lines("# Werk", "## Intern", "- [ ] Urenlijst");

		const { target, created } = move(from, 2, to);

		// *Werk* was already there; only *Klanten* is new, and it goes under it.
		expect(created).toEqual(["Klanten"]);
		expect(target.filter((line) => line === "# Werk")).toHaveLength(1);
		expect(target).toEqual([
			"# Werk",
			"## Intern",
			"- [ ] Urenlijst",
			"## Klanten",
			"- [ ] Offerte sturen",
		]);
	});

	it("matches a heading name case-insensitively rather than doubling it", () => {
		const from = lines("## Klanten", "- [ ] Offerte");
		const to = lines("## klanten", "- [ ] Iets");

		const { target, created } = move(from, 1, to);
		expect(created).toEqual([]);
		expect(target).toEqual(["## klanten", "- [ ] Iets", "- [ ] Offerte"]);
	});

	it("does not confuse two headings of the same name under different parents", () => {
		const from = lines("# Privé", "## Bellen", "- [ ] Tandarts");
		const to = lines("# Werk", "## Bellen", "- [ ] Klant", "# Privé");

		const { target, created } = move(from, 2, to);

		// The *Bellen* that exists hangs under *Werk*; the one wanted hangs under
		// *Privé* and is not there, so it is written rather than borrowed.
		expect(created).toEqual(["Bellen"]);
		expect(target).toEqual([
			"# Werk",
			"## Bellen",
			"- [ ] Klant",
			"# Privé",
			"## Bellen",
			"- [ ] Tandarts",
		]);
	});

	it("finds a heading under the other note's title, rather than beside it", () => {
		// The top of a note is usually its title, so a path of `Klussen` has to
		// find the `## Klussen` under `# Archief`. Comparing whole paths from the
		// note's root missed it — and then missed a heading it had just written
		// itself, so a second block wrote a second copy of it.
		const from = lines("## Klussen", "- [x] Haag snoeien");
		const to = lines("# Archief", "## Klussen", "- [x] Iets ouds");

		const { target, created } = move(from, 1, to);
		expect(created).toEqual([]);
		expect(target.filter((line) => line === "## Klussen")).toHaveLength(1);
	});

	it("reuses a heading it wrote itself a moment earlier", () => {
		const first = extractBlock(lines("## Klussen", "- [x] Een"), 1)!;
		const second = extractBlock(lines("## Klussen", "- [x] Twee"), 1)!;

		let out = lines("# Archief");
		out = pasteInto(out, first.path, first).lines;
		const again = pasteInto(out, second.path, second);

		expect(again.created).toEqual([]);
		expect(again.lines.filter((line) => line === "## Klussen")).toHaveLength(1);
	});

	it("joins the list at the indent that list is written at", () => {
		const from = lines("## Klanten", "- [ ] Offerte");
		const to = lines("## Klanten", "    - [ ] Iets dat inspringt");

		expect(move(from, 1, to).target).toEqual([
			"## Klanten",
			"    - [ ] Iets dat inspringt",
			"    - [ ] Offerte",
		]);
	});

	it("lands in the section's own body, not inside its last subsection", () => {
		const from = lines("## Klanten", "- [ ] Offerte");
		const to = lines("## Klanten", "- [ ] Iets", "### Detail", "- [ ] Klein ding");

		expect(move(from, 1, to).target).toEqual([
			"## Klanten",
			"- [ ] Iets",
			"- [ ] Offerte",
			"### Detail",
			"- [ ] Klein ding",
		]);
	});

	it("drops a pathless task at the end when the note opens with a heading", () => {
		const from = lines("- [ ] Losse taak");
		const to = lines("# Lijst", "- [ ] Iets");

		// Above the title would be a strange place to find it.
		expect(move(from, 0, to).target).toEqual([
			"# Lijst",
			"- [ ] Iets",
			"- [ ] Losse taak",
		]);
	});

	it("joins the preamble when the note has one", () => {
		const from = lines("- [ ] Losse taak");
		const to = lines("- [ ] Bovenaan", "# Later", "- [ ] Ergens anders");

		expect(move(from, 0, to).target).toEqual([
			"- [ ] Bovenaan",
			"- [ ] Losse taak",
			"# Later",
			"- [ ] Ergens anders",
		]);
	});
});

describe("a whole section travelling", () => {
	it("becomes a section of what it lands under, subtree re-levelled", () => {
		const from = lines(
			"# Werk",
			"## Klanten",
			"- [ ] Offerte",
			"### Grote klant",
			"- [ ] Bellen",
		);
		const to = lines("# Ooit misschien", "## Iets", "- [ ] Ergens");

		const { target } = move(from, 1, to);

		// *Klanten* hung under *Werk*, which does not exist here, so it is made
		// first — and the section it holds shifts with it: `##`→`###`, `###`→`####`.
		expect(target).toEqual([
			"# Ooit misschien",
			"## Iets",
			"- [ ] Ergens",
			"## Werk",
			"### Klanten",
			"- [ ] Offerte",
			"#### Grote klant",
			"- [ ] Bellen",
		]);
	});

	it("keeps the shape when the depth does not change", () => {
		const from = lines("# Werk", "## Klanten", "- [ ] Offerte");
		const to = lines("# Werk", "## Intern", "- [ ] Urenlijst");

		expect(move(from, 1, to).target).toEqual([
			"# Werk",
			"## Intern",
			"- [ ] Urenlijst",
			"## Klanten",
			"- [ ] Offerte",
		]);
	});

	it("clamps at six, which is as deep as markdown goes", () => {
		const from = lines("###### Diep", "- [ ] Iets");
		const to = lines("# A", "## B", "### C", "#### D", "##### E", "###### F");

		const { target } = move(from, 0, to);
		expect(target.some((line) => line.startsWith("####### "))).toBe(false);
	});
});

describe("what the source note looks like afterwards", () => {
	it("loses exactly the block and nothing around it", () => {
		const from = lines(
			"## Klanten",
			"- [ ] Blijft",
			"- [ ] Vertrekt",
			"    - [ ] Kind vertrekt mee",
			"- [ ] Blijft ook",
		);

		expect(move(from, 2, lines("## Klanten")).source).toEqual([
			"## Klanten",
			"- [ ] Blijft",
			"- [ ] Blijft ook",
		]);
	});

	it("leaves an emptied heading standing", () => {
		// A heading can carry prose or meaning the wheel never sees, and removing
		// a line the reader never pointed at is not undoable from the wheel
		// (owner's choice, 17 aug 2026).
		const from = lines("## Klanten", "- [ ] De enige");

		expect(move(from, 1, lines("## Klanten")).source).toEqual(["## Klanten"]);
	});

	it("is untouched by a copy, which never calls remove at all", () => {
		const from = lines("## Klanten", "- [ ] Offerte");
		const lifted = extractBlock(from, 1);
		pasteInto(lines("## Klanten"), lifted?.path ?? [], lifted!);
		expect(from).toEqual(["## Klanten", "- [ ] Offerte"]);
	});
});

describe("a branch carried while a filter is running", () => {
	/** Stands in for the round: only finished work is in play. */
	const finished = (lines: readonly string[]) => (line: number) => {
		const parsed = parseTaskLine(lines[line] ?? "");
		return parsed !== null && isFinished(parsed.fields);
	};

	const NOTE = [
		"## Klussen",
		"- [x] Haag snoeien",
		"- [ ] Terras vegen",
		"    - [x] Bezem kopen",
		"- [-] Schutting verven",
		"### Binnen",
		"- [x] Lamp vervangen",
		"- [ ] Cv-ketel onderhoud",
	];

	it("takes what the round shows and leaves the rest alone", () => {
		// Filtering on *finished* and moving the branch used to take the open work
		// with it, because a section carries every line under it. What travels is
		// now what the wheel is showing (owner, 17 aug 2026).
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));
		expect(blocks.map((one) => one.block[0])).toEqual([
			"- [x] Haag snoeien",
			"- [-] Schutting verven",
			"- [x] Lamp vervangen",
		]);
	});

	it("leaves a finished subtask under an open parent where it is", () => {
		// "Bezem kopen" is finished, but pulling it out from under "Terras vegen"
		// — which is staying — would leave it hanging under whatever followed.
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));
		expect(blocks.some((one) => one.block.join("\n").includes("Bezem"))).toBe(
			false,
		);
	});

	it("carries a whole block once its own task is in the round", () => {
		const note = ["## Klussen", "- [x] Haag snoeien", "    - [ ] Takken opruimen"];
		const { blocks } = extractFiltered(note, 0, finished(note));

		// The open subtask travels with its finished parent: a block is indivisible
		// here as it is everywhere else in the plugin.
		expect(blocks).toHaveLength(1);
		expect(blocks[0].block).toEqual([
			"- [x] Haag snoeien",
			"    - [ ] Takken opruimen",
		]);
	});

	it("gives each block the subsection it hung under", () => {
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));
		expect(blocks.map((one) => one.path)).toEqual([
			["Klussen"],
			["Klussen"],
			["Klussen", "Binnen"],
		]);
	});

	it("arrives on the other side as a section with its subsection", () => {
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));

		let out = ["# Archief"];
		for (const block of blocks) {
			out = pasteInto(out, block.path, block).lines;
		}

		// Blank lines because a note with one heading gives nothing to go on, and
		// airy is the default there. What matters is that *Klussen* was written
		// once and found again for the second and third block.
		expect(out).toEqual([
			"# Archief",
			"",
			"## Klussen",
			"- [x] Haag snoeien",
			"- [-] Schutting verven",
			"",
			"### Binnen",
			"- [x] Lamp vervangen",
		]);
	});

	it("takes them all out of the source, and nothing else", () => {
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));

		expect(removeBlocks(NOTE, blocks)).toEqual([
			"## Klussen",
			"- [ ] Terras vegen",
			"    - [x] Bezem kopen",
			"### Binnen",
			"- [ ] Cv-ketel onderhoud",
		]);
	});

	it("refuses the lot when one block has changed since it was read", () => {
		const { blocks } = extractFiltered(NOTE, 0, finished(NOTE));
		const edited = [...NOTE];
		edited[1] = "- [x] Haag snoeien, en de heg";

		// Half a move is worse than none: the other note already has all of it.
		expect(removeBlocks(edited, blocks)).toBeNull();
	});

	it("says nothing travels when the filter leaves the whole branch out", () => {
		const note = ["## Klussen", "- [ ] Terras vegen", "- [ ] Haag snoeien"];
		expect(extractFiltered(note, 0, finished(note))).toEqual({
			blocks: [],
			held: 0,
		});
	});

	it("counts what it had to leave under a task that stays", () => {
		// A Kanban card with a finished checklist inside it — a normal shape, and
		// the one that made "nothing here is in this round" a plain untruth: three
		// items of the round sat there, none of them able to leave on its own
		// (owner, 17 aug 2026).
		const note = [
			"## Huis en Tuin",
			"- [ ] Balkon opruimen",
			"    - [x] Bezem kopen",
			"    - [x] Stoffer kopen",
		];

		expect(extractFiltered(note, 0, finished(note))).toEqual({
			blocks: [],
			held: 2,
		});
	});

	it("counts the held ones even when something else does travel", () => {
		const note = [
			"## Huis en Tuin",
			"- [x] Ramen lappen",
			"- [ ] Balkon opruimen",
			"    - [x] Bezem kopen",
		];

		const { blocks, held } = extractFiltered(note, 0, finished(note));
		expect(blocks.map((one) => one.block[0])).toEqual(["- [x] Ramen lappen"]);
		expect(held).toBe(1);
	});

	it("does not reach into a subsection's subsection twice", () => {
		const note = [
			"## A",
			"- [x] Een",
			"### B",
			"- [x] Twee",
			"#### C",
			"- [x] Drie",
			"## D",
			"- [x] Vier",
		];

		// The branch is *A*, so *D* is not part of it however finished it is.
		const { blocks } = extractFiltered(note, 0, finished(note));
		expect(blocks.map((one) => one.block[0])).toEqual([
			"- [x] Een",
			"- [x] Twee",
			"- [x] Drie",
		]);
	});
});

describe("blank lines follow the note's own habit", () => {
	it("keeps a heading against the list in a note written tight", () => {
		const from = lines("## Nieuw", "- [ ] Iets");
		const to = lines("# Lijst", "## Bestaand", "- [ ] Ouds");

		expect(move(from, 0, to).target).toEqual([
			"# Lijst",
			"## Bestaand",
			"- [ ] Ouds",
			"## Nieuw",
			"- [ ] Iets",
		]);
	});

	it("keeps the gap in a note that separates its sections", () => {
		const from = lines("## Nieuw", "- [ ] Iets");
		const to = lines("# Lijst", "", "## Bestaand", "", "- [ ] Ouds");

		expect(move(from, 0, to).target).toEqual([
			"# Lijst",
			"",
			"## Bestaand",
			"",
			"- [ ] Ouds",
			"",
			"## Nieuw",
			"- [ ] Iets",
		]);
	});
});

describe("the round is one question, not three", () => {
	/**
	 * The real predicate, the way the view asks it.
	 *
	 * `whatTravels` used to ask only the filter, so a branch carried work the
	 * wheel was not showing: finished tasks with the setting off, and checkboxes
	 * from under a skipped heading (found by audit, 17 aug 2026). The wheel
	 * carrying *more* than it shows breaks the same promise as carrying less.
	 */
	function asking(note: string[], over: Partial<ParseOptions>) {
		const options: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, ...over };
		return extractFiltered(note, 0, (line, headingPath) => {
			const parsed = parseTaskLine(note[line] ?? "");
			return (
				parsed !== null &&
				inRound(parsed.fields, headingPath, "Werk/Plan.md", options)
			);
		});
	}

	it("leaves finished work behind when the round does not hold it", () => {
		const note = [
			"## Klussen",
			"- [ ] Haag snoeien #werk",
			"- [x] Ramen lappen #werk",
		];

		// The tag filter says yes to both; the round says no to the finished one,
		// because *Include finished tasks* is off and no status filter overrules it.
		const { blocks } = asking(note, {
			filter: { ...DEFAULT_PARSE_OPTIONS.filter, withTags: ["werk"] },
		});

		expect(blocks.map((one) => one.block[0])).toEqual(["- [ ] Haag snoeien #werk"]);
	});

	it("carries it once the round does hold it", () => {
		const note = ["## Klussen", "- [x] Ramen lappen #werk"];

		const { blocks } = asking(note, {
			includeCompleted: true,
			filter: { ...DEFAULT_PARSE_OPTIONS.filter, withTags: ["werk"] },
		});

		expect(blocks).toHaveLength(1);
	});

	it("never carries a checkbox from under a skipped heading", () => {
		const note = [
			"## Klussen",
			"- [ ] Haag snoeien",
			"### Acceptatiecriteria",
			"- [ ] Deze hoort bij het document",
		];

		// Those were never in the round to begin with — they belong to the
		// document, not to anybody's plate.
		const { blocks } = asking(note, { excludeHeadings: ["accepta*"] });

		expect(blocks.map((one) => one.block[0])).toEqual(["- [ ] Haag snoeien"]);
	});
});
