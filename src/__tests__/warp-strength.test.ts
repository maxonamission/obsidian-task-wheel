import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";
import { VAULT } from "./fixtures/vault";

/**
 * The magnifier keeps its strength wherever the reader stands (BC_E3_S155).
 *
 * `warp.ts` says the strength is worked out "once per layout, not per turn:
 * it is a property of what is on the wheel, and a magnifier whose strength
 * changed as you turned would be the shuffling all over again". It was fed the
 * items that happened to be drawn, and *which* items those are does depend on
 * where the reader is standing — so the strength moved with them.
 *
 * Measured on this fixture before the fix: 0,519 at rest, 0,487 with the focus
 * in one note and 0,961 in another. Nearly double, on the same wheel.
 */

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeFolders: ["Archief"],
};

/** The vault with a pile of extra tasks in one domain — a crowded wheel. */
const BUSIER: NoteInput[] = [
	...VAULT,
	{
		path: "Werk/Nog veel meer.md",
		content: Array.from(
			{ length: 40 },
			(_, index) => `- [ ] Extra taak ${index + 1}`,
		).join("\n"),
	},
];

describe("how strong the magnifier is", () => {
	const tree = buildTree(BUSIER, OPTIONS);
	const atRest = layoutWheel(tree, {});

	it("is the same on every stop of the wheel", () => {
		const seen = new Set<number>();
		for (const id of atRest.order) {
			seen.add(layoutWheel(tree, { focusId: id }).warp.strength);
		}

		// Every stop, one answer — and it is the answer the wheel has at rest.
		expect([...seen]).toEqual([atRest.warp.strength]);
	});

	it("still magnifies a crowded wheel at all", () => {
		// A guard against fixing this by turning the glass off: the fixture is
		// crowded on purpose and wants magnifying.
		expect(atRest.warp.strength).toBeGreaterThan(0);
	});

	it("leaves a wheel with room to spare alone", () => {
		// The other half of the promise: no glass where none is needed.
		const roomy = layoutWheel(buildTree(VAULT, OPTIONS), {});
		expect(roomy.warp.strength).toBe(0);
	});

	/**
	 * Folding is not standing somewhere: it changes what the wheel draws for
	 * everyone, so the strength may follow it. This says the fix did not go so
	 * far as to freeze the glass against the drawing itself.
	 *
	 * `Werk` is the crowded wedge — the forty extra tasks are in it. Folding it
	 * away leaves a wheel with room to spare, and a wheel with room to spare
	 * wants no magnifying at all. Measured: 0,519 → 0.
	 */
	it("does follow a change to what the wheel draws", () => {
		const crowded = atRest.order.find(
			(id) =>
				atRest.byId.get(id)?.depth === 1 &&
				atRest.byId.get(id)?.node.label === "Werk",
		);
		expect(crowded).toBeDefined();

		const folded = layoutWheel(tree, {
			collapsed: new Set([crowded as string]),
		});
		expect(folded.warp.strength).toBe(0);
	});

	/**
	 * And the other way about: folding a *quiet* wedge leaves it alone. Three
	 * items out of forty-six do not move the median, and a glass that twitched
	 * at every small change would be its own kind of restlessness.
	 */
	it("is not moved by a fold that changes nothing much", () => {
		const quiet = atRest.order.find(
			(id) =>
				atRest.byId.get(id)?.depth === 1 &&
				atRest.byId.get(id)?.node.label === "Gezin",
		);
		expect(quiet).toBeDefined();

		const folded = layoutWheel(tree, { collapsed: new Set([quiet as string]) });
		expect(folded.warp.strength).toBe(atRest.warp.strength);
	});
});
