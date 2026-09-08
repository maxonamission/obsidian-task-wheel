import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe as group, expect, it } from "vitest";
import { boxAction } from "../view/box-keys";
import { isKeyboardControl, isTextBox } from "../view/typing";

/**
 * Leaving a box you have typed in (BC_E3_S182).
 *
 * The panel has six boxes and one of them knew what Enter means. Measured in
 * Chromium: a real Enter in a text input outside a form fires `change` and
 * leaves the cursor where it was, so the other five *applied* what was typed
 * and then left the reader standing in the box (eigenaarsmelding 8 sep 2026).
 */

const src = (name: string): string =>
	readFileSync(join(__dirname, "..", name), "utf8");

group("boxAction", () => {
	it("reads Enter as done and Escape as never mind", () => {
		expect(boxAction("Enter")).toBe("submit");
		expect(boxAction("Escape")).toBe("cancel");
	});

	it("leaves every other key to the box", () => {
		for (const key of ["a", " ", "ArrowDown", "Backspace", "Tab", "Shift"]) {
			expect(boxAction(key)).toBe("none");
		}
	});
});

group("isKeyboardControl", () => {
	it("covers the boxes a reader types in", () => {
		for (const tagName of ["INPUT", "TEXTAREA"]) {
			expect(isKeyboardControl({ tagName })).toBe(true);
		}
		expect(isKeyboardControl({ isContentEditable: true })).toBe(true);
	});

	/**
	 * A dropdown too, which `isTextBox` deliberately does not cover.
	 *
	 * Nobody types in a `<select>`, so it is not a text box; the arrow keys do
	 * walk its options, so it is a control the keyboard belongs to. The two
	 * questions are close enough to be confused and different enough to matter,
	 * which is why they have separate names.
	 */
	it("covers a dropdown, which is not a text box", () => {
		expect(isKeyboardControl({ tagName: "SELECT" })).toBe(true);
		expect(isTextBox({ tagName: "SELECT" })).toBe(false);
	});

	it("leaves the canvas and the drawing alone", () => {
		for (const tagName of ["DIV", "BUTTON", "svg", "circle"]) {
			expect(isKeyboardControl({ tagName })).toBe(false);
		}
		expect(isKeyboardControl(null)).toBe(false);
	});
});

/**
 * The drift guard.
 *
 * A seventh box added to the panel without `leaves` would be the same bug back,
 * and it would look right — the box works, it just cannot be left. So the test
 * counts rather than checks one name: every helper that builds an `input` the
 * reader types into wires the shared handler.
 */
group("every box in the panel can be left", () => {
	const panel = src("view/filter-panel.ts");

	it("wires the shared handler from each text-taking helper", () => {
		// The date box is the deliberate exception: Enter there belongs to the
		// platform's own picker (story scope), so it is named here rather than
		// silently missing.
		for (const helper of ["function search", "function text", "function tags", "function number"]) {
			const at = panel.indexOf(helper);
			expect(at, `${helper} is gone`).toBeGreaterThan(-1);
			const body = panel.slice(at, panel.indexOf("\n}", at));
			expect(body, `${helper} does not wire leaves()`).toContain("leaves(input");
		}
	});

	it("keeps the Enter handling in one place", () => {
		// One `keydown` listener in the whole panel: the one inside `leaves`.
		const listeners = panel.split('addEventListener("keydown"').length - 1;
		expect(listeners).toBe(1);
	});
});

/**
 * The other half, and the half the report was really about.
 *
 * `takeBackKeyboard` refuses to pull focus off anything the reader might still
 * be typing in — and it was called on the Enter path, where the active element
 * is always the box that was just typed in. So the refusal was the whole of the
 * outcome: the wheel turned to the match and the cursor stayed behind. Enter is
 * not a guess about whether someone is done; it is them saying so.
 */
group("Enter hands the keyboard over", () => {
	const view = src("view/wheel-view.ts");

	it("asks for the keyboard on both leaving paths", () => {
		expect(view).toContain("this.takeBackKeyboard(true)");
		expect(view).toContain("onEscape: () => this.takeBackKeyboard(true)");
	});

	it("still refuses when nobody asked", () => {
		expect(view).toContain("if (!asked && isKeyboardControl(active)) return;");
	});
});
