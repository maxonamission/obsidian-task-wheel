import { describe, expect, it } from "vitest";
import {
	addSubheading,
	addTaskToSection,
	blockLength,
	insertTask,
	insertTaskLine,
	moveBlock,
	moveHeading,
	moveHeadingUnder,
	moveToNewSection,
	moveUnderTask,
	whyNotMoved,
	moveToSection,
	splitPath,
	setText,
} from "../parse/outline-edit";
import { headingsOf } from "../parse/outline";

/** The last line of a result, or nothing when the edit was refused. */
function last(lines: string[] | null): string | undefined {
	return lines === null ? undefined : lines[lines.length - 1];
}
import { parseTaskLine } from "../parse/task-line";

/**
 * Editing the outline of one note.
 *
 * The riskiest thing the plugin does, so it is decided here in pure text and
 * only then handed to the vault. What every one of these has to get right is
 * the same thing: change the one thing that was asked for, and leave every
 * other character of the note exactly as the author wrote it.
 */

const NOTE = [
	"# Weekend",
	"",
	"## Zaterdag",
	"- [ ] Boodschappen",
	"    even bellen of de winkel open is",
	"    - [ ] Lijstje maken",
	"- [ ] Tuin",
	"- [ ] Was",
	"",
	"## Zondag",
	"- [ ] Uitslapen",
];

describe("how far a task reaches", () => {
	it("takes everything indented under it, prose included", () => {
		// Lines 3-5: the task, the note about it, and the subtask.
		expect(blockLength(NOTE, 3)).toBe(3);
	});

	it("is one line when nothing hangs under it", () => {
		expect(blockLength(NOTE, 6)).toBe(1);
	});

	it("does not swallow the blank line after it", () => {
		// 'Was' is followed by a blank line and then a heading. Dragging that
		// blank around would make the note grow a gap on every move.
		expect(blockLength(NOTE, 7)).toBe(1);
	});

	it("keeps a blank line that sits inside the block", () => {
		const lines = ["- [ ] A", "    - [ ] a1", "", "    - [ ] a2", "- [ ] B"];
		expect(blockLength(lines, 0)).toBe(4);
	});
});

describe("moving a task among its siblings", () => {
	it("swaps with the next sibling, carrying its whole block", () => {
		const out = moveBlock(NOTE, 3, "down");
		expect(out?.slice(3, 7)).toEqual([
			"- [ ] Tuin",
			"- [ ] Boodschappen",
			"    even bellen of de winkel open is",
			"    - [ ] Lijstje maken",
		]);
	});

	it("swaps with the previous one, and back again", () => {
		const down = moveBlock(NOTE, 3, "down");
		if (down === null) throw new Error("expected a move");
		const back = moveBlock(down, 4, "up");
		expect(back).toEqual(NOTE);
	});

	it("refuses to move past the top or the bottom of its list", () => {
		expect(moveBlock(NOTE, 3, "up")).toBeNull();
		expect(moveBlock(NOTE, 7, "down")).toBeNull();
	});

	it("does not move a task out of its own section", () => {
		// 'Uitslapen' is the only task under Zondag; there is nothing above it in
		// that list, and the tasks under Zaterdag are not its siblings.
		expect(moveBlock(NOTE, 10, "up")).toBeNull();
	});

	it("moves a subtask within its parent, not out of it", () => {
		const lines = ["- [ ] A", "    - [ ] a1", "    - [ ] a2", "- [ ] B"];
		expect(moveBlock(lines, 1, "down")).toEqual([
			"- [ ] A",
			"    - [ ] a2",
			"    - [ ] a1",
			"- [ ] B",
		]);
		expect(moveBlock(lines, 1, "up")).toBeNull();
	});

	it("changes nothing but the order", () => {
		const out = moveBlock(NOTE, 3, "down");
		expect(out?.length).toBe(NOTE.length);
		expect([...(out ?? [])].sort()).toEqual([...NOTE].sort());
	});
});

