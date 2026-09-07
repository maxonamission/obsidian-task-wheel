import { describe as group, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { describe, isFiltering, matches } from "../parse/filter";
import { parseTaskLine } from "../parse/task-line";
import {
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	type NoteInput,
	type ParseOptions,
	type TaskFilter,
} from "../model/types";

const TODAY = "2026-08-20";

function fields(line: string) {
	const parsed = parseTaskLine(line);
	if (parsed === null) throw new Error(`not a task line: ${line}`);
	return parsed.fields;
}

function filter(over: Partial<TaskFilter> = {}): TaskFilter {
	return { ...NO_FILTER, withTags: [], withoutTags: [], ...over };
}

group("isFiltering", () => {
	it("is off when nothing is set", () => {
		expect(isFiltering(filter())).toBe(false);
	});

	it("ignores a blank row, which the settings list hands out on every add", () => {
		expect(isFiltering(filter({ withTags: ["", "  "] }))).toBe(false);
	});

	it("is on as soon as one rule is set", () => {
		expect(isFiltering(filter({ due: "overdue" }))).toBe(true);
		expect(isFiltering(filter({ minPriority: "high" }))).toBe(true);
		expect(isFiltering(filter({ withTags: ["werk"] }))).toBe(true);
		expect(isFiltering(filter({ withoutTags: ["someday"] }))).toBe(true);
	});
});

group("matches — dates", () => {
	const overdue = fields("- [ ] Gisteren 📅 2026-08-19");
	const todayTask = fields("- [ ] Vandaag 📅 2026-08-20");
	const soon = fields("- [ ] Volgende week 📅 2026-08-27");
	const far = fields("- [ ] Volgend jaar 📅 2027-01-01");
	const undated = fields("- [ ] Ooit");

	it("lets everything through by default", () => {
		for (const task of [overdue, todayTask, soon, far, undated]) {
			expect(matches(task, filter(), TODAY)).toBe(true);
		}
	});

	it("counts today as due, not as tomorrow's problem", () => {
		const rule = filter({ due: "overdue" });
		expect(matches(overdue, rule, TODAY)).toBe(true);
		expect(matches(todayTask, rule, TODAY)).toBe(true);
		expect(matches(soon, rule, TODAY)).toBe(false);
		expect(matches(undated, rule, TODAY)).toBe(false);
	});

	it("takes a window with both ends inside it", () => {
		// The seven other rules are all reckoned from today; this is the one that
		// is not. Both bounds count as in — "up to the 27th" is what a reader
		// means by "to the 27th" (BC_E3_S126).
		const rule = filter({ due: "between", from: "2026-08-20", until: "2026-08-27" });
		expect(matches(todayTask, rule, TODAY)).toBe(true);
		expect(matches(soon, rule, TODAY)).toBe(true);
		expect(matches(overdue, rule, TODAY)).toBe(false);
		expect(matches(far, rule, TODAY)).toBe(false);
	});

	it("leaves an end open when it is not given", () => {
		const from = filter({ due: "between", from: "2026-08-20" });
		expect(matches(overdue, from, TODAY)).toBe(false);
		expect(matches(far, from, TODAY)).toBe(true);

		const until = filter({ due: "between", until: "2026-08-20" });
		expect(matches(overdue, until, TODAY)).toBe(true);
		expect(matches(far, until, TODAY)).toBe(false);
	});

	it("takes the window's own date, not always the deadline", () => {
		// Tasks carries three dates and the window is as often about when you
		// meant to pick something up as about when it is due (eigenaar, 3 sep
		// 2026). Same task, two answers, depending on which date is asked for.
		const both = fields("- [ ] Bellen ⏳ 2026-08-21 📅 2026-09-30");
		const week = { from: "2026-08-20", until: "2026-08-27" } as const;

		expect(matches(both, filter({ due: "between", ...week }), TODAY)).toBe(false);
		expect(
			matches(both, filter({ due: "between", ...week, dateField: "scheduled" }), TODAY),
		).toBe(true);
	});

	it("leaves out a task that has no date of the asked-for kind", () => {
		const dueOnly = fields("- [ ] Alleen deadline 📅 2026-08-21");
		const rule = filter({
			due: "between",
			from: "2026-08-20",
			until: "2026-08-27",
			dateField: "start",
		});
		expect(matches(dueOnly, rule, TODAY)).toBe(false);
	});

	it("says which date the window is about, when it is not the deadline", () => {
		const rule = filter({
			due: "between",
			from: "2026-09-15",
			until: "2026-09-22",
			dateField: "scheduled",
		});
		expect(describe(rule)).toContain("scheduled 2026-09-15 – 2026-09-22");
		// And stays quiet about it when it is: "due 15 – 22" needs no explaining.
		expect(describe(filter({ due: "between", from: "2026-09-15", until: "2026-09-22" })))
			.toContain("due 2026-09-15");
	});

	it("never puts an undated task in a window", () => {
		// It lies between nothing, and there is a rule of its own for finding
		// those. This is the assumption that could quietly flip, so it is pinned.
		for (const rule of [
			filter({ due: "between" }),
			filter({ due: "between", from: "2020-01-01", until: "2030-01-01" }),
		]) {
			expect(matches(undated, rule, TODAY)).toBe(false);
		}
	});

	it("selects nothing from a window that ends before it starts", () => {
		const rule = filter({ due: "between", from: "2026-08-27", until: "2026-08-20" });
		for (const task of [overdue, todayTask, soon, far, undated]) {
			expect(matches(task, rule, TODAY)).toBe(false);
		}
		expect(describe(rule)).toContain("empty range");
	});

	it("says the window in words", () => {
		expect(describe(filter({ due: "between", from: "2026-09-15", until: "2026-09-22" })))
			.toContain("due 2026-09-15 – 2026-09-22");
		expect(describe(filter({ due: "between", from: "2026-09-15" }))).toContain("due from 2026-09-15");
		expect(describe(filter({ due: "between", until: "2026-09-22" }))).toContain("due up to 2026-09-22");
		// Neither end: still a filter, because everything undated falls out.
		expect(describe(filter({ due: "between" }))).toContain("has a date");
		expect(isFiltering(filter({ due: "between" }))).toBe(true);
	});

	it("reaches as far ahead as the horizon says", () => {
		const rule = filter({ due: "soon", horizon: 14 });
		expect(matches(soon, rule, TODAY)).toBe(true);
		expect(matches(far, rule, TODAY)).toBe(false);
		// Overdue work is still work: 'soon' includes what is already late.
		expect(matches(overdue, rule, TODAY)).toBe(true);
	});

	it("takes the horizon literally, to the day", () => {
		expect(matches(soon, filter({ due: "soon", horizon: 7 }), TODAY)).toBe(true);
		expect(matches(soon, filter({ due: "soon", horizon: 6 }), TODAY)).toBe(false);
	});

	it("separates dated from undated", () => {
		expect(matches(undated, filter({ due: "undated" }), TODAY)).toBe(true);
		expect(matches(soon, filter({ due: "undated" }), TODAY)).toBe(false);
		expect(matches(soon, filter({ due: "dated" }), TODAY)).toBe(true);
		expect(matches(undated, filter({ due: "dated" }), TODAY)).toBe(false);
	});
});

group("matches — words in the task", () => {
	const rapport = fields("- [ ] Northwind rapportage afmaken #werk 📅 2026-08-20");
	const bellen = fields("- [ ] Loodgieter bellen");

	it("keeps what holds every word, in any order", () => {
		expect(matches(rapport, filter({ text: "northwind rapport" }), TODAY)).toBe(true);
		expect(matches(rapport, filter({ text: "rapport northwind" }), TODAY)).toBe(true);
		expect(matches(rapport, filter({ text: "northwind offerte" }), TODAY)).toBe(false);
		expect(matches(bellen, filter({ text: "northwind" }), TODAY)).toBe(false);
	});

	it("ignores case", () => {
		expect(matches(rapport, filter({ text: "Northwind" }), TODAY)).toBe(true);
	});

	it("matches part of a word, so a stem finds its longer form", () => {
		expect(matches(rapport, filter({ text: "rapport" }), TODAY)).toBe(true);
	});

	it("searches the tags too", () => {
		expect(matches(rapport, filter({ text: "werk" }), TODAY)).toBe(true);
	});

	it("does not search the emoji fields", () => {
		// '2026' would otherwise find every task due this year, which the date
		// filter already does better and says out loud.
		expect(matches(rapport, filter({ text: "2026" }), TODAY)).toBe(false);
	});

	it("treats a box holding only spaces as empty", () => {
		expect(isFiltering(filter({ text: "   " }))).toBe(false);
		expect(matches(bellen, filter({ text: "   " }), TODAY)).toBe(true);
	});

	it("treats a box holding only a star as empty too", () => {
		// A star asks for everything, which is what an empty box already does.
		// Reporting the filter as on would put a '0 out' badge on the panel.
		expect(isFiltering(filter({ text: "*" }))).toBe(false);
		expect(matches(fields("- [ ] **Conclusie** afmaken"), filter({ text: "*" }), TODAY)).toBe(
			true,
		);
	});

	it("says what it is looking for, in the reader's own words", () => {
		// Written back as typed rather than wrapped in quotes: quotes now mean a
		// phrase, so putting them round everything would say something else.
		expect(describe(filter({ text: "northwind rapport" }))).toBe("northwind rapport");
		expect(describe(filter({ text: "northwind OR eastgate" }))).toBe("northwind OR eastgate");
	});

	it("takes OR and a quoted phrase", () => {
		const either = filter({ text: "northwind OR loodgieter" });
		expect(matches(rapport, either, TODAY)).toBe(true);
		expect(matches(bellen, either, TODAY)).toBe(true);

		const phrase = filter({ text: '"northwind rapportage"' });
		expect(matches(rapport, phrase, TODAY)).toBe(true);
		expect(matches(bellen, phrase, TODAY)).toBe(false);
	});

	it("forgives a typo in a bare word", () => {
		expect(matches(rapport, filter({ text: "rapportagie" }), TODAY)).toBe(true);
		expect(matches(bellen, filter({ text: "loodgeiter" }), TODAY)).toBe(true);
	});
});

group("matches — file: reaches into the note around the task", () => {
	// Half of what a task is about often lives in the title of its note:
	// 'Bellen' under 'Northwind roadmap' never says Northwind itself. Reaching for it is
	// an operator rather than the default, so a bare word cannot quietly drag in
	// everything that happens to live in one note.
	const bellen = fields("- [ ] Bellen");
	const NOTE = "Werk/Northwind roadmap.md";

	it("finds a task by the name of the note it sits in", () => {
		expect(matches(bellen, filter({ text: "file:roadmap" }), TODAY, NOTE)).toBe(true);
	});

	it("leaves the note out of it when nobody asked", () => {
		expect(matches(bellen, filter({ text: "roadmap" }), TODAY, NOTE)).toBe(false);
	});

	it("combines the two: one word from the task, one from the note", () => {
		expect(matches(bellen, filter({ text: "bellen file:northwind" }), TODAY, NOTE)).toBe(true);
		expect(matches(bellen, filter({ text: "mailen file:northwind" }), TODAY, NOTE)).toBe(false);
	});

	it("does not look for the task's own words in the note name", () => {
		expect(matches(bellen, filter({ text: "file:bellen" }), TODAY, NOTE)).toBe(false);
	});

	it("takes a phrase, and offers an alternative", () => {
		expect(matches(bellen, filter({ text: 'file:"northwind roadmap"' }), TODAY, NOTE)).toBe(true);
		expect(matches(bellen, filter({ text: 'file:"roadmap northwind"' }), TODAY, NOTE)).toBe(false);
		expect(
			matches(bellen, filter({ text: "file:offerte OR file:roadmap" }), TODAY, NOTE),
		).toBe(true);
	});

	it("searches the name, not the folders it sits in", () => {
		// The folders are the wedges of the wheel and have their own include and
		// exclude lists; searching them would pull in a whole branch by accident.
		expect(matches(bellen, filter({ text: "file:werk" }), TODAY, NOTE)).toBe(false);
	});

	it("leaves the extension out of it", () => {
		expect(matches(bellen, filter({ text: "file:md" }), TODAY, NOTE)).toBe(false);
	});

	it("forgives a typo there too", () => {
		expect(matches(bellen, filter({ text: "file:raodmap" }), TODAY, NOTE)).toBe(true);
	});

	it("says what it is looking for, operator and all", () => {
		expect(describe(filter({ text: "bellen file:roadmap" }))).toBe(
			"bellen file:roadmap",
		);
	});

	it("is still a filter when it is the only thing set", () => {
		expect(isFiltering(filter({ text: "file:roadmap" }))).toBe(true);
	});

	it("ignores a half-typed operator", () => {
		expect(isFiltering(filter({ text: "file:" }))).toBe(false);
		expect(matches(bellen, filter({ text: "file:" }), TODAY, NOTE)).toBe(true);
	});
});

group("matches — status", () => {
	const open = fields("- [ ] Nog niet begonnen");
	const started = fields("- [/] Mee bezig");
	const done = fields("- [x] Afgevinkt");
	const cancelled = fields("- [-] Geannuleerd");

	it("lets every status through by default", () => {
		for (const task of [open, started, done, cancelled]) {
			expect(matches(task, filter(), TODAY)).toBe(true);
		}
	});

	it("separates work not yet begun from work in hand", () => {
		expect(matches(open, filter({ status: "open" }), TODAY)).toBe(true);
		expect(matches(started, filter({ status: "open" }), TODAY)).toBe(false);

		expect(matches(started, filter({ status: "in-progress" }), TODAY)).toBe(true);
		expect(matches(open, filter({ status: "in-progress" }), TODAY)).toBe(false);
	});

	it("puts done and cancelled together under finished", () => {
		const rule = filter({ status: "finished" });
		expect(matches(done, rule, TODAY)).toBe(true);
		expect(matches(cancelled, rule, TODAY)).toBe(true);
		expect(matches(open, rule, TODAY)).toBe(false);
		expect(matches(started, rule, TODAY)).toBe(false);
	});

	it("counts a custom status as not started, the way the parser does", () => {
		expect(matches(fields("- [>] Doorgeschoven"), filter({ status: "open" }), TODAY)).toBe(
			true,
		);
	});

	it("is on as soon as it is set, and says so", () => {
		expect(isFiltering(filter({ status: "in-progress" }))).toBe(true);
		expect(describe(filter({ status: "in-progress" }))).toBe("in progress");
		expect(describe(filter({ status: "open" }))).toBe("not started");
	});
});

group("matches — parked for later", () => {
	// Tasks has no status character for 'deferred'. Putting something off is a
	// date: a start (🛫) or scheduled (⏳) date that has not arrived yet. The due
	// date says when it is wanted, which is a different question.
	const laterStart = fields("- [ ] Later beginnen 🛫 2026-09-01");
	const laterScheduled = fields("- [ ] Later ingepland ⏳ 2026-09-01");
	const startedAlready = fields("- [ ] Al begonnen 🛫 2026-08-01");
	const plain = fields("- [ ] Gewoon werk");
	const dueButParked = fields("- [ ] Wel een deadline 📅 2026-08-25 🛫 2026-09-01");

	it("keeps only what starts after today", () => {
		const rule = filter({ due: "parked" });
		expect(matches(laterStart, rule, TODAY)).toBe(true);
		expect(matches(laterScheduled, rule, TODAY)).toBe(true);
		expect(matches(startedAlready, rule, TODAY)).toBe(false);
		expect(matches(plain, rule, TODAY)).toBe(false);
	});

	it("counts today as arrived — a task that starts today is yours", () => {
		expect(matches(fields(`- [ ] Vandaag 🛫 ${TODAY}`), filter({ due: "parked" }), TODAY)).toBe(
			false,
		);
	});

	it("does not care where the due date sits", () => {
		// Wanted next week, but not to be picked up before September: parked.
		expect(matches(dueButParked, filter({ due: "parked" }), TODAY)).toBe(true);
	});

	it("ready now is exactly the other side of it", () => {
		const rule = filter({ due: "ready" });
		expect(matches(plain, rule, TODAY)).toBe(true);
		expect(matches(startedAlready, rule, TODAY)).toBe(true);
		expect(matches(laterStart, rule, TODAY)).toBe(false);
		expect(matches(dueButParked, rule, TODAY)).toBe(false);
	});

	it("says what it is doing", () => {
		expect(describe(filter({ due: "parked" }))).toBe("parked for later");
		expect(describe(filter({ due: "ready" }))).toBe("ready now");
	});
});

group("matches — priority", () => {
	it("keeps what is at or above the threshold", () => {
		const rule = filter({ minPriority: "high" });
		expect(matches(fields("- [ ] A 🔺"), rule, TODAY)).toBe(true);
		expect(matches(fields("- [ ] B ⏫"), rule, TODAY)).toBe(true);
		expect(matches(fields("- [ ] C 🔼"), rule, TODAY)).toBe(false);
		expect(matches(fields("- [ ] D"), rule, TODAY)).toBe(false);
	});

	it("treats an unmarked task as normal, not as nothing", () => {
		const rule = filter({ minPriority: "normal" });
		expect(matches(fields("- [ ] Geen markering"), rule, TODAY)).toBe(true);
		expect(matches(fields("- [ ] Laag 🔽"), rule, TODAY)).toBe(false);
	});
});

group("matches — tags", () => {
	const werk = fields("- [ ] A #werk");
	const klant = fields("- [ ] B #werk/klant");
	const thuis = fields("- [ ] C #thuis");
	const bare = fields("- [ ] D");

	it("keeps only what carries one of the wanted tags", () => {
		const rule = filter({ withTags: ["werk"] });
		expect(matches(werk, rule, TODAY)).toBe(true);
		expect(matches(thuis, rule, TODAY)).toBe(false);
		expect(matches(bare, rule, TODAY)).toBe(false);
	});

	it("lets a namespace cover its children", () => {
		expect(matches(klant, filter({ withTags: ["werk"] }), TODAY)).toBe(true);
		// But not the other way round: #werk is not inside #werk/klant.
		expect(matches(werk, filter({ withTags: ["werk/klant"] }), TODAY)).toBe(false);
	});

	it("does not treat a name prefix as a namespace", () => {
		expect(matches(fields("- [ ] E #werkgroep"), filter({ withTags: ["werk"] }), TODAY)).toBe(
			false,
		);
	});

	it("ignores case and a leading hash, the way Obsidian does", () => {
		expect(matches(werk, filter({ withTags: ["#WERK"] }), TODAY)).toBe(true);
	});

	it("throws out what carries an unwanted tag, whatever else it matches", () => {
		const rule = filter({ withTags: ["werk"], withoutTags: ["werk/klant"] });
		expect(matches(werk, rule, TODAY)).toBe(true);
		expect(matches(klant, rule, TODAY)).toBe(false);
	});
});

group("describe", () => {
	it("says what is on, in words a reader can check against", () => {
		expect(describe(filter({ due: "overdue" }))).toBe("overdue");
		expect(describe(filter({ due: "soon", horizon: 7 }))).toBe(
			"due within 7 days",
		);
		expect(describe(filter({ minPriority: "high" }))).toBe("high or above");
		expect(describe(filter({ withTags: ["werk", "thuis"] }))).toBe("#werk or #thuis");
		expect(describe(filter({ withoutTags: ["someday"] }))).toBe("not #someday");
	});

	it("joins several rules into one line", () => {
		expect(
			describe(filter({ due: "overdue", minPriority: "high", withTags: ["werk"] })),
		).toBe("overdue · high or above · #werk");
	});
});

group("the tree a filter builds", () => {
	const NOTES: NoteInput[] = [
		{
			path: "Werk/Plan.md",
			content: [
				"- [ ] Laat 📅 2026-08-01 ⏫",
				"- [ ] Later 📅 2026-12-01",
				"- [ ] Zonder datum",
			].join("\n"),
		},
		{
			path: "Gezin/Weekend.md",
			content: ["- [ ] Ouder zonder datum", "    - [ ] Kind 📅 2026-08-02"].join(
				"\n",
			),
		},
	];

	function build(over: Partial<TaskFilter>): ReturnType<typeof buildTree> {
		const options: ParseOptions = {
			...DEFAULT_PARSE_OPTIONS,
			today: TODAY,
			filter: filter(over),
		};
		return buildTree(NOTES, options);
	}

	it("draws everything when no filter is set", () => {
		const tree = build({});
		expect(tree.root.shownTaskCount).toBe(5);
		expect(tree.filteredOut).toBe(0);
	});

	it("accounts for every task: drawn plus left out is the whole set", () => {
		for (const rule of [
			{ due: "overdue" as const },
			{ due: "undated" as const },
			{ minPriority: "high" as const },
			{ withTags: ["bestaat-niet"] },
		]) {
			const tree = build(rule);
			expect(tree.root.shownTaskCount + tree.filteredOut).toBe(5);
		}
	});

	it("keeps a parent that does not match but has kept work under it", () => {
		const tree = build({ due: "overdue" });
		const labels = [...tree.byId.values()].map((node) => node.label);

		// 'Kind' is overdue and stays; its parent has no date at all and would
		// fail the filter on its own — but dropping it would orphan the child.
		expect(labels).toContain("Kind");
		expect(labels).toContain("Ouder zonder datum");
	});

	it("does not count a kept carrier as filtered out", () => {
		const tree = build({ due: "overdue" });
		// Two overdue tasks stay, and the carrier stays with them: three drawn,
		// two genuinely left out.
		expect(tree.root.shownTaskCount).toBe(3);
		expect(tree.filteredOut).toBe(2);
	});

	it("takes a note name through the whole tree", () => {
		// 'Weekend' appears in no task text at all; it is the name of the note.
		const tree = build({ text: "file:weekend" });
		expect(tree.root.shownTaskCount).toBe(2);
		expect(tree.filteredOut).toBe(3);
	});

	it("can empty the wheel without breaking it", () => {
		const tree = build({ withTags: ["bestaat-niet"] });
		expect(tree.root.shownTaskCount).toBe(0);
		expect(tree.filteredOut).toBe(5);
	});
});

group("maxPriority — de bovengrens naast de ondergrens (BC_E3_S18)", () => {
	const MARK: Record<string, string> = {
		highest: "🔺",
		high: "⏫",
		medium: "🔼",
		normal: "",
		low: "🔽",
		lowest: "⏬",
	};
	const task = (priority: string) => fields(`- [ ] Iets ${MARK[priority]}`.trim());

	const band = (min: string, max: string): TaskFilter => ({
		...NO_FILTER,
		minPriority: min as TaskFilter["minPriority"],
		maxPriority: max as TaskFilter["maxPriority"],
	});

	it("laat alles door zolang hij op any staat", () => {
		for (const priority of Object.keys(MARK)) {
			expect(matches(task(priority), NO_FILTER, TODAY, "n.md")).toBe(true);
		}
	});

	it("houdt tegen wat er bóven staat", () => {
		expect(matches(task("high"), band("any", "normal"), TODAY, "n.md")).toBe(false);
		expect(matches(task("low"), band("any", "normal"), TODAY, "n.md")).toBe(true);
		expect(matches(task("normal"), band("any", "normal"), TODAY, "n.md")).toBe(true);
	});

	it("maakt samen met de ondergrens een band", () => {
		const only = band("normal", "normal");
		expect(matches(task("normal"), only, TODAY, "n.md")).toBe(true);
		expect(matches(task("high"), only, TODAY, "n.md")).toBe(false);
		expect(matches(task("low"), only, TODAY, "n.md")).toBe(false);
	});

	it("telt als filteren, dus een tak draagt er de ronde mee", () => {
		expect(isFiltering(band("any", "low"))).toBe(true);
	});

	it("zegt in woorden wat hij doet", () => {
		expect(describe(band("any", "low"))).toContain("low or below");
		expect(describe(band("low", "high"))).toContain("high down to low");
		expect(describe(band("normal", "normal"))).toContain("normal only");
	});
});

/* ------------------------------------------------------------------ */
/* Every rule reads the date the reader chose (BC_E3_S140)             */
/* ------------------------------------------------------------------ */

group("which of the three dates a rule reads", () => {
	// A task put off until next month, with a deadline that has already gone by.
	// The two dates disagree on purpose: that is what tells the rules apart.
	const both = fields("- [ ] Aangifte 📅 2026-08-10 🛫 2026-09-15");
	// And one carrying nothing but a start date — the case that used to answer
	// "no date" while plainly having one (eigenaar, 4 sep 2026).
	const startOnly = fields("- [ ] Ooit beginnen 🛫 2026-08-15");

	const on = (over: Partial<TaskFilter>): TaskFilter => filter(over);

	it("reads the deadline unless told otherwise", () => {
		expect(matches(both, on({ due: "overdue" }), TODAY)).toBe(true);
	});

	it("reads the start date when that is what was asked about", () => {
		// Its 🛫 is a month out, so by that question it is not for now.
		expect(
			matches(both, on({ due: "overdue", dateField: "start" }), TODAY),
		).toBe(false);
	});

	it("no longer calls a task with only a 🛫 undated", () => {
		expect(matches(startOnly, on({ due: "dated", dateField: "start" }), TODAY)).toBe(
			true,
		);
		expect(
			matches(startOnly, on({ due: "undated", dateField: "start" }), TODAY),
		).toBe(false);

		// Asked about the deadline it still has none, and that is the right
		// answer to that question rather than a leftover of the old one.
		expect(matches(startOnly, on({ due: "undated" }), TODAY)).toBe(true);
	});

	it("counts a window of days from the chosen date", () => {
		const soonByStart = on({ due: "soon", horizon: 7, dateField: "start" });
		expect(matches(both, soonByStart, TODAY)).toBe(false);
		expect(matches(startOnly, soonByStart, TODAY)).toBe(true);
	});

	it("leaves parked and ready alone, whatever field is set", () => {
		// Those two ask about 🛫 and ⏳ against today by definition; pointing them
		// at the deadline would let the rule contradict itself.
		for (const field of ["due", "scheduled", "start"] as const) {
			expect(matches(both, on({ due: "parked", dateField: field }), TODAY)).toBe(
				true,
			);
			expect(matches(both, on({ due: "ready", dateField: field }), TODAY)).toBe(
				false,
			);
		}
	});

	it("says which date it is about, in the line under the wheel", () => {
		expect(describe(on({ due: "overdue" }))).toContain("overdue");
		expect(describe(on({ due: "overdue", dateField: "start" }))).toContain(
			"start overdue",
		);
		expect(describe(on({ due: "undated", dateField: "scheduled" }))).toContain(
			"no scheduled date",
		);
		expect(describe(on({ due: "soon", horizon: 3 }))).toContain("due within 3 days");
	});
});

/* ------------------------------------------------------------------ */
/* Only the work under one heading (BC_E3_S147)                        */
/* ------------------------------------------------------------------ */

group("under a heading", () => {
	const task = fields("- [ ] Bellen");
	const under = (path: string[], wanted: string): boolean =>
		matches(task, filter({ heading: wanted }), TODAY, "Werk/Plan.md", path);

	it("keeps what stands under that heading", () => {
		expect(under(["Project"], "Project")).toBe(true);
		expect(under(["Project", "Deze week"], "Project")).toBe(true);
	});

	it("leaves out what stands under another", () => {
		expect(under(["Beheer"], "Project")).toBe(false);
	});

	/**
	 * The rule this test used to assert the opposite of (BC_E3_S176).
	 *
	 * It read the outermost heading only, because the wedge is made of that
	 * same step. Measured on ordinary notes, that made the filter useless: a
	 * note opening with an `# H1` title carries the title as its outermost
	 * heading, so every section name matched nothing at all.
	 */
	it("reads every heading above the task, not only the outermost", () => {
		expect(under(["Plan 2027", "Deze week"], "Deze week")).toBe(true);
		expect(under(["Beheer", "Project"], "Project")).toBe(true);
		expect(under(["A", "B", "Project"], "Project")).toBe(true);
	});

	it("leaves out work that stands under no heading at all", () => {
		expect(under([], "Project")).toBe(false);
	});

	it("ignores case, and widens on a star like the skip lists do", () => {
		expect(under(["project"], "Project")).toBe(true);
		expect(under(["Project 2026"], "Project*")).toBe(true);
		expect(under(["Project 2026"], "Project")).toBe(false);
	});

	/**
	 * A reader types what their note says, and a note says `## Deze week`
	 * (eigenaar, 7 sep 2026). The hashes are markdown's way of spelling the
	 * level, not part of the name.
	 */
	it("takes the hashes a reader pastes in with the heading", () => {
		expect(under(["Deze week"], "## Deze week")).toBe(true);
		expect(under(["Deze week"], "#Deze week")).toBe(true);
		expect(under(["Deze week"], "  ###   Deze week  ")).toBe(true);
		expect(under(["Project 2026"], "## Project*")).toBe(true);
	});

	it("is off when it is empty, whitespace included", () => {
		expect(isFiltering(filter({ heading: "" }))).toBe(false);
		expect(isFiltering(filter({ heading: "  " }))).toBe(false);
		expect(isFiltering(filter({ heading: "Project" }))).toBe(true);
		expect(under([], "  ")).toBe(true);
	});

	/**
	 * Hashes alone name no heading, so they are not a filter — a field holding
	 * only `##` must not switch the round into "a selection" and start counting
	 * everything as left out.
	 */
	it("is off when only hashes were typed", () => {
		expect(isFiltering(filter({ heading: "##" }))).toBe(false);
		expect(isFiltering(filter({ heading: "  ###  " }))).toBe(false);
		expect(under(["Deze week"], "##")).toBe(true);
	});

	it("says what it is doing without the hashes", () => {
		expect(describe(filter({ heading: "## Deze week" }))).toContain(
			"under Deze week",
		);
	});

	it("says so in the line under the wheel", () => {
		expect(describe(filter({ heading: "Project" }))).toContain("under Project");
	});
});

group("under a heading, on a whole wheel", () => {
	const NOTES: NoteInput[] = [
		{
			path: "Werk/Vandaag.md",
			content: ["## Project", "- [ ] Bellen", "## Beheer", "- [ ] Mailen"].join("\n"),
		},
		{ path: "Werk/Ooit.md", content: "## Project\n- [ ] Opruimen" },
		{ path: "Thuis/Los.md", content: "- [ ] Afwas" },
	];

	function tasksOf(options: ParseOptions): string[] {
		const tree = buildTree(NOTES, options);
		const out: string[] = [];
		for (const node of tree.byId.values()) {
			if (node.kind === "task") out.push(node.label);
		}
		return out.sort();
	}

	it("collects the same heading across notes, whatever the domain comes from", () => {
		// The question the owner asked, and the reason this is a filter rather
		// than a wheel of its own: the scope stays what it was.
		for (const domainSource of ["folder", "tag", "property", "heading"] as const) {
			const options: ParseOptions = {
				...DEFAULT_PARSE_OPTIONS,
				domainSource,
				filter: { ...NO_FILTER, withTags: [], withoutTags: [], heading: "Project" },
			};
			expect(tasksOf(options)).toEqual(["Bellen", "Opruimen"]);
		}
	});

	it("counts what it leaves out rather than dropping it in silence", () => {
		const tree = buildTree(NOTES, {
			...DEFAULT_PARSE_OPTIONS,
			filter: { ...NO_FILTER, withTags: [], withoutTags: [], heading: "Project" },
		});

		expect(tree.filteredOut).toBe(2);
	});

	/**
	 * The scenario the owner met: every attempt gave an empty wheel
	 * (7 sep 2026, BC_E3_S176).
	 *
	 * Three notes that differ only in their title heading. The old rule read
	 * the outermost heading, and in two of the three that is the title, so
	 * `Deze week` matched a third of the work at best — and in a vault where
	 * every note opens with a title, none of it.
	 */
	const TITLED: NoteInput[] = [
		{
			// A title that is not the file's name, so it keeps its ring.
			path: "Werk/Plan.md",
			content: ["# Plan 2027", "", "## Deze week", "- [ ] Bellen"].join("\n"),
		},
		{
			// A title that repeats the file's name, so BC_E3_S70 drops it.
			path: "Werk/Beheer.md",
			content: ["# Beheer", "", "## Deze week", "- [ ] Mailen"].join("\n"),
		},
		{ path: "Werk/Los.md", content: "## Deze week\n- [ ] Opruimen" },
	];

	function titledTasks(heading: string): string[] {
		const tree = buildTree(TITLED, {
			...DEFAULT_PARSE_OPTIONS,
			filter: { ...NO_FILTER, withTags: [], withoutTags: [], heading },
		});
		const out: string[] = [];
		for (const node of tree.byId.values()) {
			if (node.kind === "task") out.push(node.label);
		}
		return out.sort();
	}

	it("finds a section whatever title heading the note opens with", () => {
		expect(titledTasks("Deze week")).toEqual(["Bellen", "Mailen", "Opruimen"]);
	});

	it("finds it with the hashes the note writes it with", () => {
		expect(titledTasks("## Deze week")).toEqual(["Bellen", "Mailen", "Opruimen"]);
	});

	it("still lets you filter on the title heading itself", () => {
		expect(titledTasks("Plan 2027")).toEqual(["Bellen"]);
	});
});
