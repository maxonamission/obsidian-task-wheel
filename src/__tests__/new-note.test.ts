import { beforeEach, describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import { noteFor } from "../view/note-picker";

/**
 * Making the note that was carried into (BC_E3_S31).
 *
 * The picker's own half — offering the row — needs a modal and is measured in
 * the harness. This is the half that touches the vault, which is where the
 * damage would be: folders made in the wrong order, a folder made over a note,
 * a half-made path left behind when something throws.
 */

const made: string[] = [];
const there = new Map<string, "note" | "folder">();

const file = (path: string): TFile => {
	const one = new TFile();
	one.path = path;
	one.basename = (path.split("/").pop() ?? path).replace(/\.md$/, "");
	return one;
};

const folder = (path: string): TFolder => {
	const one = new TFolder();
	one.path = path;
	return one;
};

const app = {
	vault: {
		getAbstractFileByPath: (path: string): TFile | TFolder | null => {
			const kind = there.get(path);
			if (kind === undefined) return null;
			return kind === "folder" ? folder(path) : file(path);
		},
		createFolder: (path: string): Promise<TFolder> => {
			made.push(`folder ${path}`);
			there.set(path, "folder");
			return Promise.resolve(folder(path));
		},
		create: (path: string): Promise<TFile> => {
			made.push(`note ${path}`);
			there.set(path, "note");
			return Promise.resolve(file(path));
		},
	},
} as never;

beforeEach(() => {
	made.length = 0;
	there.clear();
});

describe("noteFor — the note behind a choice", () => {
	it("hands back a note that is already there, making nothing", async () => {
		const one = file("Werk/Plan.md");

		expect(await noteFor(app, { kind: "existing", file: one })).toBe(one);
		expect(made).toEqual([]);
	});

	it("makes the note, and the folders above it first", async () => {
		const born = await noteFor(app, {
			kind: "new",
			path: "Archief/2026/Klussen.md",
			folders: ["Archief", "Archief/2026"],
		});

		expect(born?.path).toBe("Archief/2026/Klussen.md");
		// Outermost first: a folder cannot be made inside one that is not there.
		expect(made).toEqual([
			"folder Archief",
			"folder Archief/2026",
			"note Archief/2026/Klussen.md",
		]);
	});

	it("leaves a folder that already exists alone", async () => {
		there.set("Archief", "folder");

		await noteFor(app, {
			kind: "new",
			path: "Archief/Klussen.md",
			folders: ["Archief"],
		});

		expect(made).toEqual(["note Archief/Klussen.md"]);
	});

	it("refuses when a note is standing where a folder has to go", async () => {
		// `Archief` is a note; `Archief/Klussen.md` cannot exist under it. Saying
		// so beats whatever the vault would throw two calls later.
		there.set("Archief", "note");

		expect(
			await noteFor(app, {
				kind: "new",
				path: "Archief/Klussen.md",
				folders: ["Archief"],
			}),
		).toBeNull();
		expect(made).toEqual([]);
	});

	it("answers null rather than throwing when the vault refuses", async () => {
		const cross = {
			vault: {
				getAbstractFileByPath: () => null,
				createFolder: () => Promise.reject(new Error("no")),
				create: () => Promise.reject(new Error("no")),
			},
		} as never;

		expect(
			await noteFor(cross, { kind: "new", path: "Klussen.md", folders: [] }),
		).toBeNull();
	});

	it("makes an empty note — what goes in it is the work being carried", async () => {
		let written: string | undefined;
		const watching = {
			vault: {
				getAbstractFileByPath: () => null,
				createFolder: () => Promise.resolve(null),
				create: (path: string, data: string) => {
					written = data;
					return Promise.resolve(file(path));
				},
			},
		} as never;

		await noteFor(watching, { kind: "new", path: "Klussen.md", folders: [] });
		expect(written).toBe("");
	});
});
