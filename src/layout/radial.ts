/**
 * From tree to drawing: positions, angles and branches.
 *
 * A pure function over a `WheelTree`. No DOM, no Obsidian, no d3 — hand it a
 * tree and it hands back numbers, which is what lets the whole geometry be
 * tested headlessly (kaderdocument §7).
 *
 * The angular allocation is two-tier, and the split is the point:
 *
 *  - **Between domains**, the wedge is a fixed budget that ignores task counts
 *    entirely (see `budgets.ts`).
 *  - **Inside a wedge**, the budget is divided over the branches by how many
 *    items each carries, so a project with six tasks gets more of the wedge
 *    than a project with one. That is free to move, because the wedge it moves
 *    inside does not.
 */

import type { Priority, WheelNode, WheelTree } from "../model/types";
import {
	assignBudgets,
	budgetsByDomain,
	roundOrder,
	type DomainBudget,
	type WedgeDivision,
} from "./budgets";
import {
	DEFAULT_DOI,
	type DoiField,
	doiField,
	type DoiOptions,
	NO_DOI,
} from "./doi";
import {
	DEFAULT_VISIBLE_BUDGET,
	selectVisible,
	type Visible,
	type VisibleOptions,
} from "./visible";
import {
	angleDelta,
	branchPath,
	containsAngle,
	pointAt,
	ringRadius,
	type RingConfig,
} from "./geometry";
import { orderedChildren } from "./order";
import { warpFor, type WarpOptions } from "./warp";
import { paletteOf, type Palette } from "./colour";
import { windowFor } from "./window";

export interface LayoutOptions {
	rings: RingConfig;
	/** Rings past this fold into a stump with a counter on the last one drawn. */
	maxDepth: number;
	/** Degrees left free at each side of a wedge so neighbours do not touch. */
	wedgePadding: number;
	/** Below this span a node keeps its dot but loses its label, ever. */
	labelSpan: number;
	/**
	 * How tall an ordinary label is painted, in the same units as the radii.
	 *
	 * Labels are horizontal, so two of them clash when their *vertical* gap is
	 * smaller than the room they take up — whatever their angle. `stripsClash`
	 * compares exactly that, per turn of the wheel, and it asks each label for
	 * its own height: a wedge title is bigger than a task's name, and one number
	 * for both is either too tight for the one or too generous for the other.
	 *
	 * Measured, not guessed (19 aug 2026): a task's label is 10,4 units high and
	 * a wedge title 13, both painted with a 3-unit halo around them. This is the
	 * first of those, and it stands in for any label the browser has not yet been
	 * able to measure.
	 */
	labelHeight: number;
	/** Below this span a node degrades to a tick on its ring. */
	tickSpan: number;
	/**
	 * How many degrees one drawn item asks for.
	 *
	 * A fan of three leaves used to spread over the whole slice its parent had
	 * been given — on a wheel of two wedges that meant three tasks strung out
	 * over half the circle, and a turn of a click could throw the drawing across
	 * the screen (eigenaar, 22 aug 2026: *"dat is onoverzichtelijk"*, gemeten 29°
	 * gemiddeld en 106° in het ergste geval per klik). A fan now asks for this
	 * much per item and takes no more than it asks for; only when a branch is
	 * bigger than its slice does it fill the slice and share it out as before.
	 *
	 * Twelve degrees, which is what keeps an unfocused leaf in a small fan above
	 * `labelSpan` once the fisheye has taken its share — a tighter pitch buys
	 * compactness by taking names away, which is the wrong trade on a wheel whose
	 * whole job is to say what is there.
	 */
	itemPitch: number;
	/**
	 * How many steps from the focus a container may still name itself.
	 *
	 * Zero would be the focus alone, one adds its parent and its children.
	 * Beyond that the neighbourhood stops being a neighbourhood: the labels are
	 * of things you are not reading, and they are competing for the same few
	 * degrees as the ones you are.
	 */
	labelSteps: number;
	/** Pinned wedge widths in degrees, per domain. */
	budgets: Readonly<Record<string, number>>;
	/**
	 * The wedge order this round was dealt with, or null on a wheel that has not
	 * dealt one yet.
	 *
	 * Holding the order is what stops a domain appearing mid-round from taking
	 * another wedge's hue and place (BC_E3_S82). See `roundOrder`.
	 */
	roundDomains: readonly string[] | null;
	/**
	 * Proportional wedge division, frozen for the round — or undefined for the
	 * default equal split. Pins in `budgets` win either way (kaderdocument §3.1,
	 * herzien 26 aug 2026).
	 */
	division: WedgeDivision | undefined;
	/** The item under the reading wedge, around which the fisheye opens up. */
	focusId: string | null;
	/** Ids the reader folded away. They stay on the wheel, as stumps. */
	collapsed: ReadonlySet<string>;
	/**
	 * How many items the wheel may draw at once (hard requirement 6).
	 *
	 * The vault may hold five thousand tasks; the drawing does not grow with
	 * it. What does not fit becomes a stump with a counter.
	 */
	visibleBudget: number;
	/**
	 * Which hues the wedges are handed, in order.
	 *
	 * A selection of the theme's own hues, never colour values of its own —
	 * see `layout/colour.ts` for why that distinction carries the whole
	 * feature (BC_E3_S72).
	 */
	palette: Palette;
	doi: DoiOptions;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
	rings: { radii: [0, 40, 72, 100, 124, 146, 166], step: 11 },
	maxDepth: 6,
	wedgePadding: 1.5,
	labelSpan: 5,
	labelHeight: 13,
	tickSpan: 1.4,
	itemPitch: 12,
	labelSteps: 1,
	budgets: {},
	roundDomains: null,
	division: undefined,
	focusId: null,
	collapsed: new Set<string>(),
	visibleBudget: DEFAULT_VISIBLE_BUDGET,
	palette: paletteOf(undefined),
	doi: DEFAULT_DOI,
};

