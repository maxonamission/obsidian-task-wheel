import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A guard against one specific way of breaking the plugin on a device.
 *
 * Obsidian's `createEl`/`createSvg` hand a `cls` string straight to
 * `classList.add`, which throws on anything containing a space. Nothing in the
 * type system stops you writing `cls: "a b"`, and it reads perfectly — it cost
 * two rounds of owner testing on Android, where it broke the drawing halfway
 * and left a wheel that looked finished but was never wired to the input.
 *
 * Two classes go in an array. This test is the only thing that says so.
 */

const SRC = join(__dirname, "..");

function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (entry !== "__tests__") sourceFiles(path, found);
			continue;
		}
		if (entry.endsWith(".ts")) found.push(path);
	}
	return found;
}

/** `cls: "…"` with a space inside the quotes. */
const SPACED_CLASS = /\bcls:\s*(["'])([^"']*\s[^"']*)\1/g;

describe("class names handed to Obsidian", () => {
	it("never puts two classes in one string", () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(SPACED_CLASS)) {
				offenders.push(`${file.slice(SRC.length + 1)}: cls: "${match[2]}"`);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("would notice if one crept back in", () => {
		expect(`cls: "a b"`.match(SPACED_CLASS)).not.toBeNull();
		expect(`cls: "a"`.match(SPACED_CLASS)).toBeNull();
		expect(`cls: ["a", "b"]`.match(SPACED_CLASS)).toBeNull();
	});
});

/**
 * A second way, met while chasing a blank help panel on the owner's phone
 * (25 aug 2026).
 *
 * A `<summary>` is a `list-item`, and that is not decoration: it is what makes
 * WebKit treat the element as the fold's handle. Give it a `display` of its own
 * — `flex`, to lay a caret out beside a title — and on iOS the whole `<details>`
 * can render as nothing, while desktop and Android are fine and nothing says a
 * word.
 *
 * Whether that was the blank panel is not settled; the panel's folds are
 * buttons now for other reasons. The hazard is real either way, and the layout
 * belongs on a div inside the summary. This is the only thing that says so.
 */
const STYLES = join(SRC, "..", "styles.css");

/**
 * A rule whose selector ends in the `summary` element, and its block.
 *
 * `(?<![-\w])` so that a class of our own that happens to end in the word —
 * `.task-wheel-skip-summary` — is not mistaken for the element.
 */
const SUMMARY_RULE = /([^{}]*(?<![-\w])summary\s*)\{([^}]*)\}/g;

describe("the stylesheet", () => {
	it("never gives a summary a display of its own", () => {
		const text = readFileSync(STYLES, "utf8");
		const offenders: string[] = [];

		for (const [, selector, body] of text.matchAll(SUMMARY_RULE)) {
			// The marker pseudo-element is not the summary; hiding that is the
			// supported way to take the triangle off.
			if (selector.includes("::")) continue;
			if (/(^|[;\s])display\s*:/.test(body)) {
				offenders.push(selector.trim());
			}
		}

		expect(offenders).toEqual([]);
	});

	it("would notice if one crept back in", () => {
		const bad = ".block > summary {\n\tdisplay: flex;\n}";
		const good = ".block > summary {\n\tcursor: pointer;\n}";
		const marker = ".block > summary::-webkit-details-marker {\n\tdisplay: none;\n}";

		const displays = (css: string): string[] =>
			[...css.matchAll(SUMMARY_RULE)]
				.filter(([, selector, body]) =>
					!selector.includes("::") && /(^|[;\s])display\s*:/.test(body),
				)
				.map(([, selector]) => selector.trim());

		expect(displays(bad)).toEqual([".block > summary"]);
		expect(displays(good)).toEqual([]);
		expect(displays(marker)).toEqual([]);
		// A class of ours that ends in the word is not the element.
		expect(displays(".task-wheel-skip-summary {\n\tdisplay: flex;\n}")).toEqual(
			[],
		);
	});
});

/**
 * An icon goes into a span of its own, never straight onto a button.
 *
 * The owner's iPad drew every control on the reading card as an empty box —
 * eight actions and both nudges, right size, no icon — while the Filter chip
 * and the scope chip in the same screenshot carried theirs. Those are buttons
 * too; the only difference was where the icon went. Ten failures and two
 * successes split exactly along `setIcon(button)` against `setIcon(span)`,
 * on a screen where the phone showed all twelve (28 aug 2026, BC_E3_S71).
 *
 * So `src/view/icon.ts` owns the construction and every control goes through
 * it. This is what keeps that true — the same guard the spaced-class rule
 * above keeps, and for the same reason: a device-only failure is invisible
 * here, so the rule has to be.
 */
describe("icons on controls", () => {
	/** `setIcon` taken from Obsidian, rather than a menu item's own method. */
	const IMPORTS_SET_ICON = /import\s*\{[^}]*\bsetIcon\b[^}]*\}\s*from\s*["']obsidian["']/s;

	it("are only ever put on by the one helper", () => {
		const offenders = sourceFiles(SRC)
			.filter((file) => IMPORTS_SET_ICON.test(readFileSync(file, "utf8")))
			.map((file) => file.slice(SRC.length + 1));

		expect(offenders).toEqual(["view/icon.ts"]);
	});

	it("would notice a control that put one on itself", () => {
		expect(IMPORTS_SET_ICON.test('import { setIcon } from "obsidian";')).toBe(true);
		expect(IMPORTS_SET_ICON.test('import { Menu, setIcon } from "obsidian";')).toBe(
			true,
		);
		expect(
			IMPORTS_SET_ICON.test('import {\n\tMenu,\n\tsetIcon,\n} from "obsidian";'),
		).toBe(true);
		// A menu item's own `.setIcon()` is a different thing and stays allowed.
		expect(IMPORTS_SET_ICON.test('menu.addItem((i) => i.setIcon("copy"));')).toBe(
			false,
		);
	});
});

