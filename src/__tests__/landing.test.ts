import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { landingId, readLanding } from "../model/landing";
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