/**
 * How much of a node survives the crowding.
 *
 * The ladder is the degradation the design allows for a busy vault: a full
 * node with its label, then a bare dot, then a tick on the ring. Nothing is
 * ever dropped — a tick still occupies its angle and still answers "is there
 * something here?" (kaderdocument §3.3).
 */
export type NodeRender = "hub" | "labelled" | "dot" | "tick";

export interface LaidOutNode {
	id: string;
	node: WheelNode;
	depth: number;
	domain: string;
	/** Index of the domain wedge, and so of the hue. */
	domainIndex: number;
	parentId: string | null;
	/**
	 * Centre of the node's angular slice, degrees clockwise from twelve.
	 *
	 * The **logical** angle: it decides the stops, their turn order and the
	 * sweep. Where the node is actually drawn is `drawAngle`, which is the same
	 * thing everywhere except on the branch being read — see `straighten`.
	 */
	angle: number;
	/**
	 * Where the node is drawn, degrees clockwise from twelve.
	 *
	 * Equal to `angle` except for the containers between the focus and the hub,
	 * which are pulled onto the focus's own line (BC_E3_S38). Everything visual
	 * follows this one: the point, the branch, the label and the tick.
	 */
	drawAngle: number;
	startAngle: number;
	endAngle: number;
	span: number;
	radius: number;
	x: number;
	y: number;
	render: NodeRender;
	priority: Priority;
	/**
	 * Open tasks folded away below this node — because the reader collapsed it,
	 * or because the rings ran out. Zero when the node shows everything it has.
	 */
	hiddenCount: number;
	/** True when the reader folded this branch away, rather than the rings. */
	collapsed: boolean;
	/** How strongly to draw it: one at the focus, down to the silhouette floor. */
	presence: number;
	/** Steps through the tree from the focus. Zero when it is the focus. */
	distance: number;
	/**
	 * On the line from the focus in to the hub: the branch being read.
	 *
	 * The focus itself, the heading over it, the note over that. These are the
	 * names the reader wants on the drawing rather than only on the card, so the
	 * view writes them out longer and centres them (BC_E3_S27).
	 */
	onPath: boolean;
}

export interface LaidOutLink {
	id: string;
	parentId: string;
	childId: string;
	domainIndex: number;
	/** SVG path data: along the parent's ring, then out to the child. */
	path: string;
	/** Drawn as strongly as the child it leads to. */
	presence: number;
}

