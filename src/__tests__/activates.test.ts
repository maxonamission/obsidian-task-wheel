import { describe, expect, it } from "vitest";
import { activates } from "../model/scope";
import type { NodeKind } from "../model/types";

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
