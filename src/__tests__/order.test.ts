import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import {
	deepestFirst,
	orderedChildren,
	taskAfter,
	taskOrder,
	wedgeOrder,
} from "../layout/order";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";
import { VAULT } from "./fixtures/vault";

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeFolders: ["Archief"],
};

/** The wedge of one domain, as a list of task labels in order. */
function wedgeLabels(notes: NoteInput[], domain: string): string[] {
	const tree = buildTree(notes, OPTIONS);
	const wedge = tree.root.children.find((child) => child.label === domain);
	if (wedge === undefined) throw new Error(`no domain ${domain}`);
	return taskOrder(wedge).map((task) => task.label);
}

/** Rewrite one note, leaving the rest of the vault alone. */
function withNote(path: string, content: string): NoteInput[] {
	return VAULT.map((note) => (note.path === path ? { ...note, content } : note));
}

const PROPOSITIE = "Werk/Propositie.md";

describe("wedge order — reproducible", () => {
	it("does not depend on the order the notes arrive in", () => {
		const forward = wedgeLabels(VAULT, "Werk");
		const backward = wedgeLabels([...VAULT].reverse(), "Werk");
		expect(backward).toEqual(forward);
	});

	it("gives the same answer twice for the same vault", () => {
		expect(wedgeLabels(VAULT, "Werk")).toEqual(wedgeLabels(VAULT, "Werk"));
	});

	it("sorts siblings by their structural key, not by insertion", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const domains = orderedChildren(tree.root).map((child) => child.sortKey);
		expect([...domains].sort()).toEqual(domains);
	});
});

describe("wedge order — stable under edits", () => {
	const before = wedgeLabels(VAULT, "Werk");

	it("leaves the rest in place when a task is added", () => {
		const after = wedgeLabels(
			withNote(
				PROPOSITIE,
				"- [ ] Tarievenblad herzien\n- [ ] Offerte nalopen\n- [ ] Referentie vragen 🔺\n",
			),
			"Werk",
		);

		expect(after).toContain("Offerte nalopen");
		expect(without(after, ["Offerte nalopen"])).toEqual(before);
	});

	it("leaves the rest in place when a task is removed", () => {
		const after = wedgeLabels(
			withNote(PROPOSITIE, "- [ ] Referentie vragen 🔺\n"),
			"Werk",
		);

		expect(after).not.toContain("Tarievenblad herzien");
		expect(after).toEqual(without(before, ["Tarievenblad herzien"]));
	});

	it("leaves the rest in place when a line is inserted above a task", () => {
		const shifted = VAULT.map((note) =>
			note.path === PROPOSITIE
				? { ...note, content: `Wat losse tekst.\n\n${note.content}` }
				: note,
		);
		expect(wedgeLabels(shifted, "Werk")).toEqual(before);
	});
});

describe("wedgeOrder — the detent sequence", () => {
	const tree = buildTree(VAULT, OPTIONS);

	it("meets a parent before its children", () => {
		const walk = wedgeOrder(tree.root);
		const position = new Map(walk.map((node, index) => [node.id, index]));

		for (const node of walk) {
			for (const child of node.children) {
				expect(position.get(child.id)).toBeGreaterThan(
					position.get(node.id) as number,
				);
			}
		}
	});

	it("visits every open task exactly once", () => {
		const tasks = taskOrder(tree.root);
		expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
		expect(tasks.length).toBe(tree.root.totalTaskCount);
	});
});

function without(labels: string[], removed: string[]): string[] {
	return labels.filter((label) => !removed.includes(label));
}

describe("deepestFirst and taskAfter — where an action sends you (BC_E3_S32)", () => {
	/** One note, one heading, and a task with two levels under it. */
	const NESTED: NoteInput[] = [
		{
			path: "Werk/Plan.md",
			content: [
				"## Reis",
				"- [ ] Inpakken",
				"    - [ ] Tas",
				"        - [ ] Paspoort",
				"    - [ ] Boeken",
				"- [ ] Afsluiten",
			].join("\n"),
		},
	];

	const tree = buildTree(NESTED, DEFAULT_PARSE_OPTIONS);
	const idOf = (label: string): string => {
		const node = [...tree.byId.values()].find((one) => one.label === label);
		expect(node).toBeDefined();
		return (node as NonNullable<typeof node>).id;
	};
	const labelOf = (id: string | null): string | null =>
		id === null ? null : (tree.byId.get(id)?.label ?? null);

	it("meets a task's subtasks before the task itself", () => {
		const walked = deepestFirst(tree.root).map((node) => node.label);

		expect(walked.indexOf("Paspoort")).toBeLessThan(walked.indexOf("Tas"));
		expect(walked.indexOf("Tas")).toBeLessThan(walked.indexOf("Inpakken"));
		expect(walked.indexOf("Boeken")).toBeLessThan(walked.indexOf("Inpakken"));
	});

	it("holds every node exactly once", () => {
		const walked = deepestFirst(tree.root);
		expect(new Set(walked.map((node) => node.id)).size).toBe(walked.length);
		// The root is not in the walk; everything else is.
		expect(walked.length).toBe(tree.byId.size - 1);
	});

	it("goes deepest-first from task to task", () => {
		expect(labelOf(taskAfter(tree.root, idOf("Paspoort")))).toBe("Tas");
		expect(labelOf(taskAfter(tree.root, idOf("Tas")))).toBe("Boeken");
		// Only now the task those two hang under: it is not done until they are.
		expect(labelOf(taskAfter(tree.root, idOf("Boeken")))).toBe("Inpakken");
		expect(labelOf(taskAfter(tree.root, idOf("Inpakken")))).toBe("Afsluiten");
	});

	it("never lands on a heading or a note", () => {
		for (const node of tree.byId.values()) {
			if (node.kind !== "task") continue;
			const next = taskAfter(tree.root, node.id);
			if (next === null) continue;
			expect(tree.byId.get(next)?.kind).toBe("task");
		}
	});

	it("reaches every task before it comes back round", () => {
		const tasks = [...tree.byId.values()].filter((one) => one.kind === "task");
		const met = new Set<string>();

		let here: string | null = tasks[0].id;
		while (here !== null && !met.has(here)) {
			met.add(here);
			here = taskAfter(tree.root, here);
		}

		// Which is the whole requirement: no task can be stepped over.
		expect(met.size).toBe(tasks.length);
	});

	it("wraps round rather than stopping at the last one", () => {
		expect(labelOf(taskAfter(tree.root, idOf("Afsluiten")))).toBe("Paspoort");
	});

	it("answers nothing when there is nowhere else to go", () => {
		const alone = buildTree(
			[{ path: "Werk/Een.md", content: "- [ ] In m'n eentje" }],
			DEFAULT_PARSE_OPTIONS,
		);
		const only = [...alone.byId.values()].find((one) => one.kind === "task");
		expect(only).toBeDefined();
		if (only === undefined) return;

		expect(taskAfter(alone.root, only.id)).toBeNull();
		expect(taskAfter(tree.root, "nergens")).toBeNull();
		expect(taskAfter(tree.root, null)).toBeNull();
	});
});
