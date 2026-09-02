import { describe, expect, it } from "vitest";
import { readScope } from "../view/wheel-view";
import { scopeKey, VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * Finding the wheel that is already open (BC_E3_S75).
 *
 * The reuse was written against `leaf.view instanceof TaskWheelView`, and
 * since Obsidian 1.7 a tab you have not touched is *deferred*: the leaf is
 * there, its state is there, and its `view` is a placeholder. So the test
 * failed on exactly the tabs that had been sitting untouched — most of them,
 * after a restart — and every miss opened a duplicate. That is the half of
 * "it does not always reuse" that was a bug rather than a design decision
 * (eigenaar, 28 aug 2026).
 *
 * The answer is to ask the leaf's stored state instead, which is there
 * whether or not the view is. These tests hold `readScope` to being able to
 * answer that question for every shape of state a leaf can be carrying.
 */

/** What Obsidian hands back from `leaf.getViewState().state`. */
function stateFor(scope: WheelScope): unknown {
	return JSON.parse(JSON.stringify({ scope }));
}

/** The reuse test as `wheelLeafFor` makes it, over a leaf's stored state. */
function keyOf(state: unknown): string {
	return scopeKey(readScope(state) ?? VAULT_SCOPE);
}

const SCOPES: WheelScope[] = [
	VAULT_SCOPE,
	{ kind: "folder", path: "Werk" },
	{ kind: "folder", path: "Werk/Northwind" },
	{ kind: "note", path: "Werk/Plan.md" },
	{ kind: "section", path: "Werk/Plan.md", heading: ["Northwind"] },
	{ kind: "section", path: "Werk/Plan.md", heading: ["Northwind", "Roadmap"] },
];

describe("a leaf's stored state names its blikveld", () => {
	it("survives the round trip Obsidian puts it through", () => {
		// The workspace file is JSON, so whatever comes back has been through
		// `JSON.stringify` — which is why the test asks its questions of a
		// parsed copy rather than of the object we happen to be holding.
		for (const scope of SCOPES) {
			expect(keyOf(stateFor(scope))).toBe(scopeKey(scope));
		}
	});

	it("tells every blikveld apart, including neighbours", () => {
		const keys = SCOPES.map((scope) => keyOf(stateFor(scope)));
		expect(new Set(keys).size).toBe(SCOPES.length);
	});

	it("reads a wheel over the whole vault, which is opened without state", () => {
		// `activateView` sets no state at all, so a leaf with nothing in it is
		// the vault wheel — and must be found as such, or the ribbon opens a
		// second one every time.
		expect(keyOf(undefined)).toBe(scopeKey(VAULT_SCOPE));
		expect(keyOf({})).toBe(scopeKey(VAULT_SCOPE));
		expect(keyOf({ scope: null })).toBe(scopeKey(VAULT_SCOPE));
	});

	it("does not mistake a damaged state for a real blikveld", () => {
		// Anything it cannot read falls back to the vault rather than inventing
		// a scope: a wrong match would hand the reader a wheel about something
		// else, which is worse than a duplicate tab.
		expect(readScope({ scope: { kind: "folder" } })).toBe(null);
		expect(readScope({ scope: { kind: "section", path: "a.md" } })).toBe(null);
		expect(readScope({ scope: { kind: "section", path: "a.md", heading: [] } })).toBe(
			null,
		);
		expect(readScope({ scope: { kind: "nonsense", path: "a.md" } })).toBe(null);
	});
});
