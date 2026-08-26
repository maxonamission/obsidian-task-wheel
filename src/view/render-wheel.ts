import { branchColour, domainColour, nodeColour } from "../layout/colour";
import {
	angleDelta,
	arcPath,
	branchPath,
	normaliseAngle,
	pointAt,
} from "../layout/geometry";
import {
	HALO,
	type LabelPlan,
	LEAF_CHAR,
	LEAF_HEIGHT,
	placeLabels,
	RIM_CHAR,
	RIM_HEIGHT,
} from "../layout/labels";
import { pinnedAngle } from "../layout/pin";
import { warpAngle, type WarpOptions } from "../layout/warp";
import {
	type LaidOutNode,
	type WheelLayout,
} from "../layout/radial";
import { clampZoom, viewBoxAttr, viewBoxFor } from "../layout/zoom";
import { plainText } from "../parse/links";

/**
 * The drawing, and the two things that change about it: how far it has turned
 * and which item is under the reading wedge.
 *
 * Everything here is a translation of numbers the `layout/` modules already
 * decided on — this module picks no angles and no radii of its own. Colour
 * arrives as a CSS value and is handed to the element as a custom property, so
 * the stylesheet stays in charge of *how* a dot is painted and this file only
 * says *which* colour it is.
 *
 * The drawing is built once. Turning is a transform on the rotor group, not a
 * redraw: a rescan rebuilds, a turn does not.
 */

/**
 * How far outside the outermost ring the wedge bands sit, and the titles
 * outside those.
 *
 * Both are measured from the tree's own depth rather than fixed, so a shallow
 * vault fills the canvas instead of drawing a small wheel inside a wide empty
 * ring. The depth a tree can reach does not change while you turn, so neither
 * does the size of the drawing.
 */
const BAND_GAP = 18;
const TITLE_GAP = 12;

/**
 * Room kept outside the titles for the longest label.
 *
 * Every unit of it is width the wheel itself does not get, and most of the ring
 * has no label at all — so this is cut to what a truncated label actually
 * needs rather than to the worst case. Anything longer is what the reading card
 * is for.
 */
const LABEL_MARGIN = 62;

/** Gap between a node and its label. */
const LABEL_GAP = 7;

/** And for a centred one, which has the dot underneath it rather than beside. */
const READING_GAP = 11;

/** Breathing room between the longest label and the edge of the drawing. */
const EDGE_PAD = 4;

/**
 * Label lengths, past which the reading card is the place to read it.
 *
 * `reading` is the branch you are on — the focus and the containers between it
 * and the hub. Those get more than twice the room of an ordinary label, because
 * they are what the drawing is being asked about; the rest stay short so the
 * wheel keeps reading as a shape rather than as a list (owner, 19 aug 2026).
 */
const LABEL_CHARS = { domain: 11, leaf: 14, reading: 30 } as const;

/**
 * The hub's radius, and so where a wedge seam starts.
 *
 * One number because it is one edge: the seam runs from the hub outwards, and
 * the two drifting apart would show as a gap or an overlap at the middle of the
 * wheel. They were written down separately (audit M3, 23 aug 2026).
 */
const HUB_RADIUS = 27;

/** How wide a tap target every item gets, however small its dot is drawn. */
const HIT_RADIUS = 11;

/**
 * A label, its element, and everything the deciding needs.
 *
 * Extends `LabelPlan` rather than repeating its fields: the decision lives in
 * `layout/labels` and this is that decision's input with a drawn element
 * attached. Written out twice they would have drifted (audit M2/M3, 23 aug
 * 2026).
 */
interface LabelHandle extends LabelPlan {
	el: SVGTextElement;
	/** The node's angular slice, weighed against the room it needs. */
	span: number;
	/** How far out the label itself is anchored — its ring plus its gap. */
	radius: number;
	/** Whether the width came from the browser rather than from the estimate. */
	measured: boolean;
}

