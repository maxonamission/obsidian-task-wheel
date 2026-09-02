import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { below, inScope, isExcluded } from "../parse/domain";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	outward,
	type ParseOptions,
	scopeKey,
	scopeLabel,
	VAULT_SCOPE,
	type WheelScope,
} from "../model/types";

const NOTES: NoteInput[] = [
	{
		path: "Werk/Klanten/Northwind.md",
		content: ["## Analyse", "- [ ] Cijfers ophalen", "- [ ] Rapport schrijven"].join(
			"\n",
		),
	},
	{
		path: "Werk/Klanten/Eastgate.md",
		content: "- [ ] Offerte nakijken\n",
	},
	{
		path: "Werk/Intern/Administratie.md",
		content: "- [ ] Bonnetjes\n",
	},
	{ path: "Werk/Losse notitie.md", content: "- [ ] Iets zonder submap\n" },
	{ path: "Gezin/Weekend.md", content: "- [ ] Tassen pakken\n" },
];

const NOTE_WITH_HEADINGS: NoteInput = {
	path: "Werk/Plan.md",
	content: [
		"- [ ] Losse taak boven alles",
		"# Voorbereiding",
		"- [ ] Agenda rondsturen",
		"## Details",
		"- [ ] Zaal boeken",
		"# Uitvoering",
		"- [ ] Draaiboek schrijven",
	].join("\n"),
};

function options(scope: WheelScope, extra: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, scope, ...extra };
}

/** The wedges of a tree, which is what "re-rooting the angular axis" means. */
function wedges(notes: NoteInput[], opts: ParseOptions): string[] {
	return buildTree(notes, opts).domains.slice().sort();
}

describe("below", () => {
	it("reads a path from inside a folder", () => {
		expect(below("Werk/Klanten/Northwind.md", "Werk")).toBe("Klanten/Northwind.md");
	});

	it("leaves a path alone when it is not under the folder", () => {
		expect(below("Gezin/Weekend.md", "Werk")).toBe("Gezin/Weekend.md");
	});

	it("does not treat a name prefix as a folder", () => {
		expect(below("Werkgroep/x.md", "Werk")).toBe("Werkgroep/x.md");
	});

	it("survives the slashes people actually type", () => {
		expect(below("Werk/Klanten/Northwind.md", "/Werk/")).toBe("Klanten/Northwind.md");
	});
});

describe("inScope", () => {
	it("lets everything through for the whole vault", () => {
		expect(inScope("anything/at/all.md", { kind: "vault" })).toBe(true);
	});

	it("keeps a folder scope to its own folder", () => {
		const scope: WheelScope = { kind: "folder", path: "Werk" };
		expect(inScope("Werk/Klanten/Northwind.md", scope)).toBe(true);
		expect(inScope("Gezin/Weekend.md", scope)).toBe(false);
		expect(inScope("Werkgroep/x.md", scope)).toBe(false);
	});

	it("keeps a note scope to exactly one note", () => {
		const scope: WheelScope = { kind: "note", path: "Werk/Plan.md" };
		expect(inScope("Werk/Plan.md", scope)).toBe(true);
		expect(inScope("Werk/Plan 2.md", scope)).toBe(false);
	});
});

describe("a wheel over the whole vault", () => {
	it("still spreads the top folders over the circle", () => {
		expect(wedges(NOTES, options({ kind: "vault" }))).toEqual(["Gezin", "Werk"]);
	});
});

