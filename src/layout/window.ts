/**
 * The size of the drawing's window — one number, and it must not move.
 *
 * This is the third round against the same restlessness, each time one layer
 * further from the screen:
 *
 *  1. The window used to be measured after drawing, over the labels that were
 *     up. A long name under the reading wedge widened it, the next stop
 *     narrowed it again, and the wheel changed size at nearly every click
 *     (measured 23 aug 2026: 432 to 562 units, on 12 of 20 stops).
 *  2. So it was worked out before drawing, from the worst every **drawn** item
 *     could do. That stilled the labels — but *which* items are drawn still
 *     followed the focus: a branch past the ring cap unfolds only while the
 *     focus stands in it, and the moment it unfolds, its deeper rings and
 *     longer labels entered the reckoning. The window jumped exactly when the
 *     turn crossed such a branch, the whole drawing rescaled with it, and the
 *     owner saw the thick outer band lurch while the wheel stood still
 *     (27 aug 2026, BC_E3_S70: reproduced with one note carrying long-labelled
 *     tasks under a second heading — VRG-013 — against one without — VRG-012).
 *  3. So now it is worked out from the **tree**: every node the wheel could
 *     ever draw, at the outermost ring it could ever stand on, with the
 *     longest label form it is ever given. Whether the focus happens to be
 *     unfolding that branch right now no longer enters into it. The window
 *     changes when the notes change, and at no other time.
 *
 * The cost is honest and small: a wheel is drawn at the size its worst corner
 * needs, even while that corner is folded away. That is the concept's own
 * bargain — position stability above snugness (kaderdocument §3, eis 1).
 */

import { ringRadius, toRadians, type RingConfig } from "./geometry";
import { CENTRED, LEAF_CHAR, RIM_CHAR, UPRIGHT } from "./labels";
import { plainText } from "../parse/links";
import type { WheelTree } from "../model/types";

/**
 * How far outside the outermost ring the wedge bands sit, and the titles
 * outside those.
 *
 * Both are measured from the tree's own depth rather than fixed, so a shallow
 * vault fills the canvas instead of drawing a small wheel inside a wide empty
 * ring. The depth a tree can reach does not change while you turn, so neither
 * does the size of the drawing.
 */
export const BAND_GAP = 18;
export const TITLE_GAP = 12;

/**
 * Room kept outside the titles for the longest label.
 *
 * Every unit of it is width the wheel itself does not get, and most of the ring
 * has no label at all — so this is cut to what a truncated label actually
 * needs rather than to the worst case. Anything longer is what the reading card
 * is for.
 */
export const LABEL_MARGIN = 62;

/** Gap between a node and its label. */
export const LABEL_GAP = 7;

/** And for a centred one, which has the dot underneath it rather than beside. */
export const READING_GAP = 11;

/** Breathing room between the longest label and the edge of the drawing. */
export const EDGE_PAD = 4;

/**
 * Label lengths, past which the reading card is the place to read it.
 *
 * There are two forms of every label, and which one is used is decided per turn
 * by `anchorFor`: written out while it stands centred over its own dot near the
 * top or bottom of the wheel, cut short the moment it swings round and hangs off
 * to one side. So the pairs here are *long, short*:
 *
 *  - `reading` / `leaf` — the branch you are on, against everything else. The
 *    branch being read gets the room because it is what the drawing is being
 *    asked about; the rest stay short so the wheel keeps reading as a shape
 *    rather than as a list (owner, 19 aug 2026).
 *  - `title` / `domain` — a wedge title, on the rim. It used to have only the
 *    short form, which left the wedge under the reading wedge carrying the
 *    *shortest* label on the whole wheel: "Product launch" as "Product la…",
 *    while an ordinary task beside it had three characters more (owner, 28 aug
 *    2026). It is the name the wheel is about at that moment; it now gets the
 *    same treatment as the branch being read.
 *
 * The long forms are free — see `windowFor`, which is where that is proved
 * rather than asserted.
 */
export const LABEL_CHARS = {
	domain: 11,
	title: 34,
	leaf: 14,
	reading: 40,
} as const;