/**
 * One drawn node, and everything needed to move it.
 *
 * Both things that move a node live here: the **hold** that keeps a container
 * under the reading wedge still while the wheel turns beneath it (BC_E3_S39),
 * and the **magnifier** that swells whatever is near the wedge (BC_E3_S41).
 * Both are functions of how far the wheel has turned, so both are worked out
 * here, per turn, on the few nodes whose answer actually changed.
 */
interface Place {
	laid: LaidOutNode;
	/** A container, so it holds still while the wedge is inside its slice. */
	holds: boolean;
	/** The dot, or the little line a crowded node is drawn as instead. */
	dot: SVGCircleElement | null;
	tick: SVGLineElement | null;
	/** The finger-sized disc a tap actually lands on. */
	hit: SVGCircleElement;
	label: LabelHandle | null;
	/** The angle it is drawn on right now. */
	at: number;
}

/** A branch, with both ends, so it can be redrawn when one of them moves. */
interface Branch {
	el: SVGPathElement;
	parentId: string;
	childId: string;
	parentRadius: number;
	childRadius: number;
}

export class WheelRenderer {
	private readonly rim: number;
	private readonly titleRadius: number;
	private readonly svg: SVGSVGElement;
	private readonly rotor: SVGGElement;
	private readonly labels: LabelHandle[] = [];
	private readonly groups = new Map<string, SVGGElement>();
	/** Where the focus ring goes for each item, in rotor coordinates. */
	private readonly marks = new Map<string, { x: number; y: number; r: number }>();
	private readonly focusRing: SVGCircleElement;
	private readonly sweep: SVGGElement;

	/** Every drawn node and every branch, so a turn can re-place them. */
	private readonly places: Place[] = [];
	private readonly branches: Branch[] = [];
	/** The wedge bands and their seams, which follow the magnifier too. */
	private readonly bands: Array<{
		el: SVGPathElement;
		seam: SVGLineElement;
		startAngle: number;
		endAngle: number;
	}> = [];
	/** How hard this wheel magnifies under the reading wedge. */
	private readonly warp: WarpOptions;
	/** Steps from the focus that count as its neighbourhood, for label priority. */
	private readonly nearSteps: number;
	/** What the round has passed, in layout angles, for redrawing per turn. */
	private sweptSpans: ReadonlyArray<{ start: number; end: number }> = [];
	/** Every node's drawn angle right now, for the branches between them. */
	private readonly drawnAt = new Map<string, number>();

	private focusId: string | null = null;
	/** How far the disc stands turned, so a redraw can follow the magnifier. */
	private turned = 0;
	/** Whether any label is still going on its estimated width. */
	private unmeasured = true;
	private half: number;
	private zoom: number;

	constructor(parent: HTMLElement, layout: WheelLayout, zoom = 1) {
		parent.empty();

		this.rim = layout.radius + BAND_GAP;
		this.warp = layout.warp;
		// The layout's own reach, not a second copy of it: the renderer is not
		// choosing this rule, it is honouring one (audit M3, 23 aug 2026).
		this.nearSteps = layout.labelSteps;
		this.titleRadius = this.rim + TITLE_GAP;
		this.half = this.titleRadius + LABEL_MARGIN;
		this.half = this.roomForLabels(layout);
		this.zoom = clampZoom(zoom);

		this.svg = parent.createSvg("svg", {
			cls: "task-wheel-svg",
			attr: {
				viewBox: viewBoxAttr(viewBoxFor(this.half, -this.rim, this.zoom)),
				// The window fits itself to whatever box the pane leaves, and the
				// drawing keeps its shape inside it. No measuring, no resize
				// listener: the browser does this better than we would.
				preserveAspectRatio: "xMidYMid meet",
				"aria-hidden": "true",
				focusable: "false",
			},
		});

		this.drawRings(layout);

		// The rotor is everything that belongs to the disc: the wedges, the
		// branches and the nodes all turn together. The rings and the reading
		// wedge stay outside it — the disc turns past the reading position, not
		// the other way round (kaderdocument §5).
		this.rotor = this.svg.createSvg("g", { cls: "task-wheel-rotor" });
		this.sweep = this.rotor.createSvg("g", { cls: "task-wheel-sweep" });
		this.drawWedges(layout);
		this.drawBranches(layout);
		const nodes = this.drawNodes(layout);

		this.focusRing = nodes.createSvg("circle", {
			cls: ["task-wheel-focus-ring", "is-idle"],
			attr: { cx: 0, cy: 0, r: 0 },
		});

		// The hub sits outside the rotor. It is a readout, not part of the disc:
		// a count that turns upside down as you work is unreadable exactly when
		// you are working.
		this.drawHub(layout);
		this.drawIndex();
		this.measureLabels();
		this.setRotation(0);
	}

