import { describe, expect, it } from "vitest";
import { buildDetents } from "../layout/detents";
import { ringOrder, sidewaysFrom, taskRing } from "../layout/order";
import { layoutWheel } from "../layout/radial";
import { buildTree } from "../parse/build-tree";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type WheelNode,
	type WheelTree,
} from "../model/types";

/**
 * Sideways stays on its ring, and every step has a way back (BC_E3_S93).
 *
 * Two goes at this. The first read the step off the **drawing** and crossed to
 * the branch next door at whatever depth that branch happened to be drawn to
 * (BC_E3_S88) — which the owner tried and found broken within the hour: the
 * step took him a ring inwards and the opposite key would not bring him back,
 * because the way back was computed from a picture that had changed. *"Een
 * toetsenbord pijl naar links / rechts neemt nog steeds een stap de diepte in
 * die je ook niet terug kunt zetten naar waar je vandaan kwam"* (1 sep 2026).
 *
 * A ring is a fact about the tree, not about what is drawn. Taken from there it
 * is complete, the step never changes ring, and the inverse step is the
 * inverse.
 */

function deepNote(name: string): string {
	const lines = [`# ${name}`, ""];
	for (const branch of ["a", "b", "c", "d"]) {
		lines.push(`- [ ] ${name} ${branch}`);
		lines.push(`    - [ ] ${name} ${branch}1`);
		lines.push(`        - [ ] ${name} ${branch}1x`);
		lines.push(`            - [ ] ${name} ${branch}1x-deep`);
	}
	return lines.join("\n") + "\n";
}

/** Eight domains of six notes each — comfortably past any drawing budget. */
function bigVault(): NoteInput[] {
	const notes: NoteInput[] = [];
	for (let domain = 0; domain < 8; domain++) {
		for (let note = 0; note < 6; note++) {
			const name = `dom${domain}-n${note}`;
			notes.push({ path: `dom${domain}/${name}.md`, content: deepNote(name) });
		}
	}
	return notes;
}

function idOf(tree: WheelTree, fragment: string): string {
	const id = [...tree.byId.keys()].find((key) => key.includes(fragment));
	expect(id, `no node matching ${fragment}`).toBeDefined();
	return id as string;
}

function nodeOf(tree: WheelTree, id: string): WheelNode {
	const node = tree.byId.get(id);
	expect(node, `no node ${id}`).toBeDefined();
	return node as WheelNode;
}

const TREE = buildTree(bigVault(), DEFAULT_PARSE_OPTIONS);
const DEEP = idOf(TREE, "dom0-n0 a1x-deep");
const DOMAINS = layoutWheel(TREE, { focusId: DEEP, visibleBudget: 240 }).budgets.map(
	(budget) => budget.domain,
);

const step = (from: string, delta: number): string | null =>
	sidewaysFrom(TREE.root, DOMAINS, from, delta, "ring");

