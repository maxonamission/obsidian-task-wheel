import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { prune } from "../layout/sweep";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type WheelNode,
} from "../model/types";

/**
 * Two identical lines, and the mark that jumped between them (BC_E3_S166).
 *
 * The occurrence suffix counted the nodes already *made*, which is a number
 * that moves. Tick the first of two `- [ ] Bellen` off and the second stops
 * being `#2` and becomes the plain id the first one had — inheriting its seen
 * mark, so a round could close over a task that had never been under the
 * reading wedge. The rounde-side of V5 from the audit of 23 aug 2026, and
 * sharper than V5 described.
 */

const ids = (root: WheelNode): string[] => {
	const out: string[] = [];
	const walk = (node: WheelNode): void => {
		if (node.kind === "task") out.push(node.id);
		node.children.forEach(walk);
	};
	root.children.forEach(walk);
	return out;
};

const treeOf = (content: string) =>
	buildTree([{ path: "Werk/Plan.md", content }] as NoteInput[], DEFAULT_PARSE_OPTIONS);

describe("twins keep their own id", () => {
	it("numbers identical siblings by where they sit in the note", () => {
		const tree = treeOf("- [ ] Bellen\n- [ ] Bellen");
		const [first, second] = ids(tree.root);

		expect(first).not.toBe(second);
		expect(second.endsWith("#2")).toBe(true);
	});

	it("does not renumber the second when the first is ticked off", () => {
		// The whole defect in one assertion: the surviving twin used to slide
		// into the id of the one that left, and with it into its seen mark.
		const before = ids(treeOf("- [ ] Bellen\n- [ ] Bellen").root);
		const after = ids(treeOf("- [x] Bellen\n- [ ] Bellen").root);

		expect(after).toHaveLength(1);
		expect(after[0]).toBe(before[1]);
		expect(after[0]).not.toBe(before[0]);
	});

	it("does not hand the mark on when the note is re-read", () => {
		// The path a tick-off in the editor takes: no `carrySeen`, just a rescan
		// and the `prune` that trims marks to what the vault still holds. The
		// surviving twin used to *become* the id the seen one had, so prune kept
		// the mark and the round could close over a task nobody had seen.
		const before = treeOf("- [ ] Bellen\n- [ ] Bellen");
		const [first] = ids(before.root);

		const after = treeOf("- [x] Bellen\n- [ ] Bellen");
		expect([...prune(after, [first])]).toEqual([]);
	});

	it("survives a filter taking the first twin out", () => {
		const plain = ids(treeOf("- [ ] Bellen\n- [ ] Bellen #keep").root);
		const filtered = buildTree(
			[{ path: "Werk/Plan.md", content: "- [ ] Bellen\n- [ ] Bellen #keep" }],
			{
				...DEFAULT_PARSE_OPTIONS,
				filter: { ...DEFAULT_PARSE_OPTIONS.filter, withTags: ["keep"] },
			},
		);

		expect(ids(filtered.root)).toEqual([plain[1]]);
	});

	it("tells apart twins that sit under different headings", () => {
		// Different heading path, so they never collided and neither needs a
		// suffix — the ranking must not hand one out for nothing.
		const tree = treeOf("## Nu\n- [ ] Bellen\n## Later\n- [ ] Bellen");
		expect(ids(tree.root).some((id) => id.includes("#2"))).toBe(false);
	});
});