describe("moving a task to another heading", () => {
	// The other move on purpose: a task that changes section loses its parent,
	// so there is no "same place" to keep. It lands at the end of the target
	// section, at that section's own level.

	const ZONDAG = 9;
	const ZATERDAG = 2;

	it("lands at the end of the section it is sent to", () => {
		const out = moveToSection(NOTE, 6, ZONDAG);
		expect(out?.slice(8)).toEqual(["## Zondag", "- [ ] Uitslapen", "- [ ] Tuin"]);
	});

	it("takes the whole block with it, prose and subtasks", () => {
		const out = moveToSection(NOTE, 3, ZONDAG);
		expect(out?.slice(-3)).toEqual([
			"- [ ] Boodschappen",
			"    even bellen of de winkel open is",
			"    - [ ] Lijstje maken",
		]);
	});

	it("leaves nothing behind where it was", () => {
		const out = moveToSection(NOTE, 3, ZONDAG);
		expect(out?.slice(2, 5)).toEqual(["## Zaterdag", "- [ ] Tuin", "- [ ] Was"]);
		expect(out?.length).toBe(NOTE.length);
	});

	it("de-indents a subtask to the level of its new section", () => {
		// It has no parent there, so keeping it indented would make it a child of
		// whatever happens to sit above it.
		const out = moveToSection(NOTE, 5, ZONDAG);
		expect(last(out)).toBe("- [ ] Lijstje maken");
	});

	it("keeps the shape inside the block while re-indenting it", () => {
		const lines = [
			"## A",
			"    - [ ] Diep",
			"        - [ ] Dieper",
			"## B",
			"- [ ] Iets",
		];
		expect(moveToSection(lines, 1, 3)).toEqual([
			"## A",
			"## B",
			"- [ ] Iets",
			"- [ ] Diep",
			"    - [ ] Dieper",
		]);
	});

	it("takes the level the target section already uses", () => {
		const lines = ["## A", "- [ ] Iets", "## B", "    - [ ] Ingesprongen lijst"];
		expect(last(moveToSection(lines, 1, 2))).toBe("    - [ ] Iets");
	});

	it("goes into an empty section, straight under its heading", () => {
		const lines = ["## A", "- [ ] Iets", "## B", "", "## C", "- [ ] Anders"];
		expect(moveToSection(lines, 1, 2)).toEqual([
			"## A",
			"## B",
			"- [ ] Iets",
			"",
			"## C",
			"- [ ] Anders",
		]);
	});

	it("moves backwards as happily as forwards", () => {
		const out = moveToSection(NOTE, 10, ZATERDAG);
		expect(out?.slice(2, 8)).toEqual([
			"## Zaterdag",
			"- [ ] Boodschappen",
			"    even bellen of de winkel open is",
			"    - [ ] Lijstje maken",
			"- [ ] Tuin",
			"- [ ] Was",
		]);
		// And the section it came from is simply empty now — the heading stays,
		// because taking a task away is not a reason to rewrite somebody's note.
		expect(last(out)).toBe("## Zondag");
	});

	describe("and a subheading is a section of its own", () => {
		// A parent section's line range covers its subsections, which made every
		// move from a subheading up to its parent look like a move into the
		// section the task was already in (found by the owner, 15 aug 2026).
		const NESTED = [
			"## Project",
			"- [ ] Direct eronder",
			"### Deeltaken",
			"- [ ] Sub een",
			"- [ ] Sub twee",
			"### Andere",
			"- [ ] Elders",
		];

		it("moves a task from a subheading up to its parent", () => {
			expect(moveToSection(NESTED, 3, 0)).toEqual([
				"## Project",
				"- [ ] Direct eronder",
				"- [ ] Sub een",
				"### Deeltaken",
				"- [ ] Sub twee",
				"### Andere",
				"- [ ] Elders",
			]);
		});

		it("puts it under the parent itself, not after the last subsection", () => {
			// The parent's own content ends where its first subheading starts.
			// Appending at the end of its whole range would drop the task inside
			// the last subsection while claiming it went to the parent.
			const out = moveToSection(NESTED, 6, 0);
			expect(out?.slice(0, 3)).toEqual([
				"## Project",
				"- [ ] Direct eronder",
				"- [ ] Elders",
			]);
		});

		it("still moves down into a subheading", () => {
			expect(moveToSection(NESTED, 1, 2)?.slice(0, 4)).toEqual([
				"## Project",
				"### Deeltaken",
				"- [ ] Sub een",
				"- [ ] Sub twee",
			]);
		});

		it("moves sideways between two subheadings", () => {
			expect(last(moveToSection(NESTED, 3, 5))).toBe("- [ ] Sub een");
		});

		it("still refuses the section the task is actually in", () => {
			expect(moveToSection(NESTED, 3, 2)).toBeNull();
			expect(moveToSection(NESTED, 1, 0)).toBeNull();
		});

		it("takes its level from the parent's own tasks, not a subsection's", () => {
			const lines = [
				"## Project",
				"    - [ ] Ingesprongen lijst",
				"### Deeltaken",
				"- [ ] Sub",
			];
			expect(moveToSection(lines, 3, 0)?.[2]).toBe("    - [ ] Sub");
		});

		it("lands right under a parent that has nothing of its own yet", () => {
			const lines = ["## Project", "### Deeltaken", "- [ ] Sub"];
			expect(moveToSection(lines, 2, 0)).toEqual([
				"## Project",
				"- [ ] Sub",
				"### Deeltaken",
			]);
		});
	});

	it("refuses to move a task into the section it is already in", () => {
		expect(moveToSection(NOTE, 6, ZATERDAG)).toBeNull();
	});

	it("refuses a heading that is not one, and a line that is not a task", () => {
		expect(moveToSection(NOTE, 6, 4)).toBeNull();
		expect(moveToSection(NOTE, 0, ZONDAG)).toBeNull();
	});

	it("is not fooled by a heading inside a code fence", () => {
		// The same rule the parser follows: a '# comment' in a shell example is
		// not a heading, and moving a task under it would drop it into the block.
		const lines = [
			"## Echt",
			"- [ ] Iets",
			"```sh",
			"# Niet echt",
			"```",
			"## Ook echt",
		];
		expect(headingsOf(lines).map((heading) => heading.line)).toEqual([0, 5]);
		expect(moveToSection(lines, 1, 3)).toBeNull();
	});

	it("re-levels a moved section without touching what a fence holds", () => {
		// Reading a heading and re-levelling one had a pattern each, and only the
		// reading one skipped fences and asked for a space after the hashes. So
		// moving a section that held a shell example rewrote `# comment` and a
		// bare `#` inside it, in somebody else's note, with a notice saying all
		// had gone well (found by audit, 6 sep 2026).
		const lines = [
			"## Doel",
			"## Bron",
			"```sh",
			"# comment in code",
			"#",
			"```",
		];

		expect(moveHeadingUnder(lines, 1, 0)).toEqual([
			"## Doel",
			"### Bron",
			"```sh",
			"# comment in code",
			"#",
			"```",
		]);
	});
});

