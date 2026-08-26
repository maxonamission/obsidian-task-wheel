import { describe, expect, it } from "vitest";
import { newNotePath } from "../parse/note-path";

describe("newNotePath — what somebody typed, as a note that can be made", () => {
	it("takes a bare name into the root of the vault", () => {
		expect(newNotePath("Klussen")).toEqual({
			path: "Klussen.md",
			folders: [],
		});
	});

	it("leaves an extension that is already there", () => {
		expect(newNotePath("Klussen.md")?.path).toBe("Klussen.md");
		expect(newNotePath("Klussen.MD")?.path).toBe("Klussen.MD");
	});

	it("makes every folder on the way, outermost first", () => {
		expect(newNotePath("Archief/2026/Klussen")).toEqual({
			path: "Archief/2026/Klussen.md",
			folders: ["Archief", "Archief/2026"],
		});
	});

	it("shrugs off the slashes people type by habit", () => {
		expect(newNotePath("/Archief//2026/Klussen/")?.path).toBe(
			"Archief/2026/Klussen.md",
		);
	});

	it("trims the spaces around each part, not the ones inside it", () => {
		expect(newNotePath("  Time and Energy / Go Do This Week ")).toEqual({
			path: "Time and Energy/Go Do This Week.md",
			folders: ["Time and Energy"],
		});
	});

	it("refuses an answer that names nothing", () => {
		expect(newNotePath("")).toBeNull();
		expect(newNotePath("   ")).toBeNull();
		expect(newNotePath("///")).toBeNull();
		expect(newNotePath(".md")).toBeNull();
	});

	it("refuses a character no file can carry", () => {
		for (const bad of ["Wat?", "A:B", 'Zeg "dit"', "a|b", "a*b", "a<b"]) {
			expect(newNotePath(bad)).toBeNull();
		}
	});

	it("refuses to climb out of the vault, or to hide", () => {
		expect(newNotePath("../buiten")).toBeNull();
		expect(newNotePath("Archief/../..")).toBeNull();
		expect(newNotePath(".verborgen")).toBeNull();
	});

	it("keeps a dot inside a name, which is ordinary", () => {
		expect(newNotePath("2026.08.20 overleg")?.path).toBe(
			"2026.08.20 overleg.md",
		);
	});
});
