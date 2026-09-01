import { describe, expect, it } from "vitest";
import { layoutWheel } from "../layout/radial";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_PARSE_OPTIONS, type NoteInput, type WheelTree } from "../model/types";

/**
 * The wheel draws what it is looking at (BC_E3_S95).
 *
 * It did not, and everything that puts the reader somewhere deep failed without
 * a sound because of it: the layout came back without the item, the controller
 * fell back to the nearest stop it did have, and the reader ended up near where
 * they started. From the outside that looks like a key that bounces —
 * *"de beweging klapte een ingevouwen tak dus niet uit"* (eigenaar, 1 sep 2026).
 *
 * Two ways an ancestor could close the door. The rings ran out on it — measured
 * below at ring seven, where the parent sat at exactly `maxDepth` — or the
 * reader had folded it away. Neither may hide the item the wheel is focused on.
 */

function deep(name: string): string {
	return [
		`# ${name}`,
		"",
		`- [ ] ${name} een`,
		`    - [ ] ${name} twee`,
		`        - [ ] ${name} drie`,
		`            - [ ] ${name} vier a`,
		`            - [ ] ${name} vier b`,
		"",
	].join("\n");
}

function vault(domains: number, notes: number): NoteInput[] {
	const out: NoteInput[] = [];
	for (let d = 0; d < domains; d++) {
		for (let n = 0; n < notes; n++) {
			out.push({ path: `dom${d}/n${n}.md`, content: deep(`d${d}n${n}`) });
		}
	}
	return out;
}

function idOf(tree: WheelTree, fragment: string): string {
	const id = [...tree.byId.keys()].find((key) => key.includes(fragment));
	expect(id, `no node matching ${fragment}`).toBeDefined();
	return id as string;
}

describe("the wheel draws what it is focused on", () => {
	const tree = buildTree(vault(8, 6), DEFAULT_PARSE_OPTIONS);
	const deepTask = idOf(tree, "d0n1 vier a");

	it("even past the ring budget, where the rings had run out", () => {
		// Ring seven: domain, note, heading, and four rings of nested task.
		expect(tree.byId.get(deepTask)?.depth).toBeGreaterThan(
			// The default budget. The parent sat on it exactly, and a stump draws
			// no children.
			6,
		);

		const layout = layoutWheel(tree, { focusId: deepTask, visibleBudget: 240 });

		expect(layout.byId.has(deepTask)).toBe(true);
	});

	it("even through a branch the reader folded away", () => {
		const folded = idOf(tree, "d0n1 een");
		const layout = layoutWheel(tree, {
			focusId: deepTask,
			visibleBudget: 240,
			collapsed: new Set([folded]),
		});

		expect(layout.byId.has(deepTask)).toBe(true);
	});

	it("without undoing the fold — leaving closes it again", () => {
		const folded = idOf(tree, "d0n1 een");
		const elsewhere = idOf(tree, "d3n0 een");

		const inside = layoutWheel(tree, {
			focusId: deepTask,
			collapsed: new Set([folded]),
		});
		const away = layoutWheel(tree, {
			focusId: elsewhere,
			collapsed: new Set([folded]),
		});

		// Still marked folded while you are looking inside it, and closed again
		// the moment you are not.
		expect(inside.byId.get(folded)?.collapsed).toBe(true);
		expect(away.byId.has(deepTask)).toBe(false);
		expect(away.byId.get(folded)?.hiddenCount).toBeGreaterThan(0);
	});

	it("keeps a stump a stump when the reader is standing on it", () => {
		const folded = idOf(tree, "d0n1 een");
		const layout = layoutWheel(tree, {
			focusId: folded,
			collapsed: new Set([folded]),
		});

		// Standing on what you folded does not open it; that is what Space is for.
		expect(layout.byId.get(folded)?.hiddenCount).toBeGreaterThan(0);
		expect(layout.byId.has(deepTask)).toBe(false);
	});
});
