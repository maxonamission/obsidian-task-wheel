import { describe, expect, it } from "vitest";
import { layoutWheel, type WheelLayout } from "../layout/radial";
import { taskAfter } from "../layout/order";
import { buildTree } from "../parse/build-tree";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type WheelTree,
} from "../model/types";

/**
 * How still the wheel stands while you step through a round (BC_E3_S47).
 *
 * Hard requirement §3.1 is that the wheel never lies about what it is not
 * showing, and §5 promises that stepping does not shuffle the drawing under
 * you. Two earlier stories bought most of that — structural angles handed out
 * once (BC_E3_S41) and a branch that stays straight (BC_E3_S38) — but on a
 * vault bigger than the drawing budget there is a third source of movement
 * nobody had measured: the *selection* of what gets drawn is worked out per
 * stop, so items come and go as the reader walks.
 *
 * The audit of 23 aug 2026 raised it; the owner's decision (23 aug 2026) is to
 * accept what is left and pin it, so it can never quietly get worse. The
 * numbers below are that pin. What they say:
 *
 *  - Items **do** come and go as you step — that is the fisheye doing its job,
 *    opening detail where the reader is. Nearly all of it is inside the wedge
 *    they are standing in.
 *  - What must stay small is movement on the **far side**: items swapping in
 *    another wedge, and structural angles shifting outside the branch being
 *    read. Both are single digits, and one of them is usually zero.
 *
 * These are exact numbers from a fixed vault, not a benchmark — nothing here
 * is timed and nothing is random, so a change in the bounds means a change in
 * behaviour.
 */

/** A vault of a given size; `uneven` gives a few huge projects among small ones. */
function vault(tasks: number, uneven: boolean): NoteInput[] {
	const notes: NoteInput[] = [];
	const domains = ["Werk", "Gezin", "Studie", "Huis", "Sport", "Vrienden"];
	let made = 0;
	let n = 0;

	while (made < tasks) {
		const big = uneven && n % 7 === 0;
		const count = big ? 120 : 12;
		const heads = big ? 8 : 3;
		const lines: string[] = [`# Notitie ${n}`];

		for (let h = 0; h < heads; h++) {
			lines.push(`## Kop ${h}`);
			for (let t = 0; t < count / heads; t++) {
				lines.push(`- [ ] Taak ${n}-${h}-${t} iets om te doen`);
				if (t % 3 === 0) lines.push(`    - [ ] Subtaak ${n}-${h}-${t}`);
			}
		}

		notes.push({
			path: `${domains[n % domains.length]}/Project ${n}.md`,
			content: lines.join("\n"),
		});
		made += count;
		n++;
	}

	return notes;
}

/** The focus and every container above it: everything that is meant to move. */
function readingBranch(layout: WheelLayout, id: string): Set<string> {
	const out = new Set<string>();
	let at = layout.byId.get(id);
	while (at !== undefined) {
		out.add(at.id);
		at = at.parentId === null ? undefined : layout.byId.get(at.parentId);
	}
	return out;
}

/**
 * The first stops of a round.
 *
 * `taskAfter` walks *from* somewhere and answers null when asked from nowhere,
 * so the first stop is taken from the drawing — which is what the wheel does.
 */
function stops(tree: WheelTree, budget: number, howMany: number): string[] {
	const first = layoutWheel(tree, { visibleBudget: budget }).nodes.find(
		(node) => node.node.kind === "task",
	)?.id;
	if (first === undefined) return [];

	const out = [first];
	let at: string | null = first;
	for (let i = 1; i < howMany; i++) {
		at = taskAfter(tree.root, at);
		if (at === null || at === first) break;
		out.push(at);
	}
	return out;
}

interface Restlessness {
	/** Items drawn at one stop and not the other. */
	swapped: number;
	/** Of those, the ones in a wedge other than the reader's own. */
	elsewhere: number;
	/** Nodes outside the reading branch whose structural angle changed. */
	shifted: number;
	/** And the worst of those shifts, in degrees. */
	degrees: number;
}