export interface WheelLayout {
	nodes: LaidOutNode[];
	links: LaidOutLink[];
	budgets: DomainBudget[];
	/**
	 * Wedges that hold a place but have nothing on them right now.
	 *
	 * A round holds the wedges it was dealt (BC_E3_S82), so ticking off the last
	 * task in a domain leaves its slice standing — which is the point, because
	 * an empty slice is what makes the place mean something. But a wedge title
	 * is drawn from a node on ring one, and an emptied domain has none, so the
	 * slice stood there as a coloured band with no name on it.
	 *
	 * That reads as a drawing error rather than as a statement, and it throws
	 * away what the emptiness is actually telling you: not "nothing here" but
	 * "nothing here **under this filter**" — the work in that domain is done, or
	 * parked, or filtered out (eigenaar, 28 aug 2026). So the view names them,
	 * and this is the list it names (BC_E3_S83).
	 */
	quietWedges: DomainBudget[];
	byId: ReadonlyMap<string, LaidOutNode>;
	/** Ring radii in use, innermost first. */
	rings: number[];
	/**
	 * Outermost ring this tree can ever use, focus bonus included.
	 *
	 * Stable for a given tree, which is what lets the view size the canvas once
	 * instead of resizing the whole drawing every time the focus moves.
	 */
	radius: number;
	/**
	 * Node ids in wedge order: parents before their children, siblings in their
	 * structural order. Not the turn order — the wheel steps through its stops
	 * by angle, which `layout/detents.ts` derives (a parent sits at the
	 * midpoint of its children, so tree order runs back and forth in space).
	 */
	order: string[];
	/** Whether finished work is part of this round — what the hub is counting. */
	showsFinished: boolean;
	/**
	 * How hard to magnify under the reading wedge when drawing this wheel.
	 *
	 * A property of what is on the wheel, not of where the reader is looking —
	 * so it is decided here, once, and the drawing carries it round with the
	 * turn (BC_E3_S41).
	 */
	warp: WarpOptions;
	/**
	 * How many steps from the focus still count as its neighbourhood.
	 *
	 * The layout uses it to decide which containers are named at all; the
	 * renderer needs the same number to decide which of those names wins when
	 * two collide. It travels on the drawing rather than being written down
	 * twice, which is how the two came to be "shared in spirit" (audit,
	 * 23 aug 2026).
	 */
	labelSteps: number;
	/**
	 * The hues this wheel hands its wedges, in order.
	 *
	 * Travels on the drawing rather than being read a second time by the
	 * renderer — the same reason `warp` and `labelSteps` do (audit, 23 aug
	 * 2026): one decision, made in one place.
	 */
	palette: Palette;
	/**
	 * Half the width of the whole drawing — the window the view puts on it.
	 *
	 * From the tree, not from what this layout happens to draw: a branch that
	 * unfolds only while the focus stands in it must not change the size of
	 * the drawing when it does (BC_E3_S70). See `layout/window.ts`.
	 */
	window: number;
}

/**
 * The focus-independent selection, worked out once per tree and room.
 *
 * A `WeakMap` on the tree, so a rescan — which always builds a fresh tree —
 * starts with nothing cached and the old entry goes when the old tree does. The
 * inner key is the room, because the same tree drawn with a different budget or
 * a different ring shape is a different answer.
 */
const stableByTree = new WeakMap<WheelTree, Map<string, Visible>>();

function stableFor(tree: WheelTree, room: VisibleOptions): Visible {
	const key = `${room.budget}|${JSON.stringify(room.rings)}|${[...room.share]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([domain, part]) => `${domain}:${part.toFixed(6)}`)
		.join(",")}`;

	let forTree = stableByTree.get(tree);
	if (forTree === undefined) {
		forTree = new Map();
		stableByTree.set(tree, forTree);
	}

	const already = forTree.get(key);
	if (already !== undefined) return already;

	const built = selectVisible(tree.root, NO_DOI, room);
	forTree.set(key, built);
	return built;
}

