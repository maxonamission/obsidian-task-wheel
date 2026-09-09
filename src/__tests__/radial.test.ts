import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import {
	ancestorsOf,
	DEFAULT_LAYOUT_OPTIONS,
	focusOf,
	type LabelAnchor,
	labelStrip,
	type LaidOutNode,
	type LayoutOptions,
	layoutWheel,
	nodeAt,
	stripsClash,
	type WheelLayout,
} from "../layout/radial";
import { containsAngle, pointAt, ringRadius } from "../layout/geometry";
import { LEAF_HEIGHT } from "../layout/labels";
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

function layoutOf(
	notes: NoteInput[] = VAULT,
	budgets = {},
	extra: Partial<LayoutOptions> = {},
): WheelLayout {
	return layoutWheel(buildTree(notes, OPTIONS), { budgets, ...extra });
}

/** The same vault, with a pile of extra tasks in one domain. */
const BUSIER: NoteInput[] = [
	...VAULT,
	{
		path: "Werk/Nog veel meer.md",
		content: Array.from(
			{ length: 40 },
			(_, index) => `- [ ] Extra taak ${index + 1}`,
		).join("\n"),
	},
];

describe("layoutWheel — the fixed wedges", () => {
	it("does not move a wedge when a domain gains tasks", () => {
		const before = layoutOf().budgets;
		const after = layoutOf(BUSIER).budgets;

		expect(after.map((b) => b.domain)).toEqual(before.map((b) => b.domain));
		for (let i = 0; i < before.length; i++) {
			expect(after[i].startAngle).toBeCloseTo(before[i].startAngle, 9);
			expect(after[i].endAngle).toBeCloseTo(before[i].endAngle, 9);
		}
	});

	it("keeps every node inside its own domain's wedge", () => {
		const layout = layoutOf();
		const wedges = new Map(layout.budgets.map((b) => [b.domain, b]));

		for (const laid of layout.nodes) {
			if (laid.depth === 0) continue;
			const wedge = wedges.get(laid.domain);
			expect(wedge).toBeDefined();
			if (wedge === undefined) continue;
			expect(laid.startAngle).toBeGreaterThanOrEqual(wedge.startAngle - 1e-9);
			expect(laid.endAngle).toBeLessThanOrEqual(wedge.endAngle + 1e-9);
		}
	});

	it("honours a pinned wedge", () => {
		const layout = layoutOf(VAULT, { Werk: 180 });
		const werk = layout.budgets.find((b) => b.domain === "Werk");
		expect(werk?.degrees).toBeCloseTo(180, 9);
		expect(werk?.pinned).toBe(true);
	});
});

describe("layoutWheel — rings and branches", () => {
	const layout = layoutOf();

	it("puts a node on the ring its depth says", () => {
		for (const laid of layout.nodes) {
			expect(laid.radius).toBeCloseTo(
				ringRadius(laid.depth, DEFAULT_LAYOUT_OPTIONS.rings),
				9,
			);
		}
	});

	it("places the hub at the centre", () => {
		const hub = layout.nodes[0];
		expect(hub.depth).toBe(0);
		expect(hub.render).toBe("hub");
		expect(hub.radius).toBe(0);
	});

	it("agrees with the geometry on where a node lands", () => {
		for (const laid of layout.nodes) {
			const point = pointAt(laid.radius, laid.angle);
			expect(laid.x).toBeCloseTo(point.x, 9);
			expect(laid.y).toBeCloseTo(point.y, 9);
		}
	});

	it("draws one branch per node below the hub", () => {
		expect(layout.links.length).toBe(layout.nodes.length - 1);
		for (const link of layout.links) {
			expect(layout.byId.has(link.parentId)).toBe(true);
			expect(layout.byId.has(link.childId)).toBe(true);
			expect(link.path.startsWith("M")).toBe(true);
		}
	});

	it("sits every child inside its parent's slice", () => {
		for (const link of layout.links) {
			const parent = layout.byId.get(link.parentId);
			const child = layout.byId.get(link.childId);
			if (parent === undefined || child === undefined || parent.depth === 0) {
				continue;
			}
			expect(child.startAngle).toBeGreaterThanOrEqual(parent.startAngle - 1e-9);
			expect(child.endAngle).toBeLessThanOrEqual(parent.endAngle + 1e-9);
		}
	});

	it("gives siblings slices that touch but never overlap", () => {
		for (const parent of layout.nodes) {
			const children = layout.nodes.filter((n) => n.parentId === parent.id);
			if (parent.depth === 0 || children.length < 2) continue;
			for (let i = 1; i < children.length; i++) {
				expect(children[i].startAngle).toBeCloseTo(children[i - 1].endAngle, 9);
			}
		}
	});
});

