import { describe, expect, it } from "vitest";
import { nothingToCarry, whatTravels } from "../view/carry-flow";
import { sectionTargets } from "../view/section-edits";
import { concernsWheel, nodeAtLine } from "../view/vault-watch";
import { roundCompleteMessage } from "../view/round";
import { buildTree } from "../parse/build-tree";
import { headingsOf } from "../parse/outline";
import {
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	type ParseOptions,
	type SourceRef,
	VAULT_SCOPE,
} from "../model/types";

/**
 * The decisions BC_E3_S13 lifted out of `wheel-view.ts`.
 *
 * Every one of these used to be a private method on an `ItemView`, which is to
 * say unreachable: the one bug this file's subject shipped lived in exactly
 * such a method and no test could have caught it. These are the same decisions,
 * now asked as plain questions.
 */

const at = (path: string, line: number, raw: string | null = null): SourceRef => ({
	path,
	line,
	indent: 0,
	headingPath: [],
	raw,
});

const withFilter = (filter: Partial<typeof NO_FILTER>): ParseOptions => ({
	...DEFAULT_PARSE_OPTIONS,
	filter: { ...NO_FILTER, ...filter },
});

describe("whatTravels — what a carry actually takes", () => {
	it("takes a task with its whole block", () => {
		const lines = [
			"- [ ] Pak in",
			"    - [ ] Tas",
			"    - [x] Paspoort",
			"- [ ] Iets anders",
		];

		// A task carries the line it sits on. Since BC_E3_S130 that is what tells
		// a task on a line apart from a task that *is* a note, so the fixture has
		// to be as honest about it as the parser is.
		const carry = whatTravels(
			lines,
			at("Reis.md", 0, lines[0]),
			DEFAULT_PARSE_OPTIONS,
			"task",
		);

		expect(carry?.blocks).toHaveLength(1);
		expect(carry?.blocks[0].raw).toEqual(lines.slice(0, 3));
		expect(carry?.held).toBe(0);
	});

	it("takes a whole section when no filter is on", () => {
		const lines = ["## Reis", "- [ ] Pak in", "- [x] Boek", "## Thuis"];

		const carry = whatTravels(lines, at("Reis.md", 0), DEFAULT_PARSE_OPTIONS, "group");

		expect(carry?.blocks).toHaveLength(1);
		expect(carry?.blocks[0].kind).toBe("section");
	});

	it("takes only the round's share of a section while a filter runs", () => {
		// The bug this guards: filter on finished, carry the branch to an archive,
		// and the open work went along with it — the wheel lying about what it
		// is carrying (owner, 17 aug 2026).
		const lines = ["## Reis", "- [ ] Pak in", "- [x] Boek", "## Thuis"];

		const carry = whatTravels(
			lines,
			at("Reis.md", 0),
			withFilter({ status: "finished" }),
			"group",
		);

		const raw = carry?.blocks.flatMap((block) => block.raw) ?? [];
		expect(raw).toContain("- [x] Boek");
		expect(raw).not.toContain("- [ ] Pak in");
	});

	it("leaves nothing behind when the whole section is in the round", () => {
		const lines = ["## Reis", "- [x] Pak in", "- [x] Boek"];

		const carry = whatTravels(
			lines,
			at("Reis.md", 0),
			withFilter({ status: "finished" }),
			"group",
		);

		expect(carry?.held).toBe(0);
	});

	it("counts what the round showed but could not send", () => {
		// A finished subtask under an open task: in the round, but it cannot
		// leave on its own without being orphaned.
		const lines = ["## Reis", "- [ ] Pak in", "    - [x] Tas"];

		const carry = whatTravels(
			lines,
			at("Reis.md", 0),
			withFilter({ status: "finished" }),
			"group",
		);

		expect(carry?.blocks).toHaveLength(0);
		expect(carry?.held).toBe(1);
	});

	it("refuses a line the note no longer has", () => {
		expect(
			whatTravels(
				["- [ ] Een"],
				at("Reis.md", 9, "- [ ] Een"),
				DEFAULT_PARSE_OPTIONS,
				"task",
			),
		).toBeNull();
	});

});

