/**
 * What each card action is called — once, for the three places that say it.
 *
 * The card draws a button with a tooltip, `main.ts` registers a command with a
 * name, and the help panel lists the icons with their names. All three name the
 * same seven actions, and until now all three named them separately: the button
 * said *Mark done*, the command said *Tick off*, and the help said *Tick off*
 * as well but called the next one *Mark in progress* where the command said
 * *Mark as started* (audit BC_E3_S116, bevinding D3).
 *
 * That is not a cosmetic difference. The help panel exists so a reader can find
 * an action and then hang their own key on it, and the way you hang a key on it
 * is by finding it in the command palette *by name*. A help panel that names it
 * one thing and a palette that names it another breaks exactly the step the
 * help was written for.
 *
 * The card is the source of truth here, because it is the surface the reader
 * looks at while reviewing; the help is its legend and the command is how you
 * reach it without the mouse. `action-names.test.ts` holds the three together.
 *
 * Renaming a command does not disturb a key someone already bound: Obsidian
 * binds on the command's id, and the ids are untouched.
 *
 * The translated help says these in its own words, and must — the plugin's UI
 * is English, the help is the one surface that is not (BC_E3_S110). The test
 * checks the English filling, which is the one a palette lookup lands on.
 */
export const ACTION_NAMES = {
	done: "Mark done",
	start: "Mark in progress",
	cancel: "Cancel",
	defer: "Push a week out",
	raise: "Raise priority",
	lower: "Lower priority",
	openNote: "Open the note",
} as const;

/** The button that says the opposite, for the two statuses that toggle. */
export const ACTION_UNDO = {
	start: "No longer in progress",
	cancel: "Bring back",
} as const;