describe("layoutWheel — nothing disappears", () => {
	it("lays out every node of the tree down to the last ring", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const layout = layoutWheel(tree);
		const withinRings = [...tree.byId.values()].filter(
			(node) => node.depth <= DEFAULT_LAYOUT_OPTIONS.maxDepth,
		);
		expect(layout.nodes.length).toBe(withinRings.length);
	});

	it("counts what a stump hides instead of dropping it", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const layout = layoutWheel(tree, { maxDepth: 3 });

		const stumps = layout.nodes.filter((laid) => laid.hiddenCount > 0);
		expect(stumps.length).toBeGreaterThan(0);
		for (const stump of stumps) expect(stump.depth).toBe(3);

		const drawnTasks = layout.nodes.filter(
			(laid) => laid.node.kind === "task",
		).length;
		const hidden = stumps.reduce((sum, stump) => sum + stump.hiddenCount, 0);
		expect(drawnTasks + hidden).toBeGreaterThanOrEqual(tree.root.shownTaskCount);
	});

	it("degrades a crowded ring to ticks rather than overlapping labels", () => {
		const layout = layoutOf(BUSIER);
		const renders = new Set(layout.nodes.map((laid) => laid.render));
		expect(renders.has("labelled")).toBe(true);
		expect(renders.has("tick") || renders.has("dot")).toBe(true);

		// A domain keeps its name whatever the crowding does: it is the map.
		for (const laid of layout.nodes) {
			if (laid.depth === 1) expect(laid.render).toBe("labelled");
		}
	});

	it("counts what a partly opened container holds back, and nothing more", () => {
		// The number the drawing owes the reader (BC_E3_S154). A container that
		// draws its first few children and keeps the rest is not a stump, so it
		// is not named — the rule below this one says why — but it does have a
		// count, and the renderer draws that count on its own.
		const notes: NoteInput[] = [
			{
				path: "Werk/P1.md",
				content: Array.from({ length: 10 }, (_, i) => `- [ ] A${i}`).join("\n"),
			},
			{
				path: "Werk/P2.md",
				content: Array.from({ length: 10 }, (_, i) => `- [ ] B${i}`).join("\n"),
			},
		];
		const layout = layoutWheel(buildTree(notes, DEFAULT_PARSE_OPTIONS), {
			...DEFAULT_LAYOUT_OPTIONS,
			visibleBudget: 12,
		});

		const partly = layout.nodes.find(
			(laid) => laid.node.label === "P1" && laid.hiddenCount > 0,
		);
		expect(partly).toBeDefined();
		expect(partly?.render).toBe("dot");

		// And a container that shows everything it has says nothing at all.
		const whole = layoutWheel(buildTree(notes, DEFAULT_PARSE_OPTIONS));
		for (const laid of whole.nodes) {
			if (laid.node.children.length === 0) continue;
			if (laid.hiddenCount === 0) continue;
			expect(laid.node.children.length).toBeGreaterThan(0);
		}
		expect(
			whole.nodes.filter((laid) => laid.node.label === "P1")[0]?.hiddenCount,
		).toBe(0);
	});

	it("labels leaves and domains, never the containers in between", () => {
		// With no focus. The containers are named around the focus and nowhere
		// else, so a wheel that is not looking at anything looks as it always did.
		const layout = layoutOf(BUSIER);
		for (const laid of layout.nodes) {
			if (laid.render !== "labelled" || laid.depth <= 1) continue;
			expect(laid.node.children.length).toBe(0);
		}
	});
});

