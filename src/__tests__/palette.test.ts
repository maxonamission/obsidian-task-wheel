import { describe, expect, it } from "vitest";
import {
	branchColour,
	DEFAULT_PALETTE,
	DOMAIN_HUES,
	domainColour,
	hueColour,
	nodeColour,
	PALETTES,
	paletteOf,
	paletteSize,
	type PaletteName,
} from "../layout/colour";
import { layoutWheel } from "../layout/radial";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS } from "../model/types";
import { DEFAULT_SETTINGS } from "../settings";
import { VAULT } from "./fixtures/vault";

/**
 * Palettes select from the theme's hues; they never carry colours of their own
 * (BC_E3_S72).
 *
 * That distinction is the whole feature, and it is what these tests are here
 * to hold: a palette that started shipping hex values would keep working and
 * quietly cost the two properties the colour rests on — a theme deciding what
 * "blue" looks like, and one mixing rule instead of a light and a dark one.
 */

const NAMES = Object.keys(PALETTES) as PaletteName[];

describe("what a palette is", () => {
	it("names hues the theme defines, or builds one from those", () => {
		for (const name of NAMES) {
			for (const hue of PALETTES[name]) {
				if (DOMAIN_HUES.includes(hue as (typeof DOMAIN_HUES)[number])) continue;
				// The one exception is allowed to exist, but not to be a colour: it
				// still has to be built out of the theme's own variables.
				expect(hueColour(hue)).toContain("var(--color-");
			}
		}
	});

	it("hands out a theme variable, or a mix of them — never a value", () => {
		// No hex, no rgb(), no named CSS colour: whatever a palette hands out has
		// to still move when the theme moves, which is the whole feature.
		for (const name of NAMES) {
			for (let index = 0; index < 12; index++) {
				const colour = domainColour(index, paletteOf(name));
				expect(colour).toContain("var(--color-");
				expect(colour).not.toMatch(/#[0-9a-f]{3}|rgb|hsl\(/i);
			}
		}
	});

	/**
	 * The promise the colour-blind palette makes, held to the letter (BC_E3_S78).
	 *
	 * It used to name `pink` for its sixth hue, on the reasoning that pink is not
	 * red. Whether that is true is the theme's decision, and the owner's desktop
	 * theme decided it was: the sixth domain came out red on a palette that says
	 * it leaves red out (28 aug 2026). So the test is no longer "does it name red"
	 * but "does anything it hands out reach for red or green, however indirectly".
	 */
	it("keeps red and green out of the colour-blind palette entirely", () => {
		for (let index = 0; index < 12; index++) {
			const colour = domainColour(index, paletteOf("colour-blind"));
			expect(colour).not.toContain("--color-red");
			expect(colour).not.toContain("--color-green");
			// And not pink either, unless it has been pulled off that axis first.
			if (colour.includes("--color-pink")) {
				expect(colour).toContain("color-mix");
			}
		}
	});

	it("names no hue twice", () => {
		for (const name of NAMES) {
			expect(new Set(PALETTES[name]).size).toBe(PALETTES[name].length);
		}
	});

	it("leaves the wheel as it was by default", () => {
		expect(DEFAULT_PALETTE).toBe("theme");
		expect(PALETTES.theme).toEqual(DOMAIN_HUES);
		for (let index = 0; index < 20; index++) {
			expect(domainColour(index)).toBe(domainColour(index, paletteOf("theme")));
		}
	});
});

describe("the colour-blind palette", () => {
	const hues = PALETTES["colour-blind"];

	it("leaves out the pair that collapses", () => {
		// Deuteranopia and protanopia both confuse red against green, and in the
		// default order those sit at positions three and five — close enough
		// that a reader with either gets two domains that look alike.
		expect(hues).not.toContain("red");
		expect(hues).not.toContain("green");
	});

	it("leads with the pair that survives", () => {
		expect(hues.slice(0, 2)).toEqual(["blue", "orange"]);
	});

	it("keeps enough hues to be worth choosing", () => {
		// Fewer than four and the wheel would repeat so fast that hue stops
		// saying anything at all; the answer would then be one hue, not a
		// shorter palette.
		expect(paletteSize("colour-blind")).toBeGreaterThanOrEqual(4);
		expect(paletteSize("colour-blind")).toBeLessThan(paletteSize("theme"));
	});
});

describe("past the end of a palette", () => {
	it("starts over, so no wedge is ever left without a colour", () => {
		for (const name of NAMES) {
			const palette = paletteOf(name);
			const size = paletteSize(name);
			expect(domainColour(size, palette)).toBe(domainColour(0, palette));
			expect(domainColour(size + 1, palette)).toBe(domainColour(1, palette));
			expect(domainColour(size * 3 + 2, palette)).toBe(domainColour(2, palette));
		}
	});

	it("answers for a negative index too, rather than reaching off the end", () => {
		for (const name of NAMES) {
			const palette = paletteOf(name);
			expect(domainColour(-1, palette)).toBe(
				domainColour(paletteSize(name) - 1, palette),
			);
		}
	});

	it("falls back to the theme when handed nothing usable", () => {
		expect(paletteOf(undefined)).toEqual(PALETTES.theme);
		expect(domainColour(3, [])).toBe(domainColour(3, PALETTES.theme));
	});
});

describe("the second channel is untouched by the first", () => {
	it("still mixes the palette's hue towards the background", () => {
		const palette = paletteOf("colour-blind");
		const strong = nodeColour(0, "highest", palette);
		const faint = nodeColour(0, "lowest", palette);

		// The highest priority is the pure hue; everything below it is that same
		// hue mixed towards the page, which is what makes the ladder read the
		// same way in a dark theme as in a light one.
		expect(strong).toBe(domainColour(0, palette));
		expect(faint).toContain("color-mix");
		expect(faint).toContain(domainColour(0, palette));
		expect(faint).toContain("var(--background-primary)");
	});

	it("fades a branch by the same rule, in every palette", () => {
		for (const name of NAMES) {
			const palette = paletteOf(name);
			expect(branchColour(1, palette)).toContain(domainColour(1, palette));
		}
	});
});

describe("from the setting to the drawing", () => {
	it("travels on the layout, so the renderer reads one decision", () => {
		const tree = buildTree(VAULT, { ...DEFAULT_PARSE_OPTIONS });

		for (const name of NAMES) {
			const layout = layoutWheel(tree, { palette: paletteOf(name) });
			expect(layout.palette).toEqual(PALETTES[name]);

			// And every wedge on that drawing is coloured from it.
			for (const budget of layout.budgets) {
				expect(branchColour(budget.index, layout.palette)).toContain(
					domainColour(budget.index, paletteOf(name)),
				);
			}
		}
	});

	it("draws the theme's hues when nothing was chosen", () => {
		const tree = buildTree(VAULT, { ...DEFAULT_PARSE_OPTIONS });
		expect(layoutWheel(tree, {}).palette).toEqual(PALETTES.theme);
	});

	it("is offered as a setting, with its size on the label", () => {
		// The count is the visible half of the trade: fewer hues repeat sooner.
		for (const name of NAMES) {
			expect(String(paletteSize(name))).not.toBe("");
			expect(paletteSize(name)).toBe(PALETTES[name].length);
		}
		expect(DEFAULT_SETTINGS.wedgePalette).toBe(DEFAULT_PALETTE);
	});
});
