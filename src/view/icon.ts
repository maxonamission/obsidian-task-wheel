/**
 * One way to put an icon on a control, everywhere in the plugin.
 *
 * The icon always goes into a span of its own, never straight onto the button.
 * That is not a preference — it is the construction that renders, and the
 * other one does not, on at least one device the plugin ships to.
 *
 * The owner's iPad (28 aug 2026, both themes) showed every control on the
 * reading card as an empty box: eight actions and the two nudges, drawn at the
 * right size, holding nothing. In the same screenshot the Filter chip and the
 * scope chip carried their icons perfectly — and those are buttons too. The
 * only difference between them was where the icon went: `setIcon(span)` for
 * the chips, `setIcon(button)` for the card. Ten failures and two successes
 * split exactly along that line, on a screen where the phone showed all
 * twelve, so the split is the finding even though WebKit's reason for it is
 * not ours to see.
 *
 * A rule that lives only in a comment is a rule that comes back. This module
 * is the only place allowed to call `setIcon`, and `dom-usage.test.ts` holds
 * the whole codebase to it — the same guard the repo already keeps over a
 * class attribute carrying two names at once, which cost two rounds of owner
 * testing on Android for the same kind of reason.
 */

import { setIcon } from "obsidian";

/**
 * Add an icon to `parent`, inside a span, and hand the span back.
 *
 * `cls` names the span so the stylesheet can size that icon; several controls
 * want different sizes, and they all reach the icon through their own class.
 */
export function putIcon(
	parent: HTMLElement,
	name: string,
	cls?: string,
): HTMLSpanElement {
	const host = cls === undefined ? parent.createSpan() : parent.createSpan({ cls });
	setIcon(host, name);
	return host;
}
