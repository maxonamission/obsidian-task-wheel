import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { isRefused, scopeFor } from "../model/scope";
import {
	DEFAULT_PARSE_OPTIONS,
	outward,
	scopeKey,
	scopeLabel,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
} from "../model/types";
import { readScope } from "../view/wheel-view";

/**
 * A wheel over one heading, across the notes it is written in (BC_E3_S146).
 *
 * With the domain coming from headings, a wedge was the one thing on the wheel
 * with no way in: not a folder, not a note, so the ladder stopped at exactly the
 * axis the reader had just chosen — *"ik kan nu alleen uitzoomen"* (eigenaar,
 * 5 sep 2026). Stepping in spends the heading, so the notes take over the angle.
 */

const HEADING_MODE: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	domainSource: "heading",
	useHeadingsAsGroups: true,
};

const NOTES: NoteInput[] = [
	{
		path: "Planning/Nu/Vandaag.md",
		content: ["## Thuis", "### Tuin", "- [ ] Snoeien", "", "## Werk", "- [ ] Mailen"].join(
			"\n",
		),
	},
	{ path: "Planning/Ooit.md", content: "## Thuis\n- [ ] Zolder" },
	{ path: "Anders/Los.md", content: "## Thuis\n- [ ] Buiten de map" },
];

function labels(nodes: readonly WheelNode[]): string[] {
	return nodes.map((node) => node.label).sort();
}

describe("stepping into a heading wedge", () => {
	const vault = buildTree(NOTES, HEADING_MODE);
	const wedge = vault.root.children.find((child) => child.label === "Thuis");

	it("opens a wheel over that heading instead of refusing", () => {
		expect(wedge).toBeDefined();
		const answer = scopeFor(
			{ kind: "domain", label: "Thuis", depth: 1, source: wedge?.source },
			{ kind: "vault" },
			"heading",
		);

		expect(isRefused(answer)).toBe(false);
		// `loose` is false on a wedge that names a real heading: the loose
		// bucket is a different wheel (BC_E3_S157).
		expect(answer).toEqual({ kind: "heading", heading: "Thuis", path: "", loose: false });
	});

	it("keeps to the folder it was opened from", () => {
		const answer = scopeFor(
			{ kind: "domain", label: "Thuis", depth: 1, source: wedge?.source },
			{ kind: "folder", path: "Planning" },
			"heading",
		);

		expect(answer).toEqual({
			kind: "heading",
			heading: "Thuis",
			path: "Planning",
			loose: false,
		});
	});

	it("still refuses for the sources that name no place", () => {
		for (const source of ["tag", "property"] as const) {
			const answer = scopeFor(
				{ kind: "domain", label: "Thuis", depth: 1, source: wedge?.source },
				{ kind: "vault" },
				source,
			);
			expect(isRefused(answer)).toBe(true);
		}
	});
});

describe("the wheel that opens", () => {
	it("makes the notes its wedges, and keeps the deeper headings as rings", () => {
		const tree = buildTree(NOTES, {
			...HEADING_MODE,
			scope: { kind: "heading", heading: "Thuis", path: "" },
		});

		expect(labels(tree.root.children)).toEqual(["Los", "Ooit", "Vandaag"]);
		const vandaag = tree.root.children.find((child) => child.label === "Vandaag");
		expect(labels(vandaag?.children ?? [])).toEqual(["Tuin"]);
	});

	it("leaves out what the other headings hold", () => {
		const tree = buildTree(NOTES, {
			...HEADING_MODE,
			scope: { kind: "heading", heading: "Thuis", path: "" },
		});
		const every: string[] = [];
		const walk = (node: WheelNode): void => {
			if (node.kind === "task") every.push(node.label);
			node.children.forEach(walk);
		};
		tree.root.children.forEach(walk);

		expect(every.sort()).toEqual(["Buiten de map", "Snoeien", "Zolder"]);
	});

	it("stays inside its folder when it was opened from one", () => {
		const tree = buildTree(NOTES, {
			...HEADING_MODE,
			scope: { kind: "heading", heading: "Thuis", path: "Planning" },
		});

		expect(labels(tree.root.children)).toEqual(["Ooit", "Vandaag"]);
	});
});

