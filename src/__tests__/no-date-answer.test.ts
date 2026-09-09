import { describe as group, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { matches } from "../parse/filter";
import { noDateAnswerText } from "../view/legend";
import {
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	VAULT_SCOPE,
	type NoteInput,
	type ParseOptions,
	type TaskFields,
} from "../model/types";

/**
 * No date answer beats a wrong one (BC_E3_S183).
 *
 * A task document carries its dates in front matter, under property names the
 * wheel does not read. Its `TaskFields` therefore come back without `due`,
 * `scheduled` or `start`, and every rule that reads one of those used to take
 * that absence for a fact about the note: *has no date* answered **yes** about
 * a document due tomorrow, and *ready now* answered **yes** about one scheduled
 * for next year. Both are confident and wrong, and the reader has no way to
 * find out — which is the shape §3.3 exists to forbid.
 *
 * `datesUnread` says which of the two absences this is. Ignorance is not a
 * date, so every rule but *any* declines to answer, and what falls out that
 * way is counted apart from the rest of "left out": the reader's own rule
 * explains the rest, and explains none of this.
 */

const READ: TaskFields = {
	statusChar: " ",
	done: false,
	state: "open",
	dependsOn: [],
	priority: "normal",
	tags: [],
	description: "Een taakregel zonder datum",
	raw: "- [ ] Een taakregel zonder datum",
};

const UNREAD: TaskFields = { ...READ, raw: "", datesUnread: true };

const ask = (fields: TaskFields, due: (typeof NO_FILTER)["due"]): boolean =>
	matches(fields, { ...NO_FILTER, due }, "2026-09-04", "Werk/Iets.md");

group("a checkbox that was read keeps answering date questions", () => {
	it("has no date, and says so", () => {
		expect(ask(READ, "undated")).toBe(true);
		expect(ask(READ, "dated")).toBe(false);
		// Nothing is holding it back, so it is ready.
		expect(ask(READ, "ready")).toBe(true);
		expect(ask(READ, "parked")).toBe(false);
	});
});

group("a document whose dates were never read answers none of them", () => {
	for (const rule of [
		"dated",
		"undated",
		"overdue",
		"soon",
		"parked",
		"ready",
		"between",
	] as const) {
		it(`declines *${rule}* instead of guessing`, () => {
			expect(ask(UNREAD, rule)).toBe(false);
		});
	}

	it("still answers the one rule that asks about no date", () => {
		expect(ask(UNREAD, "any")).toBe(true);
	});
});

const DOC: NoteInput = {
	path: "Werk/Migratie.md",
	content: "Bel de DBA.\n",
	frontmatter: { type: "task", due: "2026-09-05" },
	frontmatterTags: ["werk"],
};

const OPTIONS: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	scope: VAULT_SCOPE,
	taskNoteProperty: "type",
	taskNoteValue: "task",
	today: "2026-09-04",
};

group("the wheel counts what it could not answer about", () => {
	it("keeps that count apart from the rest of what the filter left out", () => {
		const tree = buildTree([DOC], {
			...OPTIONS,
			filter: { ...NO_FILTER, due: "undated" },
		});

		expect(tree.filteredOut).toBe(1);
		expect(tree.documentsOutsideDateRule).toBe(1);
	});

	it("does not claim a document the reader's own rule already excluded", () => {
		const tree = buildTree([DOC], {
			...OPTIONS,
			filter: { ...NO_FILTER, due: "undated", withTags: ["thuis"] },
		});

		// It fails on the tag too, and a reader can read their own tag rule.
		expect(tree.documentsOutsideDateRule).toBe(0);
	});

	it("counts nothing when no date rule is running", () => {
		const tree = buildTree([DOC], {
			...OPTIONS,
			filter: { ...NO_FILTER, withTags: ["thuis"] },
		});

		expect(tree.documentsOutsideDateRule).toBe(0);
	});
});

group("and says it beside the rule", () => {
	it("writes nothing when there is nothing to say", () => {
		expect(noDateAnswerText(0)).toBeNull();
		expect(noDateAnswerText(-1)).toBeNull();
	});

	it("names the reason, not just the number", () => {
		expect(noDateAnswerText(1)).toBe(
			"1 task document left out: the wheel reads no dates in front matter",
		);
		expect(noDateAnswerText(4)).toBe(
			"4 task documents left out: the wheel reads no dates in front matter",
		);
	});
});