describe("moving a task to a heading that does not exist yet", () => {
	// The same move, with the destination made first — as Obsidian offers to
	// create a folder when you move a note into one that is not there.

	it("makes the heading and puts the task under it", () => {
		expect(moveToNewSection(NOTE, 6, "Maandag")).toEqual([
			"# Weekend",
			"",
			"## Zaterdag",
			"- [ ] Boodschappen",
			"    even bellen of de winkel open is",
			"    - [ ] Lijstje maken",
			"- [ ] Was",
			"",
			"## Maandag",
			"- [ ] Tuin",
			"",
			"## Zondag",
			"- [ ] Uitslapen",
		]);
	});

	it("makes it a sibling of the section the task is in", () => {
		const nested = [
			"## Project",
			"### Deeltaken",
			"- [ ] Sub een",
			"### Andere",
			"- [ ] Elders",
		];
		// From a '###', so the new one is a '###' too: a '##' here would close
		// the section the reader is working in.
		expect(moveToNewSection(nested, 2, "Later")).toEqual([
			"## Project",
			"### Deeltaken",
			"### Later",
			"- [ ] Sub een",
			"### Andere",
			"- [ ] Elders",
		]);
	});

	it("takes the level most of the note uses when the task is under no heading", () => {
		// A '#' title with '##' sections is the common shape, and the answer a
		// reader expects there is another '##'.
		const lines = ["- [ ] Losse taak", "# Titel", "## Een", "## Twee"];
		expect(moveToNewSection(lines, 0, "Drie")).toEqual([
			"# Titel",
			"## Een",
			"## Twee",
			"## Drie",
			"- [ ] Losse taak",
		]);
	});

	it("makes the first heading in a note that has none", () => {
		const lines = ["- [ ] Een", "- [ ] Twee"];
		expect(moveToNewSection(lines, 0, "Werk")).toEqual([
			"- [ ] Twee",
			"",
			"## Werk",
			"- [ ] Een",
		]);
	});

	it("keeps a blank line between the last line and the new heading", () => {
		const out = moveToNewSection(NOTE, 6, "Maandag");
		const at = out?.indexOf("## Maandag") ?? -1;
		expect(out?.[at - 1]).toBe("");
	});

	it("does not double a blank line that is already there", () => {
		const lines = ["## A", "- [ ] Een", "- [ ] Twee", "", "## B"];
		// One blank above the new heading, not two — and one below it, because
		// the section that follows had one and must not lose it.
		expect(moveToNewSection(lines, 1, "C")).toEqual([
			"## A",
			"- [ ] Twee",
			"",
			"## C",
			"- [ ] Een",
			"",
			"## B",
		]);
	});

	it("leaves a tightly written note tight", () => {
		// The note says how it likes its headings; we do not.
		const lines = ["## A", "- [ ] Een", "## B", "- [ ] Twee"];
		expect(moveToNewSection(lines, 1, "C")).toEqual([
			"## A",
			"## C",
			"- [ ] Een",
			"## B",
			"- [ ] Twee",
		]);
	});

	it("takes the whole block with it", () => {
		const out = moveToNewSection(NOTE, 3, "Maandag") ?? [];
		const at = out.indexOf("## Maandag");
		expect(out.slice(at, at + 4)).toEqual([
			"## Maandag",
			"- [ ] Boodschappen",
			"    even bellen of de winkel open is",
			"    - [ ] Lijstje maken",
		]);
		// And the section it lands before keeps the blank line it had.
		expect(out.slice(at + 4)).toEqual(["", "## Zondag", "- [ ] Uitslapen"]);
	});

	describe("with a path, so it lands under an existing heading", () => {
		// `org/afdeling 2` means "afdeling 2, under org" — the shape Obsidian
		// itself uses for folders. Without it the reader got one heading called
		// `org/afdeling 2` (found by the owner, 15 aug 2026).
		const ORG = ["# Org", "## Afdeling 1", "- [ ] Iets"];

		it("reads a slash as a path", () => {
			expect(splitPath("org/afdeling 2")).toEqual(["org", "afdeling 2"]);
			expect(splitPath("Zaterdag")).toEqual(["Zaterdag"]);
			expect(splitPath(" a / b ")).toEqual(["a", "b"]);
		});

		it("makes the new heading under the parent that was named", () => {
			expect(moveToNewSection(ORG, 2, "org/Afdeling 2")).toEqual([
				"# Org",
				"## Afdeling 1",
				"## Afdeling 2",
				"- [ ] Iets",
			]);
		});

		it("gives it the level its new siblings use", () => {
			const deep = ["# Org", "### Afdeling 1", "- [ ] Iets"];
			expect(moveToNewSection(deep, 2, "org/Afdeling 2")?.[2]).toBe(
				"### Afdeling 2",
			);
		});

		it("goes one deeper when the parent has no sections yet", () => {
			const bare = ["# Org", "- [ ] Iets"];
			expect(moveToNewSection(bare, 1, "org/Afdeling 1")).toEqual([
				"# Org",
				"",
				"## Afdeling 1",
				"- [ ] Iets",
			]);
		});

		it("puts it after everything the parent already holds", () => {
			const two = [
				"# Org",
				"## Afdeling 1",
				"- [ ] Iets",
				"## Afdeling 2",
				"- [ ] Anders",
			];
			expect(moveToNewSection(two, 2, "org/Afdeling 3")).toEqual([
				"# Org",
				"## Afdeling 1",
				"## Afdeling 2",
				"- [ ] Anders",
				"## Afdeling 3",
				"- [ ] Iets",
			]);
		});

		it("finds a parent by its own name without spelling out the path", () => {
			const nested = ["# Org", "## Afdeling 1", "### Team A", "- [ ] Iets"];
			expect(moveToNewSection(nested, 3, "Afdeling 1/Team B")?.[3]).toBe(
				"### Team B",
			);
		});

		it("matches the path from the top when it is spelled out", () => {
			const nested = ["# Org", "## Afdeling 1", "### Team A", "- [ ] Iets"];
			expect(moveToNewSection(nested, 3, "Org/Afdeling 1/Team B")?.[3]).toBe(
				"### Team B",
			);
		});

		it("ignores case, the way a reader typing quickly would expect", () => {
			expect(moveToNewSection(ORG, 2, "ORG/Afdeling 2")?.[2]).toBe(
				"## Afdeling 2",
			);
		});

		it("falls back to a plain sibling when the parent does not exist", () => {
			// Nothing to nest under, so the name is used and the level is the one
			// the task's own section uses. The alternative — inventing the parent
			// too — writes more of somebody's note than they asked for.
			expect(moveToNewSection(ORG, 2, "Elders/Afdeling 2")?.[2]).toBe(
				"## Afdeling 2",
			);
		});
	});

	it("refuses an empty name, and a line that is not a task", () => {
		expect(moveToNewSection(NOTE, 6, "   ")).toBeNull();
		expect(moveToNewSection(NOTE, 0, "Maandag")).toBeNull();
	});

	it("writes a heading the parser reads back as one", () => {
		const out = moveToNewSection(NOTE, 6, "Maandag") ?? [];
		const made = headingsOf(out).find((heading) => heading.text === "Maandag");
		expect(made?.level).toBe(2);
		expect(out[(made?.line ?? 0) + 1]).toBe("- [ ] Tuin");
	});
});

