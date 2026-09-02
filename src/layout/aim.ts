/**
 * What a tap meant: the nearest thing you could have been aiming at
 * (BC_E3_S117).
 *
 * A node is drawn as two things — a dot and, when there is room, the word
 * beside it — and only one of them was ever a target. The dot carries an
 * invisible disc, because the dots out on the crowded rings are two pixels
 * across. The word carried nothing: SVG text takes a tap only where a glyph is
 * painted, so between the letters a tap falls straight through.
 *
 * That would be a small unfairness if the word sat on its dot. It does not: a
 * label hangs `READING_GAP` (11) units outward, and the tap disc is 11 units
 * across, so **the word begins exactly where its own node stops being
 * tappable** — and it points at the next ring out, 20 to 24 units away, where
 * the children are. Tapping the word you are reading therefore lands in a
 * child's disc, or in nothing at all (eigenaar, 2 sep 2026, on a phone: aiming
 * at a heading moved the wheel to a task under it).
 *
 * So the rule is not "what did the finger land on" but "what was it nearest
 * to", counting the word as part of the node — because the word is what a
 * reader aims at. Distance to the box, nought inside it; a tie goes to whoever
 * is nearest the middle of that box, which is what lets a tap right on a
 * child's dot beat the parent's word lying across it.
 *
 * Pure, and in `layout/` rather than the view, because it is the whole of the
 * rule. The view's share is measuring rectangles, which no test can do.
 */

/** A rectangle on screen, as `getBoundingClientRect` reports one. */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** One item, and everything drawn for it that may be aimed at. */
export interface Target {
	id: string;
	boxes: readonly Box[];
}

/**
 * How far off a tap may be and still name something, in pixels.
 *
 * Beyond this it names nothing, and the wheel does what it does with a tap on
 * empty canvas: nothing at all. Roughly a finger's width from the edge of the
 * word or the dot — near enough to be a miss worth honouring, far enough from
 * "somewhere on this side of the wheel".
 */
export const AIM_REACH = 16;

interface Score {
	/** Distance to the nearest box, nought when inside one. */
	edge: number;
	/** Distance to the middle of that box, which settles a tie. */
	middle: number;
}

/** Ties within this many pixels are not really ties in the reader's hand. */
const EPSILON = 0.5;

export function aimedAt(
	at: { x: number; y: number },
	targets: readonly Target[],
	reach: number = AIM_REACH,
): string | null {
	let best: string | null = null;
	let bestScore: Score | null = null;

	for (const target of targets) {
		const score = scoreOf(at, target.boxes);
		if (score === null || score.edge > reach) continue;

		if (bestScore === null || better(score, bestScore)) {
			best = target.id;
			bestScore = score;
		}
	}

	return best;
}

/** Strictly better: nearer the shape, or as near and nearer its middle. */
function better(score: Score, than: Score): boolean {
	if (score.edge < than.edge - EPSILON) return true;
	if (score.edge > than.edge - EPSILON && score.edge < than.edge + EPSILON) {
		return score.middle < than.middle;
	}
	return false;
}

function scoreOf(
	at: { x: number; y: number },
	boxes: readonly Box[],
): Score | null {
	let best: Score | null = null;

	for (const box of boxes) {
		// Nought inside the box; otherwise how far outside it the point fell,
		// measured to the nearest edge or corner.
		const dx = Math.max(box.left - at.x, 0, at.x - box.right);
		const dy = Math.max(box.top - at.y, 0, at.y - box.bottom);
		const edge = Math.hypot(dx, dy);
		const middle = Math.hypot(
			(box.left + box.right) / 2 - at.x,
			(box.top + box.bottom) / 2 - at.y,
		);

		if (best === null || better({ edge, middle }, best)) best = { edge, middle };
	}

	return best;
}