describe("nothingToCarry — two very different empties", () => {
	it("blames the filter when the round showed nothing here", () => {
		expect(nothingToCarry(0)).toContain("the filter leaves it all out");
	});

	it("says why work that is in the round still cannot leave", () => {
		expect(nothingToCarry(1)).toContain("1 item of this round");
		expect(nothingToCarry(1)).toContain("orphaned");
	});

	it("counts in the plural when there is more than one", () => {
		expect(nothingToCarry(4)).toContain("4 items of this round");
	});
});

describe("sectionTargets — where a section may be hung", () => {
	const lines = [
		"# Notitie", // 0
		"## Reis", // 1
		"- [ ] Pak in",
		"### Onderweg", // 3
		"- [ ] Tanken",
		"## Thuis", // 5
	];
	const headings = headingsOf(lines);
	const self = headings.find((heading) => heading.line === 1)!;

	it("never offers the section itself", () => {
		expect(sectionTargets(headings, self).map((h) => h.line)).not.toContain(1);
	});

	it("never offers anything inside it — that would lose the note", () => {
		expect(sectionTargets(headings, self).map((h) => h.line)).not.toContain(3);
	});

	it("offers everything above and below it", () => {
		expect(sectionTargets(headings, self).map((h) => h.line)).toEqual([0, 5]);
	});
});

describe("concernsWheel — is this save this wheel's business", () => {
	it("takes a note in scope", () => {
		expect(
			concernsWheel("Werk/Plan.md", VAULT_SCOPE, DEFAULT_PARSE_OPTIONS),
		).toBe(true);
	});

	it("leaves a note another wheel is about alone", () => {
		expect(
			concernsWheel(
				"Gezin/Weekend.md",
				{ kind: "folder", path: "Werk" },
				DEFAULT_PARSE_OPTIONS,
			),
		).toBe(false);
	});

	it("leaves a skipped folder alone — that is the one that syncs in bulk", () => {
		const options: ParseOptions = {
			...DEFAULT_PARSE_OPTIONS,
			excludeFolders: ["Archief"],
		};

		expect(concernsWheel("Archief/Oud.md", VAULT_SCOPE, options)).toBe(false);
		expect(concernsWheel("Werk/Plan.md", VAULT_SCOPE, options)).toBe(true);
	});
});

describe("nodeAtLine — the stop a cursor stands in", () => {
	const tree = buildTree(
		[
			{
				path: "Werk/Plan.md",
				content: [
					"## Voorbereiding", // 0
					"- [ ] Coderen", // 1
					"", // 2
					"Wat losse tekst.", // 3
					"## Review", // 4
					"- [ ] Terugkoppelen", // 5
				].join("\n"),
			},
		],
		DEFAULT_PARSE_OPTIONS,
	);

	const labelAt = (line: number): string | undefined => {
		const id = nodeAtLine(tree, "Werk/Plan.md", line);
		return id === null ? undefined : tree.byId.get(id)?.label;
	};

	it("lands on the task when the cursor is on one", () => {
		expect(labelAt(1)).toBe("Coderen");
	});

	it("lands on the nearest stop above, which may be a task", () => {
		// Prose under a task belongs to that task, not to the heading over it:
		// the rule is "nearest at or above", not "nearest heading".
		expect(labelAt(3)).toBe("Coderen");
	});

	it("lands on the heading when the cursor is on one", () => {
		expect(labelAt(4)).toBe("Review");
	});

	it("never looks below the cursor", () => {
		// The task on line 5 is nearer in absolute distance from line 4 than the
		// heading on 4 is from anything — nearness only ever counts upwards.
		expect(labelAt(4)).not.toBe("Terugkoppelen");
		expect(labelAt(5)).toBe("Terugkoppelen");
	});

	it("has nothing to offer above the first stop", () => {
		expect(nodeAtLine(tree, "Werk/Plan.md", -1)).toBeNull();
	});

	it("ignores every other note", () => {
		expect(nodeAtLine(tree, "Gezin/Weekend.md", 1)).toBeNull();
	});
});

describe("roundCompleteMessage — a promise kept out loud", () => {
	it("names the total when nothing is filtered out", () => {
		const said = roundCompleteMessage(213, NO_FILTER);
		expect(said).toContain("all 213 items seen");
		expect(said).not.toContain("matching");
	});

	it("names the filter, so it never reads as “all of it”", () => {
		const said = roundCompleteMessage(12, { ...NO_FILTER, status: "finished" });
		expect(said).toContain("all 12 items matching");
	});
});
