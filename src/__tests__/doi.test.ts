import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import {
	DEFAULT_DOI,
	doiField,
	emphasisAt,
	NO_DOI,
	presenceAt,
} from "../layout/doi";
import { taskOrder, wedgeOrder } from "../layout/order";
import {
	DEFAULT_PARSE_OPTIONS,
	type ParseOptions,
	type WheelNode,
} from "../model/types";
import { VAULT } from "./fixtures/vault";

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeFolders: ["Archief"],
};

const tree = buildTree(VAULT, OPTIONS);

/** A task with a parent and at least one sibling, so every relation exists. */
function anchorTask(): WheelNode {
	const task = taskOrder(tree.root).find((candidate) => {
		const parent = parentOf(candidate.id);
		return parent !== null && parent.children.length > 1;
	});
	if (task === undefined) throw new Error("no suitable task in the fixture");
	return task;
}

function parentOf(id: string): WheelNode | null {
	for (const node of [tree.root, ...wedgeOrder(tree.root)]) {
		if (node.children.some((child) => child.id === id)) return node;
	}
	return null;
}

describe("the fall-off curves", () => {
	it("peaks on the focus and settles on the floor", () => {
		expect(emphasisAt(0)).toBeCloseTo(DEFAULT_DOI.peak, 9);
		expect(emphasisAt(40)).toBeCloseTo(DEFAULT_DOI.floor, 6);
	});

	it("never squeezes anything to nothing", () => {
		for (let distance = 0; distance < 30; distance++) {
			expect(emphasisAt(distance)).toBeGreaterThan(0);
			expect(presenceAt(distance)).toBeGreaterThanOrEqual(
				DEFAULT_DOI.presenceFloor,
			);
		}
	});

	it("falls away without ever rising again", () => {
		for (let distance = 1; distance < 20; distance++) {
			expect(emphasisAt(distance)).toBeLessThan(emphasisAt(distance - 1));
			expect(presenceAt(distance)).toBeLessThan(presenceAt(distance - 1));
		}
	});

	it("draws the focus at full strength", () => {
		expect(presenceAt(0)).toBeCloseTo(1, 9);
	});
});

describe("doiField — distance through the tree", () => {
	const focus = anchorTask();
	const field = doiField(tree.root, focus.id);

	it("puts the focus on itself at zero", () => {
		expect(field.distance.get(focus.id)).toBe(0);
	});

	it("reaches every node in the tree", () => {
		for (const node of wedgeOrder(tree.root)) {
			expect(field.distance.has(node.id)).toBe(true);
		}
		expect(field.distance.has(tree.root.id)).toBe(true);
	});

	it("counts a parent as one step and a sibling as two", () => {
		const parent = parentOf(focus.id);
		expect(parent).not.toBeNull();
		if (parent === null) return;

		expect(field.distance.get(parent.id)).toBe(1);
		const sibling = parent.children.find((child) => child.id !== focus.id);
		expect(sibling).toBeDefined();
		if (sibling === undefined) return;
		expect(field.distance.get(sibling.id)).toBe(2);
	});

	it("counts a child as one step", () => {
		const withChild = taskOrder(tree.root).find((t) => t.children.length > 0);
		expect(withChild).toBeDefined();
		if (withChild === undefined) return;

		const own = doiField(tree.root, withChild.id);
		expect(own.distance.get(withChild.children[0].id)).toBe(1);
	});

	it("holds the focus and everything under it as the branch", () => {
		const withChild = taskOrder(tree.root).find((t) => t.children.length > 0);
		expect(withChild).toBeDefined();
		if (withChild === undefined) return;

		const own = doiField(tree.root, withChild.id);
		expect(own.subtree.has(withChild.id)).toBe(true);
		expect(own.subtree.has(withChild.children[0].id)).toBe(true);
		expect(own.subtree.has(tree.root.id)).toBe(false);
	});

	it("gives the focus more angle than its siblings", () => {
		const parent = parentOf(focus.id);
		if (parent === null) return;
		const sibling = parent.children.find((child) => child.id !== focus.id);
		if (sibling === undefined) return;

		const mine = field.emphasis.get(focus.id) as number;
		const theirs = field.emphasis.get(sibling.id) as number;
		expect(mine).toBeGreaterThan(theirs);
	});

	it("has nothing to say without a focus", () => {
		expect(doiField(tree.root, null)).toBe(NO_DOI);
		expect(doiField(tree.root, "no such id")).toBe(NO_DOI);
	});
});

describe("the path — the branch being read (BC_E3_S27)", () => {
	it("holds the focus and everything above it", () => {
		const tree = buildTree(VAULT, DEFAULT_PARSE_OPTIONS);
		const leaf = [...tree.byId.values()]
			.filter((node) => node.depth > 2 && node.children.length === 0)
			.sort((a, b) => b.depth - a.depth)[0];
		expect(leaf).toBeDefined();

		const field = doiField(tree.root, leaf.id);
		expect(field.path.has(leaf.id)).toBe(true);

		// Every step from the focus to the hub, and nothing skipped: the chain is
		// what the drawing writes out, so a gap in it is a gap on screen.
		let steps = 0;
		for (const node of tree.byId.values()) {
			if (!field.path.has(node.id)) continue;
			steps++;
			expect(field.distance.get(node.id)).toBe(leaf.depth - node.depth);
		}
		expect(steps).toBe(leaf.depth + 1);
	});

	it("holds nothing below the focus, however near", () => {
		const tree = buildTree(VAULT, DEFAULT_PARSE_OPTIONS);
		const parent = [...tree.byId.values()].find(
			(node) => node.depth > 1 && node.children.length > 0,
		);
		expect(parent).toBeDefined();
		if (parent === undefined) return;

		const field = doiField(tree.root, parent.id);
		for (const child of parent.children) {
			expect(field.distance.get(child.id)).toBe(1);
			expect(field.path.has(child.id)).toBe(false);
		}
	});

	it("is empty when nothing is in focus", () => {
		const tree = buildTree(VAULT, DEFAULT_PARSE_OPTIONS);
		expect(doiField(tree.root, null).path.size).toBe(0);
	});
});