describe("layoutWheel — labels around the focus (BC_E3_S23)", () => {
	/** A leaf deep enough to have a container over it, with room to spare. */
	const anchorIn = (layout: WheelLayout): LaidOutNode => {
		const leaf = layout.nodes
			.filter(
				(laid) =>
					laid.depth > 2 &&
					laid.node.children.length === 0 &&
					laid.parentId !== null,
			)
			.sort((a, b) => b.span - a.span)[0];
		expect(leaf).toBeDefined();
		return leaf;
	};

	it("names the container the focus hangs off", () => {
		const plain = layoutOf();
		const focus = anchorIn(plain);
		expect(plain.byId.get(focus.parentId as string)?.render).toBe("dot");

		const focused = layoutOf(VAULT, {}, { focusId: focus.id });
		expect(focused.byId.get(focus.parentId as string)?.render).toBe("labelled");
	});

	it("names no container further off than the step allows", () => {
		const focus = anchorIn(layoutOf());
		const layout = layoutOf(VAULT, {}, { focusId: focus.id });

		// The rule the drawing rests on: a labelled container is a *neighbour* of
		// the focus. Anything else and the wheel is back to naming everything.
		const containers = layout.nodes.filter(
			(laid) =>
				laid.render === "labelled" &&
				laid.depth > 1 &&
				laid.node.children.length > 0,
		);

		// Not vacuous: there is something to be strict about.
		expect(containers.length).toBeGreaterThan(0);
		for (const laid of containers) {
			// Or on the branch being read, which is named the whole way in
			// however many rings deep it goes (BC_E3_S27).
			if (laid.onPath) continue;
			expect(laid.distance).toBeLessThanOrEqual(
				DEFAULT_LAYOUT_OPTIONS.labelSteps,
			);
		}
	});

	/**
	 * The ring you are looking out on (BC_E3_S125, eigenaar 3 sep 2026).
	 *
	 * Two good rules were making a third that nobody chose: every child of the
	 * focus is drawn, and the angles are dealt without regard for where you are
	 * looking. More dots in a wedge that does not widen means narrower dots, and
	 * under `labelSpan` the name went — *"anders wordt het gokken wat het is"*.
	 *
	 * Measured on this fixture: 49 of 53 children of a focus carried no name,
	 * and not one of them was below `tickSpan`.
	 */
	it("names the children of the focus, however narrow their slice", () => {
		const busy = layoutOf(BUSIER);
		const crowded = busy.nodes
			.filter((laid) => laid.node.children.length > 2 && laid.depth > 1)
			.sort((a, b) => b.node.children.length - a.node.children.length)[0];
		expect(crowded).toBeDefined();

		const layout = layoutOf(BUSIER, {}, { focusId: crowded.id });
		const kids = layout.nodes.filter((laid) => laid.parentId === crowded.id);
		expect(kids.length).toBeGreaterThan(2);

		// Not vacuous: these are exactly the ones the span rule used to silence.
		const narrow = kids.filter(
			(laid) => laid.span < DEFAULT_LAYOUT_OPTIONS.labelSpan,
		);
		expect(narrow.length).toBeGreaterThan(0);
		for (const laid of kids) expect(laid.render).toBe("labelled");
	});

	/**
	 * And a hairline child is still a tick.
	 *
	 * That is a decision about the *mark*, not about the label: at that width
	 * there is no room to draw a dot, let alone a name. The rule above reaches
	 * the reported case and no other.
	 */
	it("leaves a child below the tick threshold as a tick", () => {
		const tiny = { ...DEFAULT_LAYOUT_OPTIONS, tickSpan: 90 };
		const layout = layoutWheel(buildTree(BUSIER, OPTIONS), tiny);
		for (const laid of layout.nodes) {
			if (laid.depth <= 1 || laid.onPath) continue;
			if (laid.span < 90) expect(laid.render).toBe("tick");
		}
	});

	/**
	 * Untouched by BC_E3_S125, and it is worth saying why.
	 *
	 * `anchorIn` picks a **leaf**, so the focus here has no children at all and
	 * the new rule reaches nothing. The strictness this test protects — a
	 * container far from the focus stays a dot however generous `labelSteps` is
	 * — is exactly the strictness that had to survive.
	 */
	it("still leaves a container without room as a dot", () => {
		const focus = anchorIn(layoutOf(BUSIER));
		const layout = layoutOf(BUSIER, {}, { focusId: focus.id, labelSteps: 9 });

		for (const laid of layout.nodes) {
			if (laid.render !== "labelled" || laid.depth <= 1) continue;
			expect(laid.span).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.labelSpan);
		}
	});
});

