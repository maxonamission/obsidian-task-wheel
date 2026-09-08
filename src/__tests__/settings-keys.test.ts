import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe as group, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";

/**
 * The tab was rearranged; nothing it stores was (BC_E3_S174).
 *
 * BC_E3_S152 pulled two questions apart — which notes the wheel reads, and what
 * counts as a task inside one — and the group called *Structure* was left
 * mixing them anyway: how the wheel is *drawn* beside who is in the round.
 * Moving rows between groups is a change to the reading order and to nothing
 * else, and an existing `data.json` must not notice. This is the test that says
 * so rather than the commit message.
 */

const source = readFileSync(join(__dirname, "..", "settings.ts"), "utf8");

/**
 * Every settings key the tab names outright.
 *
 * Quoted only. `key: string` in a helper's signature is a type, and a folder
 * row's key is built at runtime from a name handed in — those two lists are
 * pinned by name below instead, which is the honest way to check a key that is
 * never written down in one piece.
 */
const wired = new Set<string>(
	[...source.matchAll(/\bkey: "([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]),
);

/** The keys the folder lists carry, named where those lists are built. */
const listed = new Set<string>(
	[...source.matchAll(/^\t{4}"(includeFolders|excludeFolders)",$/gm)].map((m) => m[1]),
);

group("the settings tab, after the rearrangement", () => {
	it("wires only keys the settings actually have", () => {
		const known = new Set(Object.keys(DEFAULT_SETTINGS));
		const strangers = [...wired].filter((key) => !known.has(key));
		expect(strangers).toEqual([]);
	});

	/**
	 * The rows that moved, named one by one.
	 *
	 * A set comparison alone would pass if a key were dropped *and* another
	 * added; these are the three the story touched, so they are pinned by name.
	 */
	it("keeps the keys of the rows that moved", () => {
		for (const key of ["includeCompleted", "useHeadingsAsGroups", "excludeNoteTypes"]) {
			expect(wired.has(key), key).toBe(true);
			expect(key in DEFAULT_SETTINGS, key).toBe(true);
		}

		// And the two folder lists, which moved under a heading of their own.
		expect([...listed].sort()).toEqual(["excludeFolders", "includeFolders"]);
	});

	it("no longer has a group mixing the drawing with the round", () => {
		// *Structure* held "Use headings as a grouping ring" beside "Include
		// finished tasks": one about how the wheel looks, one about who is in it.
		expect(source).not.toContain('heading: "Structure"');
		expect(source).toContain('heading: "Finished work"');
	});

	/**
	 * And the two halves of "when is something finished" are neighbours.
	 *
	 * Nine groups used to stand between them, so a reader who added a word to
	 * the extra list and saw nothing change had to find a switch under a heading
	 * called *Structure*.
	 */
	it("puts the finished switch next to the words that define finished", () => {
		const at = (heading: string): number => source.indexOf(`heading: "${heading}"`);
		const between = source.slice(
			at("Finished work"),
			at("The status of a task document"),
		);
		expect(at("Finished work")).toBeGreaterThan(-1);
		expect(at("The status of a task document")).toBeGreaterThan(at("Finished work"));
		// Nothing but the one group's own rows in between: they are adjacent.
		expect(between.match(/heading: "/g) ?? []).toHaveLength(1);
	});
});