describe("a wheel over one folder", () => {
	const scope: WheelScope = { kind: "folder", path: "Werk" };

	it("makes the subfolders and the loose notes the wedges", () => {
		// What the file list shows at this level, in the same breath: folders and
		// notes side by side (BC_E3_S35).
		expect(wedges(NOTES, options(scope))).toEqual([
			"Intern",
			"Klanten",
			"Losse notitie",
		]);
	});

	it("gives a loose note a wedge of its own, not a shared leftovers wedge", () => {
		const loose: NoteInput[] = [
			{ path: "Werk/Plan.md", content: "- [ ] Eerste\n" },
			{ path: "Werk/Offerte.md", content: "- [ ] Tweede\n" },
		];

		// Two notes, two wedges. Before this they shared the fallback domain, and
		// a folder of two documents drew one wedge — the angular axis, the wheel's
		// main coding, saying nothing at all (eigenaar, 22 aug 2026).
		expect(wedges(loose, options(scope))).toEqual(["Offerte", "Plan"]);
	});

	it("hangs the note's tasks straight under it, with no note ring repeating it", () => {
		const tree = buildTree(NOTES, options(scope));
		const loose = tree.root.children.find(
			(child) => child.label === "Losse notitie",
		);

		expect(loose?.children.map((child) => child.label)).toEqual([
			"Iets zonder submap",
		]);
	});

	it("says on that wedge that it is a note, so carrying it carries the note", () => {
		const tree = buildTree(NOTES, options(scope));
		const loose = tree.root.children.find(
			(child) => child.label === "Losse notitie",
		);

		expect(loose?.kind).toBe("project");
		expect(loose?.source).toMatchObject({ path: "Werk/Losse notitie.md", line: 0 });
	});

	it("keeps a subfolder a folder, note ring and all", () => {
		const tree = buildTree(NOTES, options(scope));
		const clients = tree.root.children.find((child) => child.label === "Klanten");

		expect(clients?.kind).toBe("domain");
		expect(clients?.source).toBeUndefined();
	});

	it("tells a subfolder and a note of the same name apart", () => {
		const twins: NoteInput[] = [
			{ path: "Werk/Klanten.md", content: "- [ ] De notitie\n" },
			{ path: "Werk/Klanten/Northwind.md", content: "- [ ] De map\n" },
		];
		const tree = buildTree(twins, options(scope));

		// Two wedges reading the same, which is honest — they are two different
		// things. Merging them would put the note's tasks and the folder's under
		// one heading and lose which was which.
		expect(tree.root.children.map((child) => child.kind).sort()).toEqual([
			"domain",
			"project",
		]);
	});

	it("counts only the tasks inside the scope", () => {
		expect(buildTree(NOTES, options(scope)).root.shownTaskCount).toBe(5);
		expect(buildTree(NOTES, options({ kind: "vault" })).root.shownTaskCount).toBe(6);
	});

	it("keeps the folders below it as rings, not as wedges", () => {
		const tree = buildTree(NOTES, options(scope));
		const clients = tree.root.children.find((child) => child.label === "Klanten");
		expect(clients?.children.map((note) => note.label).sort()).toEqual([
			"Eastgate",
			"Northwind",
		]);
	});

	it("ignores the tag setting: a folder wheel asks about folders", () => {
		const tagged = options(scope, { domainSource: "tag" });
		expect(wedges(NOTES, tagged)).toEqual([
			"Intern",
			"Klanten",
			"Losse notitie",
		]);
	});

	it("still honours an excluded folder inside the scope", () => {
		const opts = options(scope, { excludeFolders: ["Werk/Intern"] });
		expect(wedges(NOTES, opts)).toEqual(["Klanten", "Losse notitie"]);
	});
});

describe("a wheel over one note", () => {
	const scope: WheelScope = { kind: "note", path: "Werk/Plan.md" };
	const notes = [...NOTES, NOTE_WITH_HEADINGS];

	it("makes the headings the wedges", () => {
		expect(wedges(notes, options(scope))).toEqual([
			"Overig",
			"Uitvoering",
			"Voorbereiding",
		]);
	});

	it("puts a task above the first heading in the fallback domain", () => {
		const tree = buildTree(notes, options(scope));
		const rest = tree.root.children.find((child) => child.label === "Overig");
		expect(rest?.children.map((task) => task.label)).toEqual([
			"Losse taak boven alles",
		]);
	});

	it("drops the project ring: the wheel is already inside the note", () => {
		const tree = buildTree(notes, options(scope));
		const prep = tree.root.children.find((child) => child.label === "Voorbereiding");
		expect(prep?.children.map((child) => child.label)).toEqual([
			"Agenda rondsturen",
			"Details",
		]);
	});

	it("keeps deeper headings as rings under their wedge", () => {
		const tree = buildTree(notes, options(scope));
		const prep = tree.root.children.find((child) => child.label === "Voorbereiding");
		const details = prep?.children.find((child) => child.label === "Details");
		expect(details?.children.map((task) => task.label)).toEqual(["Zaal boeken"]);
	});

	it("counts only that note's tasks", () => {
		expect(buildTree(notes, options(scope)).root.shownTaskCount).toBe(4);
	});

	it("keeps the wedges in the note's own order, not in the alphabet", () => {
		// A folder or a tag sorts by name — that is what keeps a wedge in the
		// same place year after year. A note's headings are its own order, and
		// sorting them alphabetically would mean moving a heading in the note
		// changed nothing on the wheel.
		expect(buildTree(notes, options(scope)).domains).toEqual([
			"Overig",
			"Voorbereiding",
			"Uitvoering",
		]);
	});

	it("gives each wedge the line its heading sits on", () => {
		// The top heading of a note is a wedge rather than a ring, but it is
		// still a heading — and one you can move, add to, or hang a section
		// under (kaderdocument §4.2).
		const tree = buildTree(notes, options(scope));
		const wedge = (label: string) =>
			tree.root.children.find((child) => child.label === label)?.source;

		expect(wedge("Voorbereiding")).toMatchObject({
			path: "Werk/Plan.md",
			line: 1,
		});
		expect(wedge("Uitvoering")).toMatchObject({ line: 5 });
		// Tasks above the first heading fall in the fallback domain, which is
		// not a heading and has no line to edit.
		expect(wedge("Overig")).toBeUndefined();
	});
});

