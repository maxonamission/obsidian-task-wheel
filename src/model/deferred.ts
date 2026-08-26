/**
 * Writing plugin state to disk, but not on every keystroke of a gesture.
 *
 * `saveData` serialises *all* the settings, and the biggest thing in them is
 * the round: which items have been seen, per blikveld. On a full vault that is
 * hundreds of kilobytes of JSON — and it was written on **every stop the wheel
 * came to rest on and every frame of a pinch** (measured 23 aug 2026: ±463 KB
 * per write). On a phone that is felt I/O and battery, and a crash halfway
 * through a write is the one way this plugin's own file can end up broken.
 *
 * So the asking and the writing are separated: everything that changes state
 * asks, and the asks are collected. Deliberately **not** a cleverer file format
 * or a smaller state — a hundred asks in one second is one write's worth of
 * news, and the fix belongs at that level rather than in what gets written.
 *
 * Pure so the collecting can be tested with a clock that never ticks, which is
 * the only way to be sure of "asked ten times, wrote once".
 */

/** What a state change asks for, and what shutdown asks for. */
export interface Deferred {
	/**
	 * Something changed; write it before long.
	 *
	 * Each ask pushes the write back, so a gesture that asks sixty times a
	 * second costs one write once it ends rather than sixty during. A gesture
	 * always ends, which is why a pause is the right trigger and there is no
	 * ceiling on the waiting.
	 */
	soon(): void;
	/**
	 * Write what is owed now, and wait for it.
	 *
	 * For closing down, where "before long" never arrives. Costs nothing when
	 * nothing is owed, so it is safe to call on every close.
	 */
	now(): Promise<void>;
	/** Whether a write is owed. For tests and diagnostics, not for deciding. */
	owed(): boolean;
}

/**
 * Start a timer, and hand back the way to stop it.
 *
 * Passed in rather than taken from the host: this file is about *when* to
 * write, and a rule about when has no business knowing which window it is in.
 * A test can then move time by hand, which is the only way to count writes.
 */
export type Schedule = (run: () => void, after: number) => () => void;

export interface Collecting {
	/** How long a change waits for the ones behind it. */
	wait: number;
	schedule: Schedule;
	/** Where a failed write is reported. */
	onFail?: (error: unknown) => void;
}

export function deferWrites(
	write: () => Promise<void>,
	how: Collecting,
): Deferred {
	const onFail =
		how.onFail ??
		((error: unknown) =>
			console.error("Task Wheel: could not save plugin state", error));

	let cancel: (() => void) | null = null;
	let owed = false;

	// Writes are chained rather than started side by side: two `saveData` calls
	// overlapping is the one way the file could be written half from one state
	// and half from another. A failure is reported and swallowed here — one
	// unlucky write must not stop every later one from being attempted.
	let queue: Promise<void> = Promise.resolve();

	const flush = (): Promise<void> => {
		if (cancel !== null) {
			cancel();
			cancel = null;
		}
		if (!owed) return queue;

		owed = false;
		queue = queue.then(write).catch(onFail);
		return queue;
	};

	return {
		soon(): void {
			owed = true;
			cancel?.();
			cancel = how.schedule(() => {
				cancel = null;
				void flush();
			}, how.wait);
		},
		now: flush,
		owed: () => owed,
	};
}
