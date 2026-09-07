import { labelStrip, type LabelStrip, stripsClash } from "./radial";
import { normaliseAngle } from "./geometry";

/**
 * Which labels can be read at a given turn of the wheel, and which step aside.
 *
 * Split out of the renderer (audit M2, 23 aug 2026), and the reason is T4 from
 * the same audit: the guarantees this decision carries were *measured* over
 * three days of work — no collisions over a whole revolution, every stop still
 * named, the reading branch named all the way down — and none of them was
 * written down as a test, because the decision only existed inside a class that
 * needed a browser.
 *
 * The pieces were already pure (`labelStrip`, `stripsClash`); what lived in the
 * renderer was how they are *composed*: which side the text hangs on, whether
 * it is written out long or short, the order in which labels are asked, and the
 * rule that a label is kept unless something already kept is in its way. That
 * composition is the part with the guarantees in it, so that is what moved.
 *
 * No DOM here. The renderer measures real text and paints the answer; this
 * decides what the answer is.
 */

/**
 * Within this many degrees of straight up or down, a title is centred.
 *
 * Exported because the window has to know it: a label is only ever written out
 * long while it is centred, so this angle is the bound on how far sideways a
 * long label can be — and sizing the drawing for a long label at three o'clock
 * reserves room for something that cannot happen (BC_E3_S79).
 */
export const UPRIGHT = 15;

/**
 * And within this many, the label of the branch being read.
 *
 * Wider than `UPRIGHT` because this is about the reading wedge rather than
 * about a wedge title: the whole point is that it stays centred while you are
 * looking at it, and the wheel only leaves that state when you turn it.
 */
export const CENTRED = 40;

/**
 * What a label measures before the browser can be asked, in drawing units.
 *
 * Measured on the real stylesheet (19 aug 2026): a wedge title runs 6,57 units
 * per character and stands 13 high, a task's label 5,11 and 10,4. The widths
 * are rounded up rather than down — a guess that is too small lets two labels
 * overlap, one that is too large only costs a label that could have been shown.
 * The halo is painted around both.
 */
export const RIM_CHAR = 7;
export const LEAF_CHAR = 6;
export const RIM_HEIGHT = 16;
export const LEAF_HEIGHT = 13;
export const HALO = 3;

/** How wide text of this length lies, at most. */
export function charWidth(onRim: boolean): number {
	return onRim ? RIM_CHAR : LEAF_CHAR;
}

/** Everything about one label that deciding needs. Deliberately no element. */
export interface LabelPlan {
	/** The node's angle on the unturned wheel. */
	angle: number;
	x: number;
	y: number;
	/** How wide the text lies, measured or estimated. */
	width: number;
	/** And how tall it is painted, halo included. */
	height: number;
	onRim: boolean;
	/** On the branch being read, so it centres itself over its own dot. */
	centred: boolean;
	/** The one item under the reading wedge. Yields to nothing but a title. */
	focus: boolean;
	/** The focus or one of its neighbours: named before the rest is. */
	near: boolean;
	/**
	 * Only a counter, with no name in front of it (BC_E3_S154).
	 *
	 * A node that draws its first few children and holds the rest back has a
	 * number the drawing owes the reader, and a name the drawing has decided
	 * not to give it: "labels leaves and domains, never the containers in
	 * between" is a rule with a test under it, and a busy wheel is exactly
	 * where it earns its keep. So the counter goes on alone, and it is asked
	 * last — after every real name, including the ones far from the focus.
	 * A `+3` that pushed a task's name off the wheel would be a bad trade.
	 */
	countOnly?: boolean;
	/** What it says centred over its own dot, and what it says hanging aside. */
	long: string;
	short: string;
}

/** Where one label ends up at this turn, and whether it can be read there. */
export interface PlacedLabel {
	/** Position in the list handed in. */
	index: number;
	side: "start" | "middle" | "end";
	/** What it should say at this rotation — `long` only while centred. */
	words: string;
	width: number;
	strip: LabelStrip;
	/** False when something already kept is in its way. */
	kept: boolean;
}

