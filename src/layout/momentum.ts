/**
 * How far a flick would have carried the wheel.
 *
 * The design allows momentum but forbids free spinning: the wheel always comes
 * to rest on a stop (kaderdocument §5). This module is the whole of the
 * momentum, and note what it does *not* do — nothing here animates. It turns a
 * stream of pointer samples into one number, and that number is only used to
 * decide which stop is the nearest one. The travelling is done by the snap.
 *
 * Pure on purpose: it is the one piece of physics in the plugin, and physics
 * that can only be checked by flicking at a screen does not get checked.
 */

export interface TravelSample {
	/** Milliseconds on any single monotonic clock. */
	time: number;
	/** Angle travelled since the grab, unwrapped, in degrees. */
	angle: number;
}

export interface CoastOptions {
	/** How many milliseconds of travel the flick is projected forward. */
	projectMs: number;
	/** The furthest a flick may ever throw the wheel, in degrees. */
	maxDegrees: number;
}

/**
 * A quarter turn at most. This is a review instrument: travelling far in one
 * gesture is not the point, so the cap is deliberately short.
 */
export const DEFAULT_COAST: CoastOptions = {
	projectMs: 90,
	maxDegrees: 90,
};

export function coastFrom(
	samples: readonly TravelSample[],
	options: CoastOptions = DEFAULT_COAST,
): number {
	if (samples.length < 2) return 0;

	const first = samples[0];
	const last = samples[samples.length - 1];
	const elapsed = last.time - first.time;

	// Samples that share a timestamp say nothing about speed. Dividing by that
	// would turn a slow, careful drag into a wild throw.
	if (elapsed <= 0) return 0;

	const velocity = (last.angle - first.angle) / elapsed;
	const projected = velocity * options.projectMs;
	return Math.min(Math.max(projected, -options.maxDegrees), options.maxDegrees);
}

/* ------------------------------------------------------------------ */
/* the snap                                                            */
/* ------------------------------------------------------------------ */

export interface SnapOptions {
	/** Degrees per millisecond the snap aims for. */
	speed: number;
	/** Shortest and longest a snap may take, in milliseconds. */
	minMs: number;
	maxMs: number;
}

export const DEFAULT_SNAP: SnapOptions = {
	speed: 0.5,
	minMs: 110,
	maxMs: 420,
};

/**
 * How long to take over a snap of this size.
 *
 * Proportional to the distance so a step to the next item is not given the
 * same ceremony as half a turn, but bounded at both ends: below the floor the
 * movement is too quick to follow, above the ceiling it is a wait.
 */
export function snapDuration(
	distance: number,
	options: SnapOptions = DEFAULT_SNAP,
): number {
	const wanted = Math.abs(distance) / options.speed;
	return Math.min(Math.max(wanted, options.minMs), options.maxMs);
}

/** Ease out cubic: quick off the mark, gentle into the stop. */
export function easeOut(progress: number): number {
	const t = Math.min(Math.max(progress, 0), 1);
	return 1 - Math.pow(1 - t, 3);
}

/**
 * Where a snap is at this point in its run.
 *
 * At `progress` 1 this returns `to` **exactly**, not something within a
 * rounding error of it. That is the whole requirement: a wheel that stopped a
 * hundredth of a degree off its detent every time would drift, and "all the
 * way round" would stop being countable.
 */
export function tweenAt(from: number, to: number, progress: number): number {
	if (progress >= 1) return to;
	if (progress <= 0) return from;
	return from + (to - from) * easeOut(progress);
}
