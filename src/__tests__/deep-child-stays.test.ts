import { describe as group, expect, it } from "vitest";
import { layoutWheel, type WheelLayout } from "../layout/radial";
import {
	acrossRings,
	buildDetents,
	indexOfId,
	nearestTurnStop,
} from "../layout/detents";
import { angleDelta } from "../layout/geometry";
import { buildTree } from "../parse/build-tree";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type WheelTree,
} from "../model/types";

/**
 * What the wheel draws, it can also hold the focus on (BC_E3_S61).
 *
 * Reported 26 aug 2026, desktop and phone alike: a subtask deep in a branch
 * could not be selected. The selection sprang back to its parent, with the
 * arrows and with the mouse, and zooming in on that one wedge made it reachable
 * again. The story left four explanations open, and this is the measurement
 * that tells them apart:
 *
 *  - **(a)** the child is not drawn once it is the focus itself, so `adopt`
 *    cannot find it and rests on the nearest stop, which is the parent;
 *  - **(b)** it is drawn, but the nearest stop resolves to the parent anyway;
 *  - **(c)** the depth bonus leaks into the angle budget, so the wheel is laid
 *    out differently depending on where you stand;
 *  - **(d)** the visibility budget, rather than the depth.
 *
 * The branch is the reported one: a domain, a note, a heading and then nested
 * tasks, putting "drie" on depth 6 (the default `maxDepth`), "vier a" on 7,
 * "vijf" on 8 (`maxDepth + depthBonus`) and "zes" on 9.
 *
 * All four come back negative on this branch, at three budgets and with one or
 * two children. That is not the same as the report having been wrong: (a) was
 * real and is repaired, by the ancestors-are-never-stumps guard `isStump` grew
 * in BC_E3_S95 (`fc74b47`, 1 sep 2026, five days after the report). What this
 * file adds is the half that story did not cover: the *transition* from
 * standing on the parent to standing on the child, and the detent side of it.
 */

/** The reported shape: nested tasks under a heading, six to nine deep. */
function deep(name: string, siblings: 1 | 2, deeper: boolean): string {
	const lines = [
		`# ${name}`,
		"",
		`- [ ] ${name} een`,
		`    - [ ] ${name} twee`,
		`        - [ ] ${name} drie`,
		`            - [ ] ${name} vier a`,
	];
	if (deeper) {
		lines.push(`                - [ ] ${name} vijf`);
		lines.push(`                    - [ ] ${name} zes`);
	}
	// A second child so the parent and the child cannot share an angle: with an
	// only child they sit on the same spoke, and then a nearest-stop test proves
	// nothing about which of the two was picked.
	if (siblings === 2) lines.push(`            - [ ] ${name} vier b`);
	lines.push("");
	return lines.join("\n");
}

function vault(
	domains: number,
	notes: number,
	siblings: 1 | 2,
	deeper = false,
): NoteInput[] {
	const out: NoteInput[] = [];
	for (let d = 0; d < domains; d++) {
		for (let n = 0; n < notes; n++) {
			out.push({
				path: `dom${d}/n${n}.md`,
				content: deep(`d${d}n${n}`, siblings, deeper),
			});
		}
	}
	return out;
}

function idOf(tree: WheelTree, label: string): string {
	for (const [id, node] of tree.byId) {
		if (node.label.includes(label)) return id;
	}
	throw new Error(`no node labelled ${label}`);
}

/** The focus and everything above it: the one branch allowed to move. */
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
 * One step outward, as the controller and the view really make it.
 *
 * Lay out around the parent, step across the rings, lay out around the child,
 * and then ask the two questions `adopt` asks: is the id still among the stops,
 * and if it were not, what would the nearest stop be? Both arrows and taps join
 * this path at `snapTo`, so one measurement covers desktop and phone; nothing
 * in the chain touches the DOM.
 */