/**
 * Every case, walked once.
 *
 * Laying out a wheel over five thousand tasks is tens of milliseconds, and each
 * case walks a dozen stops twice over — so the answers are worked out once and
 * shared rather than recomputed per assertion.
 */
const measured = new Map<string, Restlessness>();

/** Walk a round and answer the worst single step of it. */
function worstStep(tasks: number, uneven: boolean, budget = 240): Restlessness {
	const key = `${tasks}:${uneven}:${budget}`;
	const already = measured.get(key);
	if (already !== undefined) return already;

	const tree = buildTree(vault(tasks, uneven), DEFAULT_PARSE_OPTIONS);
	const walk = stops(tree, budget, 12);
	expect(walk.length).toBeGreaterThan(8);

	const worst: Restlessness = { swapped: 0, elsewhere: 0, shifted: 0, degrees: 0 };

	for (let i = 1; i < walk.length; i++) {
		const a = layoutWheel(tree, { visibleBudget: budget, focusId: walk[i - 1] });
		const b = layoutWheel(tree, { visibleBudget: budget, focusId: walk[i] });

		const inA = new Set(a.nodes.map((node) => node.id));
		const inB = new Set(b.nodes.map((node) => node.id));
		const gone = [...inA].filter((id) => !inB.has(id));
		const came = [...inB].filter((id) => !inA.has(id));

		const wedge = a.byId.get(walk[i - 1])?.domain;
		const elsewhere = [
			...gone.map((id) => a.byId.get(id)),
			...came.map((id) => b.byId.get(id)),
		].filter((node) => node !== undefined && node.domain !== wedge).length;

		const reading = new Set([
			...readingBranch(a, walk[i - 1]),
			...readingBranch(b, walk[i]),
		]);

		let shifted = 0;
		let degrees = 0;
		for (const node of a.nodes) {
			if (reading.has(node.id)) continue;
			const other = b.byId.get(node.id);
			if (other === undefined) continue;

			// Shortest way round, so 359° and 1° are two degrees apart.
			const moved = Math.abs(((node.angle - other.angle + 540) % 360) - 180);
			if (moved > 0.01) {
				shifted++;
				degrees = Math.max(degrees, moved);
			}
		}

		worst.swapped = Math.max(worst.swapped, gone.length + came.length);
		worst.elsewhere = Math.max(worst.elsewhere, elsewhere);
		worst.shifted = Math.max(worst.shifted, shifted);
		worst.degrees = Math.max(worst.degrees, degrees);
	}

	measured.set(key, worst);
	return worst;
}

/** The shapes worth walking: even and uneven, at three sizes. */
const CASES = [
	[500, false],
	[2000, false],
	[5000, false],
	[500, true],
	[2000, true],
] as const;

describe("stepping through a round on a vault bigger than the budget", () => {
	it("opens detail where the reader is, and almost nowhere else", () => {
		for (const [tasks, uneven] of CASES) {
			const worst = worstStep(tasks, uneven);

			// Items coming and going is the fisheye working. The bound is here to
			// catch it becoming a reshuffle rather than to hold it at a number.
			expect(worst.swapped).toBeLessThanOrEqual(60);

			// This is the one that matters: what changes on the far side of the
			// wheel, away from where the reader is looking.
			expect(worst.elsewhere).toBeLessThanOrEqual(5);
		}
	});

	it("leaves the structural angles outside the reading branch nearly alone", () => {
		for (const [tasks, uneven] of CASES) {
			const worst = worstStep(tasks, uneven);

			expect(worst.shifted).toBeLessThanOrEqual(5);
			expect(worst.degrees).toBeLessThanOrEqual(14);
		}
	});

	it("holds an evenly filled vault completely still outside the branch", () => {
		// Where the shifting comes from is uneven competition for the budget, so
		// an even vault is the case that should be exactly zero — and saying so
		// keeps the two bounds above from being read as "some movement is fine".
		for (const tasks of [500, 2000, 5000]) {
			const worst = worstStep(tasks, false);
			expect(worst.shifted).toBe(0);
			expect(worst.degrees).toBe(0);
		}
	});
});
