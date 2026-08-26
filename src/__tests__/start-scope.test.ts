import { describe, expect, it } from "vitest";
import { type Found, startScope } from "../parse/start-scope";

/**
 * Which wheel opens with the vault (BC_E3_S35).
 *
 * A typed path, so the two things that can go wrong are reading it too strictly
 * and answering a missing one too kindly.
 */

const VAULT: Record<string, Found> = {
	Werk: "folder",
	"Werk/Klanten": "folder",
	"Werk/Plan.md": "note",
	"Deze week.md": "note",
};

const look = (path: string): Found => VAULT[path] ?? null;

describe("startScope — what the startup wheel is about", () => {
	it("takes an empty setting as the whole vault", () => {
		expect(startScope("", look)).toEqual({ scope: { kind: "vault" } });
		expect(startScope("   ", look)).toEqual({ scope: { kind: "vault" } });
	});

	it("opens a folder over a folder", () => {
		expect(startScope("Werk/Klanten", look)).toEqual({
			scope: { kind: "folder", path: "Werk/Klanten" },
		});
	});

	it("opens a note over a note", () => {
		expect(startScope("Werk/Plan.md", look)).toEqual({
			scope: { kind: "note", path: "Werk/Plan.md" },
		});
	});

	it("finds the note when the extension was left off", () => {
		// Everywhere else in Obsidian a note is called `Werk/Plan`. This box does
		// not get its own rules.
		expect(startScope("Werk/Plan", look)).toEqual({
			scope: { kind: "note", path: "Werk/Plan.md" },
		});
	});

	it("shrugs off the slashes people type by habit", () => {
		expect(startScope(" /Werk/ ", look)).toEqual({
			scope: { kind: "folder", path: "Werk" },
		});
	});

	it("prefers what is actually there over what could be added", () => {
		// A folder called `Werk` and a note called `Werk.md` can both exist. The
		// path as typed wins; guessing the other one would open the wrong wheel
		// without saying so.
		const both = (path: string): Found =>
			path === "Werk" ? "folder" : path === "Werk.md" ? "note" : null;

		expect(startScope("Werk", both)).toEqual({
			scope: { kind: "folder", path: "Werk" },
		});
	});

	it("says a path is missing rather than opening the vault instead", () => {
		expect(startScope("Werk/Weg", look)).toEqual({ missing: "Werk/Weg" });
	});

	it("hands back what was typed, so the message can name it", () => {
		expect(startScope("  Ooit/Weg.md  ", look)).toEqual({
			missing: "Ooit/Weg.md",
		});
	});

	it("does not take a folder for a note by adding an extension to it", () => {
		// `Werk` is a folder here; `Werk.md` is not in the vault. The answer is
		// the folder, and nothing about `.md` may change that.
		expect(startScope("Werk", look)).toEqual({
			scope: { kind: "folder", path: "Werk" },
		});
	});
});