function stepOutward(
	tree: WheelTree,
	parent: string,
	child: string,
	visibleBudget: number,
) {
	const before = layoutWheel(tree, { focusId: parent, visibleBudget });
	const stopsBefore = buildDetents(before);
	const childAt = indexOfId(stopsBefore, child);
	const stepped = acrossRings(stopsBefore, indexOfId(stopsBefore, parent), true);

	const after = layoutWheel(tree, { focusId: child, visibleBudget });
	const stopsAfter = buildDetents(after);

	const branch = readingBranch(after, child);
	let shifted = 0;
	for (const laid of after.nodes) {
		if (branch.has(laid.id)) continue;
		const was = before.byId.get(laid.id);
		if (was !== undefined && Math.abs(angleDelta(was.angle, laid.angle)) > 1e-6) {
			shifted += 1;
		}
	}

	return {
		before,
		after,
		stopsAfter,
		childAt,
		stepped,
		kept: indexOfId(stopsAfter, child),
		nearest: nearestTurnStop(stopsAfter, stopsBefore[childAt]?.rotation ?? 0),
		shifted,
	};
}

const ROOMS = [
	["one note, no pressure on the budget", 1, 1, 240],
	["a busy vault at the default budget", 8, 6, 240],
	["a busy vault at a squeezed budget", 8, 6, 60],
] as const;

group("a subtask on ring seven keeps the focus it is handed", () => {
	for (const siblings of [1, 2] as const) {
		for (const [room, domains, notes, budget] of ROOMS) {
			it(`${room}, ${siblings} child(ren) under the task on ring six`, () => {
				const tree = buildTree(
					vault(domains, notes, siblings),
					DEFAULT_PARSE_OPTIONS,
				);
				const parent = idOf(tree, "drie");
				const child = idOf(tree, "vier a");
				expect(tree.byId.get(parent)?.depth).toBe(6);
				expect(tree.byId.get(child)?.depth).toBe(7);

				const step = stepOutward(tree, parent, child, budget);

				// The starting point, as reported: standing on the task, the subtask
				// is drawn and is where one step outward goes.
				expect(step.before.byId.has(child)).toBe(true);
				expect(step.childAt).toBeGreaterThanOrEqual(0);
				expect(step.stepped).toBe(step.childAt);

				// (a) Does it survive being the focus itself? This is the one that
				// was real, and `isStump` is where it was answered.
				expect(step.kept, "(a) the child is not drawn in its own layout").
					toBeGreaterThanOrEqual(0);
				expect(step.after.byId.get(parent)?.hiddenCount).toBe(0);

				// (b) And would the nearest stop have found it anyway?
				expect(step.nearest?.id, "(b) the nearest stop is not the child").toBe(
					child,
				);

				// (c) Nothing outside the reading branch moved with the focus: angles
				// are handed out once (BC_E3_S41) and stepping does not shift the
				// drawing (§5.1).
				expect(step.shifted, "(c) angles outside the reading branch moved").toBe(
					0,
				);
				expect(step.after.warp).toEqual(step.before.warp);
			});
		}
	}

	it("stops honestly at the bonus limit rather than springing back", () => {
		const tree = buildTree(vault(1, 1, 1, true), DEFAULT_PARSE_OPTIONS);
		const vierA = idOf(tree, "vier a");
		const vijf = idOf(tree, "vijf");
		const zes = idOf(tree, "zes");
		expect(tree.byId.get(vijf)?.depth).toBe(8);
		expect(tree.byId.get(zes)?.depth).toBe(9);

		const step = stepOutward(tree, vierA, vijf, 240);

		// Inside the band, depth eight behaves like every other ring.
		expect(step.before.byId.has(vijf)).toBe(true);
		expect(step.kept).toBeGreaterThanOrEqual(0);

		// Past it, nine is not drawn — and that is a stump you can stand on, not
		// a bounce: it is counted, and the arrow stays where it is (§3.3).
		expect(step.after.byId.has(zes)).toBe(false);
		expect(step.after.byId.get(vijf)?.hiddenCount).toBe(1);
		const at = indexOfId(step.stopsAfter, vijf);
		expect(acrossRings(step.stopsAfter, at, true)).toBe(at);
	});
});