describe("a wedge that is not a heading", () => {
	it("carries no line, so the wheel cannot offer to edit it", () => {
		// In a vault or folder wheel a wedge is a folder or a tag. Neither is a
		// line in a file, and the missing source is what says so.
		const tree = buildTree(NOTES, options(VAULT_SCOPE));
		for (const wedge of tree.root.children) {
			expect(wedge.source).toBeUndefined();
		}
	});
});

describe("isExcluded", () => {
	it("drops everything outside the scope", () => {
		const opts = options({ kind: "folder", path: "Werk" });
		expect(isExcluded({ path: "Gezin/Weekend.md", content: "" }, opts)).toBe(true);
		expect(isExcluded({ path: "Werk/Klanten/Northwind.md", content: "" }, opts)).toBe(
			false,
		);
	});
});

describe("naming a scope", () => {
	it("keys each wheel apart, so their state cannot mix", () => {
		expect(scopeKey({ kind: "vault" })).toBe("vault");
		expect(scopeKey({ kind: "folder", path: "Werk" })).toBe("folder:Werk");
		expect(scopeKey({ kind: "note", path: "Werk/Plan.md" })).toBe(
			"note:Werk/Plan.md",
		);
	});

	it("names the tab after the thing the wheel is about", () => {
		expect(scopeLabel({ kind: "vault" })).toBe("Task wheel");
		expect(scopeLabel({ kind: "folder", path: "Werk/Klanten" })).toBe("Klanten");
		expect(scopeLabel({ kind: "note", path: "Werk/Plan.md" })).toBe("Plan");
	});
});

describe("outward — the blikveld one step wider (BC_E3_S37)", () => {
	it("takes a note out to the folder it is in", () => {
		expect(outward({ kind: "note", path: "Werk/Klanten/Northwind.md" })).toEqual({
			kind: "folder",
			path: "Werk/Klanten",
		});
	});

	it("takes a folder out to the folder above it", () => {
		expect(outward({ kind: "folder", path: "Werk/Klanten" })).toEqual({
			kind: "folder",
			path: "Werk",
		});
	});

	it("takes anything at the top out to the whole vault", () => {
		expect(outward({ kind: "folder", path: "Werk" })).toEqual(VAULT_SCOPE);
		expect(outward({ kind: "note", path: "Losse notitie.md" })).toEqual(
			VAULT_SCOPE,
		);
	});

	it("has nowhere to go from the vault, and says so", () => {
		// `null` and not "the vault again": a button that would land you where you
		// already are should not be there at all.
		expect(outward(VAULT_SCOPE)).toBeNull();
	});

	it("walks all the way out, one step at a time", () => {
		const steps: string[] = [];
		let at: WheelScope | null = { kind: "note", path: "a/b/c/d.md" };
		while (at !== null) {
			steps.push(scopeKey(at));
			at = outward(at);
		}

		expect(steps).toEqual([
			"note:a/b/c/d.md",
			"folder:a/b/c",
			"folder:a/b",
			"folder:a",
			"vault",
		]);
	});
});
