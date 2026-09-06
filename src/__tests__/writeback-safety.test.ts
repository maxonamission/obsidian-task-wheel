import { describe, expect, it } from "vitest";
import { spliceLine, spliceNote } from "../parse/splice";
import { addDays, isIsoDate, today } from "../model/dates";
import { setDone } from "../parse/edit-line";
import { moveBlock, moveToSection } from "../parse/outline-edit";

/**
 * The three defects the security review of BC_E3_S6 turned up, each with the
 * test that would have caught it. All three were in the write path — the one
 * place in this plugin where being wrong costs somebody their notes.
 */

const NOTE = ["# Werk", "", "- [ ] Bellen", "- [ ] Mailen 📅 2026-08-20", ""].join(
	"\n",
);

describe("spliceLine — the line must still be the line", () => {
	it("writes when the line is what we read", () => {
		const result = spliceLine(NOTE, 2, "- [ ] Bellen", (line) => [
			setDone(line, true),
		]);

		expect(result.outcome).toBe("written");
		expect(result.data.split("\n")[2]).toBe("- [x] Bellen");
	});

	it("refuses when the note has changed under us", () => {
		const result = spliceLine(NOTE, 2, "- [ ] Iets heel anders", () => ["x"]);

		expect(result.outcome).toBe("stale");
		expect(result.data).toBe(NOTE);
	});

	it("refuses when the line is no longer there at all", () => {
		expect(spliceLine(NOTE, 99, "- [ ] Bellen", () => ["x"]).outcome).toBe(
			"stale",
		);
	});

	it("leaves the note byte for byte when nothing changes", () => {
		const result = spliceLine(NOTE, 2, "- [ ] Bellen", () => null);

		expect(result.outcome).toBe("unchanged");
		expect(result.data).toBe(NOTE);
	});

	it("touches no other line", () => {
		const before = NOTE.split("\n");
		const after = spliceLine(NOTE, 2, "- [ ] Bellen", () => ["- [x] Bellen"])
			.data.split("\n");

		expect(after.length).toBe(before.length);
		before.forEach((line, index) => {
			if (index !== 2) expect(after[index]).toBe(line);
		});
	});
});

describe("spliceLine — CRLF notes", () => {
	const CRLF = NOTE.split("\n").join("\r\n");

	it("still recognises the line", () => {
		expect(spliceLine(CRLF, 2, "- [ ] Bellen", () => ["- [x] Bellen"]).outcome).toBe(
			"written",
		);
	});

	it("hands the edit a line it can actually parse", () => {
		// The defect: the carriage return came along, the task pattern refused
		// the line, every edit returned it unchanged, and the button did nothing
		// at all — with no message, for ever.
		const result = spliceLine(CRLF, 2, "- [ ] Bellen", (line) => {
			expect(line).toBe("- [ ] Bellen");
			return [setDone(line, true)];
		});

		expect(result.data.split("\r\n")[2]).toBe("- [x] Bellen");
	});

	it("keeps the file's endings intact, including for an extra line", () => {
		const result = spliceLine(CRLF, 2, "- [ ] Bellen", () => [
			"- [x] Bellen ✅ 2026-08-14",
			"- [ ] Bellen 📅 2026-08-21",
		]);

		// Every line the edit produced carries the ending, not just the last —
		// otherwise a recurring task leaves mixed endings inside one file.
		expect(result.data).not.toMatch(/[^\r]\n/);
		expect(result.data.split("\r\n")[3]).toBe("- [ ] Bellen 📅 2026-08-21");
	});

	it("does not put a carriage return in a note that had none", () => {
		const result = spliceLine(NOTE, 2, "- [ ] Bellen", () => ["- [x] Bellen"]);
		expect(result.data).not.toContain("\r");
	});
});

