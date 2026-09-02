# Changelog

All notable changes to Task Wheel. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the release workflow
lifts each version's section into the GitHub release notes.

## [Unreleased]

## [0.1.20]

Aiming, on a phone: two ways a tap could land somewhere you did not point at.

- **Fixed**: a tap on the reading card no longer reaches the wheel behind it.
  The card is deliberately see-through to the hand, so that a drag across it
  still turns the wheel — but a tap fell through as well, onto whatever the card
  was covering. Standing on a heading and tapping the words on the card would
  open a task inside that branch. A drag still goes through; a tap does not.
- **Added**: a title with no editor behind it now says why, instead of doing
  nothing. A heading is renamed in the note itself, a note in the file list so
  that its links follow, and a wedge that comes from a tag or a note property
  has no name written down anywhere to change.
- **Fixed**: the word beside an item is a tap target, like its dot. A label
  hangs outward by exactly the width of the dot's tap area, so it began where
  its own item stopped being tappable and pointed at the ring where the children
  are — which meant tapping the word you were reading could name something else.
  A tap now takes the nearest of the two shapes rather than whatever the browser
  found under the finger.

## [0.1.19]

Two more keys, and one of them was missing exactly where you needed it.

- **Added**: **Ctrl/Cmd + Enter** opens the note the item is written in, at its
  own line. Enter opens what the item *is*; the modifier opens where it *lives*
  — the same pairing Obsidian uses elsewhere. It was already a button on the
  card and a command; what it did not have was a key beside the one it belongs
  next to.
- **Fixed**: **backspace** works on a wheel with nothing on it. A heading with no
  tasks under it is the easiest wheel to open by accident, and it was the one
  place the key gave up — the wheel clears its stops when there is nothing to
  draw, and every key was giving up along with them. The button in the corner
  worked all along, which is why it took a while to notice.

## [0.1.18]

Two places where the wheel threw away something you had just told it.

- **Fixed**: stepping out keeps you on the item you were reading, now seen from
  further out. It used to open the wider wheel wherever *that* round had been
  left, which is right when you are resuming one and wrong when you are walking
  a ladder. If what you were reading has no place out there — you were standing
  on a wedge — you land on the blikveld you stepped out of instead.
- **Added**: opening the wheel with your cursor on a task lands on that task.
  A cursor three lines into a task's notes still means that task; a cursor in
  prose means nothing in particular, and then the wheel opens where it always
  did. It never guesses forward at a task below the cursor.
- **Changed**: with diagnostics on, the wheel reports how long reading the vault
  took. Nothing can land on an item before there is a tree to find it in, so
  that number is where any waiting lives.
- **Added**: the README shows the Tasks window open over the wheel, so the
  integration is visible rather than only described.

## [0.1.17]

One key, one rule: Enter and a double-click open what you are standing on.

- **Fixed**: a heading opens a wheel over **its own section**, wherever you meet
  it. From a wheel over the whole vault or a folder it used to open the whole
  note instead — a rung of the ladder skipped, because the rule that turns a
  heading into a section only applied inside a wheel that was already about a
  note.

- **Changed**: Enter and a double-click now open **what the item is**. A folder,
  a note or a heading has an inside, so opening one is a wheel over it, exactly
  as before. A task has no inside — so it opens for editing instead, by the same
  setting that decides what clicking its title opens. It used to open a wheel
  over the note the task lives in, which is not the task; and in a wheel over
  that note already it did nothing at all but say so. The key and the mouse
  change together, deliberately: the point of giving Enter this move in 0.1.16
  was that the keyboard should not be poorer than the mouse.

## [0.1.16]

A keyboard round: the keys work the moment a wheel opens, Enter steps in and
backspace steps back out, and a step lands once. Plus the Tasks plugin's own
edit window, one menu entry away.

- **Fixed**: a wheel takes the keyboard the moment it is the one in front. It
  used to look ready and not be — a task on the reading wedge, a card beside it,
  and nothing listening until you clicked the drawing. Only when it is the view
  you are looking at, and never off a box you could still be typing in.
- **Changed**: **Enter** opens a wheel over the item you are standing on — the
  same move as double-clicking it. It used to fold the branch, which is what
  **space** does, so the two keys did one thing while the move a mouse has had
  no key at all. Space still folds.
