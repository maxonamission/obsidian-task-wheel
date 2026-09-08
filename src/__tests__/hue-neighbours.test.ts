import { describe, expect, it } from "vitest";
import { assignBudgets } from "../layout/budgets";
import { domainColour, hueIndex, paletteOf } from "../layout/colour";

/**
 * No two wedges side by side in the same colour (BC_E3_S180).
 *
 * Position was the hue, and past the end of a palette the hues started over —
 * with the wedge position offered as what tells two of the same colour apart.
 * That holds for every pair except the one it has to: on a circle the last
 * wedge sits beside the first. Measured 8 sep 2026 on the owner's vault, six
 * hues and seven wedges, wedges 7 and 1 both blue and next to each other.
 */

const names = (n: number): string[] =>
	Array.from({ length: n }, (_, i) => `domein-${i + 1}`);

/** The colours of a wheel of `n` wedges, in wedge order. */
const wheelOf = (n: number, palette: readonly string[]): string[] =>
	assignBudgets(names(n), {}, undefined, palette.length)
		.sort((a, b) => a.index - b.index)
		.map((budget) => domainColour(budget.hue, palette));

/** Every pair that actually touches, the circle's own seam included. */
const neighbours = (colours: readonly string[]): Array<[number, number]> => {
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i < colours.length; i++) {
		const next = (i + 1) % colours.length;
		if (colours.length > 1 && colours[i] === colours[next]) pairs.push([i + 1, next + 1]);
	}
	return pairs;
};

describe("the hue a wedge is handed", () => {
	it("is the position while the palette still has hues left", () => {
		expect(hueIndex(0, 6, 6)).toBe(0);
		expect(hueIndex(5, 6, 6)).toBe(5);
		expect(hueIndex(3, 4, 8)).toBe(3);
	});

	it("steps the last wedge on when it would land beside its own colour", () => {
		// Seven wedges, six hues: the seventh would be hue 0, and hue 0 is the
		// first wedge, right next to it.
		expect(hueIndex(6, 7, 6)).toBe(1);
		// Everything before it is untouched.
		expect(hueIndex(0, 7, 6)).toBe(0);
		expect(hueIndex(5, 7, 6)).toBe(5);
	});

	it("leaves a repeat alone that does not land next to itself", () => {
		// Eight wedges, six hues: wedge 7 repeats hue 0 and wedge 8 hue 1, and
		// neither sits beside its twin. Position is what tells those apart, and
		// that argument does hold here.
		expect(hueIndex(6, 8, 6)).toBe(6);
		expect(hueIndex(7, 8, 6)).toBe(7);
	});

	it("gives up rather than guess with fewer than three hues", () => {
		// With two hues there is no third colour to step to, so there is nothing
		// honest to hand back but the position.
		expect(hueIndex(2, 3, 2)).toBe(2);
	});
});

describe("a whole wheel, in both palettes", () => {
	const cases = [
		["colour-blind", 7, "the owner's own wheel"],
		["colour-blind", 13, "one turn further round"],
		["theme", 9, "the same seam, eight hues"],
		["theme", 17, "and one turn further"],
	] as const;

	for (const [name, count, why] of cases) {
		it(`has no two neighbours alike: ${name}, ${count} wedges (${why})`, () => {
			expect(neighbours(wheelOf(count, paletteOf(name)))).toEqual([]);
		});
	}

	/**
	 * Not only the counts that used to break: every count either palette can
	 * meet, so a change to the rule cannot quietly reintroduce a seam somewhere
	 * further along.
	 */
	it("has no two neighbours alike at any count at all", () => {
		const offenders: string[] = [];
		for (const name of ["theme", "colour-blind"] as const) {
			const palette = paletteOf(name);
			for (let n = 1; n <= 40; n++) {
				const bad = neighbours(wheelOf(n, palette));
				if (bad.length > 0) {
					offenders.push(`${name} @ ${n}: ${bad.map((p) => p.join("~")).join(",")}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("still hands the first wedges the palette in its own order", () => {
		// The fix must not reshuffle a wheel that was never in trouble: the
		// reader learns a wedge by its colour, and six domains looked right.
		const six = wheelOf(6, paletteOf("colour-blind"));
		const seven = wheelOf(7, paletteOf("colour-blind"));
		expect(seven.slice(0, 6)).toEqual(six);
	});
});
