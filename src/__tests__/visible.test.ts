import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { doiField, NO_DOI } from "../layout/doi";
import {
	capacityAt,
	DEFAULT_VISIBLE_BUDGET,
	selectVisible,
	type Visible,
} from "../layout/visible";
import { DEFAULT_LAYOUT_OPTIONS, layoutWheel } from "../layout/radial";
import { buildDetents } from "../layout/detents";
import { orderedChildren } from "../layout/order";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type WheelNode,
	type WheelTree,
} from "../model/types";

const DOMAINS = ["Werk", "Gezin", "Gezondheid", "Huis", "Leren", "Financien"];

/**
 * A vault of roughly `target` open tasks, shaped like a real one: a long tail
 * of small notes with a few very large ones.
 */
function vaultOf(target: number, seed = 7): NoteInput[] {
	let s = seed;
	const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);

	const notes: NoteInput[] = [];
	let made = 0;

	while (made < target) {
		const domain = DOMAINS[Math.floor(rnd() * DOMAINS.length)];
		const size = Math.max(1, Math.round(rnd() ** 2.2 * 90) + 1);
		const lines = Array.from(
			{ length: size },
			(_, i) => `- [ ] Taak ${i + 1} in notitie ${notes.length}`,
		);
		notes.push({ path: `${domain}/Notitie ${notes.length}.md`, content: lines.join("\n") });
		made += size;
	}
	return notes;
}

function treeOf(target: number): WheelTree {
	return buildTree(vaultOf(target), DEFAULT_PARSE_OPTIONS);
}

function shareOf(tree: WheelTree): Map<string, number> {
	return new Map(tree.domains.map((d) => [d, 1 / tree.domains.length]));
}

function select(tree: WheelTree, focusId: string | null = null, budget = DEFAULT_VISIBLE_BUDGET): Visible {
	return selectVisible(tree.root, doiField(tree.root, focusId), {
		budget,
		rings: DEFAULT_LAYOUT_OPTIONS.rings,
		share: shareOf(tree),
	});
}

/** Every node the selection actually draws. */
function drawnNodes(tree: WheelTree, visible: Visible): WheelNode[] {
	const out: WheelNode[] = [];
	const walk = (node: WheelNode): void => {
		const limit = visible.shown.get(node.id);
		if (limit === undefined) return;
		for (const child of orderedChildren(node).slice(0, limit)) {
			out.push(child);
			walk(child);
		}
	};
	walk(tree.root);
	return out;
}

describe("selectVisible — the drawing stays a connected tree", () => {
	const tree = treeOf(5000);
	const visible = select(tree);

	it("only opens a node whose own parent already draws it", () => {
		const drawn = new Set(drawnNodes(tree, visible).map((n) => n.id));
		for (const id of visible.expanded) {
			if (id === tree.root.id) continue;
			expect(drawn.has(id)).toBe(true);
		}
	});

	it("draws the whole domain ring, whatever the vault does", () => {
		expect(visible.shown.get(tree.root.id)).toBe(tree.root.children.length);
	});

	it("says so when it left something to a counter", () => {
		expect(visible.truncated).toBe(true);
	});
});

describe("selectVisible — the budget holds at any size", () => {
	it("draws a comparable number of items at 300, 1000 and 5000 tasks", () => {
		const counts = [300, 1000, 5000].map((size) => {
			const tree = treeOf(size);
			return drawnNodes(tree, select(tree)).length;
		});

		for (const count of counts) {
			expect(count).toBeLessThanOrEqual(DEFAULT_VISIBLE_BUDGET);
			expect(count).toBeGreaterThan(40);
		}
		// The whole point: the drawing does not grow with the vault.
		expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(3);
	});

	it("honours a smaller budget", () => {
		const tree = treeOf(5000);
		expect(drawnNodes(tree, select(tree, null, 80)).length).toBeLessThanOrEqual(80);
	});

	it("never crowds a ring past what fits on it", () => {
		const tree = treeOf(5000);
		const visible = select(tree);

		const perRing = new Map<number, number>();
		for (const node of drawnNodes(tree, visible)) {
			perRing.set(node.depth, (perRing.get(node.depth) ?? 0) + 1);
		}

		for (const [ring, count] of perRing) {
			if (ring <= 1) continue; // the domain ring is exempt: it is the map
			expect(count).toBeLessThanOrEqual(
				capacityAt(ring, DEFAULT_LAYOUT_OPTIONS.rings),
			);
		}
	});

	it("gives every domain a share of the wheel, not just the first few", () => {
		const tree = treeOf(5000);
		const drawn = drawnNodes(tree, select(tree));

		for (const domain of tree.domains) {
			const mine = drawn.filter((n) => n.domain === domain && n.depth > 1);
			expect(mine.length).toBeGreaterThan(0);
		}
	});
});

