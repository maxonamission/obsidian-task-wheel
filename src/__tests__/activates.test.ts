import { describe, expect, it } from "vitest";
import { activates, renameRefusal, type TappedNode } from "../model/scope";
import type { NodeKind, SourceRef } from "../model/types";
import { VAULT_SCOPE } from "../model/types";

/**
 * What Enter and a double-click open (BC_E3_S105).
 *
 * One rule for both, deliberately: BC_E3_S99 existed because the keyboard was
 * poorer than the mouse, and letting only one of the two learn this would put
 * that back.
 *
 * Every kind is listed rather than only the interesting one. A sixth kind
 * arriving should make this test ask what it opens, instead of quietly
 * inheriting whichever branch the `else` happens to be.
 */

const KINDS: NodeKind[] = ["root", "domain", "project", "group", "task"];

describe("what activating an item opens", () => {
	it("opens a task for editing — it has no inside to step into", () => {
		expect(activates("task")).toBe("edit");
	});

	it("opens a wheel over everything that contains something", () => {
		for (const kind of KINDS.filter((one) => one !== "task")) {
			expect(`${kind}: ${activates(kind)}`).toBe(`${kind}: wheel`);
		}
	});

	it("has an answer for every kind there is", () => {
		for (const kind of KINDS) {
			expect(["edit", "wheel"]).toContain(activates(kind));
		}
	});
});

describe("why a title cannot be rewritten", () => {
	// The sentence is the view's; which refusal it is, is the rule — and the
	// rule is what has to be right per kind of item (BC_E3_S118).
	const node = (kind: NodeKind, depth = 1, source?: SourceRef): TappedNode => ({
		kind,
		depth,
		label: "Werk",
		source,
	});

	// Turned round by BC_E3_S119, which is what the doc comment on `NoRename`
	// promised: a heading and a note both have a name worth changing from the
	// card, and both now change it there. Neither reaches this function any
	// more — `actionsFor` hands each of them a `rename` — so what is left here
	// is the catch-all, and that is the honest answer for a shape that is not
	// supposed to arrive.
	it("has nothing left to say about a heading or a note", () => {
		expect(renameRefusal(node("group", 2), VAULT_SCOPE, "folder")).toEqual({
			refused: "nameless",
		});
		expect(renameRefusal(node("project", 2), VAULT_SCOPE, "folder")).toEqual({
			refused: "nameless",
		});
	});

	it("calls a wedge a folder only where a wedge is one", () => {
		expect(renameRefusal(node("domain"), VAULT_SCOPE, "folder")).toEqual({
			refused: "folder",
		});
		expect(renameRefusal(node("domain"), VAULT_SCOPE, "tag")).toEqual({
			refused: "wedge",
			source: "tag",
		});
	});

	it("knows that in a note's own wheel a wedge is a heading, and so renameable", () => {
		// The same branch `scopeFor` takes, for the same reason: there the top
		// ring is headings, whatever the domain setting says. Since BC_E3_S119
		// that means there is nothing to refuse — the wedge renames like any
		// other heading — so this branch answers the catch-all rather than
		// calling it a folder or a tag, which is what it must never do.
		expect(
			renameRefusal(node("domain"), { kind: "note", path: "Plan.md" }, "folder"),
		).toEqual({ refused: "nameless" });
		expect(
			renameRefusal(node("domain"), { kind: "note", path: "Plan.md" }, "tag"),
		).toEqual({ refused: "nameless" });
	});

	it("has a sentence left for anything else", () => {
		expect(renameRefusal(node("task", 3), VAULT_SCOPE, "folder")).toEqual({
			refused: "nameless",
		});
	});
});