/** Lay the whole wheel out. */
export function layoutWheel(
	tree: WheelTree,
	options: Partial<LayoutOptions> = {},
): WheelLayout {
	const config = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
	const budgets = assignBudgets(
		roundOrder(config.roundDomains, tree.domains),
		config.budgets,
		config.division,
	);
	const wedges = budgetsByDomain(budgets);

	const field = doiField(tree.root, config.focusId, config.doi);
	const room = {
		budget: config.visibleBudget,
		rings: config.rings,
		// A wedge owns its share of every ring, for the same reason it owns its
		// share of the circle: so a quiet domain keeps its place.
		share: new Map(budgets.map((b) => [b.domain, b.degrees / 360])),
	};
	const visible = selectVisible(tree.root, field, room);

	// And the same selection made with nobody looking. The *angles* are handed
	// out from this one, so that opening the branch under the reading wedge —
	// which is focus-dependent by its nature — cannot move anything outside that
	// branch (BC_E3_S41). What the drawing shows is still the selection above.
	//
	// Kept per tree: with nobody looking there is nothing left for it to depend
	// on but the tree and the room, so working it out again on every stop was
	// the same answer bought twice (audit, 23 aug 2026).
	const stable = stableFor(tree, room);
	const plan: Plan = { config, field, visible, stable };

	const nodes: LaidOutNode[] = [];
	const links: LaidOutLink[] = [];
	const byId = new Map<string, LaidOutNode>();
	const weights = new Map<string, number>();

	const hub = place(tree.root, 0, 360, -1, null, plan);
	nodes.push(hub);
	byId.set(hub.id, hub);

	for (const domain of orderedChildren(tree.root)) {
		const wedge = wedges.get(domain.label);
		if (wedge === undefined) continue;

		// The padding comes off the drawing, not off the budget: the wedge still
		// owns its full slice, it just does not draw into the last degree of it.
		const padding = Math.min(config.wedgePadding, wedge.degrees / 4);
		walk(
			domain,
			wedge.startAngle + padding,
			wedge.endAngle - padding,
			wedge.index,
			tree.root.id,
			{ ...plan, nodes, links, byId, weights },
		);
	}

	straighten({ ...plan, nodes, links, byId, weights });

	// From the items themselves: a crowded wheel needs the glass, a wheel with
	// room to spare is drawn exactly where its angles say. The wedges are left
	// out of the reckoning — they are always wide, and they are not what the
	// reader is trying to read.
	const warp = warpFor(
		nodes.filter((laid) => laid.depth > 1).map((laid) => laid.span),
	);

	const deepest = reachableDepth(tree, config);
	const radius = ringRadius(deepest, config.rings);

	// Which wedges ended up with nothing drawn in them. Worked out from the
	// tree's own children rather than from `nodes`, so a domain whose every task
	// was crowded down to a tick still counts as having something on it.
	const filled = new Set(orderedChildren(tree.root).map((child) => child.label));

	return {
		nodes,
		links,
		budgets,
		quietWedges: budgets.filter((budget) => !filled.has(budget.domain)),
		byId,
		rings: ringsUsed(nodes, config),
		radius,
		order: nodes.filter((laid) => laid.depth > 0).map((laid) => laid.id),
		showsFinished: tree.showsFinished,
		warp,
		labelSteps: config.labelSteps,
		palette: config.palette,
		window: windowFor(tree, radius, deepest, config.rings),
	};
}

/**
 * The node sitting at this angle: the deepest one whose slice contains it.
 *
 * When the angle lands in the gutter between two wedges — which twelve o'clock
 * does, since every wedge keeps its padding free — the nearest node wins
 * instead. The reading wedge should always be reading *something*; an empty
 * card because the pointer fell in a one-degree gap would be a bug, not
 * information.
 */
export function nodeAt(
	layout: WheelLayout,
	degrees: number,
): LaidOutNode | null {
	let best: LaidOutNode | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let bestInside = false;

	for (const laid of layout.nodes) {
		if (laid.depth === 0) continue;

		// Standing *in* a slice beats standing at the edge of one. Since fans
		// stopped filling their slice (BC_E3_S40) there are gaps inside a
		// container's own slice, and at the seam of such a gap a node that ends
		// there is exactly as far away — zero — as the node that begins there.
		// Without this the deeper of the two won, which put the card on an item
		// the reading wedge was no longer over.
		const inside = containsAngle(laid.startAngle, laid.endAngle, degrees);
		const distance = inside ? 0 : distanceTo(laid, degrees);

		if (best === null || (inside && !bestInside)) {
			best = laid;
			bestDistance = distance;
			bestInside = inside;
			continue;
		}
		if (bestInside && !inside) continue;

		// Compared with a tolerance: at a seam the two neighbouring wedges are
		// the same distance away give or take a rounding error, and which of
		// them the card shows should not come down to floating point. Equal
		// distance goes to the deeper node, and equal depth to whichever comes
		// first in the detent order.
		if (distance < bestDistance - EPSILON) {
			best = laid;
			bestDistance = distance;
			bestInside = inside;
			continue;
		}
		if (distance < bestDistance + EPSILON && laid.depth > best.depth) {
			best = laid;
			bestDistance = Math.min(bestDistance, distance);
			bestInside = inside;
		}
	}

	return best;
}

/** Angles closer together than this are the same angle as far as we care. */
const EPSILON = 1e-6;