describe("layoutWheel — the item you are reading is named (BC_E3_S26)", () => {
	/** Stops with less of the circle than the label rule normally asks for. */
	const cramped = (layout: WheelLayout): LaidOutNode[] =>
		layout.nodes.filter(
			(laid) => laid.depth > 1 && laid.span < DEFAULT_LAYOUT_OPTIONS.labelSpan,
		);

	it("names it however little of the circle it owns", () => {
		// The complaint this comes from: standing on a task and seeing no name on
		// the drawing. On a busy wheel most stops are well under `labelSpan`, and
		// the fisheye does not always lift them over it.
		const busy = layoutOf(BUSIER);
		const tight = cramped(busy);
		expect(tight.length).toBeGreaterThan(0);

		for (const one of tight) {
			const focused = layoutOf(BUSIER, {}, { focusId: one.id });
			expect(focused.byId.get(one.id)?.render).toBe("labelled");
		}
	});

	it("gives it back its dot, even where the ring had degraded to ticks", () => {
		const busy = layoutOf(BUSIER);
		const ticks = busy.nodes.filter((laid) => laid.render === "tick");
		if (ticks.length === 0) return;

		for (const tick of ticks) {
			const focused = layoutOf(BUSIER, {}, { focusId: tick.id });
			expect(focused.byId.get(tick.id)?.render).not.toBe("tick");
		}
	});

	it("leaves its cramped neighbours as they were", () => {
		// Only the focus is unconditional. A neighbour still has to have room,
		// or the wheel is back to naming everything.
		const busy = layoutOf(BUSIER);
		const tight = cramped(busy)[0];
		const focused = layoutOf(BUSIER, {}, { focusId: tight.id });

		for (const laid of focused.nodes) {
			if (laid.id === tight.id || laid.depth <= 1) continue;
			if (laid.render !== "labelled") continue;
			expect(laid.span).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.labelSpan);
		}
	});
});

describe("layoutWheel — the branch being read (BC_E3_S27)", () => {
	const deepest = (layout: WheelLayout): LaidOutNode =>
		layout.nodes
			.filter((laid) => laid.depth > 2 && laid.node.children.length === 0)
			.sort((a, b) => b.depth - a.depth)[0];

	it("marks the focus and every container in to the hub", () => {
		const focus = deepest(layoutOf(BUSIER));
		const layout = layoutOf(BUSIER, {}, { focusId: focus.id });

		const path = layout.nodes.filter((laid) => laid.onPath);
		expect(path.map((laid) => laid.depth).sort()).toEqual(
			Array.from({ length: focus.depth + 1 }, (_, i) => i),
		);

		// One per ring, from the hub out to the focus: a chain, not a scattering.
		expect(new Set(path.map((laid) => laid.depth)).size).toBe(path.length);
	});

	it("names every one of them, cramped or not", () => {
		const focus = deepest(layoutOf(BUSIER));
		const layout = layoutOf(BUSIER, {}, { focusId: focus.id });

		for (const laid of layout.nodes) {
			if (!laid.onPath || laid.depth === 0) continue;
			expect(laid.render).toBe("labelled");
		}
	});

	it("marks nothing at all without a focus", () => {
		expect(layoutOf(BUSIER).nodes.some((laid) => laid.onPath)).toBe(false);
	});

	it("does not mark the focus's children — they are not on the way in", () => {
		const container = layoutOf(BUSIER)
			.nodes.filter((laid) => laid.depth > 1 && laid.node.children.length > 0)
			.sort((a, b) => b.node.children.length - a.node.children.length)[0];
		const layout = layoutOf(BUSIER, {}, { focusId: container.id });

		for (const child of container.node.children) {
			expect(layout.byId.get(child.id)?.onPath ?? false).toBe(false);
		}
	});
});