describe("one step sideways", () => {
	it("has a ring of one in the drawing — which is why the drawing cannot answer", () => {
		const layout = layoutWheel(TREE, { focusId: DEEP, visibleBudget: 240 });
		const detents = buildDetents(layout);
		const here = detents.find((detent) => detent.id === DEEP);

		expect(detents.filter((detent) => detent.depth === here?.depth)).toHaveLength(1);
	});

	it("but a ring of many in the tree", () => {
		const ring = ringOrder(TREE.root, nodeOf(TREE, DEEP).depth, DOMAINS);

		expect(ring.length).toBeGreaterThan(100);
		expect(ring.map((node) => node.id)).toContain(DEEP);
	});

	it("never changes the ring the reader is on", () => {
		let at = DEEP;
		for (let press = 0; press < 20; press++) {
			const to = step(at, 1);
			expect(to).not.toBeNull();
			expect(nodeOf(TREE, to as string).depth).toBe(nodeOf(TREE, DEEP).depth);
			at = to as string;
		}
	});

	it("comes back to where it came from — every step, both ways", () => {
		let at = DEEP;
		for (let press = 0; press < 20; press++) {
			const to = step(at, 1) as string;
			expect(step(to, -1)).toBe(at);
			at = to;
		}
	});

	it("comes back from the very first step, which is the one that broke", () => {
		const to = step(DEEP, 1) as string;

		expect(to).not.toBe(DEEP);
		expect(step(to, -1)).toBe(DEEP);
	});

	it("keeps going instead of standing still", () => {
		const seen = new Set<string>();
		let at = DEEP;
		for (let press = 0; press < 12; press++) {
			at = step(at, 1) as string;
			seen.add(at);
		}

		expect(seen.size).toBe(12);
	});

	it("walks the ring in the wheel's own order, wrapping at the end", () => {
		const depth = nodeOf(TREE, DEEP).depth;
		const ring = ringOrder(TREE.root, depth, DOMAINS).map((node) => node.id);

		expect(step(ring[0], -1)).toBe(ring[ring.length - 1]);
		expect(step(ring[ring.length - 1], 1)).toBe(ring[0]);
		expect(step(ring[0], 1)).toBe(ring[1]);
	});

	it("walks the wedges on the first ring, in the order the round dealt them", () => {
		const wedges = ringOrder(TREE.root, 1, DOMAINS);

		expect(wedges.map((node) => node.domain)).toEqual([...DOMAINS]);
		expect(step(wedges[0].id, 1)).toBe(wedges[1].id);
		expect(step(wedges[0].id, -1)).toBe(wedges[wedges.length - 1].id);
	});

	it("refuses when there is nowhere sideways to be", () => {
		const lonely = buildTree(
			[{ path: "solo/only.md", content: "# Only\n\n- [ ] one\n" }],
			DEFAULT_PARSE_OPTIONS,
		);
		const wedge = lonely.root.children[0];

		expect(sidewaysFrom(lonely.root, [wedge.domain], wedge.id, 1)).toBeNull();
		expect(sidewaysFrom(lonely.root, [wedge.domain], "not-a-node", 1)).toBeNull();
	});
});

/**
 * A long branch is not a cul-de-sac (BC_E3_S94).
 *
 * Walking the reader's own ring is right until the ring is one branch's alone,
 * and a depth that only one branch reaches is exactly that. The owner met it
 * within the hour: *"stel er zijn drie taken aan het eind van een lange tak,
 * dan gaat nu de focus van de laatste naar de eerste van dezelfde set en niet
 * naar de eerstvolgende aan de volgende tak"* (1 sep 2026).
 *
 * Not a fault in the rule — the ring really is those three — but the reason the
 * default walks **every task** instead, and why the ring stays on offer for
 * when comparing one depth across branches is the point.
 */
describe("a long branch ending in three", () => {
	const NOTES: NoteInput[] = [
		{
			path: "werk/diep.md",
			content: [
				"# Diep",
				"",
				"- [ ] een",
				"    - [ ] twee",
				"        - [ ] drie",
				"            - [ ] vier a",
				"            - [ ] vier b",
				"            - [ ] vier c",
				"",
			].join("\n"),
		},
		{ path: "werk/plat.md", content: "# Plat\n\n- [ ] p1\n- [ ] p2\n" },
		{ path: "thuis/plat.md", content: "# Thuis\n\n- [ ] t1\n- [ ] t2\n" },
	];

	const tree = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
	const last = idOf(tree, "vier c");
	const domains = layoutWheel(tree, { focusId: last }).budgets.map(
		(budget) => budget.domain,
	);
	const label = (id: string | null): string | undefined =>
		id === null ? undefined : tree.byId.get(id)?.label;

	it("is a ring of three, and walking the ring says so", () => {
		const depth = nodeOf(tree, last).depth;

		expect(ringOrder(tree.root, depth, domains)).toHaveLength(3);
		expect(label(sidewaysFrom(tree.root, domains, last, 1, "ring"))).toBe(
			"vier a",
		);
	});

	it("walks on out of the branch when it walks tasks", () => {
		expect(label(sidewaysFrom(tree.root, domains, last, 1, "tasks"))).toBe("p1");
	});

	it("and back in again, from the other side", () => {
		const p1 = idOf(tree, "p1");

		expect(label(sidewaysFrom(tree.root, domains, p1, -1, "tasks"))).toBe(
			"vier c",
		);
	});

	it("reaches every task in the vault and comes back to the start", () => {
		const tasks = taskRing(tree.root, domains);
		const seen = new Set<string>();

		let at = last;
		for (let press = 0; press < tasks.length; press++) {
			at = sidewaysFrom(tree.root, domains, at, 1, "tasks") as string;
			seen.add(at);
		}

		expect(seen.size).toBe(tasks.length);
		expect(at).toBe(last);
	});

	it("is reversible in both modes, on every step", () => {
		for (const along of ["tasks", "ring"] as const) {
			let at = last;
			for (let press = 0; press < 6; press++) {
				const to = sidewaysFrom(tree.root, domains, at, 1, along) as string;
				expect(sidewaysFrom(tree.root, domains, to, -1, along)).toBe(at);
				at = to;
			}
		}
	});

	it("starts from where the reader stands, even off the ring", () => {
		// A heading is on no task ring at all; the next task is still the next
		// task after it, not the first in the vault.
		const heading = tree.root.children[0].id;
		const on = sidewaysFrom(tree.root, domains, heading, 1, "tasks");

		expect(on).not.toBeNull();
		expect(taskRing(tree.root, domains).some((task) => task.id === on)).toBe(true);
	});
});