describe("adding a task", () => {
	it("puts a sibling below the whole block, not inside it", () => {
		const out = insertTask(NOTE, 3, "Bloemen kopen", false);
		expect(out?.line).toBe(6);
		expect(out?.lines[6]).toBe("- [ ] Bloemen kopen");
		// The subtask is still under its own parent.
		expect(out?.lines[5]).toBe("    - [ ] Lijstje maken");
	});

	it("puts a child straight under the task", () => {
		const out = insertTask(NOTE, 6, "Heg knippen", true);
		expect(out?.line).toBe(7);
		expect(out?.lines[7]).toBe("    - [ ] Heg knippen");
	});

	it("copies the list marker, so a numbered list stays numbered", () => {
		const lines = ["1. [ ] Eerst", "2. [ ] Dan"];
		expect(insertTask(lines, 0, "Tussendoor", false)?.lines[1]).toBe(
			"1. [ ] Tussendoor",
		);
		expect(insertTask(["* [ ] A"], 0, "B", false)?.lines[1]).toBe("* [ ] B");
	});

	it("indents a child with a tab when the note uses tabs", () => {
		const lines = ["- [ ] A", "\t- [ ] a1"];
		expect(insertTask(lines, 1, "a2", true)?.lines[2]).toBe("\t\t- [ ] a2");
	});

	it("writes a line the parser reads back as an open task", () => {
		const out = insertTask(NOTE, 6, "Heg knippen", false);
		const parsed = parseTaskLine(out?.lines[7] ?? "");
		expect(parsed?.fields.state).toBe("open");
		expect(parsed?.fields.description).toBe("Heg knippen");
	});

	it("refuses a line that is not a task", () => {
		expect(insertTask(NOTE, 0, "Iets", false)).toBeNull();
	});
});

