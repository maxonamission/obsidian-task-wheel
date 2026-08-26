import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
} from "../model/types";
import { VAULT } from "./fixtures/vault";

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeFolders: ["Archief"],
};

/** Every task node, in the order the wheel would hand out detents. */
function tasksInOrder(node: WheelNode, out: WheelNode[] = []): WheelNode[] {
	if (node.kind === "task") out.push(node);
	for (const child of node.children) tasksInOrder(child, out);
	return out;
}

function labels(node: WheelNode): string[] {
	return tasksInOrder(node).map((task) => task.label);
}

function find(node: WheelNode, label: string): WheelNode {
	if (node.label === label) return node;
	for (const child of node.children) {
		const hit: WheelNode | null = tryFind(child, label);
		if (hit !== null) return hit;
	}
	throw new Error(`no node labelled ${label}`);
}

function tryFind(node: WheelNode, label: string): WheelNode | null {
	if (node.label === label) return node;
	for (const child of node.children) {
		const hit = tryFind(child, label);
		if (hit !== null) return hit;
	}
	return null;
}

describe("buildTree — the rings", () => {
	const tree = buildTree(VAULT, OPTIONS);

	it("puts domains on ring 1 and projects on ring 2", () => {
		expect(tree.root.depth).toBe(0);
		for (const domain of tree.root.children) {
			expect(domain.kind).toBe("domain");
			expect(domain.depth).toBe(1);
			for (const project of domain.children) {
				expect(project.kind).toBe("project");
				expect(project.depth).toBe(2);
			}
		}
	});

	it("derives the domain from the top folder", () => {
		expect(tree.domains).toContain("Werk");
		expect(tree.domains).toContain("Gezin");
	});

	it("gives a root-level note the fallback domain instead of dropping it", () => {
		expect(tree.domains).toContain(OPTIONS.fallbackDomain);
		expect(labels(find(tree.root, OPTIONS.fallbackDomain))).toEqual([
			"Iets zonder map",
		]);
	});

	it("skips excluded folders entirely", () => {
		expect(labels(tree.root)).not.toContain("Mag niet op het wiel verschijnen");
	});

	it("makes headings a ring between the note and its tasks", () => {
		const section = find(tree.root, "Voorbereiding");
		expect(section.kind).toBe("group");
		expect(section.depth).toBe(4); // root → domain → project → note heading → section
	});

	it("nests subtasks under the task they are indented below", () => {
		const parent = find(tree.root, "Interviews coderen");
		expect(parent.children.map((child) => child.label)).toEqual([
			"Codeboek opschonen",
		]);
		expect(parent.children[0].depth).toBe(parent.depth + 1);
	});

	it("attaches tasks straight to the note when headings are switched off", () => {
		const flat = buildTree(VAULT, { ...OPTIONS, useHeadingsAsGroups: false });
		const project = find(flat.root, "DDI job aid");
		expect(project.children.map((child) => child.label)).toEqual([
			"Interviews coderen",
			"Stappenplan schrijven",
			"Review bij twee bonden",
		]);
	});
});

describe("buildTree — completed tasks", () => {
	it("leaves completed tasks out by default", () => {
		const tree = buildTree(VAULT, OPTIONS);
		expect(labels(tree.root)).not.toContain("Boeken bevestigen");
		expect(labels(tree.root)).not.toContain("Steekproef trekken");
	});

	it("includes them when asked", () => {
		const tree = buildTree(VAULT, { ...OPTIONS, includeCompleted: true });
		expect(labels(tree.root)).toContain("Boeken bevestigen");
	});

	it("keeps a completed parent that still has open work under it", () => {
		const note: NoteInput[] = [
			{
				path: "Werk/Nest.md",
				content: ["- [x] Afgevinkte ouder", "    - [ ] Toch nog open", ""].join("\n"),
			},
		];
		const tree = buildTree(note, OPTIONS);
		// Hiding the parent would orphan the child, and nothing may vanish.
		expect(labels(tree.root)).toEqual(["Afgevinkte ouder", "Toch nog open"]);
	});
});

describe("buildTree — counts", () => {
	const tree = buildTree(VAULT, OPTIONS);

	it("counts open tasks up the tree", () => {
		const summed = tree.root.children.reduce(
			(total, domain) => total + domain.shownTaskCount,
			0,
		);
		expect(tree.root.shownTaskCount).toBe(summed);
		expect(tree.root.shownTaskCount).toBe(tasksInOrder(tree.root).length);
	});

	it("gives a parent task a count that includes itself and its subtasks", () => {
		const parent = find(tree.root, "Interviews coderen");
		expect(parent.shownTaskCount).toBe(2);
	});
});

