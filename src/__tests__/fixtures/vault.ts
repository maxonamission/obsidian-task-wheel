import type { NoteInput } from "../../model/types";

/**
 * A small vault that exercises every hierarchy signal at once: a note with
 * headings and nested subtasks, a note without headings, a root-level note
 * with no folder, a note in an excluded folder, and a note whose tasks carry
 * domain tags that disagree with its folder.
 */
export const VAULT: NoteInput[] = [
	{
		path: "Werk/Handleiding.md",
		frontmatterTags: ["domein/werk"],
		content: [
			"---",
			"tags: [domein/werk]",
			"---",
			"",
			"# Handleiding",
			"",
			"## Voorbereiding",
			"",
			"- [ ] Interviews coderen 📅 2026-08-20 ⏫ #werk",
			"    - [ ] Codeboek opschonen",
			"    - [x] Steekproef trekken ✅ 2026-08-01",
			"- [ ] Stappenplan schrijven 🔁 every week",
			"",
			"## Review",
			"",
			"- [ ] Review met twee lezers 📅 2026-09-01 🔽",
			"",
			"```markdown",
			"- [ ] Dit is een voorbeeld in een codeblok en telt niet mee",
			"```",
			"",
		].join("\n"),
	},
	{
		path: "Werk/Propositie.md",
		content: ["- [ ] Tarievenblad herzien", "- [ ] Referentie vragen 🔺", ""].join(
			"\n",
		),
	},
	{
		path: "Gezin/Weekend.md",
		content: [
			"# Weekend",
			"",
			"- [ ] Route uitzoeken",
			"- [x] Boeken bevestigen ✅ 2026-08-10",
			"- [ ] Tassen klaar 🛫 2026-08-15",
			"",
		].join("\n"),
	},
	{
		path: "Losse notitie.md",
		content: "- [ ] Iets zonder map\n",
	},
	{
		path: "Archief/Oud plan.md",
		content: "- [ ] Mag niet op het wiel verschijnen\n",
	},
	{
		path: "Werk/Gemengd.md",
		content: [
			"- [ ] Haag snoeien #domein/huis",
			"- [ ] Schema week 3 #domein/gezondheid",
			"",
		].join("\n"),
	},
];