describe("adding a whole line handed back by the Tasks creation modal", () => {
	it("places a sibling below the whole block, and re-indents it", () => {
		// The modal has no notion of outlines, so it hands the line back flush
		// with the margin — the indentation for where it lands is added here,
		// not left to whatever the modal happened to send (BC_E3_S115).
		const out = insertTaskLine(NOTE, 3, "- [ ] Bloemen kopen 📅 2026-09-10", false);
		expect(out?.line).toBe(6);
		expect(out?.lines[6]).toBe("- [ ] Bloemen kopen 📅 2026-09-10");
		expect(out?.lines[5]).toBe("    - [ ] Lijstje maken");
	});

	it("puts a child straight under the task, one level deeper", () => {
		const out = insertTaskLine(NOTE, 6, "- [ ] Heg knippen", true);
		expect(out?.line).toBe(7);
		expect(out?.lines[7]).toBe("    - [ ] Heg knippen");
	});

	it("strips whatever indentation the line already carried", () => {
		const out = insertTaskLine(NOTE, 6, "        - [ ] Heg knippen", true);
		expect(out?.lines[7]).toBe("    - [ ] Heg knippen");
	});

	it("keeps the line as it was given, checkbox and fields included", () => {
		const out = insertTaskLine(NOTE, 6, "- [ ] Heg knippen ⏫ 📅 2026-09-10", true);
		const parsed = parseTaskLine(out?.lines[7] ?? "");
		expect(parsed?.fields.priority).toBe("high");
		expect(parsed?.fields.due).toBe("2026-09-10");
	});

	it("splices in every line the modal hands back, all re-indented", () => {
		const out = insertTaskLine(
			NOTE,
			6,
			"- [ ] Heg knippen 🔁 every week\n- [x] Heg knippen",
			false,
		);
		expect(out?.lines.slice(7, 9)).toEqual([
			"- [ ] Heg knippen 🔁 every week",
			"- [x] Heg knippen",
		]);
	});

	it("refuses a line that is not a task", () => {
		expect(insertTaskLine(NOTE, 0, "- [ ] Iets", false)).toBeNull();
	});
});

describe("renaming a task", () => {
	it("replaces the words and nothing else", () => {
		expect(setText("- [ ] Bellen 📅 2026-08-20 ⏫", "Loodgieter bellen")).toBe(
			"- [ ] Loodgieter bellen 📅 2026-08-20 ⏫",
		);
	});

	it("keeps the status, the indentation and the marker", () => {
		expect(setText("    * [/] Oud 🔽", "Nieuw")).toBe("    * [/] Nieuw 🔽");
	});

	it("keeps a trailing block reference where it belongs", () => {
		expect(setText("- [ ] Oud ^a1b2c3", "Nieuw")).toBe("- [ ] Nieuw ^a1b2c3");
		expect(setText("- [ ] Oud 📅 2026-08-20 ^a1b2c3", "Nieuw")).toBe(
			"- [ ] Nieuw 📅 2026-08-20 ^a1b2c3",
		);
	});

	it("carries the tags the reader typed, because they are part of the text", () => {
		// The parsed description has had its tags lifted out; writing that back
		// would delete them. What is edited is the text as written.
		expect(setText("- [ ] Bellen #werk 📅 2026-08-20", "Mailen #werk #klant")).toBe(
			"- [ ] Mailen #werk #klant 📅 2026-08-20",
		);
	});

	it("leaves a line alone when the words did not change", () => {
		const line = "- [ ] Bellen 📅 2026-08-20";
		expect(setText(line, "Bellen")).toBe(line);
	});

	it("refuses to empty a task that has nothing else on the line", () => {
		// An empty line with a checkbox on it is not something to leave behind.
		expect(setText("- [ ] Bellen", "   ")).toBe("- [ ] Bellen");
	});

	it("allows emptying the words when the fields still say something", () => {
		expect(setText("- [ ] Bellen 📅 2026-08-20", "")).toBe("- [ ] 📅 2026-08-20");
	});

	it("does not touch a line that is not a task", () => {
		expect(setText("Gewoon een zin", "Iets")).toBe("Gewoon een zin");
	});

	it("survives a status character that is itself a bracket", () => {
		expect(setText("- [[] Oud", "Nieuw")).toBe("- [[] Nieuw");
	});

	it("reads back as the same task with new words", () => {
		const line = setText("- [ ] Oud 📅 2026-08-20 ⏫ #werk", "Nieuw #werk");
		const parsed = parseTaskLine(line);
		expect(parsed?.fields.description).toBe("Nieuw");
		expect(parsed?.fields.due).toBe("2026-08-20");
		expect(parsed?.fields.priority).toBe("high");
		expect(parsed?.fields.tags).toEqual(["werk"]);
	});
});

