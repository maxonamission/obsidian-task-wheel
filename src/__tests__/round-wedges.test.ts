import { describe, expect, it } from "vitest";
import { roundOrder } from "../layout/budgets";
import { layoutWheel } from "../layout/radial";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * The wedges a round was dealt stay the wedges of that round (BC_E3_S82).
 *
 * `assignBudgets` hands out hue and angle by *position*, and the parser sorts
 * the domains structurally — so a domain that turns up mid-round sorts into the
 * middle and everything after it moves along one. Measured 28 aug 2026 on four
 * domains, adding `Health`:
 *
 * ```
 * before:  Community#0 0–90   Finance#1 90–180   Home#2 180–270  Work#3 270–360
 * after:   Community#0 0–72   Finance#1 72–144   Health#2 144–216 Home#3 216–288  Work#4 288–360
 * ```
 *
 * `Home` went from hue 2 to hue 3, `Work` from 3 to 4. A wedge the reader had
 * learned as a colour in a place became a different colour somewhere else,
 * halfway through a round. With folders that is rare; with the domain in a
 * property (BC_E3_S81) it is one keystroke away.
 */

function note(folder: string, tasks: number): NoteInput {
	const lines = Array.from({ length: tasks }, (_, i) => `- [ ] task ${i}`);
	return { path: `${folder}/N.md`, content: lines.join("\n") };
}

const DEALT = ["Community", "Finance", "Home", "Work"];
const FOUR = DEALT.map((domain) => note(domain, 2));
const WITH_HEALTH = [...FOUR, note("Health", 2)];
const WITHOUT_FINANCE = FOUR.filter((n) => !n.path.startsWith("Finance"));

/** Every wedge as "domain#hue start–end", which is the whole of its identity. */
function wedges(notes: NoteInput[], roundDomains: string[] | null): string[] {
	const tree = buildTree(notes, DEFAULT_PARSE_OPTIONS);
	return layoutWheel(tree, { roundDomains }).budgets.map(
		(b) => `${b.domain}#${b.index} ${Math.round(b.startAngle)}–${Math.round(b.endAngle)}`,
	);
}