- **Added**: **backspace** steps back out to the wider wheel — the other half of
  Enter. On the vault wheel there is nowhere wider, and there the key stays
  unclaimed rather than saying so every time you press it. It is also a command
  (*Out to the wider wheel*), so any other key you prefer is one you can bind
  yourself.
- **Fixed**: a step with the arrows now puts the focus ring down once. It used
  to mark every stop the turn passed and then move once more when the drawing
  re-opened around where you landed, so a single step read as a scramble. The
  turn itself is unchanged, and dragging still follows what passes under the
  wedge — that one is a turn you are watching, not a jump you asked for.
- **Added**: **Edit in Tasks…** in the ⋯ menu, when the Tasks plugin is
  installed. It opens that plugin's own edit window on the task in front of you
  — dates, recurrence, dependencies, your own status set — and writes back what
  you confirm, without leaving the round or opening the note. The wheel does not
  build its own version of that window: without Tasks the entry is simply not
  there, and its own actions stay what they were.
- **Added**: a setting for what clicking a task's title opens — the card's own
  box, which rewrites the words, or the Tasks window, which is the whole task.
  Not a ninth button: the row on the card is full at eight, and the gesture that
  reaches the editor already exists. With no Tasks window to open, the box opens
  either way.

## [0.1.15]

Nothing behaves differently — the examples got tidier and the README got
pictures.

- **Changed**: plainer examples in the search box and in the documentation
  around it — `invoice OR quote`, `file:roadmap`. They explain the same three
  things: words are combined, `OR` offers an alternative, and `file:` looks at
  the note rather than the task.
- **Added**: the README shows the wheel. Three screenshots, taken in the made-up
  vault that ships with the source.

## [0.1.14]

Room on a phone: with the keyboard up, the wheel gets the screen back.

- **Fixed**: a band of empty space between the wheel and the keyboard on
  Android. The keyboard was being counted twice — the app reports it as a
  bottom inset *and* shrinks the pane by the same amount, so the room held back
  for a bar that is not there ate most of what was left. Measured on the
  owner's phone: of 424 pixels remaining, about 45 were the wheel. The
  reservation is now capped, and while a text field has focus it is dropped
  altogether: the bar it protects is not on screen while you are typing,
  because the keyboard is standing where it would be.
- **Changed**: with diagnostics on, the wheel reports what it measures of its
  own pane — window and viewport height, where the pane sits and how tall it
  is, what it holds back at the bottom, and which element has the keyboard.
  That is how the fix above was found, and it is there for the next thing that
  only happens on a device.

## [0.1.13]

Housekeeping only — nothing about the wheel behaves differently.

- **Fixed**: the stylesheet no longer uses `clip-path`, which Obsidian's plugin
  linter flags as only partly supported at the app version it checks against.
  It sat on the text that describes the wheel to a screen reader, where the
  usual recipe adds it as a second lock and where it was not needed: a
  one-pixel box that clips what does not fit already leaves nothing to see.
  That text stays exactly as hidden, and exactly as readable, as it was.

## [0.1.12]

Navigating a big vault, rewritten around one sentence: **a step sideways never
traps you and always has a way back.** Most of this comes from the first
detailed user report the plugin has had — a vault of about 2300 open tasks,
reviewed for two hours (31 aug 2026). Thank you.

- **Fixed**: left and right no longer trap you deep in a branch. They walked
  the ring as *drawn*, and the wheel draws the branch under the reading wedge
  deeper than the rest — so on those rings there was no neighbour on screen to
  step to, and the key quietly did nothing. The only way to the file beside you
  was back in to the middle and out again, which is how you lose your place.
  Sideways now walks the **whole** ring: the next item on it, drawn or not, and
  the wheel opens around it if it was not. Two things follow, and they are the
  point — a sideways step never changes which ring you are on, and the opposite
  key always brings you back to where you came from.
- **Fixed**: the wheel now draws what it is looking at, however deep that is.
  Two things could quietly stand in the way: the rings ran out on a branch
  before reaching the item, or you had folded that branch away — and either way
  the drawing came back without the item, so anything that sent you there
  landed you somewhere near where you started instead. The way down to whatever
  you are reading is now drawn open regardless. A fold you look inside stays a
  fold: it closes again when you leave, and standing *on* a folded branch still
  keeps it folded, since that is what Space is for.
