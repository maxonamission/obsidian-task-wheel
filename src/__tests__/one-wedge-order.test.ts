import { describe as group, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { deepestFirst, sidewaysFrom, taskAfter, wheelOrder } from "../layout/order";
import { noteOf, wedgeSource } from "../model/scope";
import { stateOf, STATUS_CHAR } from "../parse/task-line";
import { DEFAULT_PARSE_OPTIONS, VAULT_SCOPE, type NoteInput } from "../model/types";

/**
 * One wedge order, not two (BC_E3_S172, audit 6 sep 2026).
 *
 * A round freezes the wedges it began with (BC_E3_S82), so a domain that turns
 * up while it is running is added to the *end* of the circle rather than slipped
 * into the middle of a walk the reader is already halfway through. The arrows
 * read that frozen order; the walk an action used to send the reader along read
 * the tree's structural one. Measured on three domains with one of them new,
 * three of the four stops disagreed about what comes next.
 */

const NOTES: NoteInput[] = [
	{ path: "Aaa/Een.md", content: "- [ ] A1\n- [ ] A2" },
	{ path: "Nieuw/Twee.md", content: "- [ ] N1" },
	{ path: "Zzz/Drie.md", content: "- [ ] Z1" },
];

const tree = buildTree(NOTES, { ...DEFAULT_PARSE_OPTIONS, scope: VAULT_SCOPE });

/** The round began before *Nieuw* existed, so it froze the other two. */
const FROZEN = tree.root.children
	.filter((wedge) => wedge.label !== "Nieuw")
	.map((wedge) => wedge.domain);

const label = (id: string | null): string =>
	id === null ? "(none)" : (tree.byId.get(id)?.label ?? id);

const idOf = (wanted: string): string => {
	for (const [id, node] of tree.byId) if (node.label === wanted) return id;
	throw new Error(`no node labelled ${wanted}`);
};

group("the next task, and the next stop sideways", () => {
	it("puts a domain that turned up mid-round at the end of the circle", () => {
		expect(FROZEN).toEqual(["Aaa", "Zzz"]);
		expect(
			wheelOrder(tree.root, FROZEN)
				.filter((node) => node.kind === "task")
				.map((node) => node.label),
		).toEqual(["A1", "A2", "Z1", "N1"]);
	});

	it("agrees with the arrows at every stop", () => {
		for (const from of ["A1", "A2", "N1", "Z1"]) {
			const id = idOf(from);
			expect(
				label(taskAfter(tree.root, id, FROZEN)),
				`from ${from}`,
			).toBe(label(sidewaysFrom(tree.root, FROZEN, id, 1, "tasks")));
		}
	});

	/**
	 * The measured disagreement, kept as the thing that must not come back.
	 *
	 * Reading the structural order gives *Nieuw* the place its name would have
	 * had, which is not where the wheel drew it.
	 */
	it("would have disagreed on three of four stops without the round's order", () => {
		const differing = ["A1", "A2", "N1", "Z1"].filter((from) => {
			const id = idOf(from);
			return (
				label(taskAfter(tree.root, id)) !==
				label(sidewaysFrom(tree.root, FROZEN, id, 1, "tasks"))
			);
		});
		expect(differing).toEqual(["A2", "N1", "Z1"]);
	});

	it("still walks children before their parents inside a wedge", () => {
		// The half of this order that is `taskAfter`'s own, and it survives:
		// a task with subtasks is not done until they are.
		const nested = buildTree(
			[{ path: "Aaa/Een.md", content: "- [ ] Ouder\n    - [ ] Kind" }],
			{ ...DEFAULT_PARSE_OPTIONS, scope: VAULT_SCOPE },
		);
		const walk = deepestFirst(nested.root)
			.filter((node) => node.kind === "task")
			.map((node) => node.label);
		expect(walk).toEqual(["Kind", "Ouder"]);
	});

	it("falls back to structural order when no round is named", () => {
		// A caller that names no domains meant "whatever order the tree has",
		// and that is what it still gets.
		expect(label(taskAfter(tree.root, idOf("A2")))).toBe("N1");
	});
});

/**
 * One alphabet for the status character (BC_E3_S172, audit 6 sep 2026).
 *
 * `stateOf` read the mapping one way, a private table in `build-tree` read it
 * the other, and the card's actions wrote the characters out as literals. Three
 * copies is how a fifth status comes to mean two things.
 */
group("stateOf and STATUS_CHAR", () => {
	it("are inverses over every state the wheel writes", () => {
		for (const state of ["open", "in-progress", "done", "cancelled"] as const) {
			expect(stateOf(STATUS_CHAR[state])).toBe(state);
		}
	});

	/**
	 * And the wide direction stays wide.
	 *
	 * A vault may define statuses of its own, and an unknown character is open
	 * work rather than a reason to drop it from a round.
	 */
	it("reads a status the table has no entry for as open", () => {
		for (const char of ["?", ">", "!", "X"]) {
			expect(stateOf(char)).toBe(char === "X" ? "done" : "open");
		}
	});
});

/**
 * Which note a wheel is about, asked once (BC_E3_S172, audit 6 sep 2026).
 *
 * The header action counted a section wheel and the button beside the drawing
 * did not, so on a section wheel the reader was offered the note above the pane
 * and nowhere else.
 */
group("noteOf", () => {
	it("answers for the two wheels that are about one file", () => {
		expect(noteOf({ kind: "note", path: "Werk/Plan.md" })).toBe("Werk/Plan.md");
		expect(
			noteOf({ kind: "section", path: "Werk/Plan.md", heading: ["Deze week"] }),
		).toBe("Werk/Plan.md");
	});

	it("answers for none of the three that are not", () => {
		expect(noteOf(VAULT_SCOPE)).toBeNull();
		expect(noteOf({ kind: "folder", path: "Werk" })).toBeNull();
		// A heading wheel is one name across many notes, so there is no single
		// file to open.
		expect(noteOf({ kind: "heading", heading: "Deze week", path: "" })).toBeNull();
	});
});

/**
 * Every domain source has words of its own (BC_E3_S172, audit 6 sep 2026).
 *
 * Two refusals named the source and both ended in a silent `else`: anything
 * that was not a tag or a heading was called a note property. A fifth source
 * would have been called one too, without a word said.
 */
group("wedgeSource", () => {
	it("names all four, and never two of them the same", () => {
		const said = (["folder", "tag", "property", "heading"] as const).map(wedgeSource);
		expect(new Set(said).size).toBe(4);
		expect(said.every((words) => words.length > 0)).toBe(true);
	});

	it("calls a folder a folder rather than a note property", () => {
		// The case the silent `else` got wrong. It is unreachable today, because
		// a folder wedge is refused a step earlier — which is exactly why it went
		// unnoticed.
		expect(wedgeSource("folder")).toContain("folder");
		expect(wedgeSource("folder")).not.toContain("property");
	});
});
