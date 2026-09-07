/**
 * Every word the help surface says, in the thirteen languages Voxtral
 * Transcribe also carries (eigenaarsverzoek 25 aug 2026 — prompted by the
 * Dutch "blikveld" that had walked out of the design document into the
 * English UI).
 *
 * One typed contract, thirteen complete fillings: `Record<HelpLanguage,
 * HelpStrings>` means a language cannot silently miss a key — the compiler
 * refuses. Placeholders (`{seen}`, `{name}`, …) are checked against the
 * English original by test, because the compiler cannot see inside a string.
 *
 * Deliberately a pure module: no Obsidian import, so the whole table and the
 * resolution rule are measurable headlessly.
 */

export interface HelpStrings {
	/** The surface's own name: the modal title, the panel tab. */
	title: string;

	blockRound: string;
	blockKeys: string;
	blockLegend: string;

	/* --- where this round stands --- */
	seenOfTotal: string;
	seenNote: string;
	readingVault: string;
	nothingToReview: string;
	noWheel: string;
	openWheel: string;
	labelScope: string;
	labelFilter: string;
	labelSkipped: string;
	labelFolded: string;
	wholeVault: string;
	outTo: string;
	noFilter: string;
	filterCounts: string;
	clearFilter: string;
	skippedNote: string;
	showSkipReport: string;
	nothingFolded: string;
	foldedOne: string;
	foldedMany: string;
	unfoldAll: string;

	/* --- keys and actions --- */
	groupTurning: string;
	groupTree: string;
	groupCard: string;
	gestDrag: string;
	gestScroll: string;
	gestSwipe: string;
	gestTap: string;
	gestPinch: string;
	keyTurn: string;
	keyFlat: string;
	keyEnds: string;
	keySideways: string;
	keySidewaysTouch: string;
	keyOut: string;
	keyIn: string;
	keyTap: string;
	/** Backspace: the way back out of a wheel you stepped into. */
	keyBack: string;
	/** Ctrl/Cmd + Enter: open the note the item lives in. */
	keyNote: string;
	/** Enter: the keyboard's double-click. */
	keyOpen: string;
	keyFold: string;
	/** Ctrl/Cmd+F: the way into the filter, and Enter the way out of it. */
	keySearch: string;
	/** a / Shift+A: add a task beside this one, or a step inside it. */
	keyAdd: string;
	keyZoom: string;
	keyZoomTouch: string;
	keyMove: string;
	keysNote: string;
	keysNoteTouch: string;
	commandsNote: string;
	commandsNoteTouch: string;
	actTick: string;
	actProgress: string;
	actCancel: string;
	actDefer: string;
	actRaise: string;
	actLower: string;
	actOpenNote: string;
	actEdit: string;
	actFold: string;
	actNudge: string;

	/* --- reading the drawing --- */
	legAngleLabel: string;
	legAngle: string;
	legHues: string;
	legRamp: string;
	legWedge: string;
	legStump: string;
	legTicks: string;
	legGap: string;
	legStraightLabel: string;
	legStraight: string;
}

export type HelpLanguage =
	| "en"
	| "nl"
	| "ar"
	| "de"
	| "es"
	| "fr"
	| "hi"
	| "it"
	| "ja"
	| "ko"
	| "pt"
	| "ru"
	| "zh";

/** Native names, for the settings dropdown. */
export const LANGUAGE_NAMES: Record<HelpLanguage, string> = {
	en: "English",
	nl: "Nederlands",
	ar: "العربية",
	de: "Deutsch",
	es: "Español",
	fr: "Français",
	hi: "हिन्दी",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	pt: "Português",
	ru: "Русский",
	zh: "中文",
};

/**
 * Which language the help speaks.
 *
 * An explicit choice wins; "auto" follows Obsidian's own language setting
 * (Settings → General → Language, read via the locale Obsidian sets), and
 * anything we do not carry falls back to English. Regional tags collapse to
 * their base: `pt-BR` reads the Portuguese table, `zh-cn` the Chinese one.
 */
export function resolveLanguage(pref: string, obsidian: string): HelpLanguage {
	if (pref !== "auto" && pref in HELP_LOCALES) return pref as HelpLanguage;
	const base = obsidian.toLowerCase().split(/[-_]/)[0];
	return (base in HELP_LOCALES ? base : "en") as HelpLanguage;
}

/** `fmt("{n} of {m}", {n: 1, m: 2})` → `"1 of 2"`. Unknown names stay put. */
export function fmt(
	template: string,
	values: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in values ? String(values[name]) : whole,
	);
}