describe("labelStrip and stripsClash — the other kind of neighbour", () => {
	/** A label the renderer's way: anchored beside its dot, running outward. */
	const label = (radius: number, angle: number, width = 40): LabelAnchor => {
		const point = pointAt(radius, angle);
		return {
			...point,
			width,
			// `LEAF_HEIGHT`, which is where this number lives now: the layout
			// option that used to carry it was superseded by the label engine and
			// read by nothing but this line (BC_E3_S172).
			height: LEAF_HEIGHT,
			side: angle < 180 ? "start" : "end",
		};
	};

	// A parent and its child: one ring apart, at the same angle.
	const parent = label(72, 0);
	const child = label(100, 0);

	it("lands a label where the turn puts it", () => {
		expect(labelStrip(parent, 0).y).toBeCloseTo(-72, 9);
		expect(labelStrip(parent, 90).y).toBeCloseTo(0, 9);
		expect(labelStrip(parent, 90).left).toBeCloseTo(72, 9);
	});

	it("keeps a parent and its child apart at the reading wedge", () => {
		expect(stripsClash(labelStrip(parent, 0), labelStrip(child, 0))).toBe(false);
	});

	it("finds them on top of each other a quarter turn later", () => {
		// Where the rings flatten, one ring step buys no vertical room at all —
		// the collision the drawing used to ship with.
		expect(stripsClash(labelStrip(parent, 90), labelStrip(child, 90))).toBe(true);
		expect(stripsClash(labelStrip(parent, 270), labelStrip(child, 270))).toBe(
			true,
		);
	});

	it("lets the far side of the wheel hold a label at the same height", () => {
		// Same line, opposite halves: they are nowhere near each other.
		const left = label(100, 270);
		const right = label(100, 90);
		expect(labelStrip(left, 0).y).toBeCloseTo(labelStrip(right, 0).y, 9);
		expect(stripsClash(labelStrip(left, 0), labelStrip(right, 0))).toBe(false);
	});

	it("is the ring step that decides, not the ring", () => {
		// Two labels a hair apart stay unreadable however far out they sit.
		expect(
			stripsClash(labelStrip(label(160, 0), 0), labelStrip(label(163, 0), 0)),
		).toBe(true);
	});
});

describe("nodeAt — the reading wedge", () => {
	const layout = layoutOf();

	it("picks the deepest node whose slice covers the angle", () => {
		const anchor = layout.nodes.find(
			(laid) =>
				laid.node.kind === "task" &&
				laid.node.children.length === 0 &&
				laid.span > 1,
		);
		expect(anchor).toBeDefined();
		if (anchor === undefined) return;

		const hit = nodeAt(layout, anchor.angle);
		expect(hit?.id).toBe(anchor.id);
	});

	it("always has something under the reading wedge", () => {
		// Twelve o'clock falls in the padding at the seam of the first wedge, so
		// this is the fallback path as much as it is the happy one.
		expect(focusOf(layout)).not.toBeNull();
		for (let angle = 0; angle < 360; angle += 7) {
			expect(nodeAt(layout, angle)).not.toBeNull();
		}
	});

	it("prefers a covering node over a merely nearby one", () => {
		for (let angle = 0; angle < 360; angle += 7) {
			const hit = nodeAt(layout, angle);
			if (hit === null) continue;
			const covering = layout.nodes.filter(
				(laid) =>
					laid.depth > 0 && containsAngle(laid.startAngle, laid.endAngle, angle),
			);
			if (covering.length === 0) continue;
			expect(containsAngle(hit.startAngle, hit.endAngle, angle)).toBe(true);
			const deepest = Math.max(...covering.map((laid) => laid.depth));
			expect(hit.depth).toBe(deepest);
		}
	});

	it("walks the trail back to the domain", () => {
		const focus = focusOf(layout);
		expect(focus).not.toBeNull();
		if (focus === null) return;

		const trail = ancestorsOf(layout, focus);
		expect(trail.length).toBe(focus.depth - 1);
		if (trail.length > 0) {
			expect(trail[0].depth).toBe(1);
			expect(trail[0].node.kind).toBe("domain");
		}
	});
});

describe("layoutWheel — an empty vault", () => {
	const layout = layoutWheel(buildTree([], DEFAULT_PARSE_OPTIONS));

	it("draws a hub and nothing else", () => {
		expect(layout.nodes.length).toBe(1);
		expect(layout.links).toEqual([]);
		expect(layout.budgets).toEqual([]);
		expect(layout.order).toEqual([]);
	});
});