	/**
	 * Hold the containers under the reading wedge still while the disc turns.
	 *
	 * The rule is in `layout/pin.ts`; this is the hand that carries it out. Only
	 * the few containers whose answer actually changed are touched — on a wheel
	 * of a couple of hundred items that is the trunk and its neighbours, and
	 * everything else costs one comparison.
	 */
	private place(reading: number): void {
		const moved = new Set<string>();

		for (const spot of this.places) {
			// Two rules, in this order: a container is held under the wedge while
			// the wedge is inside its slice, and whatever comes out of that is then
			// drawn through the magnifier. Outside the magnifier's window the
			// second rule does nothing, which is what keeps this cheap.
			const held = spot.holds
				? pinnedAngle(spot.laid, reading)
				: spot.laid.drawAngle;
			const want = warpAngle(held, reading, this.warp);

			// A twentieth of a degree is a tenth of a pixel out on the rim: below
			// this the browser would repaint for nothing.
			if (Math.abs(angleDelta(spot.at, want)) < 0.05) continue;

			spot.at = want;
			this.drawnAt.set(spot.laid.id, want);
			this.move(spot);
			moved.add(spot.laid.id);
		}

		// The wedge bands are arcs on the rim, so only their two ends move — but
		// they have to, or a band would slide off the branches it stands for.
		for (const band of this.bands) {
			const from = warpAngle(band.startAngle, reading, this.warp);
			const to = warpAngle(band.endAngle, reading, this.warp);
			const width = normaliseAngle(to - from) || 360;
			band.el.setAttribute("d", arcPath(this.rim, from, from + width));

			const inner = pointAt(HUB_RADIUS, from);
			const outer = pointAt(this.rim, from);
			band.seam.setAttribute("x1", String(round(inner.x)));
			band.seam.setAttribute("y1", String(round(inner.y)));
			band.seam.setAttribute("x2", String(round(outer.x)));
			band.seam.setAttribute("y2", String(round(outer.y)));
		}

		// And the track the round has already run along, for the same reason.
		if (this.sweptSpans.length > 0) this.paintSweep(reading);

		if (moved.size === 0) return;

		// A branch is drawn from its parent's ring out to its child, so it has to
		// be redrawn when either end moves — including the branches to every one
		// of a held container's children, which are turning away underneath it.
		for (const branch of this.branches) {
			if (!moved.has(branch.parentId) && !moved.has(branch.childId)) continue;

			branch.el.setAttribute(
				"d",
				branchPath(
					branch.parentRadius,
					this.drawnAt.get(branch.parentId) ?? 0,
					branch.childRadius,
					this.drawnAt.get(branch.childId) ?? 0,
				),
			);
		}

		// The ring around the item being read rides on the item.
		if (this.focusId !== null && moved.has(this.focusId)) {
			const mark = this.marks.get(this.focusId);
			if (mark !== undefined) {
				this.focusRing.setAttribute("cx", String(mark.x));
				this.focusRing.setAttribute("cy", String(mark.y));
			}
		}
	}

