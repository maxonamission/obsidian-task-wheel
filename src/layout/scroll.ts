/**
 * What one turn of a mouse wheel means for the task wheel.
 *
 * A scroll wheel does not report notches, it reports *distance* — and how much
 * distance one notch is worth is a system-wide setting made for documents,
 * where three lines per notch is brisk reading. Windows sends 100 pixels for a
 * notch by default and several hundred when the reader has asked for faster
 * scrolling; Firefox sends lines instead of pixels. Dividing that by a step
 * size meant several stops per notch, and the wheel jumped past tasks: three
 * or seven at a time, which is exactly how you lose your place in a round
 * (eigenaar, 27 aug 2026).
 *
 * So the arithmetic here holds one invariant: **one event moves at most one
 * stop**. A wheel with detents that skips two of them when you click it once
 * is not a wheel with detents. Spinning faster still travels faster — a fast
 * spin is many events — but nothing is ever passed unseen, which is the
 * promise the whole round rests on (kaderdocument §3.3, §5).
 *
 * Pure on purpose, like `momentum.ts`: input arithmetic that can only be
 * checked by scrolling at a screen does not get checked.
 */

/** How much banked travel a stop costs, in pixels. */
export const WHEEL_STEP = 42;

export interface ScrollTurn {
	/** Stops to move: -1, 0 or 1. Never more, whatever the system sends. */
	steps: number;
	/** Travel to carry into the next event, in pixels, signed. */
	travel: number;
}

/**
 * Pixels for one wheel event, whichever unit it chose to speak in.
 *
 * `deltaMode` 1 is lines and 2 is pages; the numbers are the conventional
 * stand-ins browsers themselves use. The exact figures matter little now that
 * a fat event can no longer buy more than one stop — but the sign and the
 * rough size still decide when a trackpad's fine travel adds up.
 */
export function pixelsOf(delta: number, deltaMode: number): number {
	if (deltaMode === 1) return delta * 16;
	if (deltaMode === 2) return delta * 200;
	return delta;
}

/**
 * Bank this event's travel and say whether it buys a stop.
 *
 * Three rules, and each one is there for a reader who lost their place:
 *
 *  - **At most one stop per event.** The system's idea of "a notch" is not
 *    ours; what it buys here is one item, whether it sent 40 pixels or 400.
 *  - **A reversal spends nothing it banked going the other way.** Turning
 *    back has to answer at once — it is what you do the moment you realise
 *    you have gone one too far.
 *  - **A stop clears the bank.** Keeping the remainder is what let one fat
 *    notch spend as several stops, one event after another.
 *
 * A trackpad is unaffected by all three: its travel arrives in small pieces
 * that add up to a stop and then start again, which is the same smooth
 * behaviour it always had.
 */
export function scrollTurn(
	travel: number,
	delta: number,
	step: number = WHEEL_STEP,
): ScrollTurn {
	if (delta === 0 || !Number.isFinite(delta)) return { steps: 0, travel };

	const banked = Math.sign(delta) === Math.sign(travel) ? travel : 0;
	const total = banked + delta;

	if (Math.abs(total) < step) return { steps: 0, travel: total };
	return { steps: Math.sign(total), travel: 0 };
}
