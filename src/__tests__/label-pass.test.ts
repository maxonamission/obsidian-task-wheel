import { describe, expect, it } from "vitest";
import { layoutWheel, stripsClash, type LaidOutNode } from "../layout/radial";
import {
	anchorFor,
	HALO,
	type LabelPlan,
	LEAF_CHAR,
	LEAF_HEIGHT,
	placeLabels,
	rank,
	RIM_CHAR,
	RIM_HEIGHT,
} from "../layout/labels";
import { LABEL_CHARS } from "../layout/window";
import { taskAfter } from "../layout/order";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput } from "../model/types";

/**
 * What the labels promise, over a whole revolution (BC_E3_S51, audit T4).
 *
 * Three days of work in August 2026 bought three guarantees, each of them
 * *measured* on a throwaway harness and none of them written down as a test —
 * because the decision lived inside a class that needed a browser:
 *
 *  - no two labels lie across each other, at any turn of the wheel;
 *  - the item under the reading wedge always has its name;
 *  - the branch being read is named all the way down to the hub.
 *
 * With the decision split out of the renderer (audit M2) it can be asked
 * without a browser, so the harness becomes a test. A revolution is walked in
 * five-degree steps: 72 turns, every label placed at each of them.
 */

/** A vault with long names, which is where labels compete. */
function vault(notes: number): NoteInput[] {
	const domains = ["Werk", "Gezin", "Studie", "Huis"];
	const out: NoteInput[] = [];
	for (let n = 0; n < notes; n++) {
		const lines = [`# Project ${n}`];
		for (let h = 0; h < 2; h++) {
			lines.push(`## Een tamelijk lange kopnaam ${n}-${h}`);
			for (let t = 0; t < 5; t++) {
				lines.push(`- [ ] Een taak met een behoorlijk lange omschrijving ${n}-${h}-${t}`);
			}
		}
		out.push({
			path: `${domains[n % domains.length]}/Project ${n}.md`,
			content: lines.join("\n"),
		});
	}
	return out;
}

/**
 * The label plan for a drawn node, as the renderer builds it.
 *
 * The width is the estimate the renderer starts from — the browser's own
 * measurement only ever makes a label *narrower* than this guess, so a drawing
 * that holds together on the estimate holds together when measured.
 */
function planFor(laid: LaidOutNode, focusId: string | null): LabelPlan {
	const onRim = laid.depth === 1;
	const radius = laid.radius + (laid.onPath ? 11 : 7);
	const radians = (laid.drawAngle * Math.PI) / 180;
	// The two forms, exactly as `drawLabel` builds them: a wedge title and the
	// branch being read are written out while centred, everything else is not.
	const long = laid.node.label.slice(
		0,
		onRim
			? LABEL_CHARS.title
			: laid.onPath
				? LABEL_CHARS.reading
				: LABEL_CHARS.leaf,
	);
	const short = laid.node.label.slice(
		0,
		onRim ? LABEL_CHARS.domain : LABEL_CHARS.leaf,
	);

	return {
		angle: laid.drawAngle,
		x: radius * Math.sin(radians),
		y: -radius * Math.cos(radians),
		width: long.length * (onRim ? RIM_CHAR : LEAF_CHAR),
		height: (onRim ? RIM_HEIGHT : LEAF_HEIGHT) + HALO,
		onRim,
		centred: laid.onPath && !onRim,
		focus: laid.onPath && laid.distance === 0 && focusId !== null,
		near: laid.distance <= 1,
		long,
		short,
	};
}

/**
 * Every label of a wheel focused here, and which node each belongs to.
 *
 * Only the nodes the layout marks `labelled` get one — with nobody looking
 * that is the four wedge titles and nothing else, which is the wheel reading
 * as a shape rather than as a list. The crowd appears around a focus.
 */
function labelsFor(tasks: number, focusId: string | null) {
	const tree = buildTree(vault(tasks), DEFAULT_PARSE_OPTIONS);
	const layout = layoutWheel(tree, { focusId });
	const named = layout.nodes.filter(
		(laid) => laid.render === "labelled" && laid.depth > 0,
	);

	return {
		tree,
		layout,
		nodes: named,
		plans: named.map((laid) => planFor(laid, focusId)),
	};
}

/** The id of the first task on a wheel of this size. */
function firstTask(tasks: number): string {
	const tree = buildTree(vault(tasks), DEFAULT_PARSE_OPTIONS);
	const id = layoutWheel(tree).nodes.find(
		(laid) => laid.node.kind === "task",
	)?.id;
	if (id === undefined) throw new Error("no task on the wheel");
	return id;
}

/** Five degrees at a time, all the way round. */
const TURNS = Array.from({ length: 72 }, (_, i) => i * 5);

