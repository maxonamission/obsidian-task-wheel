import { describe, expect, it } from "vitest";
import { setDate, setDone, setPriority, setStatus } from "../parse/edit-line";
import { parseTaskLine } from "../parse/task-line";

/** What the parser makes of a line, so a rewrite can be judged by reading it. */
function read(line: string) {
	const parsed = parseTaskLine(line);
	if (parsed === null) throw new Error(`not a task line: ${line}`);
	return parsed.fields;
}

describe("setDone", () => {
	it("ticks a task off", () => {
		expect(setDone("- [ ] Bellen", true)).toBe("- [x] Bellen");
	});

	it("unticks it again", () => {
		expect(setDone("- [x] Bellen", false)).toBe("- [ ] Bellen");
	});

	it("leaves a line that is already right alone, byte for byte", () => {
		const line = "-   [x]   Bellen   📅 2026-08-20";
		expect(setDone(line, true)).toBe(line);
	});

	it("keeps the list marker someone chose", () => {
		expect(setDone("* [ ] Bellen", true)).toBe("* [x] Bellen");
		expect(setDone("1. [ ] Bellen", true)).toBe("1. [x] Bellen");
		expect(setDone("\t\t+ [ ] Bellen", true)).toBe("\t\t+ [x] Bellen");
	});

	it("is not fooled by brackets in the description", () => {
		expect(setDone("- [ ] Lees [boek](x.md) [nog]", true)).toBe(
			"- [x] Lees [boek](x.md) [nog]",
		);
	});

	it("adds no completion date of its own", () => {
		expect(setDone("- [ ] Bellen", true)).not.toContain("✅");
	});

	it("says nothing about a line that is not a task", () => {
		expect(setDone("gewone tekst", true)).toBe("gewone tekst");
		expect(setDone("# Kop", true)).toBe("# Kop");
	});
});

describe("setStatus", () => {
	it("writes the other two statuses Tasks defines", () => {
		expect(setStatus("- [ ] Bellen", "/")).toBe("- [/] Bellen");
		expect(setStatus("- [ ] Bellen", "-")).toBe("- [-] Bellen");
	});

	it("goes back to open from either of them", () => {
		expect(setStatus("- [/] Bellen", " ")).toBe("- [ ] Bellen");
		expect(setStatus("- [-] Bellen", " ")).toBe("- [ ] Bellen");
	});

	it("changes one status straight into another", () => {
		expect(setStatus("- [/] Bellen", "-")).toBe("- [-] Bellen");
		expect(setStatus("- [x] Bellen", "/")).toBe("- [/] Bellen");
	});

	it("leaves the rest of the line exactly as it was", () => {
		const line = "    * [ ] Bellen 📅 2026-08-20 ⏫ #werk ^a1b2c3";
		expect(setStatus(line, "/")).toBe(
			"    * [/] Bellen 📅 2026-08-20 ⏫ #werk ^a1b2c3",
		);
	});

	it("says nothing new when the line already says it", () => {
		expect(setStatus("- [/] Bellen", "/")).toBe("- [/] Bellen");
	});

	it("does not touch a line that is not a task", () => {
		expect(setStatus("Gewoon een zin", "/")).toBe("Gewoon een zin");
		expect(setStatus("- [R](https://example.com) een link", "/")).toBe(
			"- [R](https://example.com) een link",
		);
	});

	it("survives a status character that is itself a bracket", () => {
		// The bug this whole family of functions was rewritten for: searching
		// for the brackets by name replaced the wrong pair and left a line that
		// no longer parsed as a task.
		expect(setStatus("- [[] Bellen", "/")).toBe("- [/] Bellen");
	});

	it("reads back as the state it wrote", () => {
		expect(read(setStatus("- [ ] Bellen", "/")).state).toBe("in-progress");
		expect(read(setStatus("- [ ] Bellen", "-")).state).toBe("cancelled");
	});
});

describe("setPriority", () => {
	it("adds a priority to a bare task", () => {
		expect(setPriority("- [ ] Bellen", "high")).toBe("- [ ] Bellen ⏫");
	});

	it("replaces the one that was there", () => {
		expect(setPriority("- [ ] Bellen 🔽", "highest")).toBe("- [ ] Bellen 🔺");
	});

	it("removes it when the priority is normal", () => {
		expect(setPriority("- [ ] Bellen ⏫", "normal")).toBe("- [ ] Bellen");
	});

	it("keeps the other fields, and their order", () => {
		const out = setPriority("- [ ] Bellen 📅 2026-08-20 🔽 🔁 every week", "high");
		expect(read(out).due).toBe("2026-08-20");
		expect(read(out).recurrence).toBe("every week");
		expect(read(out).priority).toBe("high");
	});

	it("leaves syntax it has never heard of exactly where it was", () => {
		const out = setPriority("- [ ] Bellen 🧪 lab 🔽 @context", "high");
		expect(out).toContain("🧪 lab");
		expect(out).toContain("@context");
		expect(read(out).priority).toBe("high");
	});

	it("keeps a trailing block reference last", () => {
		const out = setPriority("- [ ] Bellen ^a1b2c3", "high");
		expect(out).toBe("- [ ] Bellen ⏫ ^a1b2c3");
	});

	it("keeps the block reference last when replacing too", () => {
		const out = setPriority("- [ ] Bellen 🔽 ^a1b2c3", "high");
		expect(out).toBe("- [ ] Bellen ⏫ ^a1b2c3");
	});

	it("keeps tags in the description", () => {
		const out = setPriority("- [ ] Bellen #werk #urgent", "low");
		expect(read(out).tags).toEqual(["werk", "urgent"]);
	});

	it("leaves a double space inside the description alone", () => {
		const out = setPriority("- [ ] Bellen  met  Jan", "high");
		expect(out).toBe("- [ ] Bellen  met  Jan ⏫");
	});
});

