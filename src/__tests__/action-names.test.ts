import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_NAMES } from "../view/action-names";
import { HELP_LOCALES } from "../view/help-strings";

/**
 * The three surfaces that name a card action, held together (BC_E3_S164).
 *
 * The card draws a tooltip, `main.ts` registers a command, and the help panel
 * lists the icon with its name. The audit of 6 sep 2026 found all three drifting
 * apart: the help said *Mark in progress* where the command said *Mark as
 * started*, and *Tick off* where the button said *Mark done*. That is not a
 * cosmetic difference — the help exists so a reader can find an action and then
 * bind a key to it, and binding a key means finding it in the palette by name.
 *
 * The compiler already stops a language from missing a key. What it cannot see
 * is a name typed out again in a second file, so that is what this test reads.
 */

const SRC = join(__dirname, "..");

/** Which English help string names each commanded action. */
const HELP_KEY = {
	done: "actTick",
	start: "actProgress",
	cancel: "actCancel",
	defer: "actDefer",
	raise: "actRaise",
	lower: "actLower",
	openNote: "actOpenNote",
} as const;

describe("what a card action is called", () => {
	it("says the same thing in the English help as on the card", () => {
		for (const [action, key] of Object.entries(HELP_KEY)) {
			expect(HELP_LOCALES.en[key]).toBe(
				ACTION_NAMES[action as keyof typeof ACTION_NAMES],
			);
		}
	});

	/**
	 * The names are gone from the two files that used to spell them out, so a
	 * rename cannot land in one place and not the other. A literal here is the
	 * exact shape of the drift this story removed.
	 */
	it("is written down once, not once per file", () => {
		const offenders: string[] = [];

		for (const file of ["main.ts", "view/reading-card.ts"]) {
			const text = readFileSync(join(SRC, file), "utf8");
			for (const name of Object.values(ACTION_NAMES)) {
				if (text.includes(`"${name}"`)) offenders.push(`${file}: "${name}"`);
			}
		}

		expect(offenders).toEqual([]);
	});

	/**
	 * Every language fills every action name — the compiler's guarantee, said
	 * out loud, because an empty string satisfies the type and would leave a
	 * nameless icon on the card.
	 */
	it("is filled in in every language", () => {
		for (const [code, strings] of Object.entries(HELP_LOCALES)) {
			for (const key of Object.values(HELP_KEY)) {
				expect(strings[key], `${code}.${key}`).not.toBe("");
			}
		}
	});
});