/** Zero when the angle is inside the slice, otherwise the gap to its nearest edge. */
function distanceTo(laid: LaidOutNode, degrees: number): number {
	if (containsAngle(laid.startAngle, laid.endAngle, degrees)) return 0;
	return Math.min(
		Math.abs(angleDelta(degrees, laid.startAngle)),
		Math.abs(angleDelta(degrees, laid.endAngle)),
	);
}

/** What the reading wedge is looking at. Twelve o'clock, until phase 4 turns. */
export function focusOf(layout: WheelLayout, rotation = 0): LaidOutNode | null {
	return nodeAt(layout, -rotation);
}

/** A laid-out node's ancestors, outermost first — the reading card's trail. */
export function ancestorsOf(
	layout: WheelLayout,
	laid: LaidOutNode,
): LaidOutNode[] {
	const trail: LaidOutNode[] = [];
	let current = laid.parentId === null ? null : layout.byId.get(laid.parentId);
	while (current !== undefined && current !== null && current.depth > 0) {
		trail.unshift(current);
		current = current.parentId === null ? null : layout.byId.get(current.parentId);
	}
	return trail;
}

/** Everything a walk needs to know before it places anything. */
interface Plan {
	config: LayoutOptions;
	field: DoiField;
	/** What the wheel draws. */
	visible: Visible;
	/** What it would draw with nobody looking — where the angles come from. */
	stable: Visible;
}

interface Sink extends Plan {
	nodes: LaidOutNode[];
	links: LaidOutLink[];
	byId: Map<string, LaidOutNode>;
	weights: Map<string, number>;
}

/**
 * Place one node and everything under it.
 *
 * Children are laid out in wedge order and given a share of their parent's
 * slice proportional to how many items they carry, so the wedge fills from one
 * side to the other in a reproducible way.
 */
function walk(
	node: WheelNode,
	startAngle: number,
	endAngle: number,
	domainIndex: number,
	parentId: string,
	sink: Sink,
): void {
	const laid = place(node, startAngle, endAngle, domainIndex, parentId, sink);
	sink.nodes.push(laid);
	sink.byId.set(laid.id, laid);

	const parent = sink.byId.get(parentId);
	if (parent !== undefined) {
		sink.links.push({
			id: `${parentId}->${laid.id}`,
			parentId,
			childId: laid.id,
			domainIndex,
			path: branchPath(
				parent.radius,
				parent.drawAngle,
				laid.radius,
				laid.drawAngle,
			),
			presence: laid.presence,
		});
	}

	if (isStump(node, sink)) {
		laid.hiddenCount = openBelow(node);
		return;
	}

	const children = drawnChildren(node, sink);
	// What the budget left out is counted here rather than dropped: the node
	// shows some of its children and says how many more it has.
	laid.hiddenCount = openUnder(orderedChildren(node).slice(children.length));
	if (children.length === 0) return;

	const span = endAngle - startAngle;
	const total = children.reduce(
		(sum, child) => sum + weightOf(child, sink),
		0,
	);
	if (total <= 0) return;

	// How wide this fan *wants* to be, against how much room it has. A fan only
	// spreads to fill its slice when it has to (BC_E3_S40).
	const wanted =
		sink.config.itemPitch *
		children.reduce((sum, child) => sum + weightOf(child, sink), 0);
	const used = Math.min(span, wanted);

	// Centred in the slice it was given: the room it does not use stays reserved
	// on both sides, so a branch keeps its place as it grows (hard requirement 1).
	let cursor = startAngle + (span - used) / 2;
	for (const child of children) {
		const width = (used * weightOf(child, sink)) / total;
		walk(child, cursor, cursor + width, domainIndex, laid.id, sink);
		cursor += width;
	}
}

/**
 * Put the branch being read on one straight line out of the hub.
 *
 * A container sits at the middle of its own slice, and the focus almost never
 * sits at the middle of *that* — so walking out along a branch bent it sideways,
 * one kink per ring, and the trunk swung around while the reader was following
 * it (eigenaar, 22 aug 2026, met drie screenshots: één rechte tak die rustig
 * oogt, twee gebogen die dat niet doen). The reading wedge is at twelve
 * o'clock, so a straight branch is one that runs from the hub to twelve.
 *
 * Only the **drawing** moves. The stops, their turn order and the sweep all
 * keep the logical angle, because those are bookkeeping: pulling the containers
 * onto the focus's angle would put three or four stops at exactly the same
 * rotation, and turning through them would be three clicks in which nothing
 * moves. That is the opposite of calm.
 *
 * Honest, too: the focus is a descendant of every container it hangs under, so
 * the focus's angle lies inside each of their slices. A container drawn there
 * is still standing over its own wedge — just not in the middle of it.
 */