describe("the fisheye — focus plus context (BC_E3_S41)", () => {
	const focus = layoutOf().nodes.find(
		(laid) => laid.node.kind === "task" && laid.node.children.length === 0,
	);

	it("hands out the same angles wherever the reader is looking", () => {
		// The rule the calm rests on. The fisheye used to swell the focused item
		// *in the allocation*, so every stop re-divided the circle and the wheel
		// shuffled after each turn (eigenaar, 22 aug 2026, drie keer gemeld). The
		// swelling now happens in the drawing, around the reading wedge.
		expect(focus).toBeDefined();
		if (focus === undefined) return;

		const flat = layoutOf();
		const focused = layoutOf(VAULT, {}, { focusId: focus.id });

		for (const laid of flat.nodes) {
			const after = focused.byId.get(laid.id);
			if (after === undefined) continue;
			expect(after.angle).toBeCloseTo(laid.angle, 9);
			expect(after.span).toBeCloseTo(laid.span, 9);
		}
	});

	it("still knows what it is looking at, and how far off the rest is", () => {
		if (focus === undefined) return;
		const focused = layoutOf(VAULT, {}, { focusId: focus.id });
		const after = focused.byId.get(focus.id);

		expect(after?.distance).toBe(0);
		expect(after?.presence).toBe(1);

		// And the far side recedes to a silhouette, which is the half of the
		// fisheye that never was angular. The wedges keep their full presence:
		// they are the map, and a map may not fade (kaderdocument §3.3).
		const away = focused.nodes.filter(
			(laid) => laid.distance > 3 && laid.depth > 1,
		);
		expect(away.length).toBeGreaterThan(0);
		for (const laid of away) expect(laid.presence).toBeLessThan(1);
	});

	it("asks for the magnifier only when the wheel is crowded", () => {
		// A wheel with room to spare is drawn exactly where its angles say —
		// magnifying a sparse wheel would be restlessness of its own making.
		const roomy: NoteInput[] = [
			{ path: "Werk/Plan.md", content: "- [ ] Een\n- [ ] Twee\n" },
			{ path: "Gezin/Weekend.md", content: "- [ ] Tassen\n" },
		];
		expect(layoutOf(roomy).warp.strength).toBe(0);

		const packed: NoteInput[] = Array.from({ length: 6 }, (_, note) => ({
			path: `Domein ${note % 3}/Notitie ${note}.md`,
			content: Array.from({ length: 30 }, (_, task) => `- [ ] Taak ${note}-${task}`).join(
				"\n",
			),
		}));
		expect(layoutOf(packed).warp.strength).toBeGreaterThan(0);
	});

	it("closes up its neighbours to make the room — in the drawing", () => {
		// The other half of focus-plus-context, now a property of the magnifier
		// rather than of the allocation: what is stretched under the wedge is
		// squeezed further out, and the circle keeps its size. Measured on the
		// rule itself in `warp.test.ts`; here it is only stated that a crowded
		// wheel asks for it.
		const packed: NoteInput[] = Array.from({ length: 6 }, (_, note) => ({
			path: `Domein ${note % 3}/Notitie ${note}.md`,
			content: Array.from({ length: 30 }, (_, task) => `- [ ] Taak ${note}-${task}`).join(
				"\n",
			),
		}));
		const warp = layoutOf(packed).warp;

		expect(warp.strength).toBeGreaterThan(0);
		expect(warp.window).toBeLessThan(180);
	});

	it("leaves every domain wedge exactly where it was", () => {
		if (focus === undefined) return;
		const before = layoutOf().budgets;
		const after = layoutOf(VAULT, {}, { focusId: focus.id }).budgets;

		for (let i = 0; i < before.length; i++) {
			expect(after[i].startAngle).toBeCloseTo(before[i].startAngle, 9);
			expect(after[i].endAngle).toBeCloseTo(before[i].endAngle, 9);
		}
	});

	it("keeps the far side present as a silhouette, never absent", () => {
		if (focus === undefined) return;
		const focused = layoutOf(VAULT, {}, { focusId: focus.id });

		const far = focused.nodes.filter(
			(laid) => laid.distance > 4 && laid.depth > 1,
		);
		expect(far.length).toBeGreaterThan(0);
		for (const laid of far) {
			expect(laid.presence).toBeGreaterThan(0);
			expect(laid.presence).toBeLessThan(1);
			expect(laid.span).toBeGreaterThan(0);
		}
	});

	it("never lets the map itself fade — hub and domain ring stay put", () => {
		if (focus === undefined) return;
		const focused = layoutOf(VAULT, {}, { focusId: focus.id });

		for (const laid of focused.nodes) {
			if (laid.depth <= 1) expect(laid.presence).toBe(1);
		}
	});

	it("lets the focused branch reach past the last general ring", () => {
		const tree = buildTree(VAULT, OPTIONS);
		const shallow = layoutWheel(tree, { maxDepth: 3 });
		const stump = shallow.nodes.find((laid) => laid.hiddenCount > 0);
		expect(stump).toBeDefined();
		if (stump === undefined) return;

		const opened = layoutWheel(tree, { maxDepth: 3, focusId: stump.id });
		const deeper = opened.nodes.filter((laid) => laid.depth > 3);
		expect(deeper.length).toBeGreaterThan(0);
		for (const laid of deeper) {
			expect(stump.id === laid.id || laid.parentId !== null).toBe(true);
		}
	});
});

