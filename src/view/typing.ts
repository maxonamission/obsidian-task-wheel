/**
 * Whether a node is a box somebody types into (BC_E3_S161).
 *
 * By tag name rather than `instanceof HTMLInputElement`, and that is not a
 * shortcut. Obsidian can put a view in a **pop-out window**, and a constructor
 * belongs to the document it came from: an `<input>` in a pop-out is not an
 * `instanceof` the main window's `HTMLInputElement`, so the check would answer
 * "not a text box" about a box the reader is typing in. A tag name is the same
 * string in every window.
 *
 * Pure, and out of the view for that reason: it is a question about a node, and
 * a question can be tested without an Obsidian window to ask it in.
 */
export interface TypedNode {
	tagName?: string;
	isContentEditable?: boolean;
}

export function isTextBox(node: TypedNode | null | undefined): boolean {
	if (node === null || node === undefined) return false;

	// Upper case is what the DOM stores for HTML elements; SVG keeps its own
	// case, and none of its tags are text boxes anyway.
	const tag = node.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA") return true;

	// A contenteditable is the third way a reader can be mid-word — Obsidian's
	// own editor is one, and so is anything a theme puts in a panel.
	return node.isContentEditable === true;
}

/**
 * Whether a node is a control the keyboard belongs to right now (BC_E3_S182).
 *
 * A text box, or a `<select>`: the arrow keys walk a dropdown's options, so
 * pulling focus off one mid-choice loses the choice as surely as pulling it off
 * a half-typed word.
 *
 * By tag name for the reason above this file, and the reason applies here with
 * force: the guard this replaces used four `instanceof` checks, in the one
 * place BC_E3_S161 did not reach.
 */
export function isKeyboardControl(node: TypedNode | null | undefined): boolean {
	if (isTextBox(node)) return true;
	return node?.tagName === "SELECT";
}