describe("editing a section rather than a task", () => {
	// In a wheel over one note the headings are the wedges, so standing on one
	// and having nothing to do with it was the odd gap.
	const NOTE2 = [
		"# Org",
		"## Afdeling 1",
		"- [ ] Een",
		"### Team A",
		"- [ ] Diep",
		"## Afdeling 2",
		"- [ ] Twee",
	];

	describe("moving a section", () => {
		it("swaps with the sibling after it, subsections and all", () => {
			expect(moveHeading(NOTE2, 1, "down")).toEqual([
				"# Org",
				"## Afdeling 2",
				"- [ ] Twee",
				"## Afdeling 1",
				"- [ ] Een",
				"### Team A",
				"- [ ] Diep",
			]);
		});

		it("swaps back again, unchanged", () => {
			const down = moveHeading(NOTE2, 1, "down");
			if (down === null) throw new Error("expected a move");
			expect(moveHeading(down, 3, "up")).toEqual(NOTE2);
		});

		it("refuses at the ends of its own list", () => {
			expect(moveHeading(NOTE2, 1, "up")).toBeNull();
			expect(moveHeading(NOTE2, 5, "down")).toBeNull();
		});

		it("does not treat two subsections of different parents as siblings", () => {
			const two = [
				"## A",
				"### A1",
				"## B",
				"### B1",
			];
			// A1 has nothing to swap with: B1 lives under a different parent.
			expect(moveHeading(two, 1, "down")).toBeNull();
		});
	});

	describe("moving a section under another heading", () => {
		it("re-levels the whole section as it goes", () => {
			// '## Afdeling 1' becomes a '###' under Afdeling 2, and its own
			// '### Team A' follows it down to '####'.
			expect(moveHeadingUnder(NOTE2, 1, 5)).toEqual([
				"# Org",
				"## Afdeling 2",
				"- [ ] Twee",
				"### Afdeling 1",
				"- [ ] Een",
				"#### Team A",
				"- [ ] Diep",
			]);
		});

		it("refuses to move a section into itself or into its own subsection", () => {
			expect(moveHeadingUnder(NOTE2, 1, 1)).toBeNull();
			expect(moveHeadingUnder(NOTE2, 1, 3)).toBeNull();
		});

		it("moves a subsection up to the top level of the note", () => {
			expect(moveHeadingUnder(NOTE2, 3, 0)?.slice(-2)).toEqual([
				"## Team A",
				"- [ ] Diep",
			]);
		});
	});

	describe("adding to a section", () => {
		it("adds a task at the end of the section's own content", () => {
			expect(addTaskToSection(NOTE2, 1, "Nog iets")?.[3]).toBe("- [ ] Nog iets");
		});

		it("does not drop it inside a subsection", () => {
			const out = addTaskToSection(NOTE2, 1, "Nog iets") ?? [];
			expect(out.indexOf("- [ ] Nog iets")).toBeLessThan(out.indexOf("### Team A"));
		});

		it("takes the level the section already writes at", () => {
			const lines = ["## A", "    - [ ] Ingesprongen"];
			expect(addTaskToSection(lines, 0, "Ook")?.[2]).toBe("    - [ ] Ook");
		});

		it("hangs a new section under this one, after all it holds", () => {
			expect(addSubheading(NOTE2, 1, "Team B")).toEqual([
				"# Org",
				"## Afdeling 1",
				"- [ ] Een",
				"### Team A",
				"- [ ] Diep",
				"### Team B",
				"## Afdeling 2",
				"- [ ] Twee",
			]);
		});

		it("goes one level deeper when there are no subsections yet", () => {
			expect(addSubheading(NOTE2, 5, "Team C")).toEqual([
				...NOTE2,
				"### Team C",
			]);
		});

		it("refuses an empty name and a line that is not a heading", () => {
			expect(addSubheading(NOTE2, 1, "  ")).toBeNull();
			expect(addTaskToSection(NOTE2, 2, "Iets")).toBeNull();
		});
	});
});