/**
 * Who gets asked first when two labels want the same line.
 *
 * Lower goes first, and going first means being kept: the pass keeps a label
 * unless something already kept is in its way. So this order *is* the rule:
 *
 *  0. **The focus.** The one item being read. It yields to nothing — not even
 *     to a wedge title, which is a deliberate exception to "a domain keeps its
 *     name whatever the crowding does" (kaderdocument §3). Measured 19 aug
 *     2026: with titles first, five stops in 240 on a busy vault stood under
 *     the reading wedge without a name, which is the whole complaint. A title
 *     that steps aside is back a degree later and its wedge keeps its coloured
 *     band throughout, so the map never actually goes missing.
 *  1. **Wedge titles.** They need no exemption of their own: coming second,
 *     the focus is the only thing that can have been kept before them.
 *  2. **The focus's neighbours**, then everything else.
 */
export function rank(label: LabelPlan): number {
	if (label.focus) return 0;
	if (label.onRim) return 1;
	// After every name, its own included: a bare counter is worth having only
	// where nothing else wanted the room (BC_E3_S154).
	if (label.countOnly === true) return 4;
	return label.near ? 2 : 3;
}

/**
 * Which side of the anchor point the text hangs on.
 *
 * Outward from the wheel, so a label never runs back across the drawing. A
 * wedge title near twelve or six o'clock is centred instead: hanging it off to
 * one side would read as belonging to the neighbouring wedge.
 */
export function anchorFor(
	angle: number,
	onRim: boolean,
	centred = false,
): "start" | "middle" | "end" {
	if (onRim && (angle < UPRIGHT || angle > 360 - UPRIGHT)) return "middle";
	if (onRim && Math.abs(angle - 180) < UPRIGHT) return "middle";

	// The branch being read is centred over its own dot — but only while it is
	// near the top or the bottom of the wheel, which is where the reading wedge
	// is and where there is room above and below to spare. Swung round to three
	// o'clock a long centred label would run off the side of the drawing, so
	// there it hangs outward like every other label.
	if (centred && (angle < CENTRED || angle > 360 - CENTRED)) return "middle";
	if (centred && Math.abs(angle - 180) < CENTRED) return "middle";

	return angle < 180 ? "start" : "end";
}

/**
 * Place every label for a wheel turned this far.
 *
 * Answers in the order the labels came in, so a caller can walk its own list
 * beside the answer. The keeping itself is done in `rank` order and, within a
 * rank, from the top of the screen down — so where two cannot both be read, the
 * one nearer the reading wedge is the one that stays.
 */
export function placeLabels(
	labels: readonly LabelPlan[],
	degrees: number,
): PlacedLabel[] {
	const placed = labels.map((label, index): PlacedLabel => {
		const shown = normaliseAngle(label.angle + degrees);
		const side = anchorFor(shown, label.onRim, label.centred);

		// Long only while it is centred over its own dot: long *and* hanging off
		// one side is the widest thing the drawing can hold, and reserving room
		// for it shrinks the whole wheel by a seventh — for a name at three
		// o'clock, which is not where anybody is reading (BC_E3_S42).
		const words = side === "middle" ? label.long : label.short;
		const width =
			words === label.long && label.width > 0
				? label.width
				: words.length * charWidth(label.onRim);

		return {
			index,
			side,
			words,
			width,
			strip: labelStrip(
				{ x: label.x, y: label.y, width, height: label.height, side },
				degrees,
			),
			kept: false,
		};
	});

	// The order is the whole rule, because a label is kept unless something
	// already kept is in its way.
	const asked = [...placed].sort(
		(a, b) =>
			rank(labels[a.index]) - rank(labels[b.index]) || a.strip.y - b.strip.y,
	);

	const kept: LabelStrip[] = [];
	for (const one of asked) {
		// The focus is unconditional — and, as things stand, redundantly so: it
		// ranks first, so nothing has been kept yet when it is asked and the
		// clash test cannot refuse it anyway. Taking the exemption out changes no
		// outcome, which a mutation showed when this was written down as a test
		// (BC_E3_S51). It stays because it says which of the two is the *promise*:
		// "the item you are reading always has its name" is the rule, and the
		// ordering is only how it is currently kept. Change `rank` and the promise
		// still holds.
		const clear =
			labels[one.index].focus ||
			kept.every((strip) => !stripsClash(one.strip, strip));
		one.kept = clear;
		if (clear) kept.push(one.strip);
	}

	return placed;
}
