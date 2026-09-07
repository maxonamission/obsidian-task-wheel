import { describe, expect, it, vi } from "vitest";
import { arrive } from "../view/round";
import { prune } from "../layout/sweep";
import type { RoundHost } from "../view/round";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import { DEFAULT_SETTINGS, stateFor } from "../settings";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	VAULT_SCOPE,
} from "../model/types";

/**
 * Arriving is one thing, wherever the wheel came from (BC_E3_S158).
 *
 * The controller reports `onSettle` when it actually turns, and the round work
 * hung there. Four routes reach an item by laying the wheel out around it
 * instead — a sideways step past what is drawn, a fold, a landing named from
 * outside, and following the cursor back from a note — and all four go through
 * `adopt`, which reports `onFocus` and never `onSettle`. Each of them left the
 * item unseen *and* unremembered, so the next arrow stepped over it as though
 * the reader had been there, and the round could not close.
 *
 * The layout half of arriving still lives on the view and no test can reach it;
 * that is BC_E3_S162's argument, and this file is the half that could be moved.
 */

const NOTES: NoteInput[] = [
	{ path: "Werk/Plan.md", content: "- [ ] Bellen\n- [ ] Mailen" },
	{ path: "Thuis/Klussen.md", content: "- [ ] Afwas" },
];

function harness(): { host: RoundHost; persists: () => number } {
	const settings = structuredClone(DEFAULT_SETTINGS);
	const tree = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
	const persist = vi.fn();

	return {
		host: {
			settings,
			scope: () => VAULT_SCOPE,
			tree: () => tree,
			layout: () => layoutWheel(tree),
			// The sweep is painted on a renderer the view owns; there is none
			// here, and `drawSweep` is written to do nothing without one.
			renderer: () => null,
			persist,
		},
		persists: () => persist.mock.calls.length,
	};
}

const taskIds = (): string[] => {
	const tree = buildTree(NOTES, DEFAULT_PARSE_OPTIONS);
	const out: string[] = [];
	const walk = (node: { id: string; kind: string; children: unknown[] }): void => {
		if (node.kind === "task") out.push(node.id);
		(node.children as typeof node[]).forEach(walk);
	};
	(tree.root.children as never[]).forEach(walk);
	return out;
};

describe("arrive", () => {
	it("marks the item seen and remembers where the reader is", () => {
		const { host } = harness();
		const [first] = taskIds();

		arrive(host, first);

		const state = stateFor(host.settings, VAULT_SCOPE);
		expect(state.seen).toContain(first);
		expect(state.reading).toBe(first);
	});

	it("does both halves, not one — that was the whole defect", () => {
		// Marking seen without remembering the place gives a round that survives
		// a restart and drops you at its beginning; remembering without marking
		// makes the sweep and the counter disagree with the drawing.
		const { host } = harness();
		const [first, second] = taskIds();

		arrive(host, first);
		arrive(host, second);

		const state = stateFor(host.settings, VAULT_SCOPE);
		expect(state.seen).toEqual([first, second]);
		expect(state.reading).toBe(second);
	});

	it("starts the round's clock on the first arrival and not again", () => {
		const { host } = harness();
		const [first, second] = taskIds();

		arrive(host, first);
		const started = stateFor(host.settings, VAULT_SCOPE).sweepStartedAt;
		expect(started).toBeTypeOf("string");

		arrive(host, second);
		expect(stateFor(host.settings, VAULT_SCOPE).sweepStartedAt).toBe(started);
	});

	it("writes nothing when the wheel is already standing there", () => {
		// Every arrival persists, and a rescan that landed the wedge back where
		// it already was would otherwise write `data.json` for nothing.
		const { host, persists } = harness();
		const [first] = taskIds();

		arrive(host, first);
		const after = persists();

		arrive(host, first);
		expect(persists()).toBe(after);
	});

	it("counts an item once however often you come back to it", () => {
		const { host } = harness();
		const [first, second] = taskIds();

		arrive(host, first);
		arrive(host, second);
		arrive(host, first);

		const state = stateFor(host.settings, VAULT_SCOPE);
		expect(state.seen).toEqual([first, second]);
		// Coming back does move the reading place: that is where you are.
		expect(state.reading).toBe(first);
	});

	it("is the only way in: a rescan can take marks away, never add one", () => {
		// Arriving has to be something the reader did. A redraw happens for all
		// sorts of reasons — a sync landing, a filter panel opening, a tab coming
		// back to the front — and the only thing a rescan does to the round is
		// `prune`, which drops ids the vault no longer holds.
		const { host } = harness();
		const [first, second] = taskIds();

		arrive(host, first);
		arrive(host, second);

		const tree = host.tree();
		const state = stateFor(host.settings, VAULT_SCOPE);
		const kept = prune(tree!, [...state.seen, "een-taak-die-weg-is"]);

		expect(kept.size).toBeLessThanOrEqual(state.seen.length + 1);
		expect([...kept].every((id) => state.seen.includes(id))).toBe(true);
	});
});
