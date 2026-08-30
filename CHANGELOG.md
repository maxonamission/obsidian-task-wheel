# Changelog

All notable changes to Task Wheel. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the release workflow
lifts each version's section into the GitHub release notes.

## [Unreleased]

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