export const HELP_LOCALES: Record<HelpLanguage, HelpStrings> = {
	en: {
		title: "Task wheel help",
		blockRound: "This round",
		blockKeys: "Keys and actions",
		blockLegend: "Reading the drawing",
		seenOfTotal: "{seen} of {total} seen",
		seenNote:
			"Stopping on something is what makes it seen. Turning is the only walk that cannot skip anything.",
		readingVault: "Reading the vault…",
		nothingToReview: "Nothing to review in this scope.",
		noWheel: "No wheel is open.",
		openWheel: "Open the wheel",
		labelScope: "Scope",
		labelFilter: "Filter",
		labelSkipped: "Skipped",
		labelFolded: "Folded",
		wholeVault: "The whole vault",
		outTo: "Out to {name}",
		noFilter: "None. Every task in this scope is in the round.",
		filterCounts: "{rule} — {shown} in this round, {left} left out.",
		clearFilter: "Clear",
		skippedNote:
			"The skip rules are a boundary, not a filter: what they leave out is counted nowhere.",
		showSkipReport: "Show what's left out",
		nothingFolded: "Nothing folded away in this wheel.",
		foldedOne: "1 branch folded away here.",
		foldedMany: "{n} branches folded away here.",
		unfoldAll: "Unfold all",
		groupTurning: "Turning",
		groupTree: "Walking the tree",
		groupCard: "On the card",
		gestDrag: "drag",
		gestScroll: "scroll",
		gestSwipe: "swipe",
		gestTap: "tap",
		gestPinch: "pinch",
		keyTurn:
			"One click stop per task and per stump — turning never rests on a heading. The wheel never free-spins, which is what makes “all the way round” a fact.",
		keyFlat: "The flat round order — the walk that cannot skip anything.",
		keyEnds: "The first and the last stop.",
		keySideways:
			"Sideways. Forwards it takes you to the next item this round has not been past, wherever on the circle that is; back is always one step. Shift walks the other ring.",
		keySidewaysTouch: "Sideways — the two buttons on the card's edges. Forwards to the next task this round has not been past, wherever on the circle that is; back is always one step.",
		keyOut: "A ring outwards, to a child.",
		keyIn: "A ring inwards, to the parent.",
		keyTap:
			"Brings it under the wedge. A second tap opens it — a wheel over a heading or note, or the task itself, to edit.",
		keyOpen:
			"Opens what you are on: a wheel over a folder, note or heading — or the task itself, to edit. The same move as a double-click.",
		keyBack: "Back out to the wider wheel — vault, folder, note, section.",
		keyNote: "Opens the note this task is written in, at its own line.",
		keyFold: "Folds this branch away, or opens it again.",
		keySearch: "Opens the filter and puts the cursor in its search box. Enter there takes you to the next task it finds; Escape hands the wheel back.",
		keyAdd: "Adds a task beside this one; with shift, a step inside it. On any wheel: it goes into the note the task is written in.",
		keyZoom: "Zoom, or pinch on a touchscreen.",
		keyZoomTouch: "Zoom.",
		keyMove: "Moves the task itself, with everything under it. On any wheel, within its own note.",
		keysNote:
			"With the arrows you can skip a branch; by turning you cannot. That is the division of labour: the guarantee lives in the turning.",
		keysNoteTouch:
			"By tapping you can skip a branch; by turning you cannot. That is the division of labour: the guarantee lives in the turning.",
		commandsNote: "Almost all of these are commands as well, so you can hang your own key on them: the seven before the ⋯, plus adding a task and carrying work from inside that menu. Folding and the two nudges have keys already; opening the menu itself has none.",
		commandsNoteTouch: "Almost all of these are commands as well, so you can put them on the mobile toolbar: the seven before the ⋯, plus adding a task and carrying work from inside that menu. The ⋯ itself, folding and the two nudges live on the card only.",
		actTick: "Mark done",
		actProgress: "Mark in progress",
		actCancel: "Cancel",
		actDefer: "Push a week out",
		actRaise: "Raise priority",
		actLower: "Lower priority",
		actOpenNote: "Open the note",
		actEdit: "Edit the outline, or carry it elsewhere",
		actFold: "Fold this branch away",
		actNudge: "One item along, without turning",
		legAngleLabel: "Angle",
		legAngle: "The domain. Radius is the depth: hub, domain, project, task.",
		legHues:
			"Hue is the domain. The wheel writes each name on its own rim, in the colour it is drawn in.",
		legRamp: "Lightness is the priority — the channel you cannot read without a key.",
		legWedge:
			"The reading wedge stands still at twelve o'clock. The wheel turns past it, and stopping on something is what marks it seen.",
		legStump:
			"A stump with a counter: a branch folded away, or one past the drawing budget. Nothing is ever dropped.",
		legTicks: "Ticks are an outer ring too crowded to draw as dots.",
		legGap:
			"Empty space is an answer: every domain keeps its own slice of the circle, however little is in it.",
		legStraightLabel: "Straight",
		legStraight:
			"The branch you are reading runs straight up, written out in full from the hub.",
	},

	nl: {
		title: "Task wheel-hulp",
		blockRound: "Deze ronde",
		blockKeys: "Toetsen en acties",
		blockLegend: "De tekening lezen",
		seenOfTotal: "{seen} van {total} gezien",
		seenNote:
			"Ergens op stilstaan is wat het gezien maakt. Draaien is de enige wandeling die niets kan overslaan.",
		readingVault: "De vault wordt gelezen…",
		nothingToReview: "Niets te reviewen in dit blikveld.",
		noWheel: "Er is geen wiel open.",
		openWheel: "Open het wiel",
		labelScope: "Blikveld",
		labelFilter: "Filter",
		labelSkipped: "Overgeslagen",
		labelFolded: "Ingeklapt",
		wholeVault: "De hele vault",
		outTo: "Uit naar {name}",
		noFilter: "Geen. Elke taak in dit blikveld doet mee in de ronde.",
		filterCounts: "{rule} — {shown} in deze ronde, {left} erbuiten.",
		clearFilter: "Wissen",
		skippedNote:
			"De skip-regels zijn een grens, geen filter: wat ze weglaten wordt nergens meegeteld.",
		showSkipReport: "Toon wat erbuiten valt",
		nothingFolded: "Niets ingeklapt in dit wiel.",
		foldedOne: "1 tak hier ingeklapt.",
		foldedMany: "{n} takken hier ingeklapt.",
		unfoldAll: "Alles uitklappen",
		groupTurning: "Draaien",
		groupTree: "Door de boom",
		groupCard: "Op de kaart",
		gestDrag: "slepen",
		gestScroll: "scrollen",
		gestSwipe: "vegen",
		gestTap: "tik",
		gestPinch: "knijpen",
		keyTurn:
			"Eén klikstand per taak en per stomp — draaien landt nooit op een kop. Het wiel spint nooit vrij door, en dat is wat “helemaal rond geweest” een feit maakt.",
		keyFlat: "De platte ronde-volgorde — de wandeling die niets kan overslaan.",
		keyEnds: "De eerste en de laatste stop.",
		keySideways:
			"Opzij. Vooruit brengt hij je naar het volgende item dat deze ronde nog niet langskwam, waar op de cirkel dat ook is; terug is altijd één stap. Shift loopt de andere ring.",
		keySidewaysTouch: "Opzij — de twee knoppen op de randen van de kaart. Vooruit naar de volgende taak die deze ronde nog niet langskwam, waar op de cirkel dat ook is; terug is altijd één stap.",
		keyOut: "Een ring naar buiten, naar een kind.",
		keyIn: "Een ring naar binnen, naar de ouder.",
		keyTap:
			"Brengt het onder de leeswig. Een tweede tik opent het — een wiel over een kop of notitie, of de taak zelf, om te bewerken.",
		keyOpen:
			"Opent waar je op staat: een wiel over een map, notitie of kop — of de taak zelf, om te bewerken. Dezelfde beweging als een dubbelklik.",
		keyBack: "Terug naar het wijdere wiel — vault, map, notitie, sectie.",
		keyNote: "Opent de notitie waar deze taak in staat, op zijn eigen regel.",
		keyFold: "Klapt deze tak in, of weer uit.",
		keySearch: "Opent het filter met de cursor in het zoekveld. Enter brengt je daar naar de volgende gevonden taak; Escape geeft het wiel terug.",
		keyAdd: "Voegt een taak naast deze toe; met shift een stap erbinnen. Op elk wiel: hij komt in de notitie waar de taak in staat.",
		keyZoom: "Zoomen, of knijpen op een touchscreen.",
		keyZoomTouch: "Zoomen.",
		keyMove: "Verplaatst de taak zelf, met alles eronder. Op elk wiel, binnen haar eigen notitie.",
		keysNote:
			"Met de pijltjes kun je een tak overslaan; met draaien niet. Dat is de taakverdeling: de garantie zit in het draaien.",
		keysNoteTouch:
			"Met tikken kun je een tak overslaan; met draaien niet. Dat is de taakverdeling: de garantie zit in het draaien.",
		commandsNote: "Bijna al deze zijn ook een commando, dus je kunt er je eigen sneltoets aan hangen: de zeven vóór de ⋯, plus een taak toevoegen en werk dragen uit dat menu. Inklappen en de twee opzij-knoppen hebben al een toets; het menu zelf openen heeft er geen.",
		commandsNoteTouch: "Bijna al deze zijn ook een commando, dus je kunt ze op de mobiele werkbalk zetten: de zeven vóór de ⋯, plus een taak toevoegen en werk dragen uit dat menu. De ⋯ zelf, inklappen en de twee opzij-knoppen bestaan alleen op de kaart.",
		actTick: "Afvinken",
		actProgress: "Als bezig markeren",
		actCancel: "Annuleren",
		actDefer: "Een week opschuiven",
		actRaise: "Prioriteit omhoog",
		actLower: "Prioriteit omlaag",
		actOpenNote: "De notitie openen",
		actEdit: "De outline bewerken, of elders heen dragen",
		actFold: "Deze tak inklappen",
		actNudge: "Eén item opzij, zonder te draaien",
		legAngleLabel: "Hoek",
		legAngle: "Het domein. Straal is de diepte: naaf, domein, project, taak.",
		legHues:
			"Kleurtoon is het domein. Het wiel schrijft elke naam op zijn eigen rand, in de kleur waarin hij getekend is.",
		legRamp:
			"Lichtheid is de prioriteit — het kanaal dat je zonder sleutel niet kunt lezen.",
		legWedge:
			"De leeswig staat stil op twaalf uur. Het wiel draait erlangs, en ergens op stilstaan is wat het als gezien markeert.",
		legStump:
			"Een stomp met een teller: een ingeklapte tak, of één voorbij het tekenbudget. Er valt nooit iets weg.",
		legTicks: "Streepjes zijn een buitenring die te vol is voor stippen.",
		legGap:
			"Lege ruimte is een antwoord: elk domein houdt zijn eigen deel van de cirkel, hoe weinig er ook in staat.",
		legStraightLabel: "Recht",
		legStraight:
			"De tak die je leest loopt recht omhoog, voluit geschreven vanaf de naaf.",
	},

	ar: {
		title: "مساعدة عجلة المهام",
		blockRound: "هذه الجولة",
		blockKeys: "المفاتيح والإجراءات",
		blockLegend: "قراءة الرسم",
		seenOfTotal: "شوهد {seen} من {total}",
		seenNote:
			"التوقف عند عنصر هو ما يجعله مرئيًا. التدوير هو المسار الوحيد الذي لا يتخطى شيئًا.",
		readingVault: "جارٍ قراءة الخزنة…",
		nothingToReview: "لا شيء للمراجعة في هذا النطاق.",
		noWheel: "لا توجد عجلة مفتوحة.",
		openWheel: "افتح العجلة",
		labelScope: "النطاق",
		labelFilter: "التصفية",
		labelSkipped: "المتجاوَز",
		labelFolded: "المطوي",
		wholeVault: "الخزنة كاملة",
		outTo: "خروج إلى {name}",
		noFilter: "لا شيء. كل مهمة في هذا النطاق ضمن الجولة.",
		filterCounts: "{rule} — {shown} في هذه الجولة، و{left} خارجها.",
		clearFilter: "مسح",
		skippedNote:
			"قواعد التجاوز حدود وليست تصفية: ما تستبعده لا يُحتسب في أي مكان.",
		showSkipReport: "أظهر ما استُبعد",
		nothingFolded: "لا شيء مطوي في هذه العجلة.",
		foldedOne: "فرع واحد مطوي هنا.",
		foldedMany: "{n} فروع مطوية هنا.",
		unfoldAll: "افتح الكل",
		groupTurning: "التدوير",
		groupTree: "التنقل في الشجرة",
		groupCard: "على البطاقة",
		gestDrag: "سحب",
		gestScroll: "تمرير",
		gestSwipe: "تمريرة",
		gestTap: "نقرة",
		gestPinch: "قرص",
		keyTurn:
			"محطة واحدة لكل مهمة ولكل فرع مطوي — لا يتوقف الدوران على عنوان. العجلة لا تدور بحرية، وهذا ما يجعل «دورة كاملة» حقيقة.",
		keyFlat: "الترتيب المسطّح للجولة — المسار الذي لا يتخطى شيئًا.",
		keyEnds: "المحطة الأولى والأخيرة.",
		keySideways: "جانبيًا، مع البقاء على الحلقة نفسها.",
		keySidewaysTouch: "جانبيًا — الزران على حافتي البطاقة. إلى الأمام تنتقل إلى المهمة التالية التي لم تمر بها هذه الجولة، أينما كانت على الدائرة؛ وإلى الوراء دائمًا خطوة واحدة.",
		keyOut: "حلقة إلى الخارج، نحو فرع تابع.",
		keyIn: "حلقة إلى الداخل، نحو الأصل.",
		keyTap:
			"يضعه تحت موضع القراءة. نقرة ثانية تفتحه — عجلة على عنوان أو ملاحظة، أو المهمة نفسها للتحرير.",
		keyOpen:
			"يفتح ما تقف عنده: عجلة على مجلد أو ملاحظة أو عنوان — أو المهمة نفسها للتحرير. مثل النقر المزدوج تمامًا.",
		keyBack: "يعود إلى العجلة الأوسع — الخزنة، المجلد، الملاحظة، القسم.",
		keyNote: "يفتح الملاحظة التي كُتبت فيها هذه المهمة، عند سطرها.",
		keyFold: "يطوي هذا الفرع أو يفتحه من جديد.",
		keySearch: "يفتح عامل التصفية ويضع المؤشر في مربع البحث. يأخذك Enter إلى المهمة التالية التي يجدها، وEscape يعيد لك العجلة.",
		keyAdd: "يضيف مهمة بجانب هذه المهمة، ومع shift خطوة داخلها. في أي عجلة: تُكتب في الملاحظة التي تعيش فيها المهمة.",
		keyZoom: "تكبير، أو القرص على شاشة اللمس.",
		keyZoomTouch: "تكبير.",
		keyMove: "ينقل المهمة نفسها مع كل ما تحتها. في أي عجلة، داخل ملاحظتها.",
		keysNote:
			"بالأسهم يمكنك تخطي فرع؛ بالتدوير لا يمكنك. هذا هو تقسيم العمل: الضمان في التدوير.",
		keysNoteTouch:
			"بالنقر يمكنك تخطي فرع؛ بالتدوير لا يمكنك. هذا هو تقسيم العمل: الضمان في التدوير.",
		commandsNote: "كلها تقريبًا أوامر أيضًا، فيمكنك ربطها بمفاتيحك: السبعة قبل ⋯، وكذلك إضافة مهمة ونقل العمل من داخل تلك القائمة. الطي والزران الجانبيان لهما مفاتيح بالفعل؛ أما فتح القائمة نفسها فلا أمر له.",
		commandsNoteTouch: "كلها تقريبًا أوامر أيضًا، فيمكنك وضعها في شريط أدوات الجوال: السبعة قبل ⋯، وكذلك إضافة مهمة ونقل العمل من داخل تلك القائمة. أما ⋯ نفسها والطي والزران الجانبيان فتوجد على البطاقة فقط.",
		actTick: "إنجاز",
		actProgress: "وضع قيد التنفيذ",
		actCancel: "إلغاء",
		actDefer: "تأجيل أسبوعًا",
		actRaise: "رفع الأولوية",
		actLower: "خفض الأولوية",
		actOpenNote: "فتح الملاحظة",
		actEdit: "تحرير المخطط أو نقله إلى مكان آخر",
		actFold: "طي هذا الفرع",
		actNudge: "عنصر واحد إلى الجانب، دون تدوير",
		legAngleLabel: "الزاوية",
		legAngle: "المجال. نصف القطر هو العمق: المركز، المجال، المشروع، المهمة.",
		legHues: "اللون هو المجال. تكتب العجلة كل اسم على حافته بلونه.",
		legRamp: "الإضاءة هي الأولوية — القناة التي لا تُقرأ دون مفتاح.",
		legWedge:
			"موضع القراءة ثابت عند الساعة الثانية عشرة. العجلة تدور أمامه، والتوقف عند عنصر هو ما يجعله مرئيًا.",
		legStump:
			"جذل مع عدّاد: فرع مطوي، أو فرع خارج ميزانية الرسم. لا يسقط شيء أبدًا.",
		legTicks: "الشُرط حلقة خارجية مزدحمة عن أن تُرسم نقاطًا.",
		legGap:
			"الفراغ إجابة: كل مجال يحتفظ بحصته من الدائرة، مهما قلّ ما فيه.",
		legStraightLabel: "مستقيم",
		legStraight: "الفرع الذي تقرؤه يمتد مستقيمًا، مكتوبًا كاملًا من المركز.",
	},

	de: {
		title: "Task-wheel-Hilfe",
		blockRound: "Diese Runde",
		blockKeys: "Tasten und Aktionen",
		blockLegend: "Die Zeichnung lesen",
		seenOfTotal: "{seen} von {total} gesehen",
		seenNote:
			"Auf etwas stehen zu bleiben macht es gesehen. Drehen ist der einzige Gang, der nichts überspringen kann.",
		readingVault: "Vault wird gelesen…",
		nothingToReview: "Nichts zu reviewen in diesem Blickfeld.",
		noWheel: "Kein Rad ist offen.",
		openWheel: "Rad öffnen",
		labelScope: "Blickfeld",
		labelFilter: "Filter",
		labelSkipped: "Übersprungen",
		labelFolded: "Eingeklappt",
		wholeVault: "Der ganze Vault",
		outTo: "Hinaus zu {name}",
		noFilter: "Keiner. Jede Aufgabe in diesem Blickfeld ist in der Runde.",
		filterCounts: "{rule} — {shown} in dieser Runde, {left} außen vor.",
		clearFilter: "Leeren",
		skippedNote:
			"Die Skip-Regeln sind eine Grenze, kein Filter: Was sie auslassen, wird nirgends gezählt.",
		showSkipReport: "Zeigen, was draußen bleibt",
		nothingFolded: "Nichts eingeklappt in diesem Rad.",
		foldedOne: "1 Ast hier eingeklappt.",
		foldedMany: "{n} Äste hier eingeklappt.",
		unfoldAll: "Alles ausklappen",
		groupTurning: "Drehen",
		groupTree: "Durch den Baum",
		groupCard: "Auf der Karte",
		gestDrag: "ziehen",
		gestScroll: "scrollen",
		gestSwipe: "wischen",
		gestTap: "Tipp",
		gestPinch: "kneifen",
		keyTurn:
			"Eine Raststellung pro Aufgabe und pro eingeklapptem Zweig — beim Drehen wird nie auf einer Überschrift gehalten. Das Rad dreht nie frei durch, und das macht „einmal ganz herum“ zu einer Tatsache.",
		keyFlat: "Die flache Rundenfolge — der Gang, der nichts überspringen kann.",
		keyEnds: "Der erste und der letzte Halt.",
		keySideways: "Seitwärts, auf demselben Ring.",
		keySidewaysTouch: "Seitwärts — die zwei Knöpfe an den Kartenrändern. Vorwärts zur nächsten Aufgabe, an der diese Runde noch nicht vorbei war, wo auf dem Kreis sie auch liegt; zurück ist immer ein Schritt.",
		keyOut: "Einen Ring nach außen, zu einem Kind.",
		keyIn: "Einen Ring nach innen, zum Elternteil.",
		keyTap:
			"Bringt es unter den Lesekeil. Ein zweiter Tipp öffnet es — ein Rad über Überschrift oder Notiz, oder die Aufgabe selbst, zum Bearbeiten.",
		keyOpen:
			"Öffnet, worauf du stehst: ein Rad über Ordner, Notiz oder Überschrift — oder die Aufgabe selbst, zum Bearbeiten. Wie ein Doppelklick.",
		keyBack: "Zurück zum weiteren Rad — Vault, Ordner, Notiz, Abschnitt.",
		keyNote:
			"Öffnet die Notiz, in der diese Aufgabe steht, bei ihrer eigenen Zeile.",
		keyFold: "Klappt diesen Ast ein oder wieder auf.",
		keySearch: "Öffnet den Filter und setzt den Cursor ins Suchfeld. Enter bringt dich dort zur nächsten gefundenen Aufgabe; Escape gibt das Rad zurück.",
		keyAdd: "Fügt eine Aufgabe neben dieser ein; mit Umschalt einen Schritt darin. In jedem Rad: sie landet in der Notiz, in der die Aufgabe steht.",
		keyZoom: "Zoomen, oder Kneifen auf einem Touchscreen.",
		keyZoomTouch: "Zoomen.",
		keyMove: "Verschiebt die Aufgabe selbst, mit allem darunter. In jedem Rad, innerhalb ihrer eigenen Notiz.",
		keysNote:
			"Mit den Pfeilen kannst du einen Ast überspringen; durch Drehen nicht. Das ist die Arbeitsteilung: Die Garantie liegt im Drehen.",
		keysNoteTouch:
			"Mit Tippen kannst du einen Ast überspringen; durch Drehen nicht. Das ist die Arbeitsteilung: Die Garantie liegt im Drehen.",
		commandsNote: "Fast alle davon sind auch Befehle, du kannst also deine eigene Taste daran hängen: die sieben vor dem ⋯, dazu das Hinzufügen einer Aufgabe und das Tragen aus diesem Menü. Einklappen und die zwei Seitwärtsknöpfe haben schon Tasten; das Öffnen des Menüs selbst hat keinen Befehl.",
		commandsNoteTouch: "Fast alle davon sind auch Befehle, du kannst sie also in die mobile Werkzeugleiste legen: die sieben vor dem ⋯, dazu das Hinzufügen einer Aufgabe und das Tragen aus diesem Menü. Das ⋯ selbst, das Einklappen und die zwei Seitwärtsknöpfe gibt es nur auf der Karte.",
		actTick: "Abhaken",
		actProgress: "Als begonnen markieren",
		actCancel: "Abbrechen",
		actDefer: "Eine Woche hinausschieben",
		actRaise: "Priorität erhöhen",
		actLower: "Priorität senken",
		actOpenNote: "Die Notiz öffnen",
		actEdit: "Die Gliederung bearbeiten oder woanders hintragen",
		actFold: "Diesen Ast einklappen",
		actNudge: "Ein Element weiter, ohne zu drehen",
		legAngleLabel: "Winkel",
		legAngle: "Die Domäne. Radius ist die Tiefe: Nabe, Domäne, Projekt, Aufgabe.",
		legHues:
			"Farbton ist die Domäne. Das Rad schreibt jeden Namen auf seinen eigenen Rand, in der Farbe, in der er gezeichnet ist.",
		legRamp:
			"Helligkeit ist die Priorität — der Kanal, den man ohne Schlüssel nicht lesen kann.",
		legWedge:
			"Der Lesekeil steht still auf zwölf Uhr. Das Rad dreht daran vorbei, und auf etwas stehen zu bleiben markiert es als gesehen.",
		legStump:
			"Ein Stumpf mit Zähler: ein eingeklappter Ast, oder einer jenseits des Zeichenbudgets. Es fällt nie etwas weg.",
		legTicks: "Striche sind ein Außenring, der zu voll für Punkte ist.",
		legGap:
			"Leerer Raum ist eine Antwort: Jede Domäne behält ihr eigenes Stück des Kreises, wie wenig auch darin steht.",
		legStraightLabel: "Gerade",
		legStraight:
			"Der Ast, den du liest, läuft gerade nach oben, ausgeschrieben von der Nabe an.",
	},

	es: {
		title: "Ayuda de Task wheel",
		blockRound: "Esta ronda",
		blockKeys: "Teclas y acciones",
		blockLegend: "Leer el dibujo",
		seenOfTotal: "{seen} de {total} vistos",
		seenNote:
			"Detenerse en algo es lo que lo hace visto. Girar es el único recorrido que no puede saltarse nada.",
		readingVault: "Leyendo el vault…",
		nothingToReview: "Nada que revisar en este alcance.",
		noWheel: "No hay ninguna rueda abierta.",
		openWheel: "Abrir la rueda",
		labelScope: "Alcance",
		labelFilter: "Filtro",
		labelSkipped: "Omitido",
		labelFolded: "Plegado",
		wholeVault: "Todo el vault",
		outTo: "Salir a {name}",
		noFilter: "Ninguno. Cada tarea de este alcance está en la ronda.",
		filterCounts: "{rule} — {shown} en esta ronda, {left} fuera.",
		clearFilter: "Quitar",
		skippedNote:
			"Las reglas de omisión son un límite, no un filtro: lo que dejan fuera no se cuenta en ninguna parte.",
		showSkipReport: "Mostrar lo que queda fuera",
		nothingFolded: "Nada plegado en esta rueda.",
		foldedOne: "1 rama plegada aquí.",
		foldedMany: "{n} ramas plegadas aquí.",
		unfoldAll: "Desplegar todo",
		groupTurning: "Girar",
		groupTree: "Recorrer el árbol",
		groupCard: "En la tarjeta",
		gestDrag: "arrastrar",
		gestScroll: "desplazar",
		gestSwipe: "deslizar",
		gestTap: "toque",
		gestPinch: "pellizcar",
		keyTurn:
			"Una parada por tarea y por rama plegada: al girar nunca se detiene en un encabezado. La rueda nunca gira libre, y eso es lo que convierte «toda la vuelta» en un hecho.",
		keyFlat: "El orden plano de la ronda — el recorrido que no puede saltarse nada.",
		keyEnds: "La primera y la última parada.",
		keySideways: "De lado, sin salir del anillo.",
		keySidewaysTouch: "De lado — los dos botones en los bordes de la tarjeta. Hacia adelante, a la siguiente tarea por la que esta vuelta no ha pasado, esté donde esté en el círculo; hacia atrás siempre un paso.",
		keyOut: "Un anillo hacia fuera, a un hijo.",
		keyIn: "Un anillo hacia dentro, al padre.",
		keyTap:
			"Lo trae bajo la cuña de lectura. Un segundo toque lo abre — una rueda sobre un encabezado o nota, o la tarea misma, para editarla.",
		keyOpen:
			"Abre aquello en lo que estás: una rueda sobre una carpeta, nota o encabezado — o la tarea misma, para editarla. Igual que un doble clic.",
		keyBack: "Vuelve a la rueda más amplia — bóveda, carpeta, nota, sección.",
		keyNote: "Abre la nota donde está escrita esta tarea, en su propia línea.",
		keyFold: "Pliega esta rama, o la abre de nuevo.",
		keySearch: "Abre el filtro con el cursor en el campo de búsqueda. Allí, Enter te lleva a la siguiente tarea encontrada; Escape devuelve la rueda.",
		keyAdd: "Añade una tarea junto a esta; con mayúsculas, un paso dentro de ella. En cualquier rueda: va a la nota donde está escrita la tarea.",
		keyZoom: "Zoom, o pellizcar en una pantalla táctil.",
		keyZoomTouch: "Zoom.",
		keyMove: "Mueve la tarea misma, con todo lo que cuelga de ella. En cualquier rueda, dentro de su propia nota.",
		keysNote:
			"Con las flechas puedes saltarte una rama; girando no. Ese es el reparto: la garantía vive en el giro.",
		keysNoteTouch:
			"Tocando puedes saltarte una rama; girando no. Ese es el reparto: la garantía vive en el giro.",
		commandsNote: "Casi todas son también comandos, así que puedes asignarles tu propia tecla: las siete anteriores a ⋯, más añadir una tarea y llevar trabajo desde ese menú. Plegar y los dos botones de lado ya tienen tecla; abrir el menú en sí no tiene comando.",
		commandsNoteTouch: "Casi todas son también comandos, así que puedes ponerlas en la barra móvil: las siete anteriores a ⋯, más añadir una tarea y llevar trabajo desde ese menú. El propio ⋯, plegar y los dos botones de lado solo existen en la tarjeta.",
		actTick: "Marcar hecha",
		actProgress: "Marcar en curso",
		actCancel: "Cancelar",
		actDefer: "Aplazar una semana",
		actRaise: "Subir prioridad",
		actLower: "Bajar prioridad",
		actOpenNote: "Abrir la nota",
		actEdit: "Editar el esquema, o llevarla a otra parte",
		actFold: "Plegar esta rama",
		actNudge: "Un elemento al lado, sin girar",
		legAngleLabel: "Ángulo",
		legAngle:
			"El dominio. El radio es la profundidad: centro, dominio, proyecto, tarea.",
		legHues:
			"El tono es el dominio. La rueda escribe cada nombre en su propio borde, en el color con que está dibujado.",
		legRamp:
			"La claridad es la prioridad — el canal que no se puede leer sin una clave.",
		legWedge:
			"La cuña de lectura está quieta a las doce. La rueda gira ante ella, y detenerse en algo es lo que lo marca como visto.",
		legStump:
			"Un muñón con contador: una rama plegada, o una más allá del presupuesto de dibujo. Nunca se pierde nada.",
		legTicks: "Las rayas son un anillo exterior demasiado lleno para puntos.",
		legGap:
			"El espacio vacío es una respuesta: cada dominio conserva su porción del círculo, por poco que contenga.",
		legStraightLabel: "Recto",
		legStraight:
			"La rama que estás leyendo sube recta, escrita completa desde el centro.",
	},

	fr: {
		title: "Aide de Task wheel",
		blockRound: "Ce tour",
		blockKeys: "Touches et actions",
		blockLegend: "Lire le dessin",
		seenOfTotal: "{seen} sur {total} vus",
		seenNote:
			"S'arrêter sur un élément, c'est ce qui le rend vu. Tourner est le seul parcours qui ne peut rien sauter.",
		readingVault: "Lecture du coffre…",
		nothingToReview: "Rien à passer en revue dans cette portée.",
		noWheel: "Aucune roue n'est ouverte.",
		openWheel: "Ouvrir la roue",
		labelScope: "Portée",
		labelFilter: "Filtre",
		labelSkipped: "Ignoré",
		labelFolded: "Replié",
		wholeVault: "Tout le coffre",
		outTo: "Sortir vers {name}",
		noFilter: "Aucun. Chaque tâche de cette portée est dans le tour.",
		filterCounts: "{rule} — {shown} dans ce tour, {left} laissés dehors.",
		clearFilter: "Effacer",
		skippedNote:
			"Les règles d'exclusion sont une frontière, pas un filtre : ce qu'elles écartent n'est compté nulle part.",
		showSkipReport: "Montrer ce qui reste dehors",
		nothingFolded: "Rien de replié dans cette roue.",
		foldedOne: "1 branche repliée ici.",
		foldedMany: "{n} branches repliées ici.",
		unfoldAll: "Tout déplier",
		groupTurning: "Tourner",
		groupTree: "Parcourir l'arbre",
		groupCard: "Sur la carte",
		gestDrag: "glisser",
		gestScroll: "défiler",
		gestSwipe: "balayer",
		gestTap: "toucher",
		gestPinch: "pincer",
		keyTurn:
			"Un cran par tâche et par branche repliée — la rotation ne s'arrête jamais sur un titre. La roue ne tourne jamais librement, et c'est ce qui fait de « tout le tour » un fait.",
		keyFlat: "L'ordre plat du tour — le parcours qui ne peut rien sauter.",
		keyEnds: "Le premier et le dernier arrêt.",
		keySideways: "De côté, en restant sur l'anneau.",
		keySidewaysTouch: "De côté — les deux boutons aux bords de la carte. En avant vers la prochaine tâche que ce tour n'a pas encore croisée, où qu'elle soit sur le cercle ; en arrière, toujours d'un pas.",
		keyOut: "Un anneau vers l'extérieur, vers un enfant.",
		keyIn: "Un anneau vers l'intérieur, vers le parent.",
		keyTap:
			"L'amène sous le coin de lecture. Un second toucher l'ouvre — une roue sur un titre ou une note, ou la tâche elle-même, pour la modifier.",
		keyOpen:
			"Ouvre ce sur quoi vous êtes : une roue sur un dossier, une note ou un titre — ou la tâche elle-même, pour la modifier. Comme un double-clic.",
		keyBack: "Retour à la roue plus large — coffre, dossier, note, section.",
		keyNote: "Ouvre la note où cette tâche est écrite, à sa propre ligne.",
		keyFold: "Replie cette branche, ou la rouvre.",
		keySearch: "Ouvre le filtre et place le curseur dans le champ de recherche. Entrée vous emmène à la tâche suivante trouvée ; Échap rend la roue.",
		keyAdd: "Ajoute une tâche à côté de celle-ci ; avec Maj, une étape à l'intérieur. Sur n'importe quelle roue : elle va dans la note où la tâche est écrite.",
		keyZoom: "Zoomer, ou pincer sur un écran tactile.",
		keyZoomTouch: "Zoomer.",
		keyMove: "Déplace la tâche elle-même, avec tout ce qu'elle porte. Sur n'importe quelle roue, dans sa propre note.",
		keysNote:
			"Avec les flèches on peut sauter une branche ; en tournant, non. C'est le partage des rôles : la garantie vit dans la rotation.",
		keysNoteTouch:
			"En touchant on peut sauter une branche ; en tournant, non. C'est le partage des rôles : la garantie vit dans la rotation.",
		commandsNote: "Presque toutes sont aussi des commandes : vous pouvez y attacher votre raccourci. Les sept avant le ⋯, plus l'ajout d'une tâche et le transport depuis ce menu. Replier et les deux boutons de côté ont déjà une touche ; ouvrir le menu lui-même n'a pas de commande.",
		commandsNoteTouch: "Presque toutes sont aussi des commandes : vous pouvez les placer dans la barre mobile. Les sept avant le ⋯, plus l'ajout d'une tâche et le transport depuis ce menu. Le ⋯ lui-même, le repli et les deux boutons de côté n'existent que sur la carte.",
		actTick: "Cocher",
		actProgress: "Marquer en cours",
		actCancel: "Annuler",
		actDefer: "Repousser d'une semaine",
		actRaise: "Monter la priorité",
		actLower: "Baisser la priorité",
		actOpenNote: "Ouvrir la note",
		actEdit: "Modifier le plan, ou l'emporter ailleurs",
		actFold: "Replier cette branche",
		actNudge: "Un élément de côté, sans tourner",
		legAngleLabel: "Angle",
		legAngle:
			"Le domaine. Le rayon est la profondeur : moyeu, domaine, projet, tâche.",
		legHues:
			"La teinte est le domaine. La roue écrit chaque nom sur son propre bord, dans la couleur où il est dessiné.",
		legRamp:
			"La clarté est la priorité — le canal qu'on ne peut pas lire sans clé.",
		legWedge:
			"Le coin de lecture reste immobile à midi. La roue tourne devant lui, et s'arrêter sur un élément le marque comme vu.",
		legStump:
			"Une souche avec un compteur : une branche repliée, ou une au-delà du budget de dessin. Rien n'est jamais perdu.",
		legTicks: "Les traits sont un anneau extérieur trop dense pour des points.",
		legGap:
			"L'espace vide est une réponse : chaque domaine garde sa part du cercle, si peu qu'il contienne.",
		legStraightLabel: "Droit",
		legStraight:
			"La branche que vous lisez monte droit, écrite en entier depuis le moyeu.",
	},

	hi: {
		title: "Task wheel सहायता",
		blockRound: "यह राउंड",
		blockKeys: "कुंजियाँ और क्रियाएँ",
		blockLegend: "चित्र को पढ़ना",
		seenOfTotal: "{total} में से {seen} देखे गए",
		seenNote:
			"किसी चीज़ पर रुकना ही उसे देखा हुआ बनाता है। घुमाना ही एकमात्र रास्ता है जो कुछ नहीं छोड़ सकता।",
		readingVault: "वॉल्ट पढ़ा जा रहा है…",
		nothingToReview: "इस दायरे में समीक्षा के लिए कुछ नहीं।",
		noWheel: "कोई पहिया खुला नहीं है।",
		openWheel: "पहिया खोलें",
		labelScope: "दायरा",
		labelFilter: "फ़िल्टर",
		labelSkipped: "छोड़ा गया",
		labelFolded: "मोड़ा गया",
		wholeVault: "पूरा वॉल्ट",
		outTo: "{name} की ओर बाहर",
		noFilter: "कोई नहीं। इस दायरे का हर कार्य राउंड में है।",
		filterCounts: "{rule} — इस राउंड में {shown}, बाहर {left}।",
		clearFilter: "हटाएँ",
		skippedNote:
			"स्किप-नियम एक सीमा हैं, फ़िल्टर नहीं: जो वे छोड़ते हैं वह कहीं गिना नहीं जाता।",
		showSkipReport: "दिखाएँ क्या बाहर रहा",
		nothingFolded: "इस पहिये में कुछ मोड़ा नहीं गया।",
		foldedOne: "यहाँ 1 शाखा मोड़ी गई।",
		foldedMany: "यहाँ {n} शाखाएँ मोड़ी गईं।",
		unfoldAll: "सब खोलें",
		groupTurning: "घुमाना",
		groupTree: "पेड़ में चलना",
		groupCard: "कार्ड पर",
		gestDrag: "खींचें",
		gestScroll: "स्क्रॉल",
		gestSwipe: "स्वाइप",
		gestTap: "टैप",
		gestPinch: "पिंच",
		keyTurn:
			"हर कार्य और हर मुड़ी हुई शाखा पर एक ठहराव — घुमाने पर शीर्षक पर कभी नहीं रुकता। पहिया कभी खुला नहीं घूमता, इसी से «पूरा चक्कर» एक तथ्य बनता है।",
		keyFlat: "राउंड का सपाट क्रम — वह रास्ता जो कुछ नहीं छोड़ सकता।",
		keyEnds: "पहला और आख़िरी पड़ाव।",
		keySideways: "बगल में, उसी रिंग पर।",
		keySidewaysTouch: "बगल में — कार्ड के किनारों के दो बटन। आगे बढ़ने पर वह अगले उस कार्य पर ले जाता है जिससे यह चक्र अभी नहीं गुज़रा, चाहे वह वृत्त में कहीं भी हो; पीछे हमेशा एक कदम।",
		keyOut: "एक रिंग बाहर, संतान की ओर।",
		keyIn: "एक रिंग भीतर, मूल की ओर।",
		keyTap:
			"उसे पढ़ने की स्थिति के नीचे लाता है। दूसरा टैप उसे खोलता है — शीर्षक या नोट पर एक पहिया, या स्वयं कार्य, संपादन के लिए।",
		keyOpen:
			"आप जिस पर हैं उसे खोलता है: फ़ोल्डर, नोट या शीर्षक पर एक पहिया — या स्वयं कार्य, संपादन के लिए। डबल-क्लिक जैसा ही।",
		keyBack: "व्यापक पहिये पर वापस — वॉल्ट, फ़ोल्डर, नोट, अनुभाग।",
		keyNote: "जिस नोट में यह कार्य लिखा है उसे उसी पंक्ति पर खोलता है।",
		keyFold: "इस शाखा को मोड़ता है, या फिर खोलता है।",
		keySearch: "फ़िल्टर खोलता है और कर्सर खोज बॉक्स में रखता है। वहाँ Enter अगली मिली हुई task पर ले जाता है; Escape पहिया वापस देता है।",
		keyAdd: "इसके बगल में एक task जोड़ता है; shift के साथ इसके भीतर एक चरण। किसी भी पहिये पर: वह उसी नोट में जाता है जिसमें task लिखा है।",
		keyZoom: "ज़ूम, या टचस्क्रीन पर पिंच।",
		keyZoomTouch: "ज़ूम।",
		keyMove: "कार्य को ही, उसके नीचे की हर चीज़ के साथ, स्थानांतरित करता है। किसी भी पहिये पर, उसी नोट के भीतर।",
		keysNote:
			"तीरों से आप एक शाखा छोड़ सकते हैं; घुमाने से नहीं। यही बँटवारा है: गारंटी घुमाने में है।",
		keysNoteTouch:
			"टैप से आप एक शाखा छोड़ सकते हैं; घुमाने से नहीं। यही बँटवारा है: गारंटी घुमाने में है।",
		commandsNote: "इनमें से लगभग सभी कमांड भी हैं, इसलिए आप उन्हें अपनी कुंजी से जोड़ सकते हैं: ⋯ से पहले वाले सात, साथ ही उस मेन्यू से कार्य जोड़ना और काम ले जाना। मोड़ना और दोनों बगल वाले बटन के पास पहले से कुंजी है; मेन्यू खोलने के लिए कोई कमांड नहीं है।",
		commandsNoteTouch: "इनमें से लगभग सभी कमांड भी हैं, इसलिए आप उन्हें मोबाइल टूलबार में रख सकते हैं: ⋯ से पहले वाले सात, साथ ही उस मेन्यू से कार्य जोड़ना और काम ले जाना। ⋯ स्वयं, मोड़ना और दोनों बगल वाले बटन केवल कार्ड पर हैं।",
		actTick: "पूर्ण करें",
		actProgress: "प्रगति में चिह्नित करें",
		actCancel: "रद्द करें",
		actDefer: "एक सप्ताह आगे बढ़ाएँ",
		actRaise: "प्राथमिकता बढ़ाएँ",
		actLower: "प्राथमिकता घटाएँ",
		actOpenNote: "नोट खोलें",
		actEdit: "रूपरेखा संपादित करें, या कहीं और ले जाएँ",
		actFold: "यह शाखा मोड़ें",
		actNudge: "बिना घुमाए एक आइटम आगे",
		legAngleLabel: "कोण",
		legAngle: "क्षेत्र। त्रिज्या गहराई है: केंद्र, क्षेत्र, परियोजना, कार्य।",
		legHues:
			"रंग क्षेत्र है। पहिया हर नाम उसके अपने किनारे पर, उसी रंग में लिखता है।",
		legRamp: "चमक प्राथमिकता है — वह चैनल जो कुंजी के बिना पढ़ा नहीं जा सकता।",
		legWedge:
			"पढ़ने की स्थिति बारह बजे स्थिर रहती है। पहिया उसके सामने घूमता है, और किसी चीज़ पर रुकना ही उसे देखा हुआ बनाता है।",
		legStump:
			"गिनती वाला ठूँठ: एक मोड़ी हुई शाखा, या चित्र-बजट से बाहर की शाखा। कुछ भी कभी गिरता नहीं।",
		legTicks: "रेखाएँ वह बाहरी रिंग हैं जो बिंदुओं के लिए बहुत भरी है।",
		legGap:
			"खाली जगह भी एक उत्तर है: हर क्षेत्र वृत्त में अपना हिस्सा रखता है, चाहे उसमें कितना ही कम हो।",
		legStraightLabel: "सीधा",
		legStraight:
			"जो शाखा आप पढ़ रहे हैं वह सीधी ऊपर जाती है, केंद्र से पूरी लिखी हुई।",
	},

	it: {
		title: "Guida di Task wheel",
		blockRound: "Questo giro",
		blockKeys: "Tasti e azioni",
		blockLegend: "Leggere il disegno",
		seenOfTotal: "{seen} di {total} visti",
		seenNote:
			"Fermarsi su qualcosa è ciò che lo rende visto. Girare è l'unico percorso che non può saltare nulla.",
		readingVault: "Lettura del vault…",
		nothingToReview: "Niente da rivedere in questo ambito.",
		noWheel: "Nessuna ruota è aperta.",
		openWheel: "Apri la ruota",
		labelScope: "Ambito",
		labelFilter: "Filtro",
		labelSkipped: "Saltato",
		labelFolded: "Ripiegato",
		wholeVault: "Tutto il vault",
		outTo: "Fuori verso {name}",
		noFilter: "Nessuno. Ogni attività di questo ambito è nel giro.",
		filterCounts: "{rule} — {shown} in questo giro, {left} lasciati fuori.",
		clearFilter: "Togli",
		skippedNote:
			"Le regole di esclusione sono un confine, non un filtro: ciò che lasciano fuori non è contato da nessuna parte.",
		showSkipReport: "Mostra cosa resta fuori",
		nothingFolded: "Niente di ripiegato in questa ruota.",
		foldedOne: "1 ramo ripiegato qui.",
		foldedMany: "{n} rami ripiegati qui.",
		unfoldAll: "Apri tutto",
		groupTurning: "Girare",
		groupTree: "Percorrere l'albero",
		groupCard: "Sulla scheda",
		gestDrag: "trascina",
		gestScroll: "scorri",
		gestSwipe: "scorri col dito",
		gestTap: "tocco",
		gestPinch: "pizzica",
		keyTurn:
			"Uno scatto per attività e per ramo ripiegato: ruotando non ci si ferma mai su un titolo. La ruota non gira mai libera, ed è questo che rende «tutto il giro» un fatto.",
		keyFlat: "L'ordine piatto del giro — il percorso che non può saltare nulla.",
		keyEnds: "La prima e l'ultima fermata.",
		keySideways: "Di lato, restando sull'anello.",
		keySidewaysTouch: "Di lato — i due pulsanti ai bordi della scheda. In avanti alla prossima attività su cui questo giro non è ancora passato, ovunque si trovi sul cerchio; indietro è sempre un passo.",
		keyOut: "Un anello verso l'esterno, verso un figlio.",
		keyIn: "Un anello verso l'interno, verso il genitore.",
		keyTap:
			"Lo porta sotto il cuneo di lettura. Un secondo tocco lo apre — una ruota su un titolo o una nota, oppure l'attività stessa, per modificarla.",
		keyOpen:
			"Apre ciò su cui ti trovi: una ruota su una cartella, una nota o un titolo — oppure l'attività stessa, per modificarla. Come un doppio clic.",
		keyBack: "Torna alla ruota più ampia — vault, cartella, nota, sezione.",
		keyNote: "Apre la nota in cui è scritta questa attività, alla sua riga.",
		keyFold: "Ripiega questo ramo, o lo riapre.",
		keySearch: "Apre il filtro con il cursore nel campo di ricerca. Lì Enter porta all'attività successiva trovata; Escape restituisce la ruota.",
		keyAdd: "Aggiunge un'attività accanto a questa; con maiusc, un passo al suo interno. Su qualsiasi ruota: finisce nella nota in cui l'attività è scritta.",
		keyZoom: "Zoom, o pizzicare su uno schermo tattile.",
		keyZoomTouch: "Zoom.",
		keyMove: "Sposta l'attività stessa, con tutto ciò che porta. Su qualsiasi ruota, dentro la sua nota.",
		keysNote:
			"Con le frecce puoi saltare un ramo; girando no. È la divisione dei compiti: la garanzia vive nel girare.",
		keysNoteTouch:
			"Toccando puoi saltare un ramo; girando no. È la divisione dei compiti: la garanzia vive nel girare.",
		commandsNote: "Quasi tutte sono anche comandi, quindi puoi assegnare loro un tuo tasto: le sette prima dei ⋯, più aggiungere un'attività e portare lavoro da quel menu. Chiudere il ramo e i due pulsanti laterali hanno già un tasto; aprire il menu stesso non ha comando.",
		commandsNoteTouch: "Quasi tutte sono anche comandi, quindi puoi metterle nella barra mobile: le sette prima dei ⋯, più aggiungere un'attività e portare lavoro da quel menu. I ⋯ stessi, la chiusura del ramo e i due pulsanti laterali esistono solo sulla scheda.",
		actTick: "Spunta",
		actProgress: "Segna in corso",
		actCancel: "Annulla",
		actDefer: "Rimanda di una settimana",
		actRaise: "Alza la priorità",
		actLower: "Abbassa la priorità",
		actOpenNote: "Apri la nota",
		actEdit: "Modifica la struttura, o portala altrove",
		actFold: "Ripiega questo ramo",
		actNudge: "Un elemento di lato, senza girare",
		legAngleLabel: "Angolo",
		legAngle:
			"Il dominio. Il raggio è la profondità: mozzo, dominio, progetto, attività.",
		legHues:
			"La tinta è il dominio. La ruota scrive ogni nome sul proprio bordo, nel colore in cui è disegnato.",
		legRamp:
			"La luminosità è la priorità — il canale che non si può leggere senza una chiave.",
		legWedge:
			"Il cuneo di lettura sta fermo a mezzogiorno. La ruota gli gira davanti, e fermarsi su qualcosa lo segna come visto.",
		legStump:
			"Un moncone con contatore: un ramo ripiegato, o uno oltre il budget di disegno. Nulla va mai perso.",
		legTicks: "I trattini sono un anello esterno troppo pieno per i punti.",
		legGap:
			"Lo spazio vuoto è una risposta: ogni dominio tiene la sua fetta del cerchio, per quanto poco contenga.",
		legStraightLabel: "Dritto",
		legStraight:
			"Il ramo che stai leggendo sale dritto, scritto per intero dal mozzo.",
	},

	ja: {
		title: "Task wheel ヘルプ",
		blockRound: "このラウンド",
		blockKeys: "キーと操作",
		blockLegend: "図の読み方",
		seenOfTotal: "{total} 件中 {seen} 件を確認",
		seenNote:
			"項目の上で止まることが「見た」ことになります。回転だけが何も飛ばせない歩き方です。",
		readingVault: "保管庫を読み込み中…",
		nothingToReview: "この範囲にレビューするものはありません。",
		noWheel: "ホイールが開いていません。",
		openWheel: "ホイールを開く",
		labelScope: "範囲",
		labelFilter: "フィルター",
		labelSkipped: "除外",
		labelFolded: "折りたたみ",
		wholeVault: "保管庫全体",
		outTo: "{name} へ出る",
		noFilter: "なし。この範囲のすべてのタスクがラウンドに含まれます。",
		filterCounts: "{rule} — このラウンドに {shown} 件、対象外 {left} 件。",
		clearFilter: "解除",
		skippedNote:
			"スキップ規則は境界であってフィルターではありません。除かれたものはどこにも数えられません。",
		showSkipReport: "除外されたものを表示",
		nothingFolded: "このホイールに折りたたみはありません。",
		foldedOne: "ここで 1 本の枝が折りたたまれています。",
		foldedMany: "ここで {n} 本の枝が折りたたまれています。",
		unfoldAll: "すべて展開",
		groupTurning: "回転",
		groupTree: "ツリーの移動",
		groupCard: "カード上",
		gestDrag: "ドラッグ",
		gestScroll: "スクロール",
		gestSwipe: "スワイプ",
		gestTap: "タップ",
		gestPinch: "ピンチ",
		keyTurn:
			"タスクごと、折りたたんだ枝ごとに一つの止まり位置。回しても見出しには止まりません。ホイールは空回りしないので、「一周した」が事実になります。",
		keyFlat: "ラウンドの平坦な順序 — 何も飛ばせない歩き方。",
		keyEnds: "最初と最後の停止位置。",
		keySideways: "横へ、同じリング上を。",
		keySidewaysTouch: "横へ — カード両端の二つのボタン。進むと、この周回でまだ通っていない次のタスクへ、円のどこにあっても移ります。戻るときは常に一歩。",
		keyOut: "一つ外のリングへ、子の方向。",
		keyIn: "一つ内のリングへ、親の方向。",
		keyTap: "読み取り位置の下へ持ってきます。もう一度タップすると開きます — 見出しやノートならそのホイール、タスクなら編集。",
		keyOpen: "今いるものを開きます。フォルダ・ノート・見出しならそのホイール、タスクなら編集。ダブルクリックと同じ動きです。",
		keyBack: "より広いホイールへ戻ります（保管庫・フォルダ・ノート・セクション）。",
		keyNote: "このタスクが書かれているノートを、その行で開きます。",
		keyFold: "この枝を折りたたむ、または再び開く。",
		keySearch: "フィルターを開き、検索欄にカーソルを置く。そこで Enter を押すと見つかった次のタスクへ移動し、Escape でホイールに戻る。",
		keyAdd: "このタスクの隣にタスクを追加する。Shift を押しながらだと中に一段入れる。どのホイールでも使え、追加先はそのタスクが書かれているノート。",
		keyZoom: "ズーム。タッチ画面ではピンチ。",
		keyZoomTouch: "ズーム。",
		keyMove: "タスク自体を、その下のすべてと共に移動します。どのホイールでも、そのタスクのノートの中で。",
		keysNote:
			"矢印キーでは枝を飛ばせますが、回転では飛ばせません。それが役割分担です：保証は回転にあります。",
		keysNoteTouch:
			"タップでは枝を飛ばせますが、回転では飛ばせません。それが役割分担です：保証は回転にあります。",
		commandsNote: "ここにあるもののほとんどはコマンドでもあり、好きなキーを割り当てられます。⋯ より前の七つと、そのメニュー内のタスク追加と持ち運びです。折りたたみと左右の二つのボタンにはすでにキーがあり、メニューを開く操作自体にはコマンドがありません。",
		commandsNoteTouch: "ここにあるもののほとんどはコマンドでもあり、モバイルツールバーに置けます。⋯ より前の七つと、そのメニュー内のタスク追加と持ち運びです。⋯ 自体と折りたたみ、左右の二つのボタンはカードの上にしかありません。",
		actTick: "完了にする",
		actProgress: "進行中にする",
		actCancel: "キャンセル",
		actDefer: "一週間先送り",
		actRaise: "優先度を上げる",
		actLower: "優先度を下げる",
		actOpenNote: "ノートを開く",
		actEdit: "アウトラインを編集、または別の場所へ移す",
		actFold: "この枝を折りたたむ",
		actNudge: "回転せずに一つ隣へ",
		legAngleLabel: "角度",
		legAngle: "領域。半径は深さ：中心、領域、プロジェクト、タスク。",
		legHues:
			"色相は領域。ホイールは各名前を、その描かれた色で自分の縁に書きます。",
		legRamp: "明度は優先度 — 凡例なしには読めないチャンネルです。",
		legWedge:
			"読み取り位置は十二時で静止しています。ホイールがその前を回り、項目の上で止まることが「見た」印になります。",
		legStump:
			"数字つきの切り株：折りたたまれた枝、または描画予算を超えた枝。何も失われません。",
		legTicks: "刻み線は、点で描くには混みすぎた外側のリングです。",
		legGap:
			"空白も答えです：どの領域も、中身がどれほど少なくても円の自分の取り分を保ちます。",
		legStraightLabel: "直線",
		legStraight:
			"読んでいる枝はまっすぐ上に伸び、中心から完全に書き出されています。",
	},

	ko: {
		title: "Task wheel 도움말",
		blockRound: "이번 라운드",
		blockKeys: "키와 동작",
		blockLegend: "그림 읽기",
		seenOfTotal: "{total}개 중 {seen}개 확인",
		seenNote:
			"어떤 항목 위에 멈추는 것이 곧 본 것입니다. 돌리기는 아무것도 건너뛸 수 없는 유일한 길입니다.",
		readingVault: "보관함을 읽는 중…",
		nothingToReview: "이 범위에는 검토할 것이 없습니다.",
		noWheel: "열린 휠이 없습니다.",
		openWheel: "휠 열기",
		labelScope: "범위",
		labelFilter: "필터",
		labelSkipped: "건너뜀",
		labelFolded: "접힘",
		wholeVault: "전체 보관함",
		outTo: "{name}(으)로 나가기",
		noFilter: "없음. 이 범위의 모든 작업이 라운드에 포함됩니다.",
		filterCounts: "{rule} — 이번 라운드에 {shown}개, 제외 {left}개.",
		clearFilter: "해제",
		skippedNote:
			"건너뛰기 규칙은 경계이지 필터가 아닙니다. 제외된 것은 어디에도 세어지지 않습니다.",
		showSkipReport: "제외된 항목 보기",
		nothingFolded: "이 휠에는 접힌 것이 없습니다.",
		foldedOne: "여기에 가지 1개가 접혀 있습니다.",
		foldedMany: "여기에 가지 {n}개가 접혀 있습니다.",
		unfoldAll: "모두 펼치기",
		groupTurning: "돌리기",
		groupTree: "트리 이동",
		groupCard: "카드에서",
		gestDrag: "드래그",
		gestScroll: "스크롤",
		gestSwipe: "스와이프",
		gestTap: "탭",
		gestPinch: "핀치",
		keyTurn:
			"작업마다, 접힌 가지마다 하나의 멈춤 위치. 돌릴 때 제목에는 멈추지 않습니다. 휠은 결코 헛돌지 않으므로 «한 바퀴 다 돌았다»가 사실이 됩니다.",
		keyFlat: "라운드의 평평한 순서 — 아무것도 건너뛸 수 없는 길.",
		keyEnds: "첫 번째와 마지막 정지 위치.",
		keySideways: "옆으로, 같은 링 위에서.",
		keySidewaysTouch: "옆으로 — 카드 양쪽 가장자리의 두 버튼. 앞으로 누르면 이번 라운드에서 아직 지나지 않은 다음 작업으로, 원의 어디에 있든 이동합니다. 뒤로는 항상 한 걸음.",
		keyOut: "한 링 바깥으로, 자식에게.",
		keyIn: "한 링 안쪽으로, 부모에게.",
		keyTap: "읽기 위치 아래로 가져옵니다. 두 번째 탭이 그것을 엽니다 — 제목이나 노트면 휠을, 작업이면 편집을.",
		keyOpen: "지금 있는 것을 엽니다. 폴더·노트·제목이면 그 휠을, 작업이면 편집을. 더블 클릭과 같은 동작입니다.",
		keyBack: "더 넓은 휠로 돌아갑니다 — 보관함, 폴더, 노트, 섹션.",
		keyNote: "이 작업이 적힌 노트를 해당 줄에서 엽니다.",
		keyFold: "이 가지를 접거나 다시 폅니다.",
		keySearch: "필터를 열고 검색란에 커서를 놓습니다. 그곳에서 Enter는 찾은 다음 작업으로 이동하고, Escape는 휠로 돌아갑니다.",
		keyAdd: "이 작업 옆에 작업을 추가합니다. Shift와 함께 누르면 안쪽으로 한 단계 들어갑니다. 모든 휠에서 되며, 작업이 적힌 노트에 추가됩니다.",
		keyZoom: "확대·축소, 터치 화면에서는 핀치.",
		keyZoomTouch: "확대·축소.",
		keyMove: "작업 자체를 그 아래 모든 것과 함께 옮깁니다. 모든 휠에서, 그 작업이 있는 노트 안에서.",
		keysNote:
			"화살표로는 가지를 건너뛸 수 있지만, 돌리기로는 못 합니다. 그것이 역할 분담입니다: 보장은 돌리기에 있습니다.",
		keysNoteTouch:
			"탭으로는 가지를 건너뛸 수 있지만, 돌리기로는 못 합니다. 그것이 역할 분담입니다: 보장은 돌리기에 있습니다.",
		commandsNote: "여기 있는 것 대부분은 명령이기도 하므로 원하는 키를 지정할 수 있습니다. ⋯ 앞의 일곱 가지와, 그 메뉴 안의 작업 추가와 옮기기입니다. 접기와 양옆 두 버튼에는 이미 키가 있고, 메뉴를 여는 것 자체에는 명령이 없습니다.",
		commandsNoteTouch: "여기 있는 것 대부분은 명령이기도 하므로 모바일 도구 막대에 둘 수 있습니다. ⋯ 앞의 일곱 가지와, 그 메뉴 안의 작업 추가와 옮기기입니다. ⋯ 자체와 접기, 양옆 두 버튼은 카드에만 있습니다.",
		actTick: "완료 표시",
		actProgress: "진행 중으로 표시",
		actCancel: "취소",
		actDefer: "일주일 미루기",
		actRaise: "우선순위 올리기",
		actLower: "우선순위 내리기",
		actOpenNote: "노트 열기",
		actEdit: "개요 편집 또는 다른 곳으로 옮기기",
		actFold: "이 가지 접기",
		actNudge: "돌리지 않고 한 항목 옆으로",
		legAngleLabel: "각도",
		legAngle: "영역. 반지름은 깊이입니다: 중심, 영역, 프로젝트, 작업.",
		legHues:
			"색상은 영역입니다. 휠은 각 이름을 그려진 색 그대로 자기 테두리에 씁니다.",
		legRamp: "밝기는 우선순위입니다 — 범례 없이는 읽을 수 없는 채널.",
		legWedge:
			"읽기 위치는 12시에 고정되어 있습니다. 휠이 그 앞을 돌고, 멈추는 것이 곧 본 것으로 표시됩니다.",
		legStump:
			"숫자가 붙은 그루터기: 접힌 가지이거나 그리기 예산을 넘은 가지. 아무것도 사라지지 않습니다.",
		legTicks: "눈금은 점으로 그리기엔 너무 붐비는 바깥 링입니다.",
		legGap:
			"빈 공간도 답입니다: 모든 영역은 담긴 것이 아무리 적어도 원에서 제 몫을 지킵니다.",
		legStraightLabel: "직선",
		legStraight:
			"읽고 있는 가지는 곧게 위로 뻗고, 중심에서부터 온전히 쓰여 있습니다.",
	},

	pt: {
		title: "Ajuda do Task wheel",
		blockRound: "Esta rodada",
		blockKeys: "Teclas e ações",
		blockLegend: "Ler o desenho",
		seenOfTotal: "{seen} de {total} vistos",
		seenNote:
			"Parar sobre algo é o que o torna visto. Girar é o único percurso que não pode pular nada.",
		readingVault: "Lendo o vault…",
		nothingToReview: "Nada para revisar neste escopo.",
		noWheel: "Nenhuma roda está aberta.",
		openWheel: "Abrir a roda",
		labelScope: "Escopo",
		labelFilter: "Filtro",
		labelSkipped: "Ignorado",
		labelFolded: "Recolhido",
		wholeVault: "O vault inteiro",
		outTo: "Sair para {name}",
		noFilter: "Nenhum. Cada tarefa deste escopo está na rodada.",
		filterCounts: "{rule} — {shown} nesta rodada, {left} de fora.",
		clearFilter: "Limpar",
		skippedNote:
			"As regras de exclusão são um limite, não um filtro: o que elas deixam de fora não é contado em lugar nenhum.",
		showSkipReport: "Mostrar o que ficou de fora",
		nothingFolded: "Nada recolhido nesta roda.",
		foldedOne: "1 ramo recolhido aqui.",
		foldedMany: "{n} ramos recolhidos aqui.",
		unfoldAll: "Expandir tudo",
		groupTurning: "Girar",
		groupTree: "Percorrer a árvore",
		groupCard: "No cartão",
		gestDrag: "arrastar",
		gestScroll: "rolar",
		gestSwipe: "deslizar",
		gestTap: "toque",
		gestPinch: "pinçar",
		keyTurn:
			"Uma parada por tarefa e por ramo recolhido — ao girar nunca para num cabeçalho. A roda nunca gira solta, e é isso que torna «a volta inteira» um fato.",
		keyFlat: "A ordem plana da rodada — o percurso que não pode pular nada.",
		keyEnds: "A primeira e a última parada.",
		keySideways: "De lado, ficando no anel.",
		keySidewaysTouch: "De lado — os dois botões nas bordas do cartão. Para a frente, até à próxima tarefa por que esta volta ainda não passou, onde quer que esteja no círculo; para trás é sempre um passo.",
		keyOut: "Um anel para fora, até um filho.",
		keyIn: "Um anel para dentro, até o pai.",
		keyTap:
			"Traz o item para baixo da cunha de leitura. Um segundo toque o abre — uma roda sobre um título ou nota, ou a própria tarefa, para editar.",
		keyOpen:
			"Abre aquilo em que você está: uma roda sobre uma pasta, nota ou título — ou a própria tarefa, para editar. O mesmo que um duplo clique.",
		keyBack: "Volta para a roda mais ampla — cofre, pasta, nota, seção.",
		keyNote: "Abre a nota em que esta tarefa está escrita, na sua própria linha.",
		keyFold: "Recolhe este ramo, ou o abre de novo.",
		keySearch: "Abre o filtro com o cursor no campo de busca. Ali, Enter leva à próxima tarefa encontrada; Escape devolve a roda.",
		keyAdd: "Adiciona uma tarefa ao lado desta; com shift, um passo dentro dela. Em qualquer roda: vai para a nota onde a tarefa está escrita.",
		keyZoom: "Zoom, ou pinçar numa tela sensível ao toque.",
		keyZoomTouch: "Zoom.",
		keyMove: "Move a própria tarefa, com tudo o que está abaixo dela. Em qualquer roda, dentro da sua própria nota.",
		keysNote:
			"Com as setas você pode pular um ramo; girando, não. Essa é a divisão de trabalho: a garantia vive no girar.",
		keysNoteTouch:
			"Tocando você pode pular um ramo; girando, não. Essa é a divisão de trabalho: a garantia vive no girar.",
		commandsNote: "Quase todas também são comandos, então você pode pendurar sua própria tecla nelas: as sete antes do ⋯, mais adicionar uma tarefa e levar trabalho a partir desse menu. Dobrar e os dois botões laterais já têm tecla; abrir o próprio menu não tem comando.",
		commandsNoteTouch: "Quase todas também são comandos, então você pode colocá-las na barra móvel: as sete antes do ⋯, mais adicionar uma tarefa e levar trabalho a partir desse menu. O próprio ⋯, dobrar e os dois botões laterais só existem no cartão.",
		actTick: "Concluir",
		actProgress: "Marcar em andamento",
		actCancel: "Cancelar",
		actDefer: "Adiar uma semana",
		actRaise: "Subir prioridade",
		actLower: "Baixar prioridade",
		actOpenNote: "Abrir a nota",
		actEdit: "Editar o esboço, ou levá-la para outro lugar",
		actFold: "Recolher este ramo",
		actNudge: "Um item ao lado, sem girar",
		legAngleLabel: "Ângulo",
		legAngle:
			"O domínio. O raio é a profundidade: centro, domínio, projeto, tarefa.",
		legHues:
			"O matiz é o domínio. A roda escreve cada nome na própria borda, na cor em que está desenhado.",
		legRamp:
			"A claridade é a prioridade — o canal que não se lê sem uma legenda.",
		legWedge:
			"A cunha de leitura fica parada ao meio-dia. A roda gira diante dela, e parar sobre algo é o que o marca como visto.",
		legStump:
			"Um toco com contador: um ramo recolhido, ou um além do orçamento de desenho. Nada se perde nunca.",
		legTicks: "Traços são um anel externo cheio demais para pontos.",
		legGap:
			"O espaço vazio é uma resposta: cada domínio guarda sua fatia do círculo, por menos que contenha.",
		legStraightLabel: "Reto",
		legStraight:
			"O ramo que você está lendo sobe reto, escrito por inteiro desde o centro.",
	},

	ru: {
		title: "Справка Task wheel",
		blockRound: "Этот круг",
		blockKeys: "Клавиши и действия",
		blockLegend: "Как читать рисунок",
		seenOfTotal: "Просмотрено {seen} из {total}",
		seenNote:
			"Остановиться на элементе — значит увидеть его. Вращение — единственный путь, который ничего не может пропустить.",
		readingVault: "Чтение хранилища…",
		nothingToReview: "В этом охвате нечего просматривать.",
		noWheel: "Ни одно колесо не открыто.",
		openWheel: "Открыть колесо",
		labelScope: "Охват",
		labelFilter: "Фильтр",
		labelSkipped: "Пропущено",
		labelFolded: "Свёрнуто",
		wholeVault: "Всё хранилище",
		outTo: "Выйти к {name}",
		noFilter: "Нет. Каждая задача этого охвата входит в круг.",
		filterCounts: "{rule} — {shown} в этом круге, {left} за бортом.",
		clearFilter: "Сбросить",
		skippedNote:
			"Правила пропуска — это граница, а не фильтр: что они исключают, нигде не считается.",
		showSkipReport: "Показать, что осталось за бортом",
		nothingFolded: "В этом колесе ничего не свёрнуто.",
		foldedOne: "Здесь свёрнута 1 ветка.",
		foldedMany: "Здесь свёрнуто веток: {n}.",
		unfoldAll: "Развернуть всё",
		groupTurning: "Вращение",
		groupTree: "Ходьба по дереву",
		groupCard: "На карточке",
		gestDrag: "перетащить",
		gestScroll: "прокрутить",
		gestSwipe: "смахнуть",
		gestTap: "касание",
		gestPinch: "щипок",
		keyTurn:
			"Одна фиксация на каждую задачу и каждую свёрнутую ветку — при вращении колесо не останавливается на заголовке. Колесо никогда не крутится вхолостую, и именно это делает «полный круг» фактом.",
		keyFlat: "Плоский порядок круга — путь, который ничего не может пропустить.",
		keyEnds: "Первая и последняя остановка.",
		keySideways: "Вбок, оставаясь на кольце.",
		keySidewaysTouch: "Вбок — две кнопки по краям карточки. Вперёд — к следующей задаче, мимо которой этот круг ещё не проходил, где бы она ни была на окружности; назад — всегда один шаг.",
		keyOut: "На кольцо наружу, к потомку.",
		keyIn: "На кольцо внутрь, к родителю.",
		keyTap:
			"Ставит элемент под метку чтения. Второе касание открывает его — колесо над заголовком или заметкой, либо саму задачу, для правки.",
		keyOpen:
			"Открывает то, на чём вы стоите: колесо над папкой, заметкой или заголовком — либо саму задачу, для правки. То же, что двойной щелчок.",
		keyBack: "Возврат к более широкому колесу — хранилище, папка, заметка, раздел.",
		keyNote: "Открывает заметку, в которой записана эта задача, на её строке.",
		keyFold: "Сворачивает эту ветку или снова раскрывает.",
		keySearch: "Открывает фильтр и ставит курсор в поле поиска. Enter там переходит к следующей найденной задаче, Escape возвращает колесо.",
		keyAdd: "Добавляет задачу рядом с этой; с shift — шаг внутри неё. В любом колесе: она попадает в ту заметку, где написана задача.",
		keyZoom: "Масштаб, или щипок на сенсорном экране.",
		keyZoomTouch: "Масштаб.",
		keyMove: "Перемещает саму задачу со всем, что под ней. В любом колесе, внутри её собственной заметки.",
		keysNote:
			"Стрелками можно пропустить ветку; вращением — нет. В этом разделение труда: гарантия живёт во вращении.",
		keysNoteTouch:
			"Касанием можно пропустить ветку; вращением — нет. В этом разделение труда: гарантия живёт во вращении.",
		commandsNote: "Почти все они — ещё и команды, так что можно назначить свою клавишу: семь до ⋯, а также добавление задачи и перенос работы из этого меню. У сворачивания и двух боковых кнопок клавиши уже есть; у открытия самого меню команды нет.",
		commandsNoteTouch: "Почти все они — ещё и команды, так что их можно вынести на мобильную панель: семь до ⋯, а также добавление задачи и перенос работы из этого меню. Само ⋯, сворачивание и две боковые кнопки есть только на карточке.",
		actTick: "Отметить сделанной",
		actProgress: "Отметить в работе",
		actCancel: "Отменить",
		actDefer: "Отложить на неделю",
		actRaise: "Повысить приоритет",
		actLower: "Понизить приоритет",
		actOpenNote: "Открыть заметку",
		actEdit: "Изменить структуру или перенести в другое место",
		actFold: "Свернуть эту ветку",
		actNudge: "Один элемент вбок, не вращая",
		legAngleLabel: "Угол",
		legAngle: "Сфера. Радиус — глубина: центр, сфера, проект, задача.",
		legHues:
			"Оттенок — это сфера. Колесо пишет каждое имя на своём ободе тем цветом, которым оно нарисовано.",
		legRamp:
			"Светлота — это приоритет: канал, который не прочесть без легенды.",
		legWedge:
			"Метка чтения неподвижна на двенадцати часах. Колесо вращается мимо неё, и остановка на элементе отмечает его увиденным.",
		legStump:
			"Пенёк со счётчиком: свёрнутая ветка или ветка за пределами бюджета рисунка. Ничего никогда не пропадает.",
		legTicks: "Штрихи — внешнее кольцо, слишком тесное для точек.",
		legGap:
			"Пустое место — тоже ответ: каждая сфера хранит свой сектор круга, как бы мало в нём ни было.",
		legStraightLabel: "Прямо",
		legStraight:
			"Ветка, которую вы читаете, идёт прямо вверх и выписана целиком от центра.",
	},

	zh: {
		title: "Task wheel 帮助",
		blockRound: "本轮",
		blockKeys: "按键与操作",
		blockLegend: "读懂图形",
		seenOfTotal: "已看 {seen} / {total}",
		seenNote:
			"停在某个条目上，它才算被看过。只有转动这条路径不会跳过任何东西。",
		readingVault: "正在读取仓库…",
		nothingToReview: "此范围内没有可回顾的内容。",
		noWheel: "没有打开的转盘。",
		openWheel: "打开转盘",
		labelScope: "范围",
		labelFilter: "过滤",
		labelSkipped: "跳过",
		labelFolded: "折叠",
		wholeVault: "整个仓库",
		outTo: "退到 {name}",
		noFilter: "无。此范围内的每个任务都在本轮之中。",
		filterCounts: "{rule} — 本轮 {shown} 个，排除 {left} 个。",
		clearFilter: "清除",
		skippedNote:
			"跳过规则是边界而非过滤器：被排除的内容不会计入任何地方。",
		showSkipReport: "显示被排除的内容",
		nothingFolded: "此转盘中没有折叠的内容。",
		foldedOne: "此处折叠了 1 条分支。",
		foldedMany: "此处折叠了 {n} 条分支。",
		unfoldAll: "全部展开",
		groupTurning: "转动",
		groupTree: "在树中移动",
		groupCard: "卡片上",
		gestDrag: "拖动",
		gestScroll: "滚动",
		gestSwipe: "滑动",
		gestTap: "点按",
		gestPinch: "捏合",
		keyTurn:
			"每个任务、每个折叠分支一个停位——转动时不会停在标题上。转盘从不空转，这正是「转完一整圈」成为事实的原因。",
		keyFlat: "本轮的平铺顺序 — 不会跳过任何东西的路径。",
		keyEnds: "第一个与最后一个停位。",
		keySideways: "侧移，保持在同一环上。",
		keySidewaysTouch: "侧移 — 卡片两侧的两个按钮。向前会带你到本轮还没经过的下一个任务，无论它在圆周何处；向后总是一步。",
		keyOut: "向外一环，去往子项。",
		keyIn: "向内一环，去往父项。",
		keyTap: "把它带到阅读位置下。再点一次就打开它——标题或笔记是它的转盘，任务则打开编辑。",
		keyOpen: "打开你当前所在的东西：文件夹、笔记或标题就是它的转盘，任务则打开编辑。与双击相同。",
		keyBack: "回到更宽的转盘——库、文件夹、笔记、章节。",
		keyNote: "打开写着这条任务的笔记，并定位到那一行。",
		keyFold: "折叠此分支，或再次展开。",
		keySearch: "打开筛选器并把光标放进搜索框。在那里按 Enter 跳到找到的下一个任务，按 Escape 交回轮盘。",
		keyAdd: "在这个任务旁边加一个任务；按住 shift 则加在它里面一层。在任何轮盘上都可用，加到该任务所在的那篇笔记里。",
		keyZoom: "缩放，或在触屏上捏合。",
		keyZoomTouch: "缩放。",
		keyMove: "移动任务本身及其下的一切。在任何轮盘上，都在该任务所在的笔记内。",
		keysNote:
			"用方向键可以跳过分支；转动则不能。这就是分工：保证在转动之中。",
		keysNoteTouch:
			"点按可以跳过分支；转动则不能。这就是分工：保证在转动之中。",
		commandsNote: "其中几乎每一项也是命令，你可以为它绑定自己的快捷键：⋯ 之前的七项，以及该菜单里的添加任务和搬运工作。折叠和左右两个按钮已经有按键；打开菜单本身没有命令。",
		commandsNoteTouch: "其中几乎每一项也是命令，你可以把它们放进移动工具栏：⋯ 之前的七项，以及该菜单里的添加任务和搬运工作。⋯ 本身、折叠和左右两个按钮只在卡片上。",
		actTick: "勾选完成",
		actProgress: "标记进行中",
		actCancel: "取消",
		actDefer: "推迟一周",
		actRaise: "提高优先级",
		actLower: "降低优先级",
		actOpenNote: "打开笔记",
		actEdit: "编辑大纲，或移到别处",
		actFold: "折叠此分支",
		actNudge: "不转动，移动一个条目",
		legAngleLabel: "角度",
		legAngle: "领域。半径是深度：中心、领域、项目、任务。",
		legHues: "色相是领域。转盘把每个名字用它的颜色写在自己的边缘上。",
		legRamp: "明度是优先级 — 没有图例就读不出的通道。",
		legWedge:
			"阅读位置静止在十二点。转盘从它面前转过，停在某个条目上即标记为已看。",
		legStump:
			"带计数的残枝：被折叠的分支，或超出绘制预算的分支。任何东西都不会丢失。",
		legTicks: "刻度线是拥挤得画不下圆点的外环。",
		legGap: "空白也是答案：每个领域都保有自己的一片圆，无论其中多么稀少。",
		legStraightLabel: "笔直",
		legStraight: "你正在读的分支笔直向上，从中心起完整写出。",
	},
};