- **Added**: you choose what one step sideways walks, under *What the arrows
  step through*. **Every task** — the default — steps to the next task wherever
  it hangs, so no branch is a dead end. **Along the ring** steps to the next
  item at the same depth, across branches, which is the move for comparing the
  same level of two projects; the trade is that a depth only one branch reaches
  is a ring of that branch alone, so a long branch ending in three tasks walks
  round those three. On a keyboard the other one is always on **Shift + ← →**;
  the two buttons beside the card follow the setting on a desktop, and on a
  phone always walk every task — there the coarse movement is a finger on the
  disc, and there is no Shift to borrow the other with.
- **Added**: a task too long for the card can be read in full. The card clamps
  a title to two lines because it holds one size at every stop — that is what
  keeps the drawing underneath from jumping while you turn — so a long task was
  cut off with no way to see the rest short of opening the note. A clipped title
  now offers *Show the whole task*, which lays the full text over the card's
  reading matter and leaves the card, the action row and the wheel exactly where
  they were. Turning on folds it back. **Renaming got the same room**: the box
  you type in takes the card's whole reading area rather than the two lines the
  title had, which is what it needed on a phone with the keyboard up.
- **Fixed**: a wedge that gets its domain from a front-matter property no longer
  tries to open a folder of that name. Double-tapping a wedge opens a wheel over
  what it stands for, and a folder domain names a folder — but a property value
  does not, any more than a tag does. It now says so instead of going looking.
- **Fixed**: the wheel no longer shows a paragraph of help every time the mouse
  comes to rest on it. That text is the description a screen reader reads out,
  and Obsidian renders any such description as a hover tooltip — over the whole
  drawing, again and again. It is now invisible to a mouse and unchanged for a
  screen reader, so there is nothing left to switch off. The same mistake in the
  filter panel's search box went with it.

## [0.1.11]

A wedge no longer disappears when its work does: an empty domain keeps its name
and its place, a wheel over one note draws the document's whole outline, and the
domain can come from a front-matter property instead of a folder.

- **Added**: the domain can come from a front-matter property, under *Domain
  comes from*. Vaults that keep their structure in properties rather than in
  folders — `area: Work`, `area: Home` — can now say so, and the wheel's wedges
  cut across folders instead of following them. Name the property under *Domain
  property*; a list gives its first entry, and a note without it lands in the
  fallback domain rather than being dropped. It is a third source beside the
  top-level folder and the tag namespace: choosing it turns it on, choosing
  another turns it off, and the folder stays the default — so nothing changes
  unless you ask for it. A tag namespace remains the only source that works per
  task, so it is still the way to let one note feed several wedges.
- **Fixed**: a domain that turns up while you are mid-round no longer takes
  another wedge's colour and place. The domains are sorted, so a new one sorted
  into the middle and shunted everything after it along by one — a wedge you had
  learned as a colour in a place became a different colour somewhere else,
  halfway through a review. A round now deals the wedge order once and holds it:
  a newcomer joins at the end, and a domain whose last task you tick off keeps
  its place until the round ends, so finishing a domain no longer rearranges the
  wheel you are finishing it on. Widths still give way — a new wedge has to come
  from somewhere and the circle is 360° — but nothing swaps places and nothing
  changes colour. The full re-deal happens where it always did: at the round
  boundary.
- **Added**: a wedge that is holding its place keeps its name. An empty slice is
  not a gap in the drawing and it is not nothing — it says the work in that part
  of your life is done, parked, or filtered out of what you are looking at right
  now, and the place is still yours. It is drawn in the same shape as any other
  wedge title, in the faded hue of its own band, so a domain at rest reads as
  different from one with work on it at a glance.
- **Added**: a wheel over one note or one section now draws **the document's
  whole outline** — every heading, whether or not there is open work under it.
  A pipeline note with seven phases used to draw four wedges: the three phases
  with nothing outstanding were not empty on the drawing, they were missing, and
  the process looked shorter than it is. "This phase is empty" is a finding, and
  a wheel that cannot tell empty from absent cannot show it to you. Empty
  headings deeper in appear too, so a client with nothing outstanding still has
  its place under its phase.

  Your round does not change: no task, no stop, and the count in the hub counts
  what it always counted. An empty heading is a place on the map, reachable with
  the arrows and by tapping, so you can rename it, move it, or put a task in it
  like any other. Headings your skip rules take out stay out — a rule means the
  same thing on every wheel. Wheels over a folder or the whole vault are
  unchanged: a wedge there is a folder, a tag or a property value, not a written
  frame.