function straighten(sink: Sink): void {
	const focusId = sink.field.focusId;
	if (focusId === null) return;

	const focus = sink.byId.get(focusId);
	if (focus === undefined) return;

	const moved = new Set<string>();
	for (const laid of sink.nodes) {
		// The hub is at the centre, where every angle is the same point, and the
		// focus is already where the wheel came to rest.
		if (laid.depth === 0 || laid.id === focusId) continue;
		if (!sink.field.path.has(laid.id)) continue;

		laid.drawAngle = focus.drawAngle;
		const point = pointAt(laid.radius, laid.drawAngle);
		laid.x = point.x;
		laid.y = point.y;
		moved.add(laid.id);
	}

	if (moved.size === 0) return;

	// Every branch that starts or ends on something that moved. Not all of them:
	// a wheel draws a couple of hundred, and the trunk is a handful.
	for (const link of sink.links) {
		if (!moved.has(link.parentId) && !moved.has(link.childId)) continue;

		const parent = sink.byId.get(link.parentId);
		const child = sink.byId.get(link.childId);
		if (parent === undefined || child === undefined) continue;

		link.path = branchPath(
			parent.radius,
			parent.drawAngle,
			child.radius,
			child.drawAngle,
		);
	}
}

/** The children this node actually draws — all of them, or the first few. */
function drawnChildren(node: WheelNode, plan: Plan): WheelNode[] {
	const children = orderedChildren(node);
	const limit = plan.visible.shown.get(node.id);
	return limit === undefined ? children : children.slice(0, limit);
}

function place(
	node: WheelNode,
	startAngle: number,
	endAngle: number,
	domainIndex: number,
	parentId: string | null,
	plan: Plan,
): LaidOutNode {
	const { config, field } = plan;
	const angle = (startAngle + endAngle) / 2;
	const radius = ringRadius(node.depth, config.rings);
	const point = pointAt(radius, angle);
	const span = endAngle - startAngle;

	return {
		id: node.id,
		node,
		depth: node.depth,
		domain: node.domain,
		domainIndex,
		parentId,
		angle,
		drawAngle: angle,
		startAngle,
		endAngle,
		span,
		radius,
		x: point.x,
		y: point.y,
		render: renderFor(
			node,
			span,
			config,
			isStump(node, plan),
			stepsFromFocus(node, field),
			field.path.has(node.id),
		),
		priority: node.fields?.priority ?? "normal",
		hiddenCount: 0,
		collapsed: config.collapsed.has(node.id),
		// The hub and the domain ring never recede. They are the map: which way
		// is Werk, which way is Gezin. A map you cannot read while looking at
		// something else is not a map.
		presence: node.depth <= 1 ? 1 : (field.presence.get(node.id) ?? 1),
		distance: field.distance.get(node.id) ?? 0,
		onPath: field.path.has(node.id),
	};
}

/**
 * Whether this node shows its children or stands as a stump.
 *
 * Two ways to become one, and they mean different things to the reader. The
 * first is a choice: the branch was folded away deliberately. The second is the
 * drawing running out of rings. Either way the node stays on the wheel with a
 * count of what is behind it — nothing disappears (kaderdocument §3.3).
 *
 * The focused branch is allowed further out than the rest. That is the "shows
 * its deeper rings" half of the fisheye: coming to rest on a stump can be
 * enough to see past it.
 */
function isStump(node: WheelNode, plan: Plan): boolean {
	// The way down to what the reader is looking at is drawn open, whatever
	// else would have closed it (BC_E3_S95).
	//
	// `selectVisible` already says the path to the focus "opens whatever it
	// costs". The two rules below said otherwise and they get the last word, so
	// an ancestor of the focus could be a stump — and a stump draws no children,
	// which means the wheel could not draw **the item it was focused on**. Every
	// way of putting the reader somewhere deep then failed without a sound: the
	// layout came back without them and the controller fell back to the nearest
	// stop it did have, leaving them near where they started. Measured: a task
	// at ring seven, its parent at exactly `maxDepth`, never drawn.
	//
	// It covers the reader's own folds too, and that is the answer to *"de
	// beweging klapte een ingevouwen tak dus niet uit — wat wel de verwachting
	// zou zijn"* (eigenaar, 1 sep 2026). Nothing is unfolded permanently: the
	// fold is still set, so leaving closes it again. You are looking inside it,
	// not undoing it.
	//
	// Only the *ancestors*. Standing on a stump keeps it a stump — that is the
	// whole of what a fold means, and Space is how you open it.
	if (node.id !== plan.field.focusId && plan.field.path.has(node.id)) {
		return false;
	}

	return stumpBy(node, plan, plan.visible);
}

