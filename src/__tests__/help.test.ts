import { describe, expect, it } from "vitest";
import { helpSubject } from "../model/help";
import {
	type HelpRoundState,
	keyGroups,
	roundBlock,
	type RoundRow,
} from "../view/help-content";
import {
	fmt,
	HELP_LOCALES,
	type HelpLanguage,
	type HelpStrings,
	resolveLanguage,
} from "../view/help-strings";

const EN = HELP_LOCALES.en;
const round = (state: HelpRoundState | null) => roundBlock(state, EN);

/**
 * The help panel (BC_E3_S54).
 *
 * Two things are measured, and they are the two that can be wrong. Which wheel
 * the panel is about — get that wrong and it reports on a round the reader is
 * not in, which is the lie harde eis §3.3 forbids. And what the round block
 * *says*: a row offering to unfold nothing, a filter line with one of its two
 * numbers, a percentage of an empty wheel.
 *
 * The panel itself needs a workspace and is not measured.
 */

const wheel = (over: Partial<HelpRoundState> = {}): HelpRoundState => ({
	read: true,
	seen: 12,
	total: 40,
	scope: "The whole vault",
	folded: 0,
	outward: null,
	...over,
});

const row = (rows: RoundRow[], label: string): RoundRow => {
	const found = rows.find((one) => one.label === label);
	if (found === undefined) throw new Error(`no ${label} row`);
	return found;
};

describe("helpSubject — which wheel the panel is about", () => {
	const open = (...keys: string[]) => (key: string) => keys.includes(key);

	it("takes the wheel that just became active", () => {
		expect(helpSubject("vault", "note:Plan.md", open("vault", "note:Plan.md")))
			.toBe("vault");
	});

	it("leaves the subject alone for any other pane", () => {
		// A note is not another wheel. It is the detour every round has in it, and
		// the panel has no more business moving than the wheel does.
		expect(helpSubject(null, "vault", open("vault"))).toBe("vault");
	});

	it("has no subject once that wheel is closed", () => {
		expect(helpSubject(null, "vault", open())).toBeNull();
	});

	it("has no subject before any wheel has been seen", () => {
		expect(helpSubject(null, null, open("vault"))).toBeNull();
	});
});

describe("roundBlock — where this round stands", () => {
	it("says there is no wheel, and offers the way to one", () => {
		const block = round(null);
		expect(block.head).toEqual({ kind: "none" });
		// One row, and it is the way on: closing the last wheel does not close
		// the panel, so this is what the reader is left looking at.
		expect(block.rows).toEqual([
			{
				label: "",
				text: "No wheel is open.",
				link: { text: "Open the wheel", action: "open-wheel" },
			},
		]);
	});

	it("reports how far the round has got, as a percentage of what is in it", () => {
		expect(round(wheel({ seen: 12, total: 40 })).head).toEqual({
			kind: "progress",
			seen: 12,
			total: 40,
			percent: 30,
		});
	});

	it("does not divide by an empty wheel", () => {
		// A blikveld with nothing in it is not "0% seen"; it is nothing to review.
		const block = round(wheel({ seen: 0, total: 0 }));
		expect(block.head).toEqual({ kind: "empty" });
		// The rows below still stand: the filter may be the reason it is empty.
		expect(block.rows.length).toBeGreaterThan(1);
	});

	it("does not call a wheel that has not read the vault empty", () => {
		// A wheel that has just opened has no items yet, which is not the same as
		// a blikveld with nothing in it — and on a vault of five thousand tasks
		// the difference is a second long enough to read.
		expect(round(wheel({ read: false, seen: 0, total: 0 })).head).toEqual({
			kind: "reading",
		});
	});

	it("says both of the filter's numbers, or that there is no filter", () => {
		const none = row(round(wheel()).rows, "Filter");
		expect(none.text).toContain("None");
		expect(none.link).toBeUndefined();

		const on = row(
			round(wheel({ filter: { text: "due soon", shown: 61, left: 143 } }))
				.rows,
			"Filter",
		);
		expect(on.text).toContain("61 in this round");
		expect(on.text).toContain("143 left out");
		expect(on.link).toEqual({ text: "Clear", action: "clear-filter" });
	});

	it("never offers to unfold nothing", () => {
		expect(row(round(wheel({ folded: 0 })).rows, "Folded").link)
			.toBeUndefined();
		expect(row(round(wheel({ folded: 3 })).rows, "Folded").link)
			.toEqual({ text: "Unfold all", action: "unfold" });
	});

	it("counts folded branches in words that fit the number", () => {
		expect(row(round(wheel({ folded: 1 })).rows, "Folded").text)
			.toContain("1 branch folded");
		expect(row(round(wheel({ folded: 2 })).rows, "Folded").text)
			.toContain("2 branches folded");
	});

	it("offers the way out only where there is one", () => {
		expect(row(round(wheel({ outward: null })).rows, "Scope").link)
			.toBeUndefined();
		expect(row(round(wheel({ outward: "Werk" })).rows, "Scope").link)
			.toEqual({ text: "Out to Werk", action: "outward" });
	});

	it("shows a phone only the moves a phone can make", () => {
		// A help block naming keys that are not there is noise exactly where
		// the block weighs heaviest — the phone has no palette either, so this
		// block is most of what mobile help is (eigenaar, 25 aug 2026).
		const pressed = (touch: boolean) =>
			keyGroups(touch, EN).flatMap((g) => g.rows.flatMap((r) => r.keys));

		const onDesktop = pressed(false);
		for (const key of ["PgUp", "Home", "space", "alt", "↑"]) {
			expect(onDesktop).toContain(key);
		}

		const onPhone = pressed(true);
		for (const key of ["PgUp", "Home", "space", "alt", "↑", "scroll"]) {
			expect(onPhone).not.toContain(key);
		}
		for (const gesture of ["swipe", "tap", "pinch", "‹"]) {
			expect(onPhone).toContain(gesture);
		}
	});

	it("never leaves an empty group, in any language", () => {
		for (const strings of Object.values(HELP_LOCALES)) {
			for (const touch of [false, true]) {
				for (const group of keyGroups(touch, strings)) {
					expect(group.rows.length).toBeGreaterThan(0);
				}
			}
		}
	});

	it("names the guarantee of the round on both kinds of device", () => {
		// The division of labour is the reason both ways of moving exist; only
		// the way of skipping differs per device.
		expect(EN.keysNote).toContain("guarantee lives in the turning");
		expect(EN.keysNoteTouch).toContain("guarantee lives in the turning");
		expect(EN.keysNoteTouch).not.toContain("arrows");
	});

	it("always offers the way into the skip report", () => {
		// The skip rules are a boundary, not a filter, so what they take out is
		// counted nowhere — which leaves a rule that matches nothing looking
		// exactly like one that works.
		expect(row(round(wheel()).rows, "Skipped").link).toEqual({
			text: "Show what's left out",
			action: "skip-report",
		});
	});
});

