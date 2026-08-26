/**
 * The two colour channels, and deliberately no third (kaderdocument §3.4).
 *
 *  - **Hue is the domain.** Eight hues, taken straight from the Obsidian theme
 *    variables, so a theme that retunes its palette retunes the wheel with it
 *    and light and dark both work without a second palette of our own.
 *  - **Lightness is the priority.** Every colour is the domain hue mixed
 *    towards the editor background: the highest priority is the pure hue, the
 *    lowest is a whisper of it. Mixing towards the *background* rather than
 *    towards white or black is what makes this read the same way in a dark
 *    theme as in a light one — low priority always means "closer to the page".
 *
 * These are strings, not pixels: the module builds CSS values and stays as
 * headless as the rest of `layout/`.
 */

import { PRIORITY_RANK, type Priority } from "../model/types";

/**
 * The eight hues Obsidian defines as theme variables.
 *
 * Ordered so that the first few domains — the common case — are as far apart
 * as the palette allows, rather than in spectrum order which would hand out
 * red next to orange. Past eight domains the hues repeat; the wedge position
 * is what tells those two apart, and eight is the ceiling the design sets on
 * how many colours a reader can keep straight anyway.
 */
export const DOMAIN_HUES = [
	"blue",
	"orange",
	"green",
	"purple",
	"red",
	"cyan",
	"yellow",
	"pink",
] as const;

export const MAX_HUES = DOMAIN_HUES.length;

/** Priorities from most to least urgent, for a legend or a ramp. */
export const PRIORITY_LADDER: Priority[] = (
	Object.keys(PRIORITY_RANK) as Priority[]
).sort((a, b) => PRIORITY_RANK[b] - PRIORITY_RANK[a]);

/**
 * How much pure hue survives the mix, per priority, as a percentage.
 *
 * `normal` — the absence of a priority marker, and so most of the wheel — sits
 * in the middle, which leaves room to read both "more urgent than usual" and
 * "explicitly parked" against it.
 */
const PRIORITY_STRENGTH: Readonly<Record<Priority, number>> = {
	highest: 100,
	high: 86,
	medium: 72,
	normal: 58,
	low: 44,
	lowest: 32,
};

/** The domain's hue as a bare CSS value. */
export function domainColour(domainIndex: number): string {
	const hue = DOMAIN_HUES[((domainIndex % MAX_HUES) + MAX_HUES) % MAX_HUES];
	return `var(--color-${hue})`;
}

export function priorityStrength(priority: Priority): number {
	return PRIORITY_STRENGTH[priority];
}

/** Both channels at once: the colour a node is actually drawn in. */
export function nodeColour(domainIndex: number, priority: Priority): string {
	return mixed(domainColour(domainIndex), PRIORITY_STRENGTH[priority]);
}

/**
 * The colour a branch is drawn in: the domain hue, well faded.
 *
 * Branches carry structure, not urgency. Giving them the priority channel too
 * would let a single urgent leaf shout down the whole limb it hangs from.
 */
export function branchColour(domainIndex: number): string {
	return mixed(domainColour(domainIndex), 34);
}

function mixed(colour: string, strength: number): string {
	if (strength >= 100) return colour;
	return `color-mix(in oklab, ${colour} ${strength}%, var(--background-primary))`;
}