describe("spliceNote — the same guard, for edits that move lines", () => {
	const LINES = ["# Werk", "", "- [ ] Bellen", "- [ ] Mailen", ""];
	const NOTE_LF = LINES.join("\n");
	const NOTE_CRLF = LINES.join("\r\n");

	it("refuses when the line is not what the wheel is showing", () => {
		const result = spliceNote(NOTE_LF, 2, "- [ ] Iets anders", (lines) => lines);
		expect(result.outcome).toBe("stale");
		expect(result.data).toBe(NOTE_LF);
	});

	it("refuses when the line is not there at all", () => {
		expect(spliceNote(NOTE_LF, 99, "- [ ] Bellen", (lines) => lines).outcome).toBe(
			"stale",
		);
	});

	it("moves a task in a CRLF note without wrecking the endings", () => {
		// The defect that made every review action a no-op on a Windows-authored
		// note: a carriage return travels with the line and the task pattern
		// refuses such a line. A move touches every line, so it would have shown
		// up as a note whose endings were suddenly mixed.
		const result = spliceNote(NOTE_CRLF, 2, "- [ ] Bellen", (lines) =>
			moveBlock(lines, 2, "down"),
		);
		expect(result.outcome).toBe("written");
		expect(result.data).toBe(
			["# Werk", "", "- [ ] Mailen", "- [ ] Bellen", ""].join("\r\n"),
		);
		expect(result.data.includes("\n\n")).toBe(false);
	});

	it("keeps the endings when the edit stands on the last line", () => {
		// A note split on "\n" gives its last line no carriage return, so a CRLF
		// note without a closing newline read as an LF note whenever the action
		// was on its last task: the note came back with both kinds of ending
		// mixed and a stray "\r" at the end of the file, and headings went
		// unrecognised inside the callback (found by audit, 6 sep 2026).
		const open = ["# Werk", "- [ ] Bellen", "- [ ] Mailen"].join("\r\n");
		const result = spliceNote(open, 2, "- [ ] Mailen", (lines) =>
			moveBlock(lines, 2, "up"),
		);
		expect(result.outcome).toBe("written");
		expect(result.data).toBe(
			["# Werk", "- [ ] Mailen", "- [ ] Bellen"].join("\r\n"),
		);
		expect(result.data.endsWith("\r")).toBe(false);
	});

	it("still sees a heading when the edit stands on the last line", () => {
		const open = ["## Later", "## Nu", "- [ ] Bellen"].join("\r\n");
		const result = spliceNote(open, 2, "- [ ] Bellen", (lines) =>
			moveToSection(lines, 2, 0),
		);
		expect(result.outcome).toBe("written");
		expect(result.data).toBe(
			["## Later", "- [ ] Bellen", "## Nu"].join("\r\n"),
		);
	});

	it("says nothing changed when the edit declines", () => {
		const result = spliceNote(NOTE_LF, 2, "- [ ] Bellen", () => null);
		expect(result.outcome).toBe("unchanged");
		expect(result.data).toBe(NOTE_LF);
	});

	it("says nothing changed when the edit hands back the same note", () => {
		// A press that changes nothing has to say so, or the button looks dead.
		const result = spliceNote(NOTE_LF, 2, "- [ ] Bellen", (lines) => [...lines]);
		expect(result.outcome).toBe("unchanged");
	});

	it("keeps a note that does not end in a newline exactly as it was", () => {
		const tight = "- [ ] Bellen\n- [ ] Mailen";
		const result = spliceNote(tight, 0, "- [ ] Bellen", (lines) =>
			moveBlock(lines, 0, "down"),
		);
		expect(result.data).toBe("- [ ] Mailen\n- [ ] Bellen");
	});
});

describe("dates — a week is seven days, in every zone", () => {
	it("adds seven days", () => {
		// The defect: the arithmetic went through a local-midnight Date and came
		// back out as UTC, so in Amsterdam this returned 2026-08-26. Six days.
		expect(addDays("2026-08-20", 7)).toBe("2026-08-27");
	});

	it("crosses a month, a year and a leap day", () => {
		expect(addDays("2026-08-28", 7)).toBe("2026-09-04");
		expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
		expect(addDays("2028-02-26", 7)).toBe("2028-03-04");
	});

	it("survives the day the clocks go forward", () => {
		// 29 March 2026 is when Europe switches to summer time; an hour-based
		// calculation loses a day here roughly half the time.
		expect(addDays("2026-03-26", 7)).toBe("2026-04-02");
		expect(addDays("2026-10-22", 7)).toBe("2026-10-29");
	});

	it("counts backwards just as well", () => {
		expect(addDays("2026-01-03", -7)).toBe("2025-12-27");
	});

	it("leaves something that is not a date alone", () => {
		expect(addDays("elke week", 7)).toBe("elke week");
		expect(isIsoDate("elke week")).toBe(false);
		expect(isIsoDate(undefined)).toBe(false);
		expect(isIsoDate("2026-08-20")).toBe(true);
	});

	it("reads today off the reader's own calendar, not off UTC", () => {
		// Late in the evening east of Greenwich these two disagree, and the day
		// the reader means is the one on their wall.
		expect(today(new Date(2026, 7, 20, 23, 30))).toBe("2026-08-20");
		expect(today(new Date(2026, 0, 1, 0, 15))).toBe("2026-01-01");
	});
});

describe("setDone — when the status character is itself a bracket", () => {
	it("replaces the status and nothing else", () => {
		// The defect: the brackets were found by searching, and the status
		// character may be a bracket, so the wrong pair was replaced. One variant
		// deleted a character; the other left a line that no longer parsed as a
		// task, so the item vanished from the wheel without being done.
		expect(setDone("- [[] Bellen", true)).toBe("- [x] Bellen");
		expect(setDone("- []] Bellen", true)).toBe("- [x] Bellen");
	});

	it("keeps the spacing around the checkbox", () => {
		expect(setDone("-  [[]  Bellen", true)).toBe("-  [x]  Bellen");
	});

	it("leaves a line that is still a task line", () => {
		const out = setDone("- [[] Bellen 📅 2026-08-20", true);
		expect(/^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[(.)\][ \t]*(.*)$/.test(out)).toBe(
			true,
		);
	});
});