- **Changed**: the band on the rim of the wedge you are reading is drawn in a
  stronger version of its own hue, and in a thicker line, rather than the faded
  one every band gets. Not the full hue: the rim reads as a map and a map should
  not compete with the work drawn inside it, so it lands between a band at rest
  and a wedge title. Nothing new is being encoded: hue is still the domain and
  lightness is still the priority — this only says which wedge you are standing
  in, which the reading wedge already said.

- **Fixed**: the reading wedge's arrow no longer lies across the name of the
  wedge you are reading. It is drawn behind the disc now, so it shows around the
  letters instead of through them.
- **Fixed**: a wedge title keeps its own colour when it is the item you are
  reading. It used to turn white, so the same name changed colour depending on
  whether you had the wedge or one of its tasks selected — and a wedge title is
  the one label whose colour *is* what it says.
- **Fixed**: wedge titles are coloured on every wheel. A wedge is a folder on
  one wheel and a loose note, a tag, a property value or a heading on another,
  and only one of those was being treated as a wedge — so the same drawing
  coloured its titles on a note wheel and left them grey on a folder wheel.

## [0.1.10]

The wedge you are reading says its name, and the colour-blind palette keeps its
promise.

- **Fixed**: *Colour-blind friendly* could still hand a domain the colour it
  says it leaves out. Its sixth hue asked the theme for *pink* — and pink is not
  a colour so much as a place on the red axis, with how far along it entirely
  the theme's business. Some themes make it red, and then the sixth domain came
  out red. That hue is now built rather than asked for: the theme's own pink
  pulled a fixed step towards the theme's own blue, which lands a red-leaning
  pink in magenta and a true pink in orchid. It still moves when your theme
  moves, and it is the only hue in either palette that is mixed rather than read.
- **Fixed**: the wedge under the reading wedge no longer carries the shortest
  label on the wheel. A wedge title was cut to eleven characters wherever it
  stood — three fewer than an ordinary task beside it — so "Product launch" read
  as "Product la…" at the very moment the wheel was about it. A title is now
  written out while it stands under the reading wedge and goes short again as it
  swings aside, the same way the branch you are reading always has.
- **Changed**: the name of the task you are reading gets forty characters
  instead of thirty. Both of these are free: the drawing is sized for a *short*
  label hanging off the side at three o'clock, and a written-out label only ever
  appears near the top or bottom, where it barely reaches sideways at all. The
  window was paying for a long label at three o'clock, which no turn of the
  wheel can produce — so the wheel is if anything a little roomier than before.

## [0.1.9]

The released plugin can be rebuilt from its own source again.

- **Fixed**: 0.1.8 shipped a `main.js` that nobody could reproduce. It carried
  a stamp saying which build it was, and that stamp was the clock — so every
  build differed from every other, and rebuilding the released source could
  never produce the released bytes. The stamp now comes from the source
  itself, which identifies a build just as well and leaves it reproducible:
  the same source builds the same file, byte for byte. Nothing about the
  plugin's behaviour changes; what changes is that the release can be checked.

## [0.1.8]

Turning on a phone stops opening things you did not ask for, and the wedges
can be recoloured.

- **Fixed**: on a phone, turning the wheel opened Obsidian's side panels and
  pulled down the command panel. A quick turn was read as a swipe — and it
  took almost nothing to trigger: a finger that moved at all in the first
  tenth of a second was enough, which is why turning only worked if you
  pressed, paused, and then dragged. A gesture the wheel takes now stops at
  the wheel, and a panel that still slips open under a turning finger is put
  straight back — only inside the drawing, and only to the state that finger
  found. Beside the wheel, and anywhere else, your own swipes reach the
  panels exactly as before.