	/** Put one node, and its label, on the angle it now stands at. */
	private move(spot: Place): void {
		const point = pointAt(spot.laid.radius, spot.at);

		spot.dot?.setAttribute("cx", String(round(point.x)));
		spot.dot?.setAttribute("cy", String(round(point.y)));
		spot.hit.setAttribute("cx", String(round(point.x)));
		spot.hit.setAttribute("cy", String(round(point.y)));

		if (spot.tick !== null) {
			const from = pointAt(spot.laid.radius - 3, spot.at);
			const to = pointAt(spot.laid.radius + 3, spot.at);
			spot.tick.setAttribute("x1", String(round(from.x)));
			spot.tick.setAttribute("y1", String(round(from.y)));
			spot.tick.setAttribute("x2", String(round(to.x)));
			spot.tick.setAttribute("y2", String(round(to.y)));
		}

		const mark = this.marks.get(spot.laid.id);
		if (mark !== undefined) {
			mark.x = round(point.x);
			mark.y = round(point.y);
		}

		const label = spot.label;
		if (label === null) return;

		// The label keeps its own ring — only the angle it hangs at moves. The
		// caller places it right afterwards, transform, side and all.
		const anchor = pointAt(label.radius, spot.at);
		label.x = anchor.x;
		label.y = anchor.y;
		label.angle = spot.at;
		label.el.setAttribute("x", String(round(anchor.x)));
		label.el.setAttribute("y", String(round(anchor.y)));
	}

	/** The canvas element, for measuring where the centre of the wheel is. */
	get element(): SVGSVGElement {
		return this.svg;
	}

	/**
	 * The part of the circle this round has already passed.
	 *
	 * Drawn inside the rotor, because an item's angle belongs to the disc: the
	 * band has to stay under the items it stands for as the wheel turns. It sits
	 * just inside the rim, where it reads as a track the reading wedge has run
	 * along rather than as another ring of data.
	 */
	setSweep(spans: ReadonlyArray<{ start: number; end: number }>): void {
		this.sweptSpans = spans;
		this.paintSweep(normaliseAngle(-this.turned));
	}

	/**
	 * Draw the track, through the magnifier.
	 *
	 * It marks the angles the round has passed, so it has to be stretched exactly
	 * as the items above it are — otherwise the band would slide off the very
	 * items it is a record of.
	 */
	private paintSweep(reading: number): void {
		this.sweep.empty();

		for (const span of this.sweptSpans) {
			const from = warpAngle(span.start, reading, this.warp);
			const to = warpAngle(span.end, reading, this.warp);
			const width = span.end - span.start >= 360 ? 360 : normaliseAngle(to - from);
			this.sweep.createSvg("path", {
				attr: { d: arcPath(this.rim - 5, from, from + width) },
			});
		}
	}

	/**
	 * Where the hub sits on screen, in pixels.
	 *
	 * The pivot a drag turns about, and it is *not* the middle of the canvas:
	 * zooming anchors the window on the reading wedge, so the hub slides down
	 * and can leave the pane entirely. Asking the SVG itself keeps this true
	 * through the viewBox, the zoom and `preserveAspectRatio` alike — the origin
	 * of the drawing is exactly where the matrix says it is.
	 */
	hubOnScreen(): { x: number; y: number } | null {
		const matrix = this.svg.getScreenCTM();
		if (matrix === null) return null;

		// The transform of the point (0, 0), which is the hub.
		return { x: matrix.e, y: matrix.f };
	}

	/**
	 * Close in on the reading wedge, or pull back out.
	 *
	 * One attribute. The drawing does not change, the window onto it does — so
	 * zooming costs nothing and cannot disturb the layout, the stops or the
	 * focus.
	 */
	setZoom(zoom: number): void {
		this.zoom = clampZoom(zoom);
		this.svg.setAttribute(
			"viewBox",
			viewBoxAttr(viewBoxFor(this.half, -this.rim, this.zoom)),
		);
	}

	/**
	 * Turn the disc.
	 *
	 * Labels are counter-turned about their own anchor so the text stays
	 * horizontal however far the wheel has gone (kaderdocument §5), and their
	 * anchor side flips with the half of the wheel they are currently in — a
	 * label that kept hanging leftwards after crossing to the left half would
	 * run back across the drawing to reach its own dot.
	 */
	setRotation(degrees: number): void {
		// First, while nothing has been written this frame: a pane built in a
		// background tab could not be measured, and this is the cheapest moment
		// to try again — a read after a write costs a forced layout.
		if (this.unmeasured) this.measureLabels();

		// Before the labels are placed, because this moves some of them.
		this.turned = degrees;
		this.place(normaliseAngle(-degrees));

		this.rotor.setAttribute("transform", `rotate(${round(degrees)})`);

		// Who can be read here is decided in `layout/labels`, without a browser;
		// this loop only paints the answer (audit M2, 23 aug 2026).
		const placed = placeLabels(this.labels, degrees);

		for (const one of placed) {
			const label = this.labels[one.index];

			if (label.el.textContent !== one.words) {
				label.el.textContent = one.words;
				label.width = one.width;
			}

			label.el.setAttribute(
				"transform",
				`rotate(${round(-degrees)}, ${round(label.x)}, ${round(label.y)})`,
			);
			label.el.setAttribute("text-anchor", one.side);
			label.el.toggleClass("is-crowded", !one.kept);
		}
	}