describe("the thirteen languages", () => {
	// The compiler already refuses a language that misses a key; what it cannot
	// see is what is inside a string. These two are the gaps that remain.
	const placeholders = (text: string): string[] =>
		[...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

	it("says something for every key, in every language", () => {
		for (const [lang, strings] of Object.entries(HELP_LOCALES)) {
			for (const key of Object.keys(strings) as (keyof HelpStrings)[]) {
				const text = strings[key];
				expect(`${lang}.${key}: ${text.trim() === "" ? "EMPTY" : "ok"}`).toBe(
					`${lang}.${key}: ok`,
				);
			}
		}
	});

	it("keeps every placeholder the English original has", () => {
		// A translation that drops {left} would silently stop reporting what the
		// filter leaves out — the exact half-truth harde eis §3.3 forbids.
		for (const [lang, strings] of Object.entries(HELP_LOCALES)) {
			for (const key of Object.keys(EN) as (keyof HelpStrings)[]) {
				expect(`${lang}.${key}: ${placeholders(strings[key]).join(",")}`).toBe(
					`${lang}.${key}: ${placeholders(EN[key]).join(",")}`,
				);
			}
		}
	});

	it("fills a template and leaves unknown names alone", () => {
		expect(fmt("{seen} of {total}", { seen: 1, total: 2 })).toBe("1 of 2");
		expect(fmt("{name} stays", {})).toBe("{name} stays");
	});

	it("resolves the language the way the setting promises", () => {
		const auto = (obsidian: string) => resolveLanguage("auto", obsidian);

		// An explicit choice wins over whatever Obsidian is set to.
		expect(resolveLanguage("nl", "en")).toBe("nl");
		// Auto follows Obsidian, regional tags collapse to their base…
		expect(auto("nl")).toBe("nl");
		expect(auto("pt-BR")).toBe("pt");
		expect(auto("zh-cn")).toBe("zh");
		// …and anything we do not carry falls back to English — including a
		// stored choice for a language a later version dropped.
		expect(auto("fi")).toBe("en");
		expect(resolveLanguage("xx", "nl")).toBe("nl");
	});

	it("carries exactly the thirteen languages of Voxtral Transcribe", () => {
		const carried = Object.keys(HELP_LOCALES).sort() as HelpLanguage[];
		expect(carried).toEqual(
			["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "nl", "pt", "ru", "zh"],
		);
	});
});