describe("six is as deep as markdown goes", () => {
	// `subLevel` lived twice — here without a clamp, in `cross-note` with one —
	// so a subheading under a `######` was written as `#######`. Seven hashes is
	// not a heading: a bare line of prose landed in the note and the section the
	// reader asked for did not appear at all (found by audit, 17 aug 2026). The
	// two copies are now one, in `parse/sections`.
	it("clamps a new subheading rather than writing a seventh hash", () => {
		const note = ["###### Diep", "- [ ] Iets"];
		const out = addSubheading(note, 0, "Nog dieper");

		expect(out).not.toBeNull();
		expect(out?.some((line) => line.startsWith("####### "))).toBe(false);
		expect(out).toContain("###### Nog dieper");
	});

	it("clamps a heading made on the way to moving a task under it", () => {
		const note = ["###### Diep", "- [ ] Iets"];
		const out = moveToNewSection(note, 1, "Diep/Nog dieper");

		// A level-7 heading is one `headingsOf` cannot see, so the move that
		// followed it used to refuse and report "nothing to change there".
		expect(out).not.toBeNull();
		expect(out?.some((line) => line.startsWith("####### "))).toBe(false);
		expect(out?.join("\n")).toContain("###### Nog dieper");
		expect(out?.join("\n")).toContain("- [ ] Iets");
	});
});

describe("a blank line between two tasks is a gap, not a wall", () => {
	// Down refused over it, with the untrue "already at the end of its list",
	// while up stepped over it and carried the blank to the end — moving a
	// separator that a heading below relied on (found by audit, 17 aug 2026).
	const AIRY = ["- [ ] A", "", "- [ ] B", "", "## Volgende"];

	it("moves down past a sibling with a blank line between them", () => {
		expect(moveBlock(AIRY, 0, "down")).toEqual([
			"- [ ] B",
			"",
			"- [ ] A",
			"",
			"## Volgende",
		]);
	});

	it("moves up the same way, and leaves the gap where it was", () => {
		expect(moveBlock(AIRY, 2, "up")).toEqual([
			"- [ ] B",
			"",
			"- [ ] A",
			"",
			"## Volgende",
		]);
	});

	it("is its own inverse, whichever way round you do it", () => {
		const down = moveBlock(AIRY, 0, "down");
		expect(moveBlock(down ?? [], 2, "up")).toEqual(AIRY);
	});

	it("still refuses when there really is no sibling that way", () => {
		expect(moveBlock(AIRY, 2, "down")).toBeNull();
		expect(moveBlock(AIRY, 0, "up")).toBeNull();
	});

	it("carries the whole block over the gap, subtasks and all", () => {
		const note = ["- [ ] A", "    - [ ] A1", "", "- [ ] B"];
		expect(moveBlock(note, 0, "down")).toEqual([
			"- [ ] B",
			"",
			"- [ ] A",
			"    - [ ] A1",
		]);
	});
});

describe("een kopje dat er al is, wordt er niet nog een keer bij gemaakt", () => {
	// Een leeg kopje houdt geen taken, dus het wiel tekent het niet — en dan
	// typt de lezer de naam die hij in de notitie ziet staan en krijgt een
	// duplicaat (eigenaar, 18 aug 2026). De kiezer weigert een exacte naam die
	// hij zelf kan aanbieden, maar hij kan een getypt pad niet weigeren; deze
	// laag schrijft, dus deze laag moet zeker zijn.
	it("addSubheading doet niets als de sectie er al is", () => {
		const note = ["# Werk", "## Klanten", "## Intern", "- [ ] Iets"];
		expect(addSubheading(note, 0, "Klanten")).toBeNull();
	});

	it("addSubheading kijkt alleen onder dit kopje, niet in de hele notitie", () => {
		// Twee secties "Doel" onder verschillende ouders is een normale vorm.
		const note = ["# A", "## Doel", "# B"];
		const out = addSubheading(note, 2, "Doel");
		expect(out).not.toBeNull();
		expect(out?.filter((line) => line === "## Doel")).toHaveLength(2);
	});

	it("moveToNewSection verhuist naar het bestaande kopje in plaats van er een te maken", () => {
		const note = ["# Werk", "## Leeg", "## Intern", "- [ ] Iets"];
		const out = moveToNewSection(note, 3, "Leeg");

		expect(out?.filter((line) => line === "## Leeg")).toHaveLength(1);
		expect(out).toEqual(["# Werk", "## Leeg", "- [ ] Iets", "## Intern"]);
	});

	it("ook wanneer het pad voluit is getypt", () => {
		const note = ["# Werk", "## Leeg", "## Intern", "- [ ] Iets"];
		const out = moveToNewSection(note, 3, "Werk/Leeg");

		expect(out?.filter((line) => line === "## Leeg")).toHaveLength(1);
	});

	it("maakt er nog steeds een als de naam werkelijk nieuw is", () => {
		const note = ["# Werk", "## Intern", "- [ ] Iets"];
		const out = moveToNewSection(note, 2, "Klanten");

		expect(out?.join("\n")).toContain("## Klanten");
		expect(out?.join("\n")).toContain("- [ ] Iets");
	});
});