describe("stepping in gives back what the wedge held (BC_E3_S150)", () => {
	const NOTES_WITH_TASK_NOTES: NoteInput[] = [
		{ path: "GTD/Deze week.md", content: "## Thuis\n- [ ] Afwas\n## Werk\n- [ ] Mailen" },
		// A task note with nothing under that heading — the empty wedge the owner
		// found (5 sep 2026).
		{ path: "Ooit/Leren.md", content: "Losse tekst.", frontmatter: { type: "task" } },
		// And one whose *inner* work does stand under it. On the wider wheel that
		// work sits in the note's own wedge, because a task note hangs in one
		// place with everything under it (BC_E3_S144).
		{
			path: "Ooit/Groot project.md",
			content: "## Thuis\n- [ ] Deeltaak",
			frontmatter: { type: "task" },
		},
	];

	const TASK_NOTES: ParseOptions = {
		...HEADING_MODE,
		taskNoteProperty: "type",
		taskNoteValue: "task",
	};

	/** Every task under this node, however deep. */
	function work(node: WheelNode): string[] {
		const out: string[] = [];
		const walk = (at: WheelNode): void => {
			if (at.kind === "task") out.push(at.label);
			at.children.forEach(walk);
		};
		node.children.forEach(walk);
		return out.sort();
	}

	it("hands back exactly the wedge that was tapped, and nothing else", () => {
		// The question the owner asked: he reached this wheel by double-tapping a
		// wedge, so what is on it must be what that wedge held. It was not — the
		// step in added a task note the wedge did not contain.
		const wide = buildTree(NOTES_WITH_TASK_NOTES, TASK_NOTES);

		for (const wedge of wide.root.children) {
			const stepped = buildTree(NOTES_WITH_TASK_NOTES, {
				...TASK_NOTES,
				scope: { kind: "heading", heading: wedge.label, path: "" },
			});
			// The fallback wedge is not a heading, so there is nothing to step in
			// to — it is the one wedge the ladder has no rung for.
			if (wedge.label === TASK_NOTES.fallbackDomain) continue;

			expect(work(stepped.root)).toEqual(work(wedge));
		}
	});

	it("leaves task notes off a heading wheel entirely", () => {
		// Both the bare one and the one holding work: on the wider wheel neither
		// sits in this wedge, so neither belongs here. Their work is still
		// reachable — under the note itself, where it lives.
		const tree = buildTree(NOTES_WITH_TASK_NOTES, {
			...TASK_NOTES,
			scope: { kind: "heading", heading: "Thuis", path: "" },
		});

		expect(labels(tree.root.children)).toEqual(["Deze week"]);
		expect(tree.root.shownTaskCount).toBe(1);
	});

	it("still draws a bare task note on a wheel that is not about a heading", () => {
		// The rule it is exempt from, kept as a rule (BC_E3_S130).
		const every = [...buildTree(NOTES_WITH_TASK_NOTES, TASK_NOTES).byId.values()].map(
			(node) => node.label,
		);

		expect(every).toContain("Leren");
		expect(every).toContain("Deeltaak");
	});
});

describe("the rung it is on", () => {
	it("goes back out to where it was opened from", () => {
		expect(outward({ kind: "heading", heading: "Thuis", path: "" })).toEqual({
			kind: "vault",
		});
		expect(outward({ kind: "heading", heading: "Thuis", path: "Planning" })).toEqual({
			kind: "folder",
			path: "Planning",
		});
	});

	it("is named after the heading, and keeps its own round", () => {
		const scope = { kind: "heading", heading: "Thuis", path: "Planning" } as const;
		expect(scopeLabel(scope)).toBe("Thuis");
		expect(scopeKey(scope)).toBe("heading:Planning#Thuis");
		// Two headings of the same name in different folders are two wheels.
		expect(scopeKey({ ...scope, path: "" })).not.toBe(scopeKey(scope));
	});

	it("survives being read back from a reopened tab", () => {
		const scope = { kind: "heading", heading: "Thuis", path: "Planning" };
		expect(readScope({ scope })).toEqual({ ...scope, loose: false });
		// Half a scope is no scope: the reader would land somewhere they never
		// asked for, and silently.
		expect(readScope({ scope: { kind: "heading", heading: "Thuis" } })).toBeNull();
	});

	/**
	 * And the loose bucket comes back as the loose bucket (BC_E3_S157).
	 *
	 * A tab reopened on the fallback wedge would otherwise become a wheel over a
	 * heading that mostly does not exist — empty, and saying nothing about the
	 * work it was opened for.
	 */
	it("reads the loose bucket back as itself", () => {
		const scope = { kind: "heading", heading: "Overig", path: "", loose: true };
		expect(readScope({ scope })).toEqual(scope);
	});
});
