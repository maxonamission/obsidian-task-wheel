import { describe, expect, it } from "vitest";
import {
	domainFromTags,
	isExcluded,
	projectLabel,
	resolveDomain,
	topFolder,
} from "../parse/domain";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

const FOLDER_MODE: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, domainSource: "folder" };
const TAG_MODE: ParseOptions = { ...DEFAULT_PARSE_OPTIONS, domainSource: "tag" };

describe("topFolder", () => {
	it("takes the outermost folder", () => {
		expect(topFolder("Werk/Klant/Notitie.md")).toBe("Werk");
	});

	it("returns null for a note in the vault root", () => {
		expect(topFolder("Notitie.md")).toBeNull();
	});
});

describe("projectLabel", () => {
	it("is the basename without the extension", () => {
		expect(projectLabel("Werk/Handleiding.md")).toBe("Handleiding");
		expect(projectLabel("Losse notitie.md")).toBe("Losse notitie");
	});
});

describe("domainFromTags", () => {
	it("takes the first segment under the namespace", () => {
		expect(domainFromTags(["domein/werk"], "domein")).toBe("werk");
	});

	it("ignores deeper segments, because the domain is the outer ring", () => {
		expect(domainFromTags(["domein/werk/klant"], "domein")).toBe("werk");
	});

	it("tolerates a leading hash on either side", () => {
		expect(domainFromTags(["#domein/huis"], "#domein")).toBe("huis");
	});

	it("is case-insensitive on the namespace but keeps the label as written", () => {
		expect(domainFromTags(["Domein/Werk"], "domein")).toBe("Werk");
	});

	it("returns null when nothing matches", () => {
		expect(domainFromTags(["project/x", "werk"], "domein")).toBeNull();
		expect(domainFromTags(["domein/werk"], "")).toBeNull();
	});
});

describe("resolveDomain", () => {
	const base = { notePath: "Werk/Notitie.md", frontmatterTags: [], taskTags: [] };

	it("uses the top folder in folder mode", () => {
		expect(resolveDomain(base, FOLDER_MODE)).toBe("Werk");
	});

	it("falls back for a root-level note rather than dropping the task", () => {
		expect(
			resolveDomain({ ...base, notePath: "Notitie.md" }, FOLDER_MODE),
		).toBe(FOLDER_MODE.fallbackDomain);
	});

	it("prefers the task's own tag over the note's front matter", () => {
		expect(
			resolveDomain(
				{ ...base, frontmatterTags: ["domein/werk"], taskTags: ["domein/huis"] },
				TAG_MODE,
			),
		).toBe("huis");
	});

	it("uses front matter when the task has no domain tag", () => {
		expect(
			resolveDomain({ ...base, frontmatterTags: ["domein/werk"] }, TAG_MODE),
		).toBe("werk");
	});

	it("falls back when tag mode finds nothing, ignoring the folder", () => {
		expect(resolveDomain(base, TAG_MODE)).toBe(TAG_MODE.fallbackDomain);
	});
});

describe("isExcluded", () => {
	const options: ParseOptions = {
		...DEFAULT_PARSE_OPTIONS,
		excludeFolders: ["Archief", "Templates/"],
	};

	it("excludes notes under a listed folder", () => {
		expect(isExcluded({ path: "Archief/Oud.md", content: "" }, options)).toBe(true);
		expect(isExcluded({ path: "Templates/Story.md", content: "" }, options)).toBe(true);
	});

	it("does not exclude a folder that merely starts with the same letters", () => {
		expect(isExcluded({ path: "Archiefkast/Nu.md", content: "" }, options)).toBe(false);
	});

	it("ignores an empty entry, which would otherwise exclude the vault", () => {
		expect(
			isExcluded(
				{ path: "Werk/Nu.md", content: "" },
				{ ...DEFAULT_PARSE_OPTIONS, excludeFolders: ["", "  "] },
			),
		).toBe(false);
	});
});

describe("isExcluded — narrowing the vault to a few folders", () => {
	const note = (path: string): NoteInput => ({ path, content: "- [ ] x" });

	it("reads the whole vault when no folders are named", () => {
		const options = { ...DEFAULT_PARSE_OPTIONS };
		expect(isExcluded(note("Werk/Plan.md"), options)).toBe(false);
		expect(isExcluded(note("Losse notitie.md"), options)).toBe(false);
	});

	it("reads only the named folders once one is named", () => {
		const options = { ...DEFAULT_PARSE_OPTIONS, includeFolders: ["Werk"] };
		expect(isExcluded(note("Werk/Plan.md"), options)).toBe(false);
		expect(isExcluded(note("Werk/Diep/Plan.md"), options)).toBe(false);
		expect(isExcluded(note("Gezin/Plan.md"), options)).toBe(true);
		expect(isExcluded(note("Losse notitie.md"), options)).toBe(true);
	});

	it("does not mistake a folder for one with the same first letters", () => {
		const options = { ...DEFAULT_PARSE_OPTIONS, includeFolders: ["Werk"] };
		expect(isExcluded(note("Werkgroep/Plan.md"), options)).toBe(true);
	});

	it("lets an exclusion cut a hole in an included folder", () => {
		const options = {
			...DEFAULT_PARSE_OPTIONS,
			includeFolders: ["Werk"],
			excludeFolders: ["Werk/Archief"],
		};
		expect(isExcluded(note("Werk/Plan.md"), options)).toBe(false);
		expect(isExcluded(note("Werk/Archief/Oud.md"), options)).toBe(true);
	});

	it("ignores blank entries rather than reading nothing at all", () => {
		const options = { ...DEFAULT_PARSE_OPTIONS, includeFolders: ["", "  "] };
		expect(isExcluded(note("Werk/Plan.md"), options)).toBe(false);
	});
});
