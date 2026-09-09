import { describe as group, expect, it } from "vitest";
import { whatTravels } from "../view/carry-flow";
import { collapseHint } from "../view/heading-picker";
import { pasteInto } from "../parse/cross-note";
import {
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	VAULT_SCOPE,
	type ParseOptions,
	type SourceRef,
} from "../model/types";
import type { Extracted } from "../parse/cross-note";

/**
 * What archiving does to the levels it found (BC_E3_S114).
 *
 * The report was that archiving "does not seem to bring all the levels along",
 * with the question whether tasks and subtasks all land at the same depth. Two
 * explanations were open: a real flattening bug somewhere in the carry, or the
 * filtered path behaving as designed and merely looking like one.
 *
 * Measured, it is neither of the two as they were written down. Task nesting
 * survives every route intact. What does collapse is the *heading* structure,
 * and only on the one route where the reader picks a destination heading:
 * `writeCarry` hands that one path to `pasteInto` for every block, so sections
 * that were separate arrive as one list. That is a real choice the reader made,
 * so it is not repaired; what was missing is that the picker never said so, and
 * that is what `collapseHint` now adds.
 */

const SOURCE = [
	"# Werk",
	"",
	"## Project",
	"- [ ] Ouder",
	"    - [ ] Kind",
	"        - [x] Kleinkind",
	"- [x] Los afgerond",
	"",
	"## Ander project",
	"- [x] Tweede afgerond",
	"    - [ ] Open kind",
];

const OPEN: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	scope: VAULT_SCOPE,
	includeCompleted: true,
	filter: NO_FILTER,
};

const FINISHED: ParseOptions = {
	...OPEN,
	filter: { ...NO_FILTER, status: "finished" },
};

const NOTE_RING: SourceRef = {
	path: "Werk.md",
	line: 0,
	indent: 0,
	headingPath: [],
	raw: null,
};

const branch = (line: number): SourceRef => ({
	path: "Werk.md",
	line,
	indent: 0,
	headingPath: ["Werk", "Project"],
	raw: SOURCE[line],
});

/** The archive note as it ends up, given where the reader said to put things. */
const lands = (
	blocks: readonly Extracted[],
	headingPath: readonly string[] | null,
): string[] => {
	let out: string[] = [];
	for (const block of blocks) {
		out = pasteInto(out, headingPath ?? block.path, block).lines;
	}
	return out;
};

group("archiving a whole note keeps every level of every task", () => {
	it("carries a three-deep branch without touching its indents", () => {
		const travelling = whatTravels([...SOURCE], NOTE_RING, OPEN, "project");

		expect(travelling?.blocks.map((block) => block.block)).toEqual([
			["- [ ] Ouder", "    - [ ] Kind", "        - [x] Kleinkind"],
			["- [x] Los afgerond"],
			["- [x] Tweede afgerond", "    - [ ] Open kind"],
		]);
	});

	it("keeps the sections apart when the reader keeps the path each block has", () => {
		const travelling = whatTravels([...SOURCE], NOTE_RING, OPEN, "project");

		expect(lands(travelling?.blocks ?? [], null)).toEqual([
			"## Werk",
			"",
			"### Project",
			"- [ ] Ouder",
			"    - [ ] Kind",
			"        - [x] Kleinkind",
			"- [x] Los afgerond",
			"",
			"### Ander project",
			"- [x] Tweede afgerond",
			"    - [ ] Open kind",
		]);
	});

	it("puts the sections into one list when the reader names a heading, and the tasks keep their depth", () => {
		const travelling = whatTravels([...SOURCE], NOTE_RING, OPEN, "project");

		// Two sections in, one list out. The nesting inside each block survives
		// untouched, which is the half of the report that turned out not to be
		// happening at all.
		expect(lands(travelling?.blocks ?? [], ["Archief"])).toEqual([
			"## Archief",
			"- [ ] Ouder",
			"    - [ ] Kind",
			"        - [x] Kleinkind",
			"- [x] Los afgerond",
			"- [x] Tweede afgerond",
			"    - [ ] Open kind",
		]);
	});
});

group("with a filter running, what stays is held rather than flattened", () => {
	it("leaves a finished grandchild under an open parent where it is", () => {
		const travelling = whatTravels([...SOURCE], branch(3), FINISHED, "task");

		// Not "it travels alone and lands at the margin", which is what the story
		// assumed: the block is indivisible, so the branch gives up nothing and
		// says how much it held back.
		expect(travelling).toEqual({ blocks: [], held: 1 });
	});

	it("carries a finished parent whole, open child and all", () => {
		const travelling = whatTravels([...SOURCE], branch(9), FINISHED, "task");

		expect(travelling?.blocks.map((block) => block.block)).toEqual([
			["- [x] Tweede afgerond", "    - [ ] Open kind"],
		]);
		expect(travelling?.held).toBe(0);
	});
});

group("the picker says what naming a heading costs", () => {
	it("says nothing when every block hangs under the same path", () => {
		expect(collapseHint([["Werk", "Project"], ["Werk", "Project"]])).toBe("");
		expect(collapseHint([[]])).toBe("");
		expect(collapseHint([])).toBe("");
	});

	it("counts the sections that will become one list", () => {
		expect(
			collapseHint([
				["Werk", "Project"],
				["Werk", "Ander project"],
				["Werk", "Project"],
			]),
		).toBe(" · the 2 sections land here as one list");
	});
});