describe("setDate", () => {
	it("adds a due date", () => {
		expect(setDate("- [ ] Bellen", "due", "2026-09-01")).toBe(
			"- [ ] Bellen 📅 2026-09-01",
		);
	});

	it("moves a due date without touching the rest", () => {
		const line = "- [ ] Bellen ⏫ 📅 2026-08-20 #werk";
		const out = setDate(line, "due", "2026-08-27");

		expect(out).toBe("- [ ] Bellen ⏫ 📅 2026-08-27 #werk");
		expect(read(out).due).toBe("2026-08-27");
		expect(read(out).priority).toBe("high");
		expect(read(out).tags).toEqual(["werk"]);
	});

	it("keeps a tag that sits behind the date where it was", () => {
		// The rewrite replaces the date in place rather than re-appending it, so
		// nothing that came after it moves — including a tag.
		const out = setDate("- [ ] Bellen 📅 2026-08-20 #werk", "due", null);
		expect(out).toBe("- [ ] Bellen #werk");
	});

	it("removes a date when asked", () => {
		expect(setDate("- [ ] Bellen 📅 2026-08-20", "due", null)).toBe("- [ ] Bellen");
	});

	it("touches only the field it was asked about", () => {
		const out = setDate("- [ ] Bellen ⏳ 2026-08-01 📅 2026-08-20", "due", null);
		expect(read(out).scheduled).toBe("2026-08-01");
		expect(read(out).due).toBeUndefined();
	});

	it("understands the other glyphs Tasks accepts", () => {
		const out = setDate("- [ ] Bellen 📆 2026-08-20", "due", "2026-09-01");
		expect(read(out).due).toBe("2026-09-01");
		expect(out).not.toContain("📆");
	});

	it("keeps a recurrence rule intact", () => {
		const out = setDate("- [ ] Water geven 🔁 every 3 days 📅 2026-08-20", "due", "2026-08-23");
		expect(read(out).recurrence).toBe("every 3 days");
		expect(read(out).due).toBe("2026-08-23");
	});

	it("keeps a trailing comment where it was", () => {
		const out = setDate("- [ ] Bellen 📅 2026-08-20 <!-- later -->", "due", "2026-09-01");
		expect(out).toContain("<!-- later -->");
		expect(read(out).due).toBe("2026-09-01");
	});

	it("sets a scheduled or start date just as precisely", () => {
		expect(setDate("- [ ] Bellen", "scheduled", "2026-09-01")).toBe(
			"- [ ] Bellen ⏳ 2026-09-01",
		);
		expect(setDate("- [ ] Bellen", "start", "2026-09-01")).toBe(
			"- [ ] Bellen 🛫 2026-09-01",
		);
	});
});

describe("what a rewrite must never do", () => {
	const AWKWARD = [
		"- [ ] Bellen",
		"    - [x] Diep ingesprongen 📅 2026-08-20",
		"* [ ] Ster met #tag en [[link]] 🔺",
		"1. [ ] Genummerd 🔁 every week 📅 2026-08-20 ^ref-1",
		"- [ ] Emoji in de tekst 🎉 en een veld ⏬",
		"- [ ] Onbekend veld 🧪 waarde 📅 2026-08-20",
		"- [ ] Twee  spaties   binnenin",
	];

	it("leaves every other field readable after a priority change", () => {
		for (const line of AWKWARD) {
			const before = read(line);
			const after = read(setPriority(line, "medium"));

			expect(after.due).toBe(before.due);
			expect(after.recurrence).toBe(before.recurrence);
			expect(after.tags).toEqual(before.tags);
			expect(after.done).toBe(before.done);
			expect(after.priority).toBe("medium");
		}
	});

	it("leaves the description untouched, whatever is in it", () => {
		for (const line of AWKWARD) {
			const before = read(line);
			expect(read(setDate(line, "due", "2026-12-31")).description).toBe(
				before.description,
			);
			expect(read(setDone(line, true)).description).toBe(before.description);
		}
	});

	it("returns to the original when a change is undone", () => {
		for (const line of AWKWARD) {
			const roundTrip = setPriority(setPriority(line, "lowest"), read(line).priority);
			expect(read(roundTrip).priority).toBe(read(line).priority);
			expect(read(roundTrip).description).toBe(read(line).description);
		}
	});

	it("keeps a block reference at the very end", () => {
		const out = setDate("1. [ ] Genummerd 📅 2026-08-20 ^ref-1", "due", "2026-09-09");
		expect(out.endsWith("^ref-1")).toBe(true);
		expect(read(out).due).toBe("2026-09-09");
	});
});