- **Added**: a choice of hues for the wedges, under *Wedge colours*. A palette
  selects from the colours your own theme defines, so retuning the theme still
  retunes the wheel and one rule keeps serving both light and dark.
  **Colour-blind friendly** leaves out red and green — the pair that collapses
  for the two most common kinds — and leads with blue and orange, which stay
  apart. Hue says which domain a task belongs to, never how urgent it is.
- **Changed**: stepping into a wheel now stays in the tab you are in, and
  stepping back out returns to the wider one. The ladder runs vault → folder →
  note → section, so a tab per step used to leave one behind for every branch
  you looked at. Nothing is lost by walking rather than stacking: every wheel
  keeps its own round, filter, zoom and folded branches. Set it back under
  *Stepping into a wheel*; a wheel opened from the file list, the ribbon or a
  command still gets a tab of its own.
- **Fixed**: a wheel that was already open is found again reliably. Tabs you
  had not touched since starting Obsidian were invisible to the check, so
  opening the same wheel made a second one.
- **Changed**: the troubleshooting panel has a *Copy* button and keeps far
  more of what it recorded, so a report can carry the trace itself rather
  than a photograph of part of it.

## [0.1.7]

The buttons on the reading card are visible again.

- **Fixed**: on iPad, every control on the reading card was an empty box —
  the eight actions and both step arrows, drawn at the right size, holding no
  icon at all. Icons now always sit in an element of their own, the way the
  rest of the plugin already placed them, which is the arrangement that
  renders on every device tested.
- **Changed**: those same icons are drawn with a slightly heavier line, so
  they read as controls rather than as decoration on a light theme. Their
  colour is unchanged: the row stays quiet, because the wheel is what your
  eye should land on.

## [0.1.6]

The drawing sits still now — and turning lands on the work.

- **Fixed**: on a wheel with a single wedge, the thick band around the wheel
  lurched to a new place at every stop while everything else stood still. A
  full-circle band was drawn as one SVG arc, whose two endpoints all but
  coincide — and a browser re-derives an arc's centre from its endpoints, so
  the ring landed visibly off the hub, somewhere new every turn. A whole
  circle is now drawn as two half arcs, whose centre cannot wander.
- **Fixed**: the drawing no longer changes size while you turn. Its window
  was sized to what happened to be drawn, and what is drawn follows the
  focus — a deep or long-labelled branch unfolding under the reading wedge
  rescaled the whole wheel. The window now comes from the notes themselves
  and only changes when they do.
- **Fixed**: a note opening with a heading that merely repeats its own name
  no longer spends a ring on it. Tasks in a folder of notes with and without
  such a heading now share one ring, so the outermost ring reads steady
  instead of stepping in and out as you turn. The heading itself is still
  there for editing; it just is not a ring.
- **Changed**: turning now lands on tasks — and on folded branches — rather
  than on every container in between, and the count in the hub counts tasks.
  A round of 40 tasks is 40 stops; the arrows, tapping and the menus still
  reach every heading and note. A container's arc colours along as
  everything of the round below it has been seen.
- **Fixed**: on desktop, the help panel could open as an empty pane when the
  workspace refused the sidebar view (seen on Obsidian 1.13.7); the help now
  verifies it is actually on screen and falls back to a window if not.

## [0.1.5]

Scrolling now moves one task at a time.

- **Fixed**: turning the wheel with a mouse could jump several tasks per
  notch, which is a fast way to lose your place in a round. A scroll wheel
  reports distance rather than notches, and how much distance a notch is
  worth is a system-wide setting made for reading documents. One scroll now
  moves at most one stop, whatever your system sends. Spinning faster still
  travels faster, turning back answers immediately, and trackpads are
  unchanged.

## [0.1.4]

A wheel over one section, and deferring that actually parks.

- **Added**: the section wheel. Double-tap a heading — the wedge or a ring —
  in a wheel over one note, or pick *Open a wheel over this section* from
  the heading's menu, and you get a wheel over just that section, with its
  subheadings as the wedges. The ladder now runs vault → folder → note →
  section, and each rung goes back out one step. Deep notes gain drawing
  rings exactly where they ran out of them. Every section keeps its own
  round and filter; a renamed or removed heading is said out loud instead of
  leaving a circle about nothing.
