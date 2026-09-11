import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { resolveDomain } from "../parse/domain";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
} from "../model/types";

/**
 * The heading as the wheel's angle (BC_E3_S143).
 *
 * The vault this is for splits its work by *horizon* — one note for today, one
 * for this week, one for someday — and names the *domain* in the headings. The
 * folder then says nothing about what a task is about, and the same heading
 * lives in three notes at once: three rings in three wedges, which is precisely
 * the opposite of what the reader wanted (eigenaar, 5 sep 2026).
 *
 * In this mode one wedge spans the notes, and the notes sit side by side inside
 * it — so one turn of that wedge walks the same subject across every horizon.
 */

const HEADING_MODE: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	domainSource: "heading",
	useHeadingsAsGroups: true,
};

const NOTES: NoteInput[] = [
	{
		path: "Planning/Vandaag.md",
		content: ["## Thuis", "- [ ] Afwas", "", "## Werk", "- [ ] Mailen"].join("\n"),
	},
	{
		path: "Planning/Deze week.md",
		content: ["## Thuis", "- [ ] Ramen lappen", "", "## Werk", "- [ ] Offerte"].join("\n"),
	},
	{
		path: "Planning/Ooit.md",
		content: ["## Thuis", "- [ ] Zolder opruimen"].join("\n"),
	},
];

function wedges(tree: { root: WheelNode }): string[] {
	return tree.root.children.map((child) => child.label).sort();
}

function wedge(tree: { root: WheelNode }, label: string): WheelNode {
	const found = tree.root.children.find((child) => child.label === label);
	if (found === undefined) throw new Error(`no wedge ${label}`);
	return found;
}

/** Every task label under this node, however deep. */
function tasksUnder(node: WheelNode): string[] {
	const out: string[] = [];
	const walk = (at: WheelNode): void => {
		if (at.kind === "task") out.push(at.label);
		at.children.forEach(walk);
	};
	node.children.forEach(walk);
	return out.sort();
}

describe("a wedge that is a heading, across notes", () => {
	const tree = buildTree(NOTES, HEADING_MODE);

	it("collects the same heading from every note into one wedge", () => {
		expect(wedges(tree)).toEqual(["Thuis", "Werk"]);
	});

	it("holds the work of all three notes", () => {
		expect(tasksUnder(wedge(tree, "Thuis"))).toEqual([
			"Afwas",
			"Ramen lappen",
			"Zolder opruimen",
		]);
	});

	it("keeps the notes side by side inside the wedge", () => {
		expect(wedge(tree, "Thuis").children.map((child) => child.label).sort()).toEqual(
			["Deze week", "Ooit", "Vandaag"],
		);
	});

	it("does not repeat the wedge heading as a ring under itself", () => {
		// It would say what the wedge just said, one ring further out.
		const note = wedge(tree, "Thuis").children[0];
		expect(note.children.map((child) => child.kind)).not.toContain("group");
	});

	it("still makes rings of the deeper headings", () => {
		const nested = buildTree(
			[
				{
					path: "Planning/Vandaag.md",
					content: ["## Thuis", "### Tuin", "- [ ] Snoeien"].join("\n"),
				},
			],
			HEADING_MODE,
		);
		const note = wedge(nested, "Thuis").children[0];
		expect(note.children.map((child) => child.label)).toEqual(["Tuin"]);
	});

	it("puts a task under no heading in the fallback, never nowhere", () => {
		const loose = buildTree(
			[{ path: "Planning/Vandaag.md", content: "- [ ] Losse taak" }],
			HEADING_MODE,
		);
		expect(wedges(loose)).toEqual([HEADING_MODE.fallbackDomain]);
		expect(tasksUnder(wedge(loose, HEADING_MODE.fallbackDomain))).toEqual([
			"Losse taak",
		]);
	});

	it("sorts its wedges by name, because document order means nothing across notes", () => {
		expect(tree.root.children.map((child) => child.label)).toEqual([
			"Thuis",
			"Werk",
		]);
	});
});

describe("what the review found (BC_E3_S144)", () => {
	it("holds on a folder wheel too, and keeps two same-named sections apart", () => {
		// Two things at once. The wedge is the heading, not the subfolder
		// (BC_E3_S145): narrowing to a folder narrows the scope, not what the
		// angle means. And the rings under it start where the wedge stopped, so
		// two different sections that share a subheading stay two branches — they
		// used to merge into one node, and an edit on it aimed at whichever
		// heading came first (BC_E3_S144).
		const tree = buildTree(
			[
				{
					path: "Planning/Vandaag.md",
					content: [
						"## Thuis",
						"### Tuin",
						"- [ ] Snoeien",
						"",
						"## Werk",
						"### Tuin",
						"- [ ] Offerte",
					].join("\n"),
				},
			],
			{ ...HEADING_MODE, scope: { kind: "folder", path: "Planning" } },
		);

		expect(wedges(tree)).toEqual(["Thuis", "Werk"]);
		expect(tasksUnder(wedge(tree, "Thuis"))).toEqual(["Snoeien"]);
		expect(tasksUnder(wedge(tree, "Werk"))).toEqual(["Offerte"]);

		// One "Tuin" ring per wedge, each holding its own task.
		const tuin = wedge(tree, "Thuis").children[0].children;
		expect(tuin.map((child) => child.label)).toEqual(["Tuin"]);
	});

	it("gives a note that is itself a task one wedge, not one per heading", () => {
		// It drew three copies of itself and counted five items for the three it
		// holds, so the round could only close by landing on it three times.
		const tree = buildTree(
			[
				{
					path: "Planning/Project X.md",
					content: ["## Thuis", "- [ ] Afwas", "", "## Werk", "- [ ] Mailen"].join(
						"\n",
					),
					frontmatter: { type: "task" },
				},
			],
			{ ...HEADING_MODE, taskNoteProperty: "type", taskNoteValues: ["task"] },
		);

		expect(wedges(tree)).toEqual([HEADING_MODE.fallbackDomain]);
		expect(tree.root.shownTaskCount).toBe(3);

		const notes = tree.root.children[0].children;
		expect(notes.map((child) => child.label)).toEqual(["Project X"]);
		// The headings are still rings, now under the task the note is.
		expect(notes[0].children.map((child) => child.label)).toEqual(["Thuis", "Werk"]);
	});
});

describe("resolveDomain in heading mode", () => {
	const candidates = {
		notePath: "Planning/Vandaag.md",
		frontmatterTags: [],
		taskTags: [],
	};

	it("takes the outermost heading", () => {
		expect(
			resolveDomain({ ...candidates, headingPath: ["Thuis", "Tuin"] }, HEADING_MODE),
		).toBe("Thuis");
	});

	it("falls back when there is no heading above the task", () => {
		expect(resolveDomain({ ...candidates, headingPath: [] }, HEADING_MODE)).toBe(
			HEADING_MODE.fallbackDomain,
		);
		expect(resolveDomain(candidates, HEADING_MODE)).toBe(HEADING_MODE.fallbackDomain);
	});

	it("leaves the other three sources alone", () => {
		const withHeading = { ...candidates, headingPath: ["Thuis"] };
		expect(resolveDomain(withHeading, DEFAULT_PARSE_OPTIONS)).toBe("Planning");
	});
});
