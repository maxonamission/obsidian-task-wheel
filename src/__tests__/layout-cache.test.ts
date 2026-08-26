import { describe, expect, it } from "vitest";
import { layoutWheel } from "../layout/radial";
import { doiField } from "../layout/doi";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * The kept answers, and that they cannot go stale (BC_E3_S48, audit P1).
 *
 * Three things about a tree's *shape* were worked out again on every stop —
 * who is whose parent, the children in wedge order, and the id index — and one
 * whole selection that by definition does not depend on where the reader is.
 * Keeping them halved the cost of a stop.
 *
 * The danger with keeping anything is that it outlives what it describes. Here
 * it cannot: every entry is held in a `WeakMap` on the tree, and a scan always
 * builds a fresh tree rather than editing the old one. These tests are that
 * claim written down — a second tree must never be answered with the first
 * one's shape, however similar the two look.
 */

const note = (path: string, lines: string[]): NoteInput => ({
	path,
	content: lines.join("\n"),
});

const treeOf = (notes: NoteInput[]) => buildTree(notes, DEFAULT_PARSE_OPTIONS);

describe("what the layout keeps between stops", () => {
	it("answers the same tree the same way twice", () => {
		const tree = treeOf([
			note("Werk/Plan.md", ["## Deze week", "- [ ] Bellen", "- [ ] Mailen"]),
			note("Gezin/Weekend.md", ["- [ ] Route uitzoeken"]),
		]);

		const first = layoutWheel(tree);
		const focus = first.nodes.find((node) => node.node.kind === "task")?.id;
		expect(focus).toBeDefined();

		const a = layoutWheel(tree, { focusId: focus });
		const b = layoutWheel(tree, { focusId: focus });

		expect(b.nodes.map((n) => `${n.id}@${n.angle.toFixed(4)}`)).toEqual(
			a.nodes.map((n) => `${n.id}@${n.angle.toFixed(4)}`),
		);
	});

	it("does not answer a new tree with the old one's shape", () => {
		const before = treeOf([
			note("Werk/Plan.md", ["## Deze week", "- [ ] Bellen"]),
		]);
		layoutWheel(before);

		// The same note, one task longer. A fresh tree, as a rescan gives.
		const after = treeOf([
			note("Werk/Plan.md", ["## Deze week", "- [ ] Bellen", "- [ ] Mailen"]),
		]);
		const drawn = layoutWheel(after).nodes.map((node) => node.node.label);

		expect(drawn).toContain("Mailen");
		expect(layoutWheel(before).nodes.map((node) => node.node.label)).not.toContain(
			"Mailen",
		);
	});

	it("keeps the two trees' fields apart", () => {
		const one = treeOf([note("Werk/A.md", ["- [ ] Eén", "- [ ] Twee"])]);
		const two = treeOf([note("Werk/B.md", ["- [ ] Drie", "- [ ] Vier"])]);

		const inOne = layoutWheel(one).nodes.find((n) => n.node.kind === "task");
		expect(inOne).toBeDefined();

		// A focus that exists in the first tree and not in the second: the second
		// must say so rather than answer from the first tree's index.
		const field = doiField(two.root, inOne?.id ?? null);
		expect(field.focusId).toBeNull();

		const own = doiField(one.root, inOne?.id ?? null);
		expect(own.focusId).toBe(inOne?.id);
		expect(own.distance.get(inOne?.id ?? "")).toBe(0);
	});

	it("still answers a different budget differently on the same tree", () => {
		// Spread over notes and folders, because a budget bites on how many
		// branches there are to open, not on one long list.
		const notes: NoteInput[] = [];
		for (let n = 0; n < 30; n++) {
			const lines = [`## Kop ${n}`];
			for (let i = 0; i < 8; i++) lines.push(`- [ ] Taak ${n}-${i}`);
			notes.push(note(`Map ${n % 5}/Project ${n}.md`, lines));
		}
		const tree = treeOf(notes);

		const wide = layoutWheel(tree, { visibleBudget: 240 });
		const narrow = layoutWheel(tree, { visibleBudget: 40 });

		// The kept selection is keyed on the room as well as the tree; without
		// that, the second budget would be handed the first one's answer.
		expect(narrow.nodes.length).toBeLessThan(wide.nodes.length);
	});

	it("walks a big tree without the cost squaring", () => {
		// The field used to take the front off an array to walk it, which copies
		// the rest each time. Not a timing test: a thousand nodes simply has to
		// come back, and every one of them has a distance.
		const lines = ["## Kop"];
		for (let i = 0; i < 1000; i++) lines.push(`- [ ] Taak ${i}`);
		const tree = treeOf([note("Werk/Groot.md", lines)]);

		const focus = layoutWheel(tree).nodes.find((n) => n.node.kind === "task")?.id;
		const field = doiField(tree.root, focus ?? null);

		expect(field.distance.size).toBeGreaterThan(1000);
		expect(field.distance.get(focus ?? "")).toBe(0);
	});
});