describe("waarom een verplaatsing niet doorging", () => {
	// Eén zin dekte elke weigering — "already at the end of its list" — en dat is
	// onwaar als je omhoog vroeg, en dubbel onwaar voor de enige taak onder een
	// kopje, waar het echte antwoord een andere bewerking is (eigenaar, 18 aug
	// 2026, op een tak met één taak erin).
	const NOTE = [
		"## Alleen dit",
		"- [ ] De enige taak",
		"    - [ ] Subtaak",
		"## Meer",
		"- [ ] Eerste",
		"- [ ] Tweede",
		"- [ ] Derde",
	];

	it("noemt de enige taak in z'n lijst ook zo", () => {
		expect(whyNotMoved(NOTE, 1, "up")).toBe("alone");
		expect(whyNotMoved(NOTE, 1, "down")).toBe("alone");
	});

	it("en een subtaak die alleen onder z'n ouder hangt net zo", () => {
		expect(whyNotMoved(NOTE, 2, "down")).toBe("alone");
	});

	it("zegt eerste als er niets boven staat", () => {
		expect(whyNotMoved(NOTE, 4, "up")).toBe("first");
	});

	it("zegt laatste als er niets onder staat", () => {
		expect(whyNotMoved(NOTE, 6, "down")).toBe("last");
	});

	it("weigert niet wanneer er wél iets te ruilen valt", () => {
		expect(moveBlock(NOTE, 4, "down")).not.toBeNull();
		expect(moveBlock(NOTE, 6, "up")).not.toBeNull();
	});

	it("herkent een regel die geen taak is", () => {
		expect(whyNotMoved(NOTE, 0, "up")).toBe("not-a-task");
	});
});

describe("moveUnderTask — van los item naar deelstap (BC_E3_S19)", () => {
	const lines = [
		"## Tuin", // 0
		"- [ ] Haag aanpakken", // 1
		"    - [ ] Gereedschap halen", // 2
		"- [ ] Takken afvoeren", // 3
		"    - [ ] Aanhanger lenen", // 4
		"- [ ] Terras vegen", // 5
	];

	it("hangt het blok één niveau dieper onder z'n nieuwe ouder", () => {
		const out = moveUnderTask(lines, 3, 1)!;
		expect(out).toEqual([
			"## Tuin",
			"- [ ] Haag aanpakken",
			"    - [ ] Takken afvoeren",
			"        - [ ] Aanhanger lenen",
			"    - [ ] Gereedschap halen",
			"- [ ] Terras vegen",
		]);
	});

	it("landt bovenaan wat de ouder al heeft, niet onderaan", () => {
		const out = moveUnderTask(lines, 5, 1)!;
		expect(out[2]).toBe("    - [ ] Terras vegen");
		expect(out[3]).toBe("    - [ ] Gereedschap halen");
	});

	it("neemt subtaken mee en houdt hun onderlinge diepte", () => {
		const out = moveUnderTask(lines, 3, 5)!;
		expect(out).toContain("    - [ ] Takken afvoeren");
		expect(out).toContain("        - [ ] Aanhanger lenen");
	});

	it("weigert een taak onder zichzelf", () => {
		expect(moveUnderTask(lines, 1, 1)).toBeNull();
	});

	it("weigert een taak onder een eigen nazaat — dat zou beide kwijtraken", () => {
		expect(moveUnderTask(lines, 1, 2)).toBeNull();
	});

	it("weigert een regel die geen taak is, aan beide kanten", () => {
		expect(moveUnderTask(lines, 0, 1)).toBeNull();
		expect(moveUnderTask(lines, 1, 0)).toBeNull();
	});

	it("weigert een taak die al precies daar hangt", () => {
		expect(moveUnderTask(lines, 2, 1)).toBeNull();
	});

	it("houdt tabs tabs", () => {
		const tabbed = ["- [ ] Ouder", "\t- [ ] Kind", "- [ ] Los"];
		const out = moveUnderTask(tabbed, 2, 0)!;
		expect(out[1]).toBe("\t- [ ] Los");
	});

	it("werkt ook omhoog, van later in de notitie naar eerder", () => {
		const out = moveUnderTask(lines, 5, 3)!;
		expect(out).toEqual([
			"## Tuin",
			"- [ ] Haag aanpakken",
			"    - [ ] Gereedschap halen",
			"- [ ] Takken afvoeren",
			"    - [ ] Terras vegen",
			"    - [ ] Aanhanger lenen",
		]);
	});
});