- **Fixed**: *Push a week out* now parks the task — it writes a scheduled
  date (⏳) a week ahead and leaves the due date (📅) alone. Deferred tasks
  now show up under *Parked for later* and drop out of *Ready now*, and
  your deadlines stop being quietly rewritten. Pressing again moves another
  week forward; a task past its due date honestly stays visible under the
  *Overdue* lens — the deadline is a fact, only your attention moved.

## [0.1.3]

Fixing a task's place in its note no longer needs a detour.

- **Changed**: the outline actions on the card — rename, add a task, move up
  or down, send to another heading, hang under another task — now work from
  every wheel, not only from a wheel over one note. Each of these edits stays
  inside the task's own note whatever wheel you are looking at, so a task
  that sits just wrong can be put right mid-review. Editing headings still
  belongs to the note's own wheel: that reshapes a document.
- **Removed**: an internal audit document that travelled along with the
  0.1.2 source sync. It contained no secrets — a quality report with
  everything green — but it was never meant to be part of this repository.

## [0.1.2]

A round can only close honestly if no task is secretly on the wheel twice —
and a wheel can now say how busy each part of your life is.

- **Added**: *Show possible duplicate tasks* — a command (also in the round
  menu) that groups open checkboxes sharing the same words, across the whole
  vault, and links every place straight to its line in the note. Exact
  matches only, compared after stripping dates, priorities and tags — so a
  copy that later gained a due date is still found. The report names
  candidates and changes nothing: whether two identical texts are one task
  twice or two tasks on purpose is your call, in the note.
- **Added**: wedge sizes are now a choice — *Equal* (the default, unchanged:
  every domain the same slice, the strongest guarantee for spatial memory)
  or *By open tasks*, where busier domains get wider wedges. Proportional
  wedges re-divide only when a round begins, never mid-round, so the drawing
  cannot shift under your hands while you review. A configurable narrowest
  wedge (default 15°) keeps every domain wide enough to carry its own name —
  proportion is not worth an unreadable sliver. Hand-pinned wedges keep
  their width in both modes.

## [0.1.1]

Findings from the community-listing review, plus clearer store copy.

- **Fixed**: two CSS lint findings — a dead duplicate `flex` on the card's
  action buttons, and `all: unset` on the help panel's action links (replaced
  by explicit resets, which also restores focus visibility).
- **Changed**: the plugin description now opens with the problem the wheel
  solves instead of explaining its geometry.
- **Changed**: removed leftover placeholder text from the README.

## [0.1.0]

First public release.

- **The wheel**: every open task in your vault as a turnable radial tree —
  angle is the life domain, radius is the depth. A fixed reading wedge at
  twelve o'clock; one click stop per item; a round is complete when the circle
  closes, and the wheel says so.
- **Position stability**: every domain keeps a fixed angular budget, so
  spatial memory works. A fisheye around the reading wedge shows detail where
  you look without redistributing anything.
- **Nothing disappears silently**: folded branches and everything past the
  drawing budget stay visible as stumps with counters; an active filter always
  says what it is leaving out.
- **Scales**: a vault of two hundred tasks and one of twenty thousand produce
  the same amount of drawing.
- **Review actions on the card**: tick off, mark in progress, cancel, push a
  week out, raise or lower priority, open the note — routed through the Tasks
  plugin when it is installed, so recurring tasks roll over correctly.
- **Carrying work**: copy or move a task (with its subtasks) or a whole
  heading into another note, with its category path recreated over there.
  Named destinations become commands you can bind keys to.
- **Local wheels**: a wheel over one folder or one note, from the file list or
  by double-tapping an item; a way back out to the wider wheel.
- **Filters per wheel**: words (with `OR`, quotes, `*` and `file:`), status,
  dates (including "parked for later"), priority and tags. A changed filter
  is a new round, and the wheel says so.
- **Skip rules**: exclude checklists by note type or by heading, with a
  report that shows exactly what they take out.
- **Help surface**: a sidebar panel on desktop, a modal on mobile — keys and
  actions (only the ones your device has), the drawing's legend, and where
  this round stands. Speaks thirteen languages and follows Obsidian's own
  language setting.
- **Theme-true**: all colour comes from your theme's variables; works in
  light and dark, on desktop and mobile.
- **Private by design**: no network calls, no telemetry; release assets carry
  a build-provenance attestation.