	/**
	 * How much room the labels of *this wheel* can ever need.
	 *
	 * Worked out before anything is drawn, from what the wheel could show rather
	 * than from what it happens to show right now — and that "rather than" is the
	 * whole point. It used to be measured after drawing, over the labels that
	 * were up: a long name under the reading wedge widened the window, and the
	 * next stop narrowed it again, so the wheel changed size at nearly every
	 * click (gemeten 23 aug 2026: 432 tot 562 eenheden, 30% verschil, op 12 van
	 * de 20 stops). The reader sees a drawing that will not sit still — the last
	 * of the restlessness (eigenaar, 23 aug 2026).
	 *
	 * So every drawn item is asked the worst it could do: swung round to three
	 * o'clock, with the longest label it is ever given. A name is written out at
	 * reading length only on the branch being read, and there it is centred over
	 * its own dot — so it reaches out half its width, where a label hanging
	 * beside its dot reaches out all of it. The bigger of those two is what the
	 * item can cost.
	 *
	 * The widths are the estimates, which are rounded *up* from the measured
	 * ones (7 against 6,57 units per character on the rim, 6 against 5,11
	 * elsewhere), so the window is never too small for what the browser then
	 * paints.
	 */
	private roomForLabels(layout: WheelLayout): number {
		let needed = this.half;

		for (const laid of layout.nodes) {
			if (laid.depth === 0) continue;
			const onRim = laid.depth === 1;
			const words = plainText(laid.node.label);

			// A wedge title is never centred and never written out long. Every other
			// item may be either, depending on where the reader stands.
			const reach = onRim
				? this.titleRadius + widthOf(words, LABEL_CHARS.domain, true)
				: laid.radius +
					Math.max(
						// Centred over its own dot, at reading length: half either way.
						READING_GAP + widthOf(words, LABEL_CHARS.reading, false) / 2,
						// Or hanging off one side, and then it is an ordinary name.
						LABEL_GAP + widthOf(words, LABEL_CHARS.leaf, false),
					);

			// Whole units, so the window stays exactly symmetrical about the middle
			// once it has been through the rounding that writing it out does.
			needed = Math.max(needed, Math.ceil(reach + EDGE_PAD));
		}

		return needed;
	}

	/**
	 * Ask the browser how wide every label lies — all of them, in one go.
	 *
	 * One pass of nothing but reads costs one layout; the same reads scattered
	 * through the drawing cost one *each*, because every element created in
	 * between invalidates what was just computed. That is what a browser calls a
	 * forced reflow, and doing it per label was measurable enough for Chrome to
	 * complain (owner's console, 19 aug 2026).
	 *
	 * `getComputedTextLength` answers zero for text that has not been laid out —
	 * a pane built while its tab is in the background, which is the ordinary way
	 * a wheel is restored. Then the estimate stands and the next turn asks again.
	 */
	private measureLabels(): void {
		let all = true;

		for (const label of this.labels) {
			if (label.measured) continue;

			// One call for both numbers, so the read costs what one read costs.
			const box = label.el.getBBox?.();
			if (box !== undefined && box.width > 0) {
				label.width = box.width;
				label.height = box.height + HALO;
				label.measured = true;
			} else {
				all = false;
			}
		}

		this.unmeasured = !all;
	}

