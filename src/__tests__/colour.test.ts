import { describe, expect, it } from "vitest";
import {
	branchColour,
	domainColour,
	DOMAIN_HUES,
	MAX_HUES,
	nodeColour,
	PRIORITY_LADDER,
	priorityStrength,
} from "../layout/colour";
import { PRIORITY_RANK, type Priority } from "../model/types";

describe("channel one — hue is the domain", () => {
	it("offers at most eight distinguishable hues", () => {
		expect(MAX_HUES).toBe(8);
		expect(new Set(DOMAIN_HUES).size).toBe(8);
	});

	it("takes every hue from a theme variable", () => {
		for (let index = 0; index < MAX_HUES; index++) {
			expect(domainColour(index)).toMatch(/^var\(--color-[a-z]+\)$/);
		}
	});

	it("gives the first eight domains eight different hues", () => {
		const hues = Array.from({ length: MAX_HUES }, (_, i) => domainColour(i));
		expect(new Set(hues).size).toBe(MAX_HUES);
	});

	it("cycles rather than running out", () => {
		expect(domainColour(MAX_HUES)).toBe(domainColour(0));
		expect(domainColour(-1)).toBe(domainColour(MAX_HUES - 1));
	});
});

describe("channel two — lightness is the priority", () => {
	it("ranks the ladder from most to least urgent", () => {
		expect(PRIORITY_LADDER[0]).toBe("highest");
		expect(PRIORITY_LADDER[PRIORITY_LADDER.length - 1]).toBe("lowest");
		expect(PRIORITY_LADDER.length).toBe(Object.keys(PRIORITY_RANK).length);
	});

	it("fades monotonically down the ladder", () => {
		for (let i = 1; i < PRIORITY_LADDER.length; i++) {
			expect(priorityStrength(PRIORITY_LADDER[i])).toBeLessThan(
				priorityStrength(PRIORITY_LADDER[i - 1]),
			);
		}
	});

	it("mixes towards the theme background, not towards white", () => {
		const colour = nodeColour(0, "low");
		expect(colour).toContain("color-mix(in oklab");
		expect(colour).toContain("var(--color-blue)");
		expect(colour).toContain("var(--background-primary)");
	});

	it("leaves the top of the ladder as the pure hue", () => {
		expect(nodeColour(2, "highest")).toBe(domainColour(2));
	});

	it("keeps the two channels independent", () => {
		const priorities: Priority[] = ["highest", "normal", "lowest"];
		const seen = new Set<string>();
		for (let index = 0; index < 3; index++) {
			for (const priority of priorities) seen.add(nodeColour(index, priority));
		}
		expect(seen.size).toBe(9);
	});
});

describe("branches", () => {
	it("carry the domain but not the priority", () => {
		expect(branchColour(1)).toContain("var(--color-orange)");
		expect(branchColour(1)).toBe(branchColour(1));
	});
});