describe("selectVisible — partial opening", () => {
	const tree = treeOf(5000);
	const visible = select(tree);

	it("shows the first children of a branch that does not fit whole", () => {
		const partial = [...visible.shown.entries()].filter(([id, count]) => {
			const node = tree.byId.get(id);
			return node !== undefined && count < node.children.length;
		});
		expect(partial.length).toBeGreaterThan(0);

		// The ones drawn are the first in wedge order, never a chosen subset.
		const drawn = new Set(drawnNodes(tree, visible).map((n) => n.id));
		for (const [id, count] of partial) {
			const node = tree.byId.get(id) as WheelNode;
			const children = orderedChildren(node);
			for (let i = 0; i < children.length; i++) {
				expect(drawn.has(children[i].id)).toBe(i < count);
			}
		}
	});

	it("gives the same answer twice", () => {
		const again = select(tree);
		expect([...again.shown.entries()].sort()).toEqual(
			[...visible.shown.entries()].sort(),
		);
	});
});

describe("selectVisible — the focus always opens", () => {
	const tree = treeOf(5000);

	it("draws every child of the item under the reading wedge", () => {
		const plain = layoutWheel(tree);
		const focusId = buildDetents(plain).find((d) => {
			const node = tree.byId.get(d.id);
			return node !== undefined && node.children.length > 30;
		})?.id;

		expect(focusId).toBeDefined();
		if (focusId === undefined) return;

		const visible = select(tree, focusId);
		const focus = tree.byId.get(focusId) as WheelNode;
		expect(visible.shown.get(focusId)).toBe(focus.children.length);
	});

	it("opens the whole way down to it", () => {
		const plain = layoutWheel(tree);
		const deep = buildDetents(plain).find((d) => d.depth >= 3);
		expect(deep).toBeDefined();
		if (deep === undefined) return;

		const drawn = new Set(drawnNodes(tree, select(tree, deep.id)).map((n) => n.id));
		expect(drawn.has(deep.id)).toBe(true);
	});
});

describe("selectVisible — without a focus", () => {
	it("fills breadth first rather than favouring one wedge", () => {
		const tree = treeOf(1000);
		const visible = selectVisible(tree.root, NO_DOI, {
			budget: DEFAULT_VISIBLE_BUDGET,
			rings: DEFAULT_LAYOUT_OPTIONS.rings,
			share: shareOf(tree),
		});

		const drawn = drawnNodes(tree, visible);
		for (const domain of tree.domains) {
			expect(drawn.some((n) => n.domain === domain && n.depth > 1)).toBe(true);
		}
	});
});

describe("the wheel still cannot lie, at five thousand tasks", () => {
	it("accounts for every open task, drawn or counted", () => {
		const tree = treeOf(5000);
		const plain = layoutWheel(tree);

		for (const focusId of [null, buildDetents(plain)[0]?.id ?? null]) {
			const layout = layoutWheel(tree, { focusId });
			const drawn = layout.nodes.filter(
				(laid) => laid.node.kind === "task" && laid.node.fields?.done !== true,
			).length;
			const counted = layout.nodes.reduce(
				(sum, laid) => sum + laid.hiddenCount,
				0,
			);
			expect(drawn + counted).toBe(tree.root.shownTaskCount);
		}
	});
});
