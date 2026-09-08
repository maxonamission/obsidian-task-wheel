import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTextBox } from "../view/typing";

/**
 * Is the reader mid-word? (BC_E3_S161)
 *
 * The wheel holds a rescan back while somebody is typing in one of its boxes.
 * The guard used to look for one class name — the rename box — which left the
 * search box in the filter panel out, and that is the one it matters for:
 * a sync landing there rebuilds the panel, and measured in Chromium the
 * removal fires `change` on the way out, so half a search term gets applied
 * and takes the round with it.
 */
describe("what counts as a box being typed in", () => {
	it("recognises the two boxes this plugin draws", () => {
		expect(isTextBox({ tagName: "INPUT" })).toBe(true);
		expect(isTextBox({ tagName: "TEXTAREA" })).toBe(true);
	});

	it("recognises an editable that is not an input at all", () => {
		expect(isTextBox({ tagName: "DIV", isContentEditable: true })).toBe(true);
	});

	it("says no to everything else on the wheel", () => {
		expect(isTextBox({ tagName: "DIV" })).toBe(false);
		expect(isTextBox({ tagName: "BUTTON" })).toBe(false);
		expect(isTextBox({ tagName: "svg" })).toBe(false);
		expect(isTextBox({ tagName: "BODY" })).toBe(false);
	});

	it("says no when there is nothing focused", () => {
		expect(isTextBox(null)).toBe(false);
		expect(isTextBox(undefined)).toBe(false);
		expect(isTextBox({})).toBe(false);
	});

	/**
	 * The reason this asks for a tag name instead of `instanceof`.
	 *
	 * Obsidian can put a view in a pop-out window, and a constructor belongs to
	 * the document it came from: an `<input>` there is not an `instanceof` the
	 * main window's `HTMLInputElement`. A plain object stands in for exactly
	 * that — a node this window's classes know nothing about.
	 */
	it("answers for a node from another window", () => {
		const fromPopout = { tagName: "INPUT" };
		expect(fromPopout instanceof Object).toBe(true);
		expect(isTextBox(fromPopout)).toBe(true);
	});
});

/**
 * That the guard is actually asked, in both the places that matter.
 *
 * The question being right buys nothing if a redraw does not ask it. Read from
 * the source, because both callers sit on an `ItemView` that needs a running
 * Obsidian.
 */
describe("where the guard is asked", () => {
	const view = readFileSync(
		join(__dirname, "..", "view", "wheel-view.ts"),
		"utf8",
	);

	it("holds a rescan back for any of our boxes, not one class name", () => {
		expect(view).toContain("if (this.isTyping(this.containerEl)) return;");
		// The class name it used to look for, gone.
		expect(view).not.toContain('querySelector(".task-wheel-card-rename")');
	});

	it("leaves the filter panel standing while its search box is in use", () => {
		expect(view).toContain("if (!this.isTyping(this.controlsEl)) {");
	});
});
