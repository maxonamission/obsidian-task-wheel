/**
 * What a change of pane means for a wheel.
 *
 * Reading a round has one detour in it: you open the note to change something
 * the card cannot, and you come back. Landing where you left rather than where
 * you started is what makes that a detour instead of a restart — so the wheel
 * follows the cursor of the note you were in.
 *
 * The mistake was in *which* note. The wheel used to react to every change of
 * pane by reading the cursor of the first open note in scope, whichever pane
 * that happened to be. On the vault wheel every note is in scope, so any note
 * open anywhere decided where the wheel stood; and a note that was merely
 * opened has its cursor at the top, which resolves to the first task in it.
 * Hence a wheel that kept returning to the same item, whatever the reader did
 * (eigenaar, 24 aug 2026).
 *
 * Three cases, and telling them apart is the whole fix.
 */
export type PaneChange =
	/** Into a note this wheel is about: the start of a detour, so remember it. */
	| { kind: "into"; path: string }
	/** Back to this wheel: the end of one, so land where the cursor was left. */
	| { kind: "back" }
	/** Somewhere else entirely. The wheel has no business moving. */
	| { kind: "away" };

export function paneChange(
	/** Path of the note now in front, or `null` when the new pane is not one. */
	notePath: string | null,
	/** Whether the pane that just became active is this wheel's own. */
	isThisWheel: boolean,
	inThisScope: (path: string) => boolean,
): PaneChange {
	// A note first: a wheel and a note are never the same pane, and asking about
	// the note is what decides whether a detour is even starting.
	if (notePath !== null) {
		return inThisScope(notePath)
			? { kind: "into", path: notePath }
			: { kind: "away" };
	}

	return isThisWheel ? { kind: "back" } : { kind: "away" };
}
