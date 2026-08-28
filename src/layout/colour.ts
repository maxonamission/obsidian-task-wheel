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

/**
 * A palette is a **selection and ordering of the theme's own hues**, and
 * never a set of colour values of its own (BC_E3_S72).
 *
 * That is the whole design, and it is what lets the wheel be recoloured
 * without giving up either property the colour rests on: a theme still
 * decides what "blue" looks like, so retuning the theme retunes the wheel;
 * and every colour is still one hue mixed towards the background, so there is
 * one rule instead of a light and a dark variant. A palette carrying its own
 * values would have cost both.
 *
 * Past the end of a palette the hues repeat, exactly as they always did past
 * eight — the wedge position is the disambiguator. A shorter palette repeats
 * sooner, and that is the trade the reader makes when choosing fewer, better
 * separated colours; the settings tab says how many hues each one holds so
 * the trade is visible at the moment of choosing.
 */
export const PALETTES = {
	/** Every hue the theme offers. The wheel as it has always looked. */
	theme: DOMAIN_HUES,

	/**
	 * Red and green taken out — they are the pair that collapses.
	 *
	 * Deuteranopia and protanopia together account for nearly all colour
	 * blindness, and both confuse exactly the red/green axis. In the default
	 * order those two sit at positions five and three, so a reader with either
	 * gets a hue channel that is partly silent: two domains that look alike
	 * with nothing but position to separate them.
	 *
	 * Dropping them costs nothing the wheel needs. Hue here means *which
	 * domain*, never *how urgent* — urgency is the lightness channel — so red
	 * carries no meaning that has to survive. What is left leads with
	 * blue/orange, the strongest pair that stays distinct under both.
	 *
	 * It is not a guarantee and is not offered as one: the values come from
	 * the theme, so this is only as separable as that theme's own blue and
	 * orange. It does little for tritanopia, which confuses blue and yellow
	 * and is rare enough that designing around it would cost the common case.
	 */
	"colour-blind": ["blue", "orange", "purple", "yellow", "cyan", "pink"],
} as const satisfies Record<string, readonly string[]>;

export type PaletteName = keyof typeof PALETTES;

/** The hues a palette hands out, in order. */
export type Palette = readonly string[];

export const DEFAULT_PALETTE: PaletteName = "theme";

/** How many hues a palette holds — what the settings tab shows. */
export function paletteSize(name: PaletteName): number {
	return PALETTES[name].length;
}

/** The hues themselves, falling back to the theme's full set. */
export function paletteOf(name: PaletteName | undefined): Palette {
	return PALETTES[name ?? DEFAULT_PALETTE] ?? PALETTES[DEFAULT_PALETTE];
}

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

/**
 * The domain's hue as a bare CSS value.
 *
 * The palette defaults to the theme's full set, so every caller that does not
 * care about palettes — the legend's priority ramp, the help panel's ladder —
 * reads exactly as it did before.
 */
export function domainColour(
	domainIndex: number,
	palette: Palette = PALETTES[DEFAULT_PALETTE],
): string {
	const hues = palette.length > 0 ? palette : PALETTES[DEFAULT_PALETTE];
	const hue = hues[((domainIndex % hues.length) + hues.length) % hues.length];
	return `var(--color-${hue})`;
}

export function priorityStrength(priority: Priority): number {
	return PRIORITY_STRENGTH[priority];
}

/** Both channels at once: the colour a node is actually drawn in. */
export function nodeColour(
	domainIndex: number,
	priority: Priority,
	palette?: Palette,
): string {
	return mixed(domainColour(domainIndex, palette), PRIORITY_STRENGTH[priority]);
}

/**
 * The colour a branch is drawn in: the domain hue, well faded.
 *
 * Branches carry structure, not urgency. Giving them the priority channel too
 * would let a single urgent leaf shout down the whole limb it hangs from.
 */
export function branchColour(domainIndex: number, palette?: Palette): string {
	return mixed(domainColour(domainIndex, palette), 34);
}

function mixed(colour: string, strength: number): string {
	if (strength >= 100) return colour;
	return `color-mix(in oklab, ${colour} ${strength}%, var(--background-primary))`;
}