/**
 * How far sideways a label can be carried and still be written out long.
 *
 * `anchorFor` centres a label only within 40° of vertical — 15° for a wedge
 * title — and a label is written out long only while it is centred. So the sine
 * of that angle is the bound on the sideways part of a long label's position:
 * never the whole radius, which is what the window used to charge for it.
 */
const CENTRED_SWING = Math.sin(toRadians(CENTRED));
const UPRIGHT_SWING = Math.sin(toRadians(UPRIGHT));

/**
 * How wide a label of this text lies, at most, in drawing units.
 *
 * The widths are estimates rounded *up* from the measured ones (7 against 6,57
 * units per character on the rim, 6 against 5,11 elsewhere), so a window sized
 * from them is never too small for what the browser then paints.
 */
export function widthOf(words: string, limit: number, onRim: boolean): number {
	const chars = Math.min(words.length, limit) + (words.length > limit ? 1 : 0);
	return chars * (onRim ? RIM_CHAR : LEAF_CHAR);
}

/**
 * Half the width of the whole drawing, from what this tree could ever show.
 *
 * Every node is asked the worst it could do: on the outermost ring it can ever
 * stand on (its own, or the cap where deeper work folds into a stump), in each
 * of its two label forms, at the angle where that form reaches furthest from
 * the middle. Those are two different angles, and that is the whole of the
 * arithmetic here:
 *
 *  - **Hanging beside its dot**, in its short form, a label reaches furthest at
 *    three o'clock: the dot is a whole radius out and the text runs outward
 *    from there.
 *  - **Centred over its dot**, written out long, it cannot *be* at three
 *    o'clock — `anchorFor` gives up centring long before that and the long form
 *    goes with it. It reaches furthest at the edge of the band where it is still
 *    centred, and there its dot is only `sin 40°` of a radius out (`sin 15°` for
 *    a wedge title).
 *
 * That second bound was missing (BC_E3_S79). The window paid for a long label at
 * three o'clock, which no turn of the wheel can produce, and the label lengths
 * were cut to afford it. Measured over a whole revolution on the demo vault, the
 * furthest any label actually reaches is 239 units — and it stays 239 whether
 * the long forms are allowed 30 characters or 60, because what sets it is a
 * short wedge title hanging off the side.
 *
 * Only the horizontal reach is worked out. The drawing is square about the hub,
 * and the tallest a label can stand is one radius plus its own height — always
 * less than the `LABEL_MARGIN` the floor below keeps past the titles.
 */
export function windowFor(
	tree: WheelTree,
	radius: number,
	deepest: number,
	rings: RingConfig,
): number {
	const titleRadius = radius + BAND_GAP + TITLE_GAP;
	let needed = titleRadius + LABEL_MARGIN;

	for (const node of tree.byId.values()) {
		if (node.depth === 0) continue;
		const words = plainText(node.label);

		// A wedge title sits on the rim, an ordinary node on its ring; both have
		// the same two forms, at their own two angles.
		const reach =
			node.depth === 1
				? Math.max(
						// Centred at the top of the wheel, written out: its dot is at most
						// `sin 15°` of the rim sideways, and the text half its width past
						// that.
						titleRadius * UPRIGHT_SWING +
							widthOf(words, LABEL_CHARS.title, true) / 2,
						// Or swung round to the side, and then it is a short title.
						titleRadius + widthOf(words, LABEL_CHARS.domain, true),
					)
				: reachOf(
						ringRadius(Math.min(node.depth, deepest), rings),
						words,
					);

		// Whole units, so the window stays exactly symmetrical about the middle
		// once it has been through the rounding that writing it out does.
		needed = Math.max(needed, Math.ceil(reach + EDGE_PAD));
	}

	return needed;
}

/**
 * How far from the middle a node on this ring can carry its own name.
 *
 * The gaps are radial — a label is lifted off its dot along the radius — so they
 * ride along with the sine on a centred label and count in full on one that
 * hangs out sideways at three o'clock.
 */
function reachOf(radius: number, words: string): number {
	return Math.max(
		(radius + READING_GAP) * CENTRED_SWING +
			widthOf(words, LABEL_CHARS.reading, false) / 2,
		radius + LABEL_GAP + widthOf(words, LABEL_CHARS.leaf, false),
	);
}
