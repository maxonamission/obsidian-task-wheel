/**
 * What a key means in a box you are typing in (BC_E3_S182).
 *
 * Two keys, one meaning each, and the meaning is about *leaving*: Enter applies
 * what you typed and hands the wheel back, Escape hands it back without
 * applying. Everything else is a character.
 *
 * Its own module because the filter panel has six boxes and only the search box
 * knew this. Enter in the other five did what the browser does in a text input
 * outside a form — measured in Chromium, 8 sep 2026: the `change` event fires,
 * so the filter *was* applied, and the cursor stays where it was. So the round
 * narrowed under the reader's hands while they were still standing in the box,
 * reaching for the mouse to get out (eigenaarsmelding 8 sep 2026). BC_E3_S121
 * wrote down the reason for the one box that had it: *"a search box you cannot
 * leave without reaching for the mouse."* That reason never only applied to
 * that box.
 */
export type BoxAction = "submit" | "cancel" | "none";

/** Whether this key leaves the box, and on what terms. */
export function boxAction(key: string): BoxAction {
	if (key === "Enter") return "submit";
	if (key === "Escape") return "cancel";
	return "none";
}