describe("labels over a whole revolution", () => {
	it("never lets two of them lie across each other", () => {
		const tree = buildTree(vault(24), DEFAULT_PARSE_OPTIONS);
		let focus: string | null = firstTask(24);
		let checked = 0;

		// Ten stops of a round, each at every turn of the wheel: the crowding
		// changes with the focus, so one drawing would not be a test of much.
		for (let stop = 0; stop < 10 && focus !== null; stop++) {
			const { plans } = labelsFor(24, focus);
			expect(plans.length).toBeGreaterThan(4);

			for (const degrees of TURNS) {
				const kept = placeLabels(plans, degrees).filter((one) => one.kept);

				for (let i = 0; i < kept.length; i++) {
					for (let j = i + 1; j < kept.length; j++) {
						// Except the focus, which is allowed to sit on anything.
						if (plans[kept[i].index].focus || plans[kept[j].index].focus) {
							continue;
						}
						expect(stripsClash(kept[i].strip, kept[j].strip)).toBe(false);
						checked++;
					}
				}
			}

			focus = taskAfter(tree.root, focus);
		}

		// Guards against the whole thing passing because nothing was compared.
		expect(checked).toBeGreaterThan(1000);
	});

	it("always names the item under the reading wedge", () => {
		const tree = buildTree(vault(24), DEFAULT_PARSE_OPTIONS);
		let focus: string | null = firstTask(24);

		// Twenty stops of a round, each asked at every turn of the wheel.
		for (let stop = 0; stop < 20 && focus !== null; stop++) {
			const { plans } = labelsFor(24, focus);
			const at = plans.findIndex((plan) => plan.focus);
			expect(at).toBeGreaterThanOrEqual(0);

			for (const degrees of TURNS) {
				expect(placeLabels(plans, degrees)[at].kept).toBe(true);
			}

			focus = taskAfter(tree.root, focus);
		}
	});

	it("keeps the whole reading branch named", () => {
		const focus = firstTask(24);
		const { nodes, plans } = labelsFor(24, focus);
		const branch = nodes
			.map((laid, index) => ({ laid, index }))
			.filter((one) => one.laid.onPath);
		expect(branch.length).toBeGreaterThan(1);

		// At the turn the reader is actually looking at: the wheel brings the
		// branch to twelve o'clock, and there every step of it must be readable.
		const placed = placeLabels(plans, -plans[branch[0].index].angle);
		for (const one of branch) {
			expect(placed[one.index].kept).toBe(true);
		}
	});
});

describe("the rules underneath", () => {
	it("asks the focus first, then titles, then the neighbourhood", () => {
		const base: LabelPlan = {
			angle: 0,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			onRim: false,
			centred: false,
			focus: false,
			near: false,
			long: "x",
			short: "x",
		};

		expect(rank({ ...base, focus: true, onRim: true })).toBe(0);
		expect(rank({ ...base, onRim: true })).toBe(1);
		expect(rank({ ...base, near: true })).toBe(2);
		expect(rank(base)).toBe(3);
	});

	it("hangs a label outward, and centres the two that must be", () => {
		// An ordinary label: to the right on the right half, left on the left.
		expect(anchorFor(90, false)).toBe("start");
		expect(anchorFor(270, false)).toBe("end");

		// A wedge title near twelve or six is centred, so it does not read as
		// belonging to the neighbouring wedge.
		expect(anchorFor(5, true)).toBe("middle");
		expect(anchorFor(183, true)).toBe("middle");
		expect(anchorFor(90, true)).toBe("start");

		// The reading branch keeps a wider centred window — it is what you are
		// looking at — but gives it up once swung round to the side.
		expect(anchorFor(30, false, true)).toBe("middle");
		expect(anchorFor(90, false, true)).toBe("start");
	});

	it("writes a reading label out long only while it is centred", () => {
		const plan: LabelPlan = {
			angle: 0,
			x: 0,
			y: -100,
			width: 30 * LEAF_CHAR,
			height: LEAF_HEIGHT + HALO,
			onRim: false,
			centred: true,
			focus: false,
			near: true,
			long: "een tamelijk lange naam die past",
			short: "een tamelijk l",
		};

		// At twelve o'clock, centred over its own dot: the long name.
		expect(placeLabels([plan], 0)[0].words).toBe(plan.long);
		// Swung round to three o'clock it hangs off one side, and reserving room
		// for a long name there costs the whole wheel a seventh (BC_E3_S42).
		expect(placeLabels([plan], 90)[0].words).toBe(plan.short);
	});

	it("lets the focus keep its name even where a title would not", () => {
		// Two labels in exactly the same place. Without the exemption the second
		// would step aside; the focus never does.
		const here = {
			angle: 0,
			x: 0,
			y: -100,
			width: 60,
			height: 16,
			onRim: false,
			centred: false,
			near: true,
			long: "beide",
			short: "beide",
		};

		const placed = placeLabels(
			[
				{ ...here, onRim: true, focus: false },
				{ ...here, focus: true },
			],
			0,
		);

		expect(placed[1].kept).toBe(true);
		expect(placed[0].kept).toBe(false);
	});
});
