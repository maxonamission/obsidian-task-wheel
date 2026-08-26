import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { parseTaskLine, stateOf } from "../parse/task-line";
import { skipReport } from "../parse/skip-report";
import {
	DEFAULT_PARSE_OPTIONS,
	isFinished,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

/**
 * The four statuses Obsidian Tasks defines.
 *
 * ` ` open, `/` in progress, `x` done, `-` cancelled. For a review round the
 * question is only ever "is there something left to look at here", and by that
 * measure cancelled sits with done: one you did, one you decided not to do.
 * Started work sits on the other side, and is the most obviously yours of all.
 */

function options(over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, ...over };
}

function fields(line: string) {
	const parsed = parseTaskLine(line);
	if (parsed === null) throw new Error(`not a task line: ${line}`);
	return parsed.fields;
}

const NOTE: NoteInput = {
	path: "Werk/Plan.md",
	content: [
		"- [ ] Nog niet begonnen",
		"- [/] Mee bezig",
		"- [x] Afgevinkt",
		"- [-] Geannuleerd",
	].join("\n"),
};

describe("reading the character", () => {
	it("knows the four", () => {
		expect(stateOf(" ")).toBe("open");
		expect(stateOf("/")).toBe("in-progress");
		expect(stateOf("x")).toBe("done");
		expect(stateOf("X")).toBe("done");
		expect(stateOf("-")).toBe("cancelled");
	});

	it("treats anything else as open", () => {
		// Tasks lets a vault define its own statuses. An unknown character is not
		// a reason to take work out of a round — erring the other way would hide
		// work behind a setting nobody made.
		expect(stateOf(">")).toBe("open");
		expect(stateOf("?")).toBe("open");
		expect(stateOf("!")).toBe("open");
	});

	it("keeps 'done' meaning ticked off, and nothing else", () => {
		// Cancelled is finished, but it was never done.
		expect(fields("- [x] A").done).toBe(true);
		expect(fields("- [-] B").done).toBe(false);
		expect(fields("- [/] C").done).toBe(false);
	});

	it("counts done and cancelled as finished, the other two as not", () => {
		expect(isFinished(fields("- [x] A"))).toBe(true);
		expect(isFinished(fields("- [-] B"))).toBe(true);
		expect(isFinished(fields("- [/] C"))).toBe(false);
		expect(isFinished(fields("- [ ] D"))).toBe(false);
	});
});

describe("what reaches the wheel", () => {
	it("draws what is open and what is started, and neither of the rest", () => {
		const tree = buildTree([NOTE], options());
		const drawn = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label)
			.sort();

		expect(drawn).toEqual(["Mee bezig", "Nog niet begonnen"]);
		expect(tree.root.shownTaskCount).toBe(2);
	});

	it("shows all four when finished work is asked for, and counts all four", () => {
		const tree = buildTree([NOTE], options({ includeCompleted: true }));
		expect(tree.root.totalTaskCount).toBe(4);
		// And counts all four. `shownTaskCount` is what the hub, the stumps and
		// the "nothing to review" test read: it means *items this round is
		// about*, not "not ticked off". In a round that deliberately holds
		// finished work they are items of it, so a wheel showing four would
		// otherwise announce two and hide the rest behind a stump saying zero.
		expect(tree.root.shownTaskCount).toBe(4);
		expect(tree.showsFinished).toBe(true);
	});

	it("finds finished work when the filter asks for it, whatever the setting says", () => {
		// The setting drops finished tasks before the filter ever sees one, so
		// the two rules used to cancel each other out and *finished* selected an
		// empty wheel in a vault full of `[x]` (owner, 17 aug 2026).
		const tree = buildTree(
			[NOTE],
			options({
				filter: { ...DEFAULT_PARSE_OPTIONS.filter, status: "finished" },
			}),
		);
		const drawn = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label)
			.sort();

		expect(drawn).toEqual(["Afgevinkt", "Geannuleerd"]);
		expect(tree.showsFinished).toBe(true);
		// Two items in the round, and the two open ones said to be outside it.
		expect(tree.root.shownTaskCount).toBe(2);
		expect(tree.filteredOut).toBe(2);
	});

	it("counts what a filter leaves out of a round that holds finished work", () => {
		// The badge on the filter panel is drawn from `filteredOut`, and that was
		// still counted as "not ticked off" after the round changed meaning. With
		// finished work in play and a filter on, it reported `0 out` while work
		// was quietly removed — the silent hiding §3.3 forbids. It survived
		// because the tests only covered the direction where the old meaning
		// happened to agree (found by audit, 17 aug 2026).
		const tree = buildTree(
			[NOTE],
			options({
				includeCompleted: true,
				filter: { ...DEFAULT_PARSE_OPTIONS.filter, status: "open" },
			}),
		);

		// Four checkboxes are in play with finished work included; *not started*
		// keeps one, so three are outside the round and the panel must say so.
		expect(tree.showsFinished).toBe(true);
		expect(tree.root.shownTaskCount).toBe(1);
		expect(tree.filteredOut).toBe(3);
	});

	it("still counts correctly in a round that holds no finished work", () => {
		const tree = buildTree(
			[NOTE],
			options({ filter: { ...DEFAULT_PARSE_OPTIONS.filter, status: "open" } }),
		);

		// Two in play (open and in progress), one kept, one left out.
		expect(tree.showsFinished).toBe(false);
		expect(tree.root.shownTaskCount).toBe(1);
		expect(tree.filteredOut).toBe(1);
	});

	it("keeps a cancelled parent that still has open work under it", () => {
		// Same rule as for a completed parent: dropping it would orphan the
		// child, and nothing may silently disappear from the wheel.
		const note: NoteInput = {
			path: "Werk/Afgeblazen.md",
			content: ["- [-] Project geannuleerd", "    - [ ] Toch nog afronden"].join("\n"),
		};
		const tree = buildTree([note], options());
		expect(tree.root.totalTaskCount).toBe(2);
		expect(tree.root.shownTaskCount).toBe(1);
	});

	it("drops a cancelled parent whose work is finished too", () => {
		const note: NoteInput = {
			path: "Werk/Klaar.md",
			content: ["- [-] Project geannuleerd", "    - [x] Restje afgerond"].join("\n"),
		};
		expect(buildTree([note], options()).root.totalTaskCount).toBe(0);
	});

	it("leaves started work in the filter's accounting", () => {
		const tree = buildTree(
			[NOTE],
			options({
				today: "2026-08-20",
				filter: { ...options().filter, text: "bezig" },
			}),
		);
		expect(tree.root.shownTaskCount).toBe(1);
		expect(tree.filteredOut).toBe(1);
	});
});

describe("the skip report counts the same way", () => {
	it("looks at open and started work only", () => {
		// A report that counted cancelled checkboxes would make every pattern
		// look weaker than it is against the wheel it explains.
		expect(skipReport([NOTE], options()).total).toBe(2);
	});
});