describe("collapsing — a branch folded away is still on the wheel", () => {
	const tree = buildTree(VAULT, OPTIONS);

	/** A container with open work under it, so folding it hides something. */
	const branch = layoutWheel(tree).nodes.find(
		(laid) =>
			laid.depth > 0 &&
			laid.node.children.length > 0 &&
			laid.node.shownTaskCount > 1,
	);

	it("keeps the folded node itself visible", () => {
		expect(branch).toBeDefined();
		if (branch === undefined) return;

		const folded = layoutWheel(tree, { collapsed: new Set([branch.id]) });
		expect(folded.byId.has(branch.id)).toBe(true);
		expect(folded.byId.get(branch.id)?.collapsed).toBe(true);
	});

	it("drops its children from the drawing", () => {
		if (branch === undefined) return;
		const folded = layoutWheel(tree, { collapsed: new Set([branch.id]) });

		for (const child of branch.node.children) {
			expect(folded.byId.has(child.id)).toBe(false);
		}
	});

	it("counts on the stump exactly what it hides", () => {
		if (branch === undefined) return;
		const folded = layoutWheel(tree, { collapsed: new Set([branch.id]) });

		const stump = folded.byId.get(branch.id);
		const self =
			branch.node.kind === "task" && branch.node.fields?.done !== true ? 1 : 0;
		expect(stump?.hiddenCount).toBe(branch.node.shownTaskCount - self);
	});
});

describe("the wheel cannot lie about completeness", () => {
	const tree = buildTree(VAULT, OPTIONS);

	/** Every open task is drawn, or counted on exactly one stump. */
	function accountsForEverything(layout: WheelLayout): void {
		const drawn = layout.nodes.filter(
			(laid) => laid.node.kind === "task" && laid.node.fields?.done !== true,
		).length;
		const hidden = layout.nodes.reduce((sum, laid) => sum + laid.hiddenCount, 0);
		expect(drawn + hidden).toBe(tree.root.shownTaskCount);
	}

	it("adds up with nothing folded", () => {
		accountsForEverything(layoutWheel(tree));
	});

	it("adds up with the rings cut short", () => {
		accountsForEverything(layoutWheel(tree, { maxDepth: 2 }));
		accountsForEverything(layoutWheel(tree, { maxDepth: 3 }));
	});

	it("adds up with a branch folded away", () => {
		for (const laid of layoutWheel(tree).nodes) {
			if (laid.depth === 0) continue;
			accountsForEverything(
				layoutWheel(tree, { collapsed: new Set([laid.id]) }),
			);
		}
	});

	it("adds up with every domain folded at once", () => {
		const domains = layoutWheel(tree)
			.nodes.filter((laid) => laid.depth === 1)
			.map((laid) => laid.id);
		accountsForEverything(layoutWheel(tree, { collapsed: new Set(domains) }));
	});

	it("adds up while the fisheye is open on each item in turn", () => {
		for (const laid of layoutWheel(tree).nodes) {
			accountsForEverything(layoutWheel(tree, { focusId: laid.id }));
		}
	});
});