describe("buildTree — identity survives editing", () => {
	const note = (extra: string): NoteInput[] => [
		{
			path: "Werk/Notitie.md",
			content: `${extra}- [ ] Eerste\n- [ ] Tweede\n- [ ] Derde\n`,
		},
	];

	it("keeps ids when lines shift down", () => {
		const before = tasksInOrder(buildTree(note(""), OPTIONS).root).map((t) => t.id);
		const after = tasksInOrder(
			buildTree(note("Een nieuwe alinea bovenaan.\n\n"), OPTIONS).root,
		).map((t) => t.id);
		expect(after).toEqual(before);
	});

	it("changes the line in the source ref, since write-back needs the new one", () => {
		const before = tasksInOrder(buildTree(note(""), OPTIONS).root)[0];
		const after = tasksInOrder(
			buildTree(note("Een nieuwe alinea bovenaan.\n\n"), OPTIONS).root,
		)[0];
		expect(before.source?.line).toBe(0);
		expect(after.source?.line).toBe(2);
	});

	it("gives two identical siblings distinct ids", () => {
		const tree = buildTree(
			[{ path: "Werk/Dubbel.md", content: "- [ ] Bellen\n- [ ] Bellen\n" }],
			OPTIONS,
		);
		const ids = tasksInOrder(tree.root).map((task) => task.id);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});

	it("keeps ids unique across the whole vault", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const ids = tasksInOrder(tree.root).map((task) => task.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("indexes every node by id", () => {
		const tree = buildTree(VAULT, OPTIONS);
		for (const task of tasksInOrder(tree.root)) {
			expect(tree.byId.get(task.id)).toBe(task);
		}
	});
});

describe("buildTree — ordering is stable and reproducible", () => {
	it("produces the same order twice", () => {
		const once = tasksInOrder(buildTree(VAULT, OPTIONS).root).map((t) => t.id);
		const twice = tasksInOrder(buildTree(VAULT, OPTIONS).root).map((t) => t.id);
		expect(twice).toEqual(once);
	});

	it("does not depend on the order the vault hands us the notes in", () => {
		const forward = tasksInOrder(buildTree(VAULT, OPTIONS).root).map((t) => t.id);
		const backward = tasksInOrder(
			buildTree([...VAULT].reverse(), OPTIONS).root,
		).map((t) => t.id);
		expect(backward).toEqual(forward);
	});

	it("keeps the remaining order intact when a task is removed", () => {
		const before = tasksInOrder(buildTree(VAULT, OPTIONS).root).map((t) => t.id);

		const trimmed = VAULT.map((note) =>
			note.path === "Gezin/Weekend.md"
				? {
						...note,
						content: note.content
							.split("\n")
							.filter((line) => !line.includes("Route uitzoeken"))
							.join("\n"),
					}
				: note,
		);
		const after = tasksInOrder(buildTree(trimmed, OPTIONS).root).map((t) => t.id);

		expect(after.length).toBe(before.length - 1);
		expect(isSubsequence(after, before)).toBe(true);
	});

	it("keeps the existing order intact when a task is added", () => {
		const before = tasksInOrder(buildTree(VAULT, OPTIONS).root).map((t) => t.id);

		const grown = VAULT.map((note) =>
			note.path === "Werk/Propositie.md"
				? { ...note, content: `${note.content}- [ ] Nieuwe taak onderaan\n` }
				: note,
		);
		const after = tasksInOrder(buildTree(grown, OPTIONS).root).map((t) => t.id);

		expect(after.length).toBe(before.length + 1);
		expect(isSubsequence(before, after)).toBe(true);
	});

	it("orders domains and projects by a locale-independent key", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const sorted = [...tree.root.children].sort((a, b) =>
			a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
		);
		expect(tree.root.children).toEqual(sorted);
	});
});

describe("buildTree — tag mode", () => {
	it("lets one note feed several domains", () => {
		const tree = buildTree(VAULT, { ...OPTIONS, domainSource: "tag" });
		expect(tree.domains).toContain("huis");
		expect(tree.domains).toContain("gezondheid");
		expect(labels(find(tree.root, "huis"))).toEqual(["Haag snoeien"]);
	});
});

/** True when `small` appears inside `large` in the same relative order. */
function isSubsequence(small: string[], large: string[]): boolean {
	let index = 0;
	for (const item of large) {
		if (index < small.length && small[index] === item) index += 1;
	}
	return index === small.length;
}

describe("a task with no description of its own", () => {
	it("shows what the line says rather than an apology", () => {
		// From the owner's vault: a task carrying only a tag and a date. The
		// description is what is left after those are taken out — nothing — and
		// "(no description)" told the reader nothing while looking like a fault.
		const tree = buildTree(
			[{ path: "Werk/Plan.md", content: "- [ ] #werk 📅 2026-08-20\n" }],
			DEFAULT_PARSE_OPTIONS,
		);

		const labels = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label);

		expect(labels).toEqual(["#werk 📅 2026-08-20"]);
	});

	it("says so plainly when the line really is empty", () => {
		const tree = buildTree(
			[{ path: "Werk/Plan.md", content: "- [ ] \n" }],
			DEFAULT_PARSE_OPTIONS,
		);

		const labels = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label);

		expect(labels).toEqual(["(empty task)"]);
	});
});
