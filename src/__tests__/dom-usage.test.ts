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