	/** Mark the item under the reading wedge. */
	setFocus(id: string | null): void {
		if (id === this.focusId) return;

		const previous =
			this.focusId === null ? undefined : this.groups.get(this.focusId);
		previous?.removeClass("is-focus");
		this.focusId = id;

		if (id === null) {
			this.focusRing.addClass("is-idle");
			return;
		}

		const group = this.groups.get(id);
		group?.addClass("is-focus");

		const mark = this.marks.get(id);
		if (mark === undefined) {
			this.focusRing.addClass("is-idle");
			return;
		}

		this.focusRing.setAttribute("cx", String(mark.x));
		this.focusRing.setAttribute("cy", String(mark.y));
		this.focusRing.setAttribute("r", String(mark.r + 4.5));
		this.focusRing.removeClass("is-idle");
	}

	private drawRings(layout: WheelLayout): void {
		const rings = this.svg.createSvg("g", { cls: "task-wheel-rings" });
		for (const radius of layout.rings) {
			rings.createSvg("circle", { attr: { r: radius } });
		}
	}

	/**
	 * The fixed budgets, made visible.
	 *
	 * A band on the rim per domain, plus a hairline where one wedge ends and the
	 * next begins. Without them the empty half of a quiet domain reads as a
	 * drawing error rather than as the deliberate reserved space it is.
	 */
	private drawWedges(layout: WheelLayout): void {
		const wedges = this.rotor.createSvg("g", { cls: "task-wheel-wedges" });

		for (const budget of layout.budgets) {
			const band = wedges.createSvg("path", {
				cls: "task-wheel-budget",
				attr: { d: arcPath(this.rim, budget.startAngle, budget.endAngle) },
			});
			band.style.setProperty("--tw-colour", branchColour(budget.index));

			const inner = pointAt(HUB_RADIUS, budget.startAngle);
			const outer = pointAt(this.rim, budget.startAngle);
			const seam = wedges.createSvg("line", {
				cls: "task-wheel-seam",
				attr: { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y },
			});

			this.bands.push({
				el: band,
				seam,
				startAngle: budget.startAngle,
				endAngle: budget.endAngle,
			});
		}
	}

	private drawBranches(layout: WheelLayout): void {
		const branches = this.rotor.createSvg("g", { cls: "task-wheel-branches" });
		for (const link of layout.links) {
			const path = branches.createSvg("path", { attr: { d: link.path } });
			path.style.setProperty("--tw-colour", branchColour(link.domainIndex));
			path.style.setProperty("--tw-presence", String(round(link.presence)));

			// Kept, because a branch is the one thing that has to be redrawn when
			// a container holds still while its children turn away.
			const parent = layout.byId.get(link.parentId);
			const child = layout.byId.get(link.childId);
			if (parent === undefined || child === undefined) continue;
			this.branches.push({
				el: path,
				parentId: link.parentId,
				childId: link.childId,
				parentRadius: parent.radius,
				childRadius: child.radius,
			});
		}
	}

