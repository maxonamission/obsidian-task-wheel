import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { landingId, nodeAt, readLanding } from "../model/landing";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	VAULT_SCOPE,
	type WheelScope,
	type WheelTree,
} from "../model/types";

/**
 * Where a wheel comes to rest when the act of opening already said so
 * (BC_E3_S107, BC_E3_S108).
 *
 * Both findings are the same complaint: the wheel picked its stop from what
 * that blikveld remembered, and threw away a sentence the reader had just
 * spoken. Stepping out names where you came from; a cursor names a task. The
 * remembered place stays the right *second* choice, which is why every test
 * here also has a case that answers null and hands the question back.
 */

const NOTES: NoteInput[] = [
	{
		path: "Werk/Klanten/Northwind.md",
		content: [
			"# Voorbereiding",
			"- [ ] Cijfers ophalen",
			"",
			"  wat losse aantekeningen",
			"## Details",
			"- [ ] Zaal boeken",
			"# Uitvoering",
			"- [ ] Draaiboek schrijven",
		].join("\n"),
	},
	{ path: "Werk/Intern/Administratie.md", content: "- [ ] Bonnetjes\n" },
	{ path: "Werk/Later.md", content: "\n\n- [ ] Pas op regel drie\n" },
	{ path: "Gezin/Weekend.md", content: "- [ ] Tassen pakken\n" },
];

function treeFor(scope: WheelScope): WheelTree {
	return buildTree(NOTES, { ...DEFAULT_PARSE_OPTIONS, scope });
}

/** The label of the node an id names, which is what a test can read. */
function labelOf(tree: WheelTree, id: string | null): string | null {
	return id === null ? null : (tree.byId.get(id)?.label ?? null);
}

describe("stepping out lands on what you were reading", () => {
	it("keeps you on the task itself, out in the wider wheel", () => {
		// The finding that reopened this: landing on the branch the task hangs
		// from is close enough to look deliberate and wrong enough to confuse.
		// The line is what carries across — an id is built from the path down
		// the tree, and that path differs in a wider wheel.
		const tree = treeFor(VAULT_SCOPE);
		const id = landingId(tree, {
			kind: "line",
			path: "Werk/Klanten/Northwind.md",
			line: 5,
		});

		expect(labelOf(tree, id)).toBe("Zaal boeken");
	});
});

describe("stepping out falls back to the blikveld you left", () => {
	it("puts a section back on its own heading in the note's wheel", () => {
		const tree = treeFor({ kind: "note", path: "Werk/Klanten/Northwind.md" });
		const id = landingId(tree, {
			kind: "scope",
			scope: {
				kind: "section",
				path: "Werk/Klanten/Northwind.md",
				heading: ["Voorbereiding", "Details"],
			},
		});

		expect(labelOf(tree, id)).toBe("Details");
	});

	it("puts a note back on its own ring in the folder's wheel", () => {
		const tree = treeFor({ kind: "folder", path: "Werk" });
		const id = landingId(tree, {
			kind: "scope",
			scope: { kind: "note", path: "Werk/Klanten/Northwind.md" },
		});

		expect(labelOf(tree, id)).toBe("Northwind");
	});

	it("puts a folder back on its own wedge one level up", () => {
		// `Werk/Klanten` is the wedge `Klanten` in the wheel over `Werk`: a
		// wedge is named by the last segment, not by the whole path.
		const tree = treeFor({ kind: "folder", path: "Werk" });
		const id = landingId(tree, {
			kind: "scope",
			scope: { kind: "folder", path: "Werk/Klanten" },
		});

		expect(labelOf(tree, id)).toBe("Klanten");
	});

	it("hands the question back when what you left is not on this wheel", () => {
		// Then the remembered place decides, exactly as before. A filter, a fold
		// or the visibility budget can all leave it out legitimately.
		const tree = treeFor(VAULT_SCOPE);
		expect(
			landingId(tree, {
				kind: "scope",
				scope: { kind: "note", path: "Weg/Verdwenen.md" },
			}),
		).toBeNull();
	});

	it("has nothing to say about the vault, which you cannot step out of", () => {
		const tree = treeFor(VAULT_SCOPE);
		expect(landingId(tree, { kind: "scope", scope: VAULT_SCOPE })).toBeNull();
	});
});