describe("a fan takes only the room it needs (BC_E3_S40)", () => {
	/** The angle from the first child's near edge to the last one's far edge. */
	const fanOf = (layout: WheelLayout, id: string): number => {
		const kids = layout.nodes.filter((laid) => laid.parentId === id);
		if (kids.length === 0) return 0;
		return (
			Math.max(...kids.map((k) => k.endAngle)) -
			Math.min(...kids.map((k) => k.startAngle))
		);
	};

	const find = (layout: WheelLayout, label: string): LaidOutNode => {
		const laid = layout.nodes.find((one) => one.node.label === label);
		if (laid === undefined) throw new Error(`no node called ${label}`);
		return laid;
	};

	const SPARSE: NoteInput[] = [
		{ path: "Werk/Plan.md", content: "- [ ] Een\n- [ ] Twee\n- [ ] Drie\n" },
		{ path: "Gezin/Weekend.md", content: "- [ ] Tassen\n" },
	];

	it("leaves the rest of the slice empty rather than spreading out", () => {
		const layout = layoutOf(SPARSE);
		const werk = find(layout, "Werk");

		// Three leaves ask for three pitches — not for the half of the circle
		// their wedge was given.
		expect(fanOf(layout, find(layout, "Plan").id)).toBeCloseTo(
			3 * DEFAULT_LAYOUT_OPTIONS.itemPitch,
			6,
		);
		expect(werk.span).toBeGreaterThan(3 * fanOf(layout, werk.id));
	});

	it("centres what it does use in the slice it was given", () => {
		const layout = layoutOf(SPARSE);
		const plan = find(layout, "Plan");
		const kids = layout.nodes.filter((laid) => laid.parentId === plan.id);

		const from = Math.min(...kids.map((k) => k.startAngle));
		const to = Math.max(...kids.map((k) => k.endAngle));
		expect(from - plan.startAngle).toBeCloseTo(plan.endAngle - to, 6);
	});

	it("fills the slice when the branch is bigger than the room", () => {
		const many: NoteInput[] = [
			{
				path: "Werk/Plan.md",
				content: Array.from({ length: 40 }, (_, at) => `- [ ] Taak ${at}`).join("\n"),
			},
			{ path: "Gezin/Weekend.md", content: "- [ ] Tassen\n" },
		];
		const layout = layoutOf(many);
		const plan = find(layout, "Plan");

		expect(fanOf(layout, plan.id)).toBeCloseTo(plan.span, 6);
	});

	it("keeps the width of a fan out of the fisheye's hands", () => {
		// The room a branch takes says how much is in it. Which item you happen
		// to be reading may divide that room differently, but it may not change
		// how wide it is — the edges of a fan swinging about as the focus moves
		// inside it is what made walking a branch restless (eigenaar, 22 aug 2026).
		const flat = layoutOf(SPARSE);
		const plan = find(flat, "Plan");
		const kids = flat.nodes.filter((laid) => laid.parentId === plan.id);

		for (const kid of kids) {
			const focused = layoutOf(SPARSE, {}, { focusId: kid.id });
			expect(fanOf(focused, find(focused, "Plan").id)).toBeCloseTo(
				fanOf(flat, plan.id),
				6,
			);
		}
	});

	it("divides that room the same way whoever you are reading", () => {
		// Stronger than it started out (BC_E3_S40 asked only that the fan's outer
		// edges hold still): since the magnifier moved to the reading wedge, the
		// division inside a fan does not move either. Nothing in the allocation
		// knows where the reader is any more.
		const flat = layoutOf(SPARSE);
		const kids = flat.nodes.filter(
			(laid) => laid.parentId === find(flat, "Plan").id,
		);

		expect(kids.length).toBeGreaterThan(1);
		for (const kid of kids) {
			const focused = layoutOf(SPARSE, {}, { focusId: kid.id });
			for (const other of kids) {
				expect(focused.byId.get(other.id)?.span).toBeCloseTo(other.span, 9);
			}
		}
	});
});