	private drawNodes(layout: WheelLayout): SVGGElement {
		const nodes = this.rotor.createSvg("g", { cls: "task-wheel-nodes" });
		const holds = new Set(layout.links.map((link) => link.parentId));

		for (const laid of layout.nodes) {
			if (laid.render === "hub") continue;

			// The id travels with the drawing so a tap can name what it hit
			// without the controller having to know any geometry.
			const group = nodes.createSvg("g", {
				cls: classesFor(laid),
				attr: { "data-tw-id": laid.id },
			});

			// A domain anchors the hue channel, so it is drawn in the undiluted
			// colour. It carries no priority of its own to fade it with — the
			// lightness channel belongs to the tasks.
			group.style.setProperty(
				"--tw-colour",
				laid.depth === 1
					? domainColour(laid.domainIndex)
					: nodeColour(laid.domainIndex, laid.priority),
			);

			// The far side of the wheel recedes to a silhouette rather than
			// disappearing: it still says "there is work here", which is the one
			// thing the wheel may never be silent about (kaderdocument §3.3).
			group.style.setProperty("--tw-presence", String(round(laid.presence)));

			// A folded branch is drawn a size up: its label carries the count, but
			// a label needs room and the far side of the wheel has none. The ring
			// has to say "there is more here" on its own.
			const radius = dotRadius(laid.depth) + (laid.collapsed ? 2 : 0);
			let dot: SVGCircleElement | null = null;
			let tick: SVGLineElement | null = null;
			if (laid.render === "tick") {
				tick = drawTick(group, laid);
			} else {
				dot = group.createSvg("circle", {
					attr: { cx: laid.x, cy: laid.y, r: radius },
				});
			}

			// A finger is far larger than the dot it is aiming at, and out on the
			// crowded rings the dots are two pixels across. This invisible disc is
			// what the tap actually lands on.
			const hit = group.createSvg("circle", {
				cls: "task-wheel-hit",
				attr: { cx: laid.x, cy: laid.y, r: Math.max(radius + 5, HIT_RADIUS) },
			});

			// Where the focus ring goes when this item comes under the wedge.
			this.marks.set(laid.id, {
				x: round(laid.x),
				y: round(laid.y),
				r: radius,
			});

			const label =
				laid.render === "labelled" ? this.drawLabel(group, laid) : null;
			this.groups.set(laid.id, group);
			this.drawnAt.set(laid.id, laid.drawAngle);

			// Only containers *hold*: a leaf that stopped moving would take the
			// turning motion away from the very items the round is about. Every
			// node is placed, though — the magnifier reaches them all.
			this.places.push({
				laid,
				holds: holds.has(laid.id),
				dot,
				tick,
				hit,
				label,
				at: laid.drawAngle,
			});
		}

		return nodes;
	}

	/**
	 * A horizontal label beside the node.
	 *
	 * Horizontal rather than curved along its ring — the reason the design picked
	 * a node-link tree over a sunburst in the first place (kaderdocument §4).
	 *
	 * A domain is the exception: its name goes on the rim as the title of the
	 * wedge, where it labels the whole slice — empty space included — instead of
	 * one dot near the middle.
	 */
	private drawLabel(group: SVGGElement, laid: LaidOutNode): LabelHandle {
		const onRim = laid.depth === 1;
		// A centred label straddles its own dot, so it is lifted a little further
		// out than one that hangs beside it — otherwise the text sits on the dot.
		const radius = onRim
			? this.titleRadius
			: laid.radius + (laid.onPath ? READING_GAP : LABEL_GAP);
		const anchor = pointAt(radius, laid.drawAngle);

		const el = group.createSvg("text", {
			cls: "task-wheel-label",
			attr: { x: anchor.x, y: anchor.y },
		});
		const long = labelText(laid);
		const short = laid.onPath && !onRim ? labelText(laid, true) : long;
		el.textContent = long;

		const handle: LabelHandle = {
			el,
			x: anchor.x,
			y: anchor.y,
			angle: laid.drawAngle,
			span: laid.span,
			radius,
			onRim,
			// Measured in one pass once the whole drawing stands — see
			// `measureLabels`. Asking here, between two elements being created,
			// forces a layout per label and Chrome says so out loud.
			width: estimate(el, onRim),
			height: onRim ? RIM_HEIGHT : LEAF_HEIGHT,
			measured: false,
			// The focus itself is distance zero; `labelSteps` decides how far the
			// neighbourhood reaches, and the layout has already applied it — a
			// container this far out is only labelled at all because of it.
			// `distance` reads zero for every node when there is no focus at all,
			// so the path is what tells the two apart.
			focus: laid.onPath && laid.distance === 0,
			near: laid.distance <= this.nearSteps,
			centred: laid.onPath && !onRim,
			long,
			short,
		};
		this.labels.push(handle);
		return handle;
	}