/**
 * A third way, found by a user rather than by us (31 aug 2026).
 *
 * Obsidian renders **every** `aria-label` as a hover tooltip. That is fine for
 * a button, whose label is a name of two or three words. It is not fine for a
 * description: the wheel's canvas carried forty-five words explaining how to
 * turn it, so a mouse resting anywhere on the drawing got a paragraph, over and
 * over. *"The help-mouse-over popped up again and again. After reading it twice
 * I don't feel like it offers anything anymore."*
 *
 * The rule that separates the two is length. A label is a **name**; anything
 * long enough to be prose is a description, and a description belongs in a
 * hidden element the label points at with `aria-labelledby`, where a screen
 * reader still reads it and a mouse never sees it.
 *
 * The ceiling is generous on purpose — it is not a style rule about wording,
 * it is a guard against writing a paragraph into a tooltip.
 */
describe("accessible names", () => {
	/** An `aria-label` given a string literal, and that literal's text. */
	const ARIA_LABEL = /"aria-label":\s*(["'])((?:\\.|[^\\])*?)\1/g;

	const CEILING = 120;

	it("are names, not paragraphs", () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(SRC)) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(ARIA_LABEL)) {
				if (match[2].length <= CEILING) continue;
				offenders.push(
					`${file.slice(SRC.length + 1)}: ${match[2].slice(0, 40)}… (${match[2].length})`,
				);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("would notice a description written into one", () => {
		const short = '{ "aria-label": "Rename this task" }';
		const long = `{ "aria-label": "${"word ".repeat(40)}" }`;

		expect([...short.matchAll(ARIA_LABEL)][0]?.[2].length).toBeLessThan(CEILING);
		expect([...long.matchAll(ARIA_LABEL)][0]?.[2].length).toBeGreaterThan(CEILING);
	});
});

/**
 * The card keeps one size at every stop, and the unfolded title may not change
 * that (BC_E3_S90).
 *
 * The whole reason the card can float over the drawing is that it never
 * resizes: turning past a long task would otherwise push the wheel about under
 * the reader's eye. So the way to show a clipped title is an overlay, and the
 * obvious "fix" — letting the title grow the card — is the one thing that must
 * not happen. Neither the height nor the overlay is visible to a headless test,
 * so the shape of the rule is what gets guarded.
 */
/**
 * CSS the app we ship into cannot be trusted to have (1 sep 2026).
 *
 * Obsidian's plugin linter checks the stylesheet against the browser features
 * the app version supports, and it caught `clip-path` in the screen-reader
 * helper — a property that recipe adds as a second lock and does not need. A
 * warning found at submission time is a warning found late; the baseline is
 * cheap to keep here instead.
 *
 * This is not a ban on the property for ever. When Obsidian's floor moves,
 * move this — but move it deliberately, with the linter's word for it.
 */
describe("browser features Obsidian may not have", () => {
	// Declarations only. The comment above the screen-reader helper names the
	// property it is not using, and a guard that cannot tell prose from code
	// would fail on its own explanation — which is how this one first failed.
	const css = readFileSync(STYLES, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

	it("leaves clip-path alone", () => {
		expect(css).not.toMatch(/clip-path\s*:/);
	});

	it("would notice it coming back", () => {
		const withOne = "a { clip-path: inset(50%); }".replace(
			/\/\*[\s\S]*?\*\//g,
			"",
		);

		expect(withOne).toMatch(/clip-path\s*:/);
	});
});

describe("the reading card's fixed frame", () => {
	const css = readFileSync(STYLES, "utf8");

	function block(selector: string): string {
		const at = css.indexOf(selector);
		expect(at, `${selector} is missing`).toBeGreaterThanOrEqual(0);
		return css.slice(at, css.indexOf("}", at));
	}

	it("gives the card a height of its own", () => {
		expect(block(".task-wheel-card {")).toMatch(/\n\theight:/);
	});

	it("lifts the unfolded title out of the flow rather than growing the card", () => {
		const open = block(".task-wheel-card-title.is-open {");

		expect(open).toMatch(/position:\s*absolute/);
		expect(open).toMatch(/overflow-y:\s*auto/);
		// The clamp is what it undoes; anything else would leave it clipped.
		expect(open).toMatch(/-webkit-line-clamp:\s*none/);
	});

	it("keeps the unfolding control a word rather than a mobile button", () => {
		// Obsidian gives every button a 44px tap target and a filled pill on
		// mobile. Inside this fixed frame that is a grey slab across the card —
		// it happened to the action row once and to this once (1 sep 2026).
		const more = block(".task-wheel-card-more {");

		expect(more).toMatch(/min-height:\s*0/);
		expect(more).toMatch(/background:\s*none/);
	});

	it("keeps the way back out above the overlay", () => {
		const more = block(".task-wheel-card-more {");
		const open = block(".task-wheel-card-title.is-open {");

		const layer = (rule: string): number =>
			Number(/z-index:\s*(\d+)/.exec(rule)?.[1] ?? 0);

		expect(layer(more)).toBeGreaterThan(layer(open));
		expect(more).toMatch(/pointer-events:\s*auto/);
	});
});