/** The same question asked of a particular selection. */
function stumpBy(node: WheelNode, plan: Plan, visible: Visible): boolean {
	if (plan.config.collapsed.has(node.id)) return true;
	// The budget never reached this branch. Same outcome as a fold, arrived at
	// by arithmetic rather than by choice (kaderdocument §3 eis 6).
	if (node.children.length > 0 && !visible.expanded.has(node.id)) {
		return true;
	}
	return node.depth >= ringBudget(node, plan);
}

function ringBudget(node: WheelNode, plan: Plan): number {
	return plan.field.subtree.has(node.id)
		? plan.config.maxDepth + plan.config.doi.depthBonus
		: plan.config.maxDepth;
}

/**
 * How crowded this node is, and therefore how much of it is drawn.
 *
 * Four kinds of node carry a label: the **domain**, which the view writes on
 * the rim as the title of its wedge; the **branch being read** — the focus and
 * everything between it and the hub — unconditionally; a **leaf** with enough
 * room to put a name beside; and, since BC_E3_S23, a **container within a step
 * or two of the focus**.
 *
 * That last one used to be forbidden everywhere, for a real reason: a project
 * and the task hanging off it sit at nearly the same angle, so their two
 * horizontal labels land on nearly the same line and collide. But that reason
 * is about *where on the circle* the two are, not about what kind of node they
 * are. Two labels one ring apart are pushed apart vertically by `Δr·cos`,
 * which is the full ring step at twelve o'clock and nothing at three — and the
 * focus is what sits at twelve o'clock. So the containers around the focus are
 * labelled here, and the renderer takes the label away again on any turn where
 * the arithmetic stops working (`labelsClear`).
 */
function renderFor(
	node: WheelNode,
	span: number,
	config: LayoutOptions,
	stump: boolean,
	steps: number,
	onPath: boolean,
): NodeRender {
	if (node.depth === 0) return "hub";
	if (node.depth === 1) return "labelled";

	// The branch being read always says what it is, however little of the circle
	// it owns: the focus, and every container between it and the hub. Standing on
	// a task without seeing its name on the drawing was the complaint that
	// started this (owner, 19 aug 2026: 104 of 240 stops went unnamed on a busy
	// vault), and reading that name without seeing what it hangs under was the
	// next one. What protects the rest of the drawing from these is not a span
	// rule but the renderer's collision test, which is exact.
	if (onPath) return "labelled";

	if (span < config.tickSpan) return "tick";
	if (span < config.labelSpan) return "dot";

	// A stump counts as a leaf for labelling: it is the outermost thing on its
	// branch, and it is exactly the node whose counter the reader wants to read.
	const leaf = stump || node.children.length === 0;
	return leaf || steps <= config.labelSteps ? "labelled" : "dot";
}

/**
 * Steps through the tree from the focus — infinity when there is no focus.
 *
 * Deliberately not `laid.distance`, which reads a missing entry as zero. Zero
 * is "this *is* the focus", and answering that about every node on a wheel
 * that has no focus at all would label the entire drawing.
 */
function stepsFromFocus(node: WheelNode, field: DoiField): number {
	if (field.focusId === null) return Number.POSITIVE_INFINITY;
	return field.distance.get(node.id) ?? Number.POSITIVE_INFINITY;
}

/** A label's anchor on the unturned wheel, and which way its text runs. */
export interface LabelAnchor {
	x: number;
	y: number;
	/** Width of the drawn text, in the same units as the radii. */
	width: number;
	/** Height of it, halo included — how much room it takes on its own line. */
	height: number;
	/** Which side of the anchor the text hangs on, as SVG names it. */
	side: "start" | "middle" | "end";
}

/** The strip of screen a label covers once the disc has turned. */
export interface LabelStrip {
	left: number;
	right: number;
	y: number;
	height: number;
}

/**
 * Where a label lands, and how wide it lies there.
 *
 * The plain rotation of its anchor — which is what the SVG transform does to
 * it — and then the text laid out horizontally from that point, because the
 * label is counter-turned and so never tilts. Both halves matter: the vertical
 * position decides which labels are on the same line as each other, and the
 * horizontal extent decides whether being on one line means anything.
 */