describe("the order a round holds", () => {
	it("is whatever the tree says when no round has dealt one", () => {
		// A wheel opening for the first time, and every existing data.json,
		// where the field is simply absent.
		expect(roundOrder(null, ["b", "a"])).toEqual(["b", "a"]);
		expect(roundOrder(undefined, ["b", "a"])).toEqual(["b", "a"]);
	});

	it("appends a newcomer instead of sorting it in", () => {
		expect(roundOrder(["a", "c"], ["a", "b", "c"])).toEqual(["a", "c", "b"]);
	});

	it("keeps a domain that has gone quiet", () => {
		expect(roundOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "b", "c"]);
	});

	it("keeps the dealt order even when the tree reorders underneath", () => {
		expect(roundOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
	});

	it("names no domain twice when a quiet one comes back", () => {
		expect(roundOrder(["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
		expect(roundOrder(["a", "b"], ["b", "a"])).toEqual(["a", "b"]);
	});
});

describe("a domain that turns up mid-round", () => {
	it("takes no wedge's hue and no wedge's place", () => {
		const before = wedges(FOUR, DEALT);
		const after = wedges(WITH_HEALTH, DEALT);

		// The four keep their hue and their order; only their widths give way,
		// because the circle is 360° and a fifth wedge has to come from
		// somewhere.
		for (const [at, domain] of DEALT.entries()) {
			expect(after[at]).toContain(`${domain}#${at} `);
			expect(before[at]).toContain(`${domain}#${at} `);
		}
		expect(after[4]).toContain("Health#4 ");
	});

	it("is still drawn, and its work still counts", () => {
		// Nothing may vanish (harde eis 3): waiting for the round boundary must
		// never mean waiting to be shown.
		const tree = buildTree(WITH_HEALTH, DEFAULT_PARSE_OPTIONS);
		const layout = layoutWheel(tree, { roundDomains: DEALT });

		expect(layout.budgets.some((b) => b.domain === "Health")).toBe(true);
		expect(layout.budgets.every((b) => b.degrees > 0)).toBe(true);
		expect(tree.root.shownTaskCount).toBe(10);
		expect(
			layout.nodes.some((laid) => laid.depth === 1 && laid.node.label === "Health"),
		).toBe(true);
	});

	it("would have moved two wedges without the frozen order", () => {
		// The artefact itself, kept as a measurement — this is what the story is
		// about, and it is what the fix has to keep answering for.
		const loose = wedges(WITH_HEALTH, null);
		expect(loose[2]).toContain("Health#2 ");
		expect(loose[3]).toContain("Home#3 ");
		expect(loose[4]).toContain("Work#4 ");
	});
});

describe("a domain that empties mid-round", () => {
	it("keeps its place, and the drawing does not move at all", () => {
		// The strongest case for holding the order: ticking off the last task in
		// a domain is ordinary review work, and it must not rearrange the wheel
		// you are reviewing on.
		expect(wedges(WITHOUT_FINANCE, DEALT)).toEqual(wedges(FOUR, DEALT));
	});

	it("moves everything after it when the order is not held", () => {
		const loose = wedges(WITHOUT_FINANCE, null);
		expect(loose).toHaveLength(3);
		expect(loose[1]).toContain("Home#1 ");
	});
});

describe("both divisions", () => {
	const division = {
		weights: { Community: 2, Finance: 4, Home: 8, Work: 16 },
		minimum: 15,
	};

	it("holds the order when the wedges divide by open tasks too", () => {
		// Order is not a property of the division, so it is dealt in both — the
		// weights are frozen separately and only in the proportional one.
		const tree = buildTree(WITH_HEALTH, DEFAULT_PARSE_OPTIONS);
		const budgets = layoutWheel(tree, { roundDomains: DEALT, division }).budgets;

		expect(budgets.map((b) => b.domain)).toEqual([...DEALT, "Health"]);
		expect(budgets[4].domain).toBe("Health");
		// A newcomer has no frozen weight, so it falls to the readability floor
		// rather than to nothing — measured, not assumed.
		expect(Math.round(budgets[4].degrees)).toBe(15);
	});

	it("gives a pinned wedge its width whatever the order says", () => {
		const budgets = layoutWheel(buildTree(WITH_HEALTH, DEFAULT_PARSE_OPTIONS), {
			roundDomains: DEALT,
			budgets: { Home: 120 },
		}).budgets;

		const home = budgets.find((b) => b.domain === "Home");
		expect(home?.pinned).toBe(true);
		expect(Math.round(home?.degrees ?? 0)).toBe(120);
		expect(budgets.map((b) => b.domain)).toEqual([...DEALT, "Health"]);
	});
});

/**
 * A wedge holding its place says whose place it is (BC_E3_S83).
 *
 * Holding the order (above) left an emptied domain standing as a coloured band
 * with no name on it, which reads as a drawing error rather than as a
 * statement. And it threw away what the emptiness is telling you: not "nothing
 * here" but "nothing here **under this filter**" — the work in that domain is
 * done, parked, or filtered out, and the wedge is still its own (eigenaar,
 * 28 aug 2026).
 */
describe("the name of a wedge with nothing on it", () => {
	it("is reported by the layout, because no node can carry it", () => {
		const tree = buildTree(WITHOUT_FINANCE, DEFAULT_PARSE_OPTIONS);
		const layout = layoutWheel(tree, { roundDomains: DEALT });

		expect(layout.quietWedges.map((b) => b.domain)).toEqual(["Finance"]);
		// And it is a real wedge, with the width and the hue it was dealt.
		expect(layout.quietWedges[0].index).toBe(1);
		expect(layout.quietWedges[0].degrees).toBeGreaterThan(0);
	});

	it("says nothing about a wheel where every wedge has work on it", () => {
		const full = layoutWheel(buildTree(FOUR, DEFAULT_PARSE_OPTIONS), {
			roundDomains: DEALT,
		});
		expect(full.quietWedges).toEqual([]);
	});

	it("counts a domain whose work is filtered away, not only one that is done", () => {
		// The two are the same shape from here: the round holds the wedge and the
		// tree has nothing to put in it. Which of the two it is, is exactly what
		// the reader is meant to be able to ask.
		const filtered = buildTree(FOUR, {
			...DEFAULT_PARSE_OPTIONS,
			filter: { ...DEFAULT_PARSE_OPTIONS.filter, text: "task 0" },
		});
		const layout = layoutWheel(filtered, {
			roundDomains: [...DEALT, "Health"],
		});
		expect(layout.quietWedges.map((b) => b.domain)).toEqual(["Health"]);
	});

	it("never names a wedge that has been crowded down to ticks", () => {
		// A domain whose tasks are all drawn as ticks still has work on it, and
		// naming it quiet would be a lie. Worked out from the tree, not from what
		// survived the drawing budget.
		const busy = Array.from({ length: 4 }, (_, i) => note(DEALT[i], 200));
		const layout = layoutWheel(buildTree(busy, DEFAULT_PARSE_OPTIONS), {
			roundDomains: DEALT,
			visibleBudget: 20,
		});
		expect(layout.quietWedges).toEqual([]);
	});
});
