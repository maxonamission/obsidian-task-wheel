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

import { ringRadius, type RingConfig } from "./geometry";
import { LEAF_CHAR, RIM_CHAR } from "./labels";
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
 * `reading` is the branch you are on — the focus and the containers between it
 * and the hub. Those get more than twice the room of an ordinary label, because
 * they are what the drawing is being asked about; the rest stay short so the
 * wheel keeps reading as a shape rather than as a list (owner, 19 aug 2026).
 */
export const LABEL_CHARS = { domain: 11, leaf: 14, reading: 30 } as const;

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
 * Every node is asked the worst it could do: swung round to three o'clock, on
 * the outermost ring it can ever stand on (its own, or the cap where deeper
 * work folds into a stump), with its longest label form. A name is written out
 * at reading length only on the branch being read, and there it is centred
 * over its own dot — so it reaches out half its width, where a label hanging
 * beside its dot reaches out all of it. The bigger of the two is what the node
 * can cost.
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

		// A wedge title is never centred and never written out long. Every other
		// node may be either, depending on where the reader stands.
		const reach =
			node.depth === 1
				? titleRadius + widthOf(words, LABEL_CHARS.domain, true)
				: ringRadius(Math.min(node.depth, deepest), rings) +
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