describe("opening from the editor lands on the cursor's task", () => {
	const at = (line: number): string | null => {
		const tree = treeFor(VAULT_SCOPE);
		return labelOf(
			tree,
			landingId(tree, {
				kind: "line",
				path: "Werk/Klanten/Northwind.md",
				line,
			}),
		);
	};

	it("finds the task the cursor is on", () => {
		expect(at(1)).toBe("Cijfers ophalen");
		expect(at(5)).toBe("Zaal boeken");
		expect(at(7)).toBe("Draaiboek schrijven");
	});

	it("finds the task the cursor has walked into", () => {
		// Three lines down, in the notes under a task, still means that task.
		expect(at(2)).toBe("Cijfers ophalen");
		expect(at(3)).toBe("Cijfers ophalen");
	});

	it("finds the heading the cursor is on, not the task under it", () => {
		// Line 0 is `# Voorbereiding`, with the first task below it. An exact hit
		// on any kind is what lets one lookup serve both callers — and it is
		// also what the reader is pointing at.
		expect(at(0)).toBe("Voorbereiding");
		expect(at(4)).toBe("Details");
	});

	it("prefers what is really on the line over the note that starts there", () => {
		// Every note carries `line: 0` to say where it begins, and a task can be
		// on line 0 too. Without a tie-break the note would win on every note
		// whose first line is a task.
		const tree = treeFor(VAULT_SCOPE);
		expect(
			labelOf(
				tree,
				landingId(tree, {
					kind: "line",
					path: "Werk/Intern/Administratie.md",
					line: 0,
				}),
			),
		).toBe("Bonnetjes");
	});

	it("never guesses forward at something the reader has not reached", () => {
		// Two blank lines, then the first task. Nothing on line 0 and nothing
		// above it: saying "you must have meant that one" is the kind of
		// helpfulness that moves a round without being asked.
		const tree = treeFor(VAULT_SCOPE);
		expect(
			landingId(tree, { kind: "line", path: "Werk/Later.md", line: 0 }),
		).toBeNull();
	});

	it("says nothing about a note with no tasks in this wheel", () => {
		const tree = treeFor(VAULT_SCOPE);
		expect(
			landingId(tree, { kind: "line", path: "Werk/Leeg.md", line: 3 }),
		).toBeNull();
	});
});

describe("reading a landing out of a leaf's state", () => {
	it("takes the two shapes it knows", () => {
		expect(readLanding({ landing: { kind: "line", path: "a.md", line: 4 } })).toEqual({
			kind: "line",
			path: "a.md",
			line: 4,
		});
		expect(
			readLanding({ landing: { kind: "scope", scope: VAULT_SCOPE } }),
		).toEqual({ kind: "scope", scope: VAULT_SCOPE });
	});

	it("refuses anything else, rather than half-believing it", () => {
		// A workspace file written by hand or by a future version should leave
		// the wheel opening normally, not opening wrongly.
		for (const state of [
			null,
			{},
			{ landing: null },
			{ landing: { kind: "line", path: "a.md" } },
			{ landing: { kind: "line", path: 3, line: 3 } },
			{ landing: { kind: "scope" } },
			{ landing: { kind: "elders" } },
		]) {
			expect(readLanding(state)).toBeNull();
		}
	});
});

/**
 * The one answer to "which node is at this line" (BC_E3_S159, audit 6 sep 2026).
 *
 * There used to be two lookups: this one, and `nodeAtLine` in `view/`. They
 * disagreed on five lines out of twelve in an ordinary note, each had a test
 * pinning its own answer, and neither tested the other's. The cases below are
 * both sets, kept together so that a future disagreement has to be written down
 * as a contradiction rather than discovered in a second file.
 */
describe("nodeAt — the stop a cursor stands in", () => {
	const PATH = "Werk/Plan.md";
	const tree = buildTree(
		[
			{
				path: PATH,
				content: [
					"- [ ] Bonnetjes scannen", // 0
					"  aantekening bij de taak", // 1
					"", // 2
					"## Deze week", // 3
					"een paragraaf", // 4
					"- [ ] Iets onder de kop", // 5
					"## Volgende week", // 6
					"nog een paragraaf", // 7
					"- [ ] Later", // 8
				].join("\n"),
			},
		],
		DEFAULT_PARSE_OPTIONS,
	);

	const labelAt = (line: number): string | undefined => {
		const id = nodeAt(tree, PATH, line);
		return id === null ? undefined : tree.byId.get(id)?.label;
	};

	it("lands on the task when the cursor is on one", () => {
		expect(labelAt(0)).toBe("Bonnetjes scannen");
		expect(labelAt(5)).toBe("Iets onder de kop");
	});

	it("lands on the heading when the cursor is on one", () => {
		expect(labelAt(3)).toBe("Deze week");
		expect(labelAt(6)).toBe("Volgende week");
	});

	/**
	 * The first of the two disagreements, and `nodeAt` had it right.
	 *
	 * Every note has a line 0, and the note's own ring claims it — `line: 0`
	 * with `raw: null`, meaning "this document starts here" rather than "I am
	 * written on this line". The other lookup took that literally and answered
	 * the note about a cursor sitting on a task.
	 */
	it("never answers the note about a line a task is written on", () => {
		expect(labelAt(0)).toBe("Bonnetjes scannen");
		for (const line of [0, 1, 2]) {
			expect(labelAt(line)).toBe("Bonnetjes scannen");
		}
	});

	/**
	 * The second, and there the *other* lookup had it right.
	 *
	 * Reaching back for the last **task** walked straight past the heading in
	 * between: measured, a cursor in a paragraph under *Volgende week* answered
	 * with a task under *Deze week* — work from a section the reader had left.
	 */
	it("does not reach past a heading for a task in the section before it", () => {
		expect(labelAt(7)).toBe("Volgende week");
		expect(labelAt(4)).toBe("Deze week");
	});

	it("still lets prose under a task belong to that task", () => {
		// No heading in between, so the task *is* the nearest node above.
		expect(labelAt(1)).toBe("Bonnetjes scannen");
	});

	it("never looks below the cursor", () => {
		expect(labelAt(3)).not.toBe("Iets onder de kop");
	});

	it("has nothing to offer above the first stop", () => {
		expect(nodeAt(tree, PATH, -1)).toBeNull();
	});

	it("ignores every other note", () => {
		expect(nodeAt(tree, "Gezin/Weekend.md", 1)).toBeNull();
	});
});
