import { describe, expect, it } from "vitest";
import { indentWidth, parseTaskLine } from "../parse/task-line";

describe("parseTaskLine — what counts as a task", () => {
	it("accepts the bullet markers Obsidian itself accepts", () => {
		for (const line of ["- [ ] a", "* [ ] a", "+ [ ] a", "1. [ ] a", "2) [ ] a"]) {
			expect(parseTaskLine(line), line).not.toBeNull();
		}
	});

	it("rejects lines that are not checkboxes", () => {
		for (const line of ["", "- gewoon een bullet", "# Kop", "[ ] geen bullet", "text"]) {
			expect(parseTaskLine(line), line).toBeNull();
		}
	});

	it("keeps the status character and reads completion from it", () => {
		expect(parseTaskLine("- [ ] a")?.fields.done).toBe(false);
		expect(parseTaskLine("- [x] a")?.fields.done).toBe(true);
		expect(parseTaskLine("- [X] a")?.fields.done).toBe(true);
		// A custom status such as "in progress" is neither open-with-no-marker
		// nor done; we keep the character so write-back can preserve it.
		expect(parseTaskLine("- [/] a")?.fields.statusChar).toBe("/");
		expect(parseTaskLine("- [/] a")?.fields.done).toBe(false);
	});
});

describe("parseTaskLine — indentation", () => {
	it("measures spaces and tabs on the same scale", () => {
		expect(indentWidth("")).toBe(0);
		expect(indentWidth("    ")).toBe(4);
		expect(indentWidth("\t")).toBe(4);
		expect(indentWidth("  \t")).toBe(4);
		expect(indentWidth("\t\t")).toBe(8);
	});

	it("reports the indent of the line", () => {
		expect(parseTaskLine("        - [ ] diep")?.indent).toBe(8);
	});
});

describe("parseTaskLine — Tasks fields", () => {
	it("reads every date signifier", () => {
		const fields = parseTaskLine(
			"- [ ] Iets 🛫 2026-01-02 ⏳ 2026-01-03 📅 2026-01-04 ➕ 2025-12-31 ✅ 2026-01-05 ❌ 2026-01-06",
		)?.fields;
		expect(fields?.start).toBe("2026-01-02");
		expect(fields?.scheduled).toBe("2026-01-03");
		expect(fields?.due).toBe("2026-01-04");
		expect(fields?.created).toBe("2025-12-31");
		expect(fields?.completed).toBe("2026-01-05");
		expect(fields?.cancelled).toBe("2026-01-06");
	});

	it("accepts the alternative due-date glyphs", () => {
		expect(parseTaskLine("- [ ] a 📆 2026-03-01")?.fields.due).toBe("2026-03-01");
		expect(parseTaskLine("- [ ] a 🗓 2026-03-02")?.fields.due).toBe("2026-03-02");
	});

	it("reads all five priorities and defaults to normal", () => {
		expect(parseTaskLine("- [ ] a")?.fields.priority).toBe("normal");
		expect(parseTaskLine("- [ ] a 🔺")?.fields.priority).toBe("highest");
		expect(parseTaskLine("- [ ] a ⏫")?.fields.priority).toBe("high");
		expect(parseTaskLine("- [ ] a 🔼")?.fields.priority).toBe("medium");
		expect(parseTaskLine("- [ ] a 🔽")?.fields.priority).toBe("low");
		expect(parseTaskLine("- [ ] a ⏬")?.fields.priority).toBe("lowest");
	});

	it("keeps a recurrence rule verbatim instead of interpreting it", () => {
		expect(parseTaskLine("- [ ] a 🔁 every week on Monday")?.fields.recurrence).toBe(
			"every week on Monday",
		);
	});

	it("reads task ids and dependencies", () => {
		const fields = parseTaskLine("- [ ] a 🆔 abc123 ⛔ def456, ghi789")?.fields;
		expect(fields?.taskId).toBe("abc123");
		expect(fields?.dependsOn).toEqual(["def456", "ghi789"]);
	});
});

describe("parseTaskLine — the description", () => {
	it("stops at the first field, so a date never lands in the text", () => {
		expect(parseTaskLine("- [ ] Bel de loodgieter 📅 2026-08-20 ⏫")?.fields.description).toBe(
			"Bel de loodgieter",
		);
	});

	it("collects tags and takes them out of the text", () => {
		const fields = parseTaskLine("- [ ] Snoeien #huis #tuin/voor 📅 2026-08-20")?.fields;
		expect(fields?.tags).toEqual(["huis", "tuin/voor"]);
		expect(fields?.description).toBe("Snoeien");
	});

	it("leaves a hash inside a word alone", () => {
		const fields = parseTaskLine("- [ ] Issue a#b oplossen")?.fields;
		expect(fields?.tags).toEqual([]);
		expect(fields?.description).toBe("Issue a#b oplossen");
	});

	it("strips a trailing block reference", () => {
		expect(parseTaskLine("- [ ] Iets ^a1b2c3")?.fields.description).toBe("Iets");
	});

	it("keeps the original line untouched for write-back", () => {
		const raw = "  - [ ] Iets raars ⏫ 📅 2026-08-20 <!-- comment -->";
		expect(parseTaskLine(raw)?.fields.raw).toBe(raw);
	});
});

describe("what is not a task, however much it looks like one", () => {
	it("does not read a markdown link as a checkbox", () => {
		// From the owner's vault, 14 aug 2026: an ordinary prose list on a page
		// about PCA. `- [R](https://…)` is a bullet holding a link, and it was
		// being counted as open work with the status "R".
		const line =
			"- [R](https://en.wikipedia.org/wiki/R_(programming_language)) – [Free](https://en.wikipedia.org/wiki/Free_software) statistical package, the functions `princomp` and `prcomp` can be used for principal component analysis";

		expect(parseTaskLine(line)).toBeNull();
	});

	it("holds the line on every shape of that mistake", () => {
		for (const line of [
			"- [R](https://example.com)",
			"* [Wikipedia](https://example.com) is a site",
			"1. [x](https://example.com) not a task",
			"+ [ ](https://example.com/space)",
		]) {
			expect(parseTaskLine(line)).toBeNull();
		}
	});

	it("still reads a real checkbox, whatever is between the brackets", () => {
		expect(parseTaskLine("- [ ] Bellen")).not.toBeNull();
		expect(parseTaskLine("- [x] Gedaan")).not.toBeNull();
		expect(parseTaskLine("- [/] Half af")).not.toBeNull();
		expect(parseTaskLine("- [-] Geschrapt")).not.toBeNull();
	});

	it("reads a checkbox with nothing after it", () => {
		expect(parseTaskLine("- [x]")?.fields.done).toBe(true);
		expect(parseTaskLine("- [ ]   ")?.fields.description).toBe("");
	});

	it("keeps a link that comes after a real checkbox", () => {
		const parsed = parseTaskLine("- [ ] Lees [R](https://example.com) door");
		expect(parsed?.fields.description).toBe("Lees [R](https://example.com) door");
	});
});
