import { describe, expect, it } from "vitest";
import { outlineNote } from "../parse/outline";

describe("outlineNote", () => {
	it("records the heading path a task sits under", () => {
		const tasks = outlineNote(
			["# Note", "", "## Section", "", "### Subsection", "", "- [ ] a", ""].join("\n"),
		);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].headingPath).toEqual(["Note", "Section", "Subsection"]);
	});

	it("pops back out when a shallower heading follows", () => {
		const tasks = outlineNote(
			["## A", "### A1", "- [ ] one", "## B", "- [ ] two"].join("\n"),
		);
		expect(tasks.map((task) => task.headingPath)).toEqual([["A", "A1"], ["B"]]);
	});

	it("handles a note whose first heading is not level one", () => {
		const tasks = outlineNote(["### Deep", "- [ ] a"].join("\n"));
		expect(tasks[0].headingPath).toEqual(["Deep"]);
	});

	it("ignores checkboxes inside a fenced code block", () => {
		const tasks = outlineNote(
			["- [ ] echt", "", "```md", "- [ ] voorbeeld", "```", "", "- [ ] ook echt"].join(
				"\n",
			),
		);
		expect(tasks.map((task) => task.fields.description)).toEqual(["echt", "ook echt"]);
	});

	it("handles tilde fences and longer fences", () => {
		const tasks = outlineNote(
			["~~~", "- [ ] verstopt", "~~~", "- [ ] zichtbaar"].join("\n"),
		);
		expect(tasks.map((task) => task.fields.description)).toEqual(["zichtbaar"]);
	});

	it("skips front matter, so a YAML line is never read as a task", () => {
		const tasks = outlineNote(
			["---", "tags: [a]", "- [ ] niet echt", "---", "- [ ] echt"].join("\n"),
		);
		expect(tasks.map((task) => task.fields.description)).toEqual(["echt"]);
	});

	it("records line numbers so write-back can find the line again", () => {
		const tasks = outlineNote(["# Kop", "", "- [ ] a", "- [ ] b"].join("\n"));
		expect(tasks.map((task) => task.line)).toEqual([2, 3]);
	});

	it("returns nothing for a note without tasks", () => {
		expect(outlineNote("# Kop\n\nGewone tekst.\n")).toEqual([]);
	});
});