export function labelStrip(anchor: LabelAnchor, degrees: number): LabelStrip {
	const radians = (degrees * Math.PI) / 180;
	const x = anchor.x * Math.cos(radians) - anchor.y * Math.sin(radians);
	const y = anchor.x * Math.sin(radians) + anchor.y * Math.cos(radians);

	const height = anchor.height;
	if (anchor.side === "middle") {
		return { left: x - anchor.width / 2, right: x + anchor.width / 2, y, height };
	}
	return anchor.side === "start"
		? { left: x, right: x + anchor.width, y, height }
		: { left: x - anchor.width, right: x, y, height };
}

/**
 * Whether two labels land on top of each other at this turn of the wheel.
 *
 * This replaced a proxy (`labelRoom`, removed in BC_E3_S26) that asked the
 * question one node at a time: has this item enough of the circle to be worth
 * naming where it currently is. The proxy was wrong in both directions. It
 * missed neighbours across the rings — two nodes a ring apart at nearly the
 * same angle, pushed apart by `Δr·cos` rather than by their angle — so the
 * drawing shipped with labels lying across each other. And it was brutal at
 * twelve o'clock, where it demanded 39° of span on ring three against 6° at
 * three o'clock: labels vanished exactly where the reading wedge is and
 * appeared in crowds on the sides, which is precisely the behaviour the owner
 * called unclear (19 aug 2026).
 *
 * So the renderer asks this instead, per turn, of every pair still standing.
 * Two labels are in each other's way when they share a line *and* that line,
 * which is why the far side of the wheel is free to hold a label at the same
 * height.
 */
export function stripsClash(a: LabelStrip, b: LabelStrip): boolean {
	// Half of each: two labels of different sizes need the sum of their halves
	// between their baselines, which for two of a kind is simply their height.
	if (Math.abs(a.y - b.y) >= (a.height + b.height) / 2) return false;
	return a.left < b.right && b.left < a.right;
}

/**
 * How much of its parent's slice a subtree claims.
 *
 * One share per item that will actually be drawn: a leaf, or a stump with its
 * subtree folded behind it. **Nothing about where the reader is looking comes
 * into it** (BC_E3_S41). It used to: the fisheye multiplied this by how
 * interesting a node was, which is what made the focus swell — and what made
 * the whole circle re-divide itself every time the wheel came to rest somewhere
 * else. The swelling now happens in the drawing, around the reading wedge,
 * where it can be continuous (`layout/warp.ts`).
 */
function weightOf(node: WheelNode, sink: Sink): number {
	const cached = sink.weights.get(node.id);
	if (cached !== undefined) return cached;

	let weight = 1;
	if (!stumpBy(node, sink, sink.stable)) {
		const children = orderedChildren(node);
		const limit = sink.stable.shown.get(node.id) ?? 0;
		const counted = children.slice(0, limit);
		if (counted.length > 0) {
			weight = counted.reduce((sum, child) => sum + weightOf(child, sink), 0);
		}
	}

	sink.weights.set(node.id, weight);
	return weight;
}

/**
 * Open tasks strictly below this node — what a stump counts.
 *
 * Summed from the children rather than subtracting the node's own share, so it
 * cannot drift from whatever `countTasks` decided that share was. It counts a
 * finished task exactly when the round does.
 */
function openBelow(node: WheelNode): number {
	return node.children.reduce((sum, child) => sum + child.shownTaskCount, 0);
}

/** Open tasks in a set of branches, itself included — what a remainder counts. */
function openUnder(nodes: readonly WheelNode[]): number {
	return nodes.reduce((sum, node) => sum + node.shownTaskCount, 0);
}

/** The deepest ring this tree could put something on, focus bonus included. */
function reachableDepth(tree: WheelTree, config: LayoutOptions): number {
	let deepest = 1;
	for (const node of tree.byId.values()) deepest = Math.max(deepest, node.depth);
	return Math.min(deepest, config.maxDepth + config.doi.depthBonus);
}

function ringsUsed(nodes: readonly LaidOutNode[], config: LayoutOptions): number[] {
	let deepest = 0;
	for (const laid of nodes) deepest = Math.max(deepest, laid.depth);
	const rings: number[] = [];
	for (let depth = 1; depth <= deepest; depth++) {
		rings.push(ringRadius(depth, config.rings));
	}
	return rings;
}