	/**
	 * The middle of the wheel, where every branch starts — and the total.
	 *
	 * How much there is altogether is a property of the wheel, not of the item
	 * you happen to be reading, so it belongs in the drawing rather than on the
	 * card. Drawn outside the rotor: a number that turns upside down as you work
	 * is unreadable exactly when you need it.
	 */
	private drawHub(layout: WheelLayout): void {
		const root = layout.nodes.find((laid) => laid.render === "hub");
		if (root === undefined) return;

		const hub = this.svg.createSvg("g", { cls: "task-wheel-hub" });
		hub.createSvg("circle", { attr: { r: HUB_RADIUS } });

		const count = hub.createSvg("text", {
			cls: "task-wheel-hub-count",
			attr: { x: 0, y: -1 },
		});
		count.textContent = String(root.node.shownTaskCount);

		const caption = hub.createSvg("text", {
			cls: "task-wheel-hub-caption",
			attr: { x: 0, y: 11 },
		});
		// "Open" is the whole point of the wheel, so it is what the hub says —
		// except in a round that deliberately holds finished work, where the
		// number counts those too and the word would be a small lie.
		caption.textContent = layout.showsFinished ? "shown" : "open";
	}

	/** The reading wedge: fixed at twelve o'clock, outside the rotor. */
	private drawIndex(): void {
		const rim = this.rim;
		const index = this.svg.createSvg("g", { cls: "task-wheel-index" });
		index.createSvg("line", {
			attr: { x1: 0, y1: -(rim + 4), x2: 0, y2: -(rim + 18) },
		});
		index.createSvg("path", {
			attr: { d: `M0 ${-(rim + 2)} L-6 ${-(rim + 14)} L6 ${-(rim + 14)} Z` },
		});
	}
}

/** A crowded node keeps its angle but gives up its dot: a mark on the ring. */
function drawTick(group: SVGGElement, laid: LaidOutNode): SVGLineElement {
	const from = pointAt(laid.radius - 3, laid.drawAngle);
	const to = pointAt(laid.radius + 3, laid.drawAngle);
	return group.createSvg("line", {
		attr: { x1: from.x, y1: from.y, x2: to.x, y2: to.y },
	});
}

/**
 * How wide the text lies when the browser will not say.
 *
 * `getComputedTextLength` answers zero for text that has not been laid out,
 * which is the ordinary case for a pane restored in a background tab. Until it
 * can be asked again the width is guessed from the character count, generously
 * — a guess that is too small lets two labels overlap, one that is too large
 * only costs a label that could have been shown.
 */
function estimate(el: SVGTextElement, onRim: boolean): number {
	const chars = el.textContent?.length ?? 0;
	return chars * (onRim ? RIM_CHAR : LEAF_CHAR);
}

/**
 * How wide a label of this text lies, at most, in drawing units.
 *
 * The same estimate the labels themselves start out with, asked before anything
 * exists to measure — which is what lets the window be sized from what the
 * wheel *could* show rather than from what it happens to show.
 */
function widthOf(words: string, limit: number, onRim: boolean): number {
	const chars = Math.min(words.length, limit) + (words.length > limit ? 1 : 0);
	return chars * (onRim ? RIM_CHAR : LEAF_CHAR);
}

function labelText(laid: LaidOutNode, ordinary = false): string {
	// Without the link syntax: a label is plain text and cannot be followed, so
	// showing the brackets spends the little room there is on punctuation.
	const words = plainText(laid.node.label);
	const limit =
		laid.depth === 1
			? LABEL_CHARS.domain
			: laid.onPath && !ordinary
				? LABEL_CHARS.reading
				: LABEL_CHARS.leaf;
	const label = truncate(words, limit);
	return laid.hiddenCount > 0 ? `${label} +${laid.hiddenCount}` : label;
}

function truncate(text: string, limit: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= limit) return trimmed;
	return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

function classesFor(laid: LaidOutNode): string[] {
	const classes = ["task-wheel-node", `is-${laid.node.kind}`, `is-${laid.render}`];
	if (laid.hiddenCount > 0) classes.push("is-stump");
	if (laid.collapsed) classes.push("is-collapsed");

	// Started work gets a ring rather than a colour: the fill is the priority
	// channel and stays that way, so the two can be read at the same time.
	const state = laid.node.fields?.state;
	if (state === "in-progress") classes.push("is-in-progress");
	if (state === "cancelled") classes.push("is-cancelled");

	return classes;
}

function dotRadius(depth: number): number {
	if (depth === 1) return 5.5;
	if (depth === 2) return 4;
	return 3;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