/* ------------------------------------------------------------------ */
/* Stepping over what the round has already been past (BC_E3_S138)     */
/* ------------------------------------------------------------------ */

describe("the arrow steps over what this round has seen", () => {
	const NOTES: NoteInput[] = [
		{ path: "werk/plat.md", content: "# Werk\n\n- [ ] w1\n- [ ] w2\n- [ ] w3\n- [ ] w4\n" },
		{ path: "thuis/plat.md", content: "# Thuis\n\n- [ ] t1\n- [ ] t2\n" },
	];

	const tree = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
	const first = idOf(tree, "w1");
	const domains = layoutWheel(tree, { focusId: first }).budgets.map(
		(budget) => budget.domain,
	);
	const label = (id: string | null): string | undefined =>
		id === null ? undefined : tree.byId.get(id)?.label;

	/** Step along the task ring, with these labels already behind the reader. */
	const walk = (from: string, delta: number, ...behind: string[]): string | undefined => {
		const marks = new Set(
			[...tree.byId.values()]
				.filter((node) => behind.includes(node.label))
				.map((node) => node.id),
		);
		return label(
			sidewaysFrom(tree.root, domains, from, delta, "tasks", (id) => marks.has(id)),
		);
	};

	it("passes over a run of items it has already been past", () => {
		// Looking at the same task twice is time spent for nothing, and after an
		// hour of sorting most of a ring is behind you (eigenaar, 4 sep 2026).
		expect(walk(first, 1, "w2", "w3")).toBe("w4");
	});

	it("stops on the very next one when that one is new", () => {
		expect(walk(first, 1, "w3")).toBe("w2");
	});

	it("steps back exactly one, even though the one behind is seen", () => {
		// Coming to rest on something is having seen it, so everything the reader
		// has walked is behind them and marked. A backwards step that skipped
		// what it had seen could never return them to where they came from.
		// Measured before this rule existed: stepping back from here answered
		// with a task two wedges away.
		const w3 = idOf(tree, "w3");
		expect(walk(w3, -1, "w1", "w2")).toBe("w2");
	});

	it("walks on as it always did once everything is seen", () => {
		// The end of a round must not leave the key dead.
		expect(walk(first, 1, "w2", "w3", "w4", "t1", "t2")).toBe("w2");
	});

	it("reaches a straggler that is behind the reader", () => {
		// The round that would not close (eigenaar, 5 sep 2026: stuck at 193 of
		// 194). Moving tasks about leaves the last unseen ones *behind* you, and
		// the first version stopped searching at the end of the ring — so the key
		// fell back to the plain neighbour, one already-seen item per press, a
		// hundred and ninety times. Each press looked like nothing happened.
		const w4 = idOf(tree, "w4");
		expect(walk(w4, 1, "w2", "w3", "w4", "t1", "t2")).toBe("w1");
	});

	it("does not offer the item the reader is standing on", () => {
		// It is marked the moment they land, so a lap that offered it back would
		// answer the key with "you are already here".
		expect(walk(first, 1, "w2", "w3", "w4", "t1", "t2")).toBe("w2");
	});

	it("does not skip when the round is not offered", () => {
		expect(label(sidewaysFrom(tree.root, domains, first, 1, "tasks"))).toBe("w2");
	});
});
