# Design guidelines: neo2-flightpath desktop UI

Standing reference for the Electron desktop UI.

## 1. Purpose, scope and status

- **Read before UI work.** Everyone who changes anything under `ui/` must read this file first, agents included. AGENTS.md links to this file; the rules live here, not in AGENTS.md.
- **Scope:** the app UI: landing, player (video, map overlay, control bar, stats strip), settings and export dialogs, icons, copy and error text. Native OS dialogs in `app/main.mjs` are not styled here; their wording follows section 12.
- **Out of scope:** the frames and map overlay rendered by `src/renderer/` (its palette is an exception, section 16) and CLI output.
- **Source of truth:** this file for token names and values, patterns, states and copy. For values the code is authoritative: `ui/app/globals.css` (tokens and styles), `ui/components/` (components), `ui/icons/` (glyphs) and `ui/lib/` (helpers such as `errortext.ts`, `framerate.ts`, `pickstate.ts`, `exportstate.ts`, `hotkeys.ts`).
- **Where tokens live:** only in the `:root` block of `ui/app/globals.css`. Components use classes that consume tokens. Inline styles are limited to runtime geometry.
- **Status:** dark theme only. Changes to this file follow section 17.

## 2. Principles

Section 2.1 states the product principles. Section 2.2 applies [Jakob Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) (Nielsen Norman Group) to this app as guiding principles.

### 2.1 Product principles

1. **Calm and precise.** One accent, neutral surfaces, short plain sentences.
2. **One primary action per surface.** The landing and the export form each have one primary button; the player bar has none.
3. **Every state visible.** Busy, waiting, canceling, disabled and failed states each show text (sections 10 and 13).
4. **Say what happened and what to do next.** Failures read as sentences, not codes (section 13).
5. **The footage is the hero.** The video is the main pane and the map a picture-in-picture pane (section 11).
6. **No decoration that competes with the video.** Video and map never animate (section 9); the chrome has no glow, gradient or blur.

### 2.2 Usability heuristics

**TL;DR:** Nielsen's ten heuristics (system status, real-world match, user control, consistency, error prevention, recognition over recall, flexibility, minimalist design, error recovery, help) guide every screen. The table shows how this UI applies each one and which gap is open.

| # | Heuristic | How this UI applies it | Open gap |
|---|---|---|---|
| H1 | Visibility of system status | Busy text on actions and progress ("Preparing…", "Warming tiles…", "Canceling…", "Rendering 83%"); notices announced as `status` or `alert`; the time readout follows playback | §16 #13 |
| H2 | Match between system and the real world | Plain failure sentences; "59.94 fps"; m:ss times; "0:10–0:12 · 121 frames" | §16 #5, #6 |
| H3 | User control and freedom | Escape, backdrop and header Close leave Settings at any time; Cancel export; Dismiss on Open errors; Clear loop; settings apply on change | None recorded |
| H4 | Consistency and standards | One button recipe, one `Notice`, one dialog anchor (`--dialog-top`), one label per action (Open…, Export…, Start export) | §16 #2, #19, #20 |
| H5 | Error prevention | Values are checked before the pipeline (`patchConfig`, `dimensionsValid`); Play and Clear are disabled when they cannot act; the export refuses to overwrite the source recording (`src/exportjob.ts`); the destination is replaced only after verification; the save flow asks before replacing a file (`app/main.mjs`) | §16 #9 |
| H6 | Recognition rather than recall | Icon plus label on landing and bar actions; shortcuts in titles ("Set loop in (I)"); the selected speed is filled; the segment choice shows its range and frame count | §16 #33 |
| H7 | Flexibility and efficiency of use | Shortcuts for play, speed, loop, swap and frame stepping (`ui/lib/hotkeys.ts`); Ctrl+O in the player; Shift with arrows jumps one second | §16 #15 |
| H8 | Aesthetic and minimalist design | One accent; the footage is the largest surface; one notice at a time on the landing; two shadow tokens; no gradients or textures | §16 #19 |
| H9 | Help users recognize, diagnose and recover from errors | One sentence says what happened and what to do next; technical text sits under "Technical details"; field messages name the rule; export errors state that the destination was left untouched | §16 #10, #11, #28 |
| H10 | Help and documentation | The landing states the requirements (ffmpeg and ffprobe on PATH; an .SRT sidecar is used); shortcuts are in titles; README.md and AGENTS.md document usage and development | §16 #8, #33 |

## 3. Look and feel

- **Direction:** dark desktop UI: layered neutral surfaces (`--page` to `--surface-4`), 1 px hairline borders, one cyan accent (`--accent`), a violet loop color (`--loop`), 8 px and 12 px radii with pills, the Segoe UI Variable stack, icon plus label for landing and bar actions, and 140 ms motion.
- **Dark only:** `color-scheme: dark` on `html` and `body`. There is no light theme.
- **Avoid:** neon glow, heavy or decorative gradients, background textures, skeuomorphic bevels, and highlights that are not states. The only inset rings mark the loop band and invalid fields (section 7).

## 4. Color

All 36 tokens in `ui/app/globals.css` (`:root`). Contrast ratios are WCAG 2.x, computed from these values; control bar and stats strip contrast assumes black footage behind them.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--page` | `#0b1017` | Page background (`html`, `body`) | Text 17.1:1 |
| `--surface-1` | `#121a25` | Raised card: landing, dialogs, notice base, select options | Text 15.7:1 |
| `--surface-2` | `#19232f` | Controls: buttons, fields, stats chips, speed group, progress track, toggles | Text 14.2:1 |
| `--surface-3` | `#212c3a` | Hover fill | Text 12.7:1 |
| `--surface-4` | `#2b3749` | Pressed fill; dialog scrollbar thumb | Text 10.8:1 |
| `--bar` | `rgba(11, 16, 23, 0.94)` | Control bar over the footage | Text 17.2:1 over black |
| `--scrim` | `rgba(4, 7, 12, 0.5)` | Dialog backdrop | Not text |
| `--hairline` | `rgba(255, 255, 255, 0.08)` | Decorative separators: landing card, bar top edge, stats chips | 1.24:1 on surface-1 (decorative) |
| `--hairline-strong` | `rgba(255, 255, 255, 0.16)` | Borders: buttons, fields, speed group, dialogs, PIP, toggles | 1.66:1 on surface-2 (§16 #17) |
| `--hairline-hover` | `rgba(255, 255, 255, 0.28)` | Hover borders: buttons, number fields, unchecked toggles | 2.52:1 on surface-2 (§16 #17) |
| `--text` | `#eef3f8` | Primary text | 17.1:1 on page |
| `--text-2` | `rgba(238, 243, 248, 0.74)` | Labels, readouts, chips, paths | 9.0:1 on surface-1; 7.6:1 on surface-3 |
| `--text-3` | `rgba(238, 243, 248, 0.6)` | Hints, legends, "Technical details" | 6.3:1 on surface-1; 5.0:1 on surface-4 |
| `--accent` | `#5cd5ff` | Primary fill, selected speed, checked toggle, played range, export fill | 11.3:1 with `--accent-ink`; 9.4:1 on surface-2 (non-text) |
| `--accent-hover` | `#8fe6ff` | Primary hover fill | 13.6:1 with `--accent-ink` |
| `--accent-press` | `#47c2ec` | Primary pressed fill | 9.3:1 with `--accent-ink` |
| `--accent-ink` | `#071018` | Text and check mark on accent | 11.3:1 on `--accent` |
| `--focus` | `#ffffff` | Focus outline | 19.1:1 on page (non-text) |
| `--danger` | `#ff7a7a` | Danger tone; invalid field border; field message | 6.9:1 as text on surface-1 |
| `--warning` | `#ffcb6b` | Warning tone (notices only) | 11.7:1 on surface-1 (tone) |
| `--info` | `#8ab4ff` | Info tone (notices only) | 8.4:1 on surface-1 (tone) |
| `--loop` | `#b388ff` | Loop band fill and outline | 7.2:1 on bar (non-text) |
| `--loop-text` | `#d4bcff` | Loop readout text | 11.4:1 on bar |
| `--radius-control` | `8px` | Buttons, fields, select, notices, dismiss (§7) | — |
| `--radius-panel` | `12px` | Landing card, dialog panel, PIP (§7) | — |
| `--radius-pill` | `999px` | Stats chips, speed group and segments, progress track and fill, loop band (§7) | — |
| `--control-h` | `36px` | Default control height (§10.1) | — |
| `--bar-h` | `64px`; `96px` at 1440px and below | Control bar height (§11) | — |
| `--dialog-top` | `56px` | Dialog top offset (§10.5) | — |
| `--shadow-float` | `0 24px 60px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)` | Landing card, dialog panel, player notices (§7) | — |
| `--shadow-pip` | `0 12px 32px rgba(0, 0, 0, 0.5)` | PIP pane (§7) | — |
| `--disabled-opacity` | `0.45` | Disabled controls (§10.1) | — |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | Transition easing (§9) | — |
| `--motion` | `140ms` | Transition duration (§9) | — |
| `--font-ui` | `"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif` | UI font (§5) | — |
| `--font-mono` | `ui-monospace, "Cascadia Mono", Consolas, monospace` | Paths and details (§5) | — |

- **Accent** marks the primary action, the selected speed segment, a checked toggle, the played part of the timeline and the export progress. It never marks loops, warnings or decoration.
- **Loop colors** mark only the loop band, its ring and the loop readout.
- **Warning** appears only in notices. **Danger** appears in notices and on invalid fields and field messages (§16 #31).
- **Never color alone:** every state also has text: a label, `aria-invalid` with a message, or notice wording.
- **Contrast:** text needs 4.5:1 on its surface; non-text needs 3:1 (focus, state fills, meaningful icons, and borders that identify a control). Disabled controls are exempt.
- `--tone` is a local property set by `.notice-info`, `.notice-warning` and `.notice-danger`. Literal colors outside `:root`: `#000` (video and PIP backgrounds), `rgba(11, 16, 23, 0.82)` (stats strip), `#b9c6d6` (select chevron).

## 5. Typography

- **Stacks:** `--font-ui` and `--font-mono` as listed in section 4. No font file is bundled or loaded.
- **Type scale in use** (every size and weight in `ui/app/globals.css`):

| Size | Weight | Used for |
|---|---|---|
| 28px | 600 | Landing title (`.landing h1`) |
| 18px | 600 | Dialog titles (`.settings-header h2`) |
| 16px | 600 | Landing primary button (`button.primary`) |
| 14px | 400 | Body (`html, body`), buttons, fields, notice text, settings rows |
| 13px | 400 | Hints, legends, readouts, stats chips, field messages, notice details, progress label |
| 12px | 400 | Mono only: notice details, export path |

- **Weights:** 400 and 600. Weight 600 also applies to `h1`, `h2`, `button.primary`, `button.export-primary` and the pressed speed segment. Headings use `letter-spacing: -0.01em`.
- **Line height:** 1 for buttons; 1.5 for notice text, hints, landing copy and mono text.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`): readouts, stats chips, number fields, export progress label.
- **Case:** sentence case; capitals only for names and acronyms (ALT, SPD, HUD, SRT).
- **Ellipsis:** the character "…" (U+2026), never three periods, for actions that open a dialog or picker (Open…, Export…) and for work in progress (Preparing…, Warming tiles…, Canceling…).
- **Other characters:** "×" in sizes and speed ("1280×720", "1×"); "–" in ranges; " · " between parts of a summary; straight quotes inside error sentences.

## 6. Spacing

No spacing tokens exist (§16 #4). New code follows the 4 px grid. Values in use:

| Value | Used for |
|---|---|
| 2px | Speed group gap and padding |
| 4px | Stats chip vertical padding; legend bottom padding |
| 8px | Gaps in buttons, bar groups, stats strip and dialog actions; dismiss padding; narrow bar row gap |
| 10px | Speed segment horizontal padding |
| 12px | Button padding; gaps in settings rows, notices and the bar; stats chip padding; export path offset |
| 16px | Notice margin and padding; bar and stats side padding; dialog header, group and action offsets; progress offset; player notice and PIP inset |
| 20px | Dialog panel vertical padding |
| 24px | Dialog panel and overlay horizontal padding; landing primary padding |
| 32px | Landing card padding; room for the select chevron |
| 40px | Minimum height of a settings row |

Sizes that are not spacing: 8px progress track and loop band height; 28px dismiss; 30px speed segment; 36px `--control-h`; 44px landing primary; 56px `--dialog-top`; 64px and 96px `--bar-h`; 96px settings label and number field width.

## 7. Shape and elevation

- **Radii:** `--radius-control` 8px (buttons, fields, select, notices, dismiss); `--radius-panel` 12px (landing card, dialog panel, PIP); `--radius-pill` 999px (stats chips, speed group and segments, progress track and fill, loop band). Literals: 4px for checkboxes and 50% for radios (§10.2).
- **Borders:** 1 px. `--hairline` for decorative separators; `--hairline-strong` for controls, dialogs and the PIP; `--hairline-hover` on hover. Notice borders are the tone at 40%.
- **Shadows:** `--shadow-float` (landing card, dialog panel, player notices) and `--shadow-pip` (PIP). No other drop shadows.
- **Inset rings:** a 1 px inset ring marks two states only: the loop band (`--loop`) and an invalid field (`--danger`).
- **Scrim:** `--scrim` with `backdrop-filter: blur(2px)` on `.settings-overlay`. Blur belongs only behind dialogs, which open over the player; do not blur the bar, the stats strip or other surfaces (§16 #32).
- **Stacking:** dialog overlay 2000; player notices 3; PIP 2 (`ui/lib/pipstyle.ts`); the map host isolates its internal layers.

## 8. Iconography

- **Style:** 24-unit grid (`viewBox="0 0 24 24"`), stroke only (`fill="none"`, `stroke="currentColor"`), stroke width 2, round caps and joins, `aria-hidden="true"`. Tests pin these attributes (`test/ui/lineicons.test.tsx`, `closeicon.test.tsx`, `settingsicon.test.tsx`).
- **Size:** 16px inside buttons (`button svg` in `ui/app/globals.css`), which overrides the SVG attributes. The seven drawn glyphs have `width="16"`; `CloseIcon` and `SettingsIcon` have `width="18"`, pinned by their tests, and render at 16px (§16 #3).
- **Color:** `currentColor`. A glyph takes its button's text color (`--text`, or `--accent-ink` on the primary and pressed speed segments).
- **Icon plus label:** landing and bar actions show a glyph and visible text. Dialog footer buttons, speed segments ("1×") and the timeline use no glyph.
- **Icon-only controls:** none exist. A future one must carry `aria-label` and `title`, as the Settings control does. Close and Settings also show their text today (§16 #1).
- **Inventory:** vendored Lucide: `CloseIcon` ("x") and `SettingsIcon` ("settings"). Drawn for this app, per their file headers, in the Lucide grid and stroke style: `PlayIcon`, `PauseIcon`, `FolderOpenIcon`, `SwapIcon`, `ExportIcon`, `MarkInIcon`, `MarkOutIcon`.
- **Provenance (checked):** `THIRD-PARTY-NOTICES.md` describes the `ui/icons/` components as the Lucide icon set under the ISC license, with MIT also applying to the Feather-derived "x". It has no entry for the seven drawn glyphs, and their paths were not compared with Lucide (§16 #29).

## 9. Motion

- **Tokens:** `--motion` 140ms; `--ease` `cubic-bezier(0.2, 0, 0, 1)`.
- **What moves:** buttons, checkboxes, radios, number fields and selects transition `background-color`, `border-color`, `color`, `transform` and `opacity` over 140ms; the press shift (`translateY(1px)`) moves with its button. The export progress fill animates `width` over 250ms (§16 #21).
- **What never moves:** the map (`.scene-host` and children set `animation: none` and `transition: none`), the video, the stage panes and the PIP swap (instant), the control bar, the timeline and loop band, the stats strip, notices, and dialog open and close. A toggle's check mark is a pseudo-element and does not transition.
- **Reduced motion:** `prefers-reduced-motion: reduce` sets `transition: none` on buttons, checkboxes, radios, number fields, selects and the progress fill. The press shift then becomes instant.

## 10. Components and states

### 10.1 Buttons

- **Recipe** (`button`): inline-flex; 36px high (`--control-h`); 0 12px padding; 14px text, line height 1; 8px gap; 16px glyph; 1px `--hairline-strong` border; `--surface-2` fill; `--radius-control`.

| Variant | Selector | Difference from the recipe | Used for |
|---|---|---|---|
| Default | `button` | None | Open…, In, Out, Clear, Swap view, Export…, Settings, Cancel, Cancel export, Reveal in folder, Open video, Close, Dismiss |
| Primary, landing | `button.primary` | Accent fill, `--accent-ink` text, 600, transparent border, 44px high, 0 24px padding, 16px text | Open… on the landing |
| Primary, dialog | `button.export-primary` | Accent fill, `--accent-ink` text, 600, transparent border; default size | Start export |
| Speed segment | `.speed-group button.speed` | Transparent fill, no border, 30px high, 0 10px padding, pill | 1×, 2×, 3×, 4× |
| Dismiss | `.notice-dismiss` | 28px high, 0 8px padding | Dismiss in notices |

| State | Default | Primary | Speed segment |
|---|---|---|---|
| Hover | `--surface-3` fill; `--hairline-hover` border | `--accent-hover` fill | `--surface-3` fill; pressed segment `--accent-hover` |
| Pressed | `--surface-4` fill; `translateY(1px)` | `--accent-press` fill; `translateY(1px)` | `translateY(1px)` only |
| Focus-visible | 2px `--focus` outline, 2px offset | same | same |
| Disabled | `--disabled-opacity` (0.45); default cursor; no hover or pressed change | same | same |

### 10.2 Toggles

- Checkboxes and radios are custom: 16px box, `--surface-2` fill, 1px `--hairline-strong` border; checkbox radius 4px, radio 50%. Checked: `--accent` fill and border, with the check mark or dot in `--accent-ink`. Unchecked hover: `--hairline-hover` border. Disabled: 0.45 opacity. Each sits in a `label.settings-row` with its text.
- HUD chips are checkboxes. "Altitude (ALT)" is disabled, with the title "Altitude unavailable in this telemetry", when the recording has no altitude. The export "What" choice uses radios.

### 10.3 Notices

- One component, `Notice` (`ui/components/Notice.tsx`), with props `tone` (`info`, `warning`, `danger`), `details` and `onDismiss`. It renders `notice notice-{tone}`: 12px 16px padding, 12px gap, 8px radius, an 11% tone tint over `--surface-1`, and a 40% tone border.
- Text: 14px, line height 1.5. Details: a "Technical details" disclosure with the original text in 12px mono. Roles: `danger` is `alert`; `info` and `warning` are `status`.

| Tone | Used for |
|---|---|
| `info` | Open preparing; no recording picked; export summary; export canceled |
| `warning` | Settings: no altitude telemetry, so the ALT chip stays off |
| `danger` | Open failed; export could not start; export failed |

- **Placement:** landing, below Open… (16px top margin). Player: a centered overlay at the top of the stage (16px from the top, at most 560px wide, z-index 3, `--shadow-float`), showing only Open preparing and Open errors. Dialogs: above the footer on the export form; under the title in the done, canceled and error phases. Settings: inside the HUD chips group.
- **Dismissible rule:** a notice is dismissible only when its owner passes `onDismiss`; today only Open errors are. Notices that describe a state (preparing, export running, the altitude warning) are not dismissible and clear when the state changes. Export form errors clear on the next form edit or start (`ui/lib/exportstate.ts`).

### 10.4 Fields

- **Settings row:** label (`label.settings-label`, 96px, `--text-2`), control (36px high, `--surface-2`, `--hairline-strong` border, 8px radius, 0 12px padding, 14px text), and one helper slot holding the hint (`.hint`, 13px, `--text-3`) or the message (`.field-message`, 13px, `--danger`).
- **Number field** (`NumberField`): 96px wide, tabular numerals, `min` and `step` props (step 1; 0.5 for Intro and Outro). A valid value applies at once. A value that is not finite, is below `min`, or fails the owner's check is rejected: the typed text stays, `aria-invalid="true"` is set, the border turns `--danger` with a 1px inset ring, `aria-describedby` points at the message, and the message replaces the hint: "Must be {rule}." Rules in use: "0 or more", "at least 64 px". On blur the typed text is dropped and the last valid value shows.
- **Select:** a native `select` styled as a field (`appearance: none`, 32px right padding, chevron as background image). Options show raw values (§16 #6).
- **Groups:** `fieldset.settings-group` with a 13px `legend` in `--text-3`: "HUD chips"; "What" and "How" in export.

### 10.5 Dialogs

- **Anatomy:** overlay `.settings-overlay`; panel `.settings-panel` (`role="dialog"`, `aria-label` "Settings" or "Export"); header `.settings-header` (18px title and the header close); body; footer `.dialog-actions` (right-aligned, wrapping, 8px gap, 16px top margin), export only. Settings has no footer and applies changes on change.
- **Position and size:** the top edge sits 56px (`--dialog-top`) below the window top in every phase. The panel is `min(440px, 100%)` wide, padded 20px 24px, at most `100vh − 80px` high, and scrolls inside.
- **Header close** (`DialogClose`): always present, labeled "Close" with a glyph. While closing would interrupt work it is disabled, and its `title` gives the reason: "Export is running. Cancel it to close."
- **Footer by phase** (export):

| Phase | Footer | Notice |
|---|---|---|
| Form | Cancel (closes); Start export (primary) | Danger, for a start or file error |
| Running | Cancel export (disabled while canceling) | Progress above |
| Done | Reveal in folder; Open video; Close | Info summary; output path above |
| Canceled | Close | Info |
| Error | Close | Danger; ends "The destination file was left untouched." |

- **Escape and backdrop:** Settings closes on Escape, backdrop click or header Close at any time. Export closes on Escape, backdrop click or Close only when not running; while running they are ignored.
- **Lock while busy:** during an export the header close is disabled. Closing the window asks "An export is in progress" (native prompt, `app/main.mjs`). Cancel export is the only way out.
- **Shortcuts:** while a dialog is open, player shortcuts are off; only Escape reaches the dialog logic (section 15).

### 10.6 Progress

- **Determinate:** `.export-progress-track` (8px high, `--surface-2`, pill) holds `.export-progress-fill` (`--accent`, width = rounded percent). `role="progressbar"`, `aria-label="Export progress"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` = the percent. The label below (13px, `--text-2`) reads "Rendering 83%" from the `frames: N/M captured` log lines (`ui/lib/exportstate.ts`).
- **Unknown amount:** no animated indeterminate bar exists (§16 #13). The label reads "Preparing…" and the fill stays at 0%; while canceling it reads "Canceling…".
- **Busy controls:** the landing Open… reads "Preparing…" and is disabled while the recording is prepared; the player's Open… is disabled; Play reads "Warming tiles…" and is disabled until the map is ready.

## 11. Layout and responsiveness

- **Window:** default 1600×950; minimum 1024×600 (`app/main.mjs`).
- **Landing:** card at most 560px wide, 32px padding, 12vh top margin, centered.
- **Player stage:** fills the area above the control bar. The video is the main pane (`object-fit: contain`, black letterbox). By default the map is the picture-in-picture pane: 30% of the stage width in a 16:9 frame; a video in that pane takes its own aspect, and a portrait video takes 45% of the stage height. The pane sits 16px from the right and bottom edges. Swap view exchanges the two.
- **Stats strip:** above the bar, 8px 16px padding; five chips, or six with no-lock cues, wrapping with 8px gaps.
- **Control bar:** `--bar-h` 64px. Above 1440px it is one row: Open… (left); transport (center: Play, In, Out, Clear, timeline, time readout, loop readout, speed group); Swap view, Export… and Settings (right). Gaps 12px; padding 0 16px.
- **At 1440px and below** (`@media (max-width: 1440px)`): the bar is 96px high in two rows. The left and right groups share the first row; the transport takes the second. Row gap 8px; padding 8px 16px. The code comment says "below 1440px"; the query includes 1440 (§16 #24).
- **Timeline:** minimum 120px, `clamp(120px, 28vw, 420px)` wide, growing to fill its row.
- **Dialogs:** `min(440px, 100%)` wide; top offset 56px (§10.5).

## 12. Copy and labels

- **Rules:** verb-first actions ("Open…", "Start export", "Cancel export", "Reveal in folder"); nouns for toggles and destinations ("Settings", "Swap view"); short phrases for status ("Preparing…", "Warming tiles…", "Canceling…"). Sentence case. American English ("canceled", "Canceling…"). No exclamation marks.
- **One name per action:** the landing and the player both say "Open…"; the bar says "Export…" and the dialog title is "Export".
- **Ellipsis:** for actions that open a dialog or picker and for work in progress (section 5). **Shortcuts** go in parentheses in the `title`: "Set loop in (I)".

| Label | Where | Notes |
|---|---|---|
| Open… | Landing primary; player bar | Opens the native picker; disabled while preparing |
| Preparing… | Landing primary | Replaces Open… while preparing |
| Play / Pause | Player bar | Follows playback |
| Warming tiles… | Player bar | Until the map is ready; disabled |
| In / Out / Clear | Player bar | `aria-label` "Set loop in", "Set loop out", "Clear loop"; Clear is disabled without a loop |
| Swap view | Player bar | Exchanges video and map |
| Export… | Player bar | Opens the export dialog |
| Settings | Player bar | Opens settings; no ellipsis (§16 #2) |
| Start export | Export form | Asks for a destination first |
| Cancel | Export form | Closes the dialog |
| Cancel export / Canceling… | Export running | "Canceling…" while the cancel is pending |
| Rendering 83% / Preparing… | Export progress | Percent, or unknown amount |
| Reveal in folder / Open video | Export done | Shows the folder; opens the file |
| Close / Dismiss | Dialog header and footer / notice | |
| Technical details | Notice disclosure | Original text |
| Full recording (0:34); In–Out segment (0:10–0:12 · 121 frames) | Export "What" | Radios, shown only when a loop is set |
| Width, Height | Export "How" | Hint "px"; message "Must be at least 64 px." |
| Map style, View | Settings | Options show raw values (§16 #6) |
| Zoom, Zoom-out, Intro (s), Outro (s) | Settings | Hints "0 = auto-fit" and "auto-fit only"; rule "0 or more" |
| Heading arrow, Altitude (ALT), Speed (SPD) | Settings HUD chips | |
| Stats chips | Stats strip | Raw source and method names (§16 #5) |

- Raw identifiers belong under "Technical details" or in the CLI, never in main UI text.

## 13. Error guidance

- **Flow:** a backend or Node message goes through `describeError()` (`ui/lib/errortext.ts`) and yields `{ text, technical }`. The owning component renders `Notice tone="danger"`: `text` is the main line; `technical` sits under "Technical details". Open errors prefix the sentence with "Could not open the recording:" (§16 #28).
- **Mapping:** (1) a message that starts with a Node code (`EEXIST`, `ENOENT`, `EACCES`, `EPERM`, `ENOSPC`, `EBUSY`, `EISDIR`) becomes "{what happened} {what to do}", naming the file when the message ends with a quoted path; (2) one of 12 known app messages becomes its sentence; (3) any other message passes through unchanged as the main line, with no technical text (§16 #10).
- **Sentence pattern:** what happened, in plain words with the cause when known, then what to do next. Examples from the code:

| Message in | Main line shown | Technical details |
|---|---|---|
| `not a readable .mp4 file: <path>` (Open) | Could not open the recording: "<name>" is not a readable .mp4 recording. | Original message |
| `EEXIST: file already exists, mkdir '<path>'` (export) | A file named "<name>" is in the way. Choose another folder or file name. The destination file was left untouched. | Original message |
| `ENOSPC: …` | The disk is full. Free some space or choose another drive. | Original message |
| `no recording loaded` | No recording is loaded. Open a recording first. | Original message |
| `output verification failed: …` | The finished file does not match the recording frame count or frame rate. The destination file was left untouched. | Original message |
| `could not replace <path>: … (the finished render is at <working>)` | The export finished, but its file could not replace the destination. The render is kept at <working>. The destination file was left untouched. | Original message |
| `unknown error` | Something went wrong. Try again. | Original message |

- **Tones:** danger when an action failed and the user must act; info for a neutral result or progress; warning when the result stands but something is missing or limited.
- **"Left untouched":** say it only for export outcomes. It is true today because the export writes a `.partial` file beside the destination and replaces the destination only after verification (`src/exportjob.ts`). Never use it for Open errors.
- **"Working file was removed":** the canceled notice says so; removal is best-effort (§16 #12).
- **Never in the main line:** Node codes, Node or stack text, or a path other than a file name, unless the user must open that path (the kept render). Full detail goes under "Technical details".
- **Adding a message:** map it in `ui/lib/errortext.ts`, add a test in `test/ui/errortext.test.ts`, choose a tone, and follow the pattern. Field validation is not error text; it uses "Must be {rule}.".

## 14. Numbers and formats

- **Frame rate:** `formatFrameRate` (`ui/lib/framerate.ts`) turns a rational rate into decimal fps rounded to hundredths, with " fps": 60000/1001 → "59.94 fps"; 30000/1001 → "29.97 fps"; 25/1 → "25 fps". 24000/1001 shows as "23.98 fps" (§16 #26).
- **Time:** `formatTime` (`ui/lib/framedriver.ts`) gives m:ss from whole seconds, rounded, with no hour field (§16 #27). Readout "0:00 / 0:34"; chip "Duration 0:34"; loop readout "loop 0:10–0:12" ("?" for an unset point); segment "0:10–0:12 · 121 frames" (frames = out − in + 1).
- **Frames and seeks:** time is frame index ÷ fps; a one-second jump is `round(fps)` frames (`framesForSeconds`).
- **Export summary:** "{frames} frames @ {fps} · {seconds} s · {width}×{height}". Seconds are whole (`Math.round`, `src/run.ts`). Width and height are the even sizes rendered: each is rounded down, with a minimum of 64 (`src/run.ts`); they can differ from the typed values (§16 #9).
- **Dimensions:** px, minimum 64 (`MIN_DIMENSION`, `src/config.ts`).
- **Stats strip** (`formatStats`, `ui/lib/flightstats.ts`): "Duration {m:ss}", "Track {n} m", "{source} ({method})", "{n} fixes", "{n} no-lock cues" (only above 0), "heading: {yaw or cog}".
- **Percent:** whole percent, rounded: "Rendering 83%". **Units:** px, s, m and fps; speed uses "×".
- **Numerals:** tabular for readouts, stats chips, number fields and the export progress label. Decimal point "."; " · " between parts; "–" for ranges; "×" for sizes and speed.

## 15. Accessibility

- **Focus:** `:focus-visible` shows a 2px `--focus` (#ffffff) outline, offset 2px, on buttons, inputs (including toggles and the timeline), selects and summaries. Mouse clicks do not show it. Contrast on the page is 19.1:1.
- **Contrast:** every text token meets 4.5:1 on each surface where it is used (section 4). The accent, focus ring and state fills meet 3:1; control borders do not (§16 #17).
- **Names:** icon-plus-label buttons have visible text; Settings and Close also set `aria-label`; loop buttons set `aria-label` and a `title` with the key; dialogs have `role="dialog"` and an `aria-label`; the progress bar has `role="progressbar"` and a label; fields use `label` with `htmlFor`; groups use `fieldset` and `legend`; speed segments use `aria-pressed` in a group labeled "Playback speed". The timeline has no name (§16 #14).
- **Disabled reasons:** the visible label when it states the reason ("Preparing…", "Warming tiles…", "Canceling…") or a `title` (header close during an export; the altitude toggle). Clear gives no reason (§16 #8).
- **Keyboard** (`ui/lib/hotkeys.ts`, `PlayerChrome.tsx`): Space or K play and pause; 1–4 set speed; Home and End seek; I and O set loop points; S swaps the views; Left and Right step one frame; Shift with Left or Right jumps one second; Ctrl+O opens a recording; Escape closes the open dialog, or clears the loop when none is open, and does nothing while an export runs. Shortcuts are off in text fields, selects and text areas, and while a dialog is open (only Escape gets through). Only the arrow keys repeat when held. Known gap: Space toggles playback even when a button has focus (§16 #15).
- **Motion:** reduced motion removes all transitions; video and map never animate (section 9).
- **Announcements:** danger notices are alerts; info and warning notices are status messages. The progress bar exposes its value as `aria-valuenow` (§16 #13).
- **Text size:** the smallest text is 12px (mono details and paths); body text is 13–14px. Sizes are fixed in px and do not follow a system text-size setting.

## 16. Deliberate deviations and open items

**Accepted (deliberate)**

- Renderer palette and font in `src/renderer/theme.ts` and `src/renderer/dom.ts` (satellite, topo and HUD colors; the HUD font stack): out of UI scope. Accepted.
- OS-drawn select popups and number spinners. Accepted; `color-scheme: dark` darkens them.
- Segoe UI Variable is not bundled; the stack falls back to Segoe UI, then system UI. Availability depends on Windows and was not checked here. Accepted.
- Dark only; no light theme. Accepted.

**Baseline items** (the baseline UI audit behind issue #45, deviations D1–D12), status after this design

- D1, D5, D6, D7 (no interaction states; player open errors; silent validation; busy covering the native picker): fixed in code (sections 10.1, 10.3, 10.4, 10.6, 15); not re-measured here.
- D2 five button recipes: partly fixed; heights and primary sizes still differ (#20). Open.
- D3 control bar at 1024×600: addressed by the 1440px two-row bar; not measured here (#25). Open.
- D4 error presentation: mostly fixed; raw text still possible (#10). Open.
- D8 modal chrome: partly fixed; header close and top edge are fixed, two dismiss controls remain (#19). Open.
- D9 accent overload: mostly fixed; the loop is violet; the map core still differs (#23). Open.
- D10 native and custom controls: partly fixed; toggles and selects styled; OS popups remain. Open.
- D11 chip vocabularies and labels: mostly fixed; stats chips still show raw identifiers (#5). Open.
- D12 dead and token-free CSS: partly fixed; `.export-stage` and `.export-hint` removed; literals and dead hooks remain (#21). Open.

**Open items**

1. Icon-only exception: the brief allowed Close and Settings as icon-only; the code shows glyph plus visible text.
2. The Settings label has no "…" though it opens a dialog.
3. Glyph size: 18px attributes (test-pinned) vs 16px rendering.
4. No spacing tokens; spacing values are literals.
5. Stats chips show raw identifiers: `srt (srt-cues)`, `cammeta (dvtm-packets)`, `heading: yaw`.
6. Map style and View show raw values: `satellite`, `topo`, `follow`, `overview`.
7. The speed segment title reads "Playback speed 1x (…)"; the visible label reads "1×".
8. Clear is disabled without a loop and has no reason title.
9. Width and height accept odd values (checks only the minimum); the pipeline rounds each down to even and the summary shows the rounded size.
10. Unknown error messages appear unchanged in the main line.
11. Failures of "Reveal in folder" and "Open video" are stored but not shown.
12. "Working file was removed" is best-effort (`removeQuietly`, `src/exportjob.ts`).
13. Export progress has no indeterminate bar; "Preparing…" carries `aria-valuenow="0"`.
14. The timeline range input has no accessible name.
15. Space toggles playback even when a button has focus, so Space cannot activate a focused button.
16. Dialogs do not move focus in, trap Tab, restore focus, or set `aria-modal`.
17. Control borders: `--hairline-strong` is 1.66:1 and `--hairline-hover` 2.52:1 on surface-2; 3:1 applies where the border identifies the control.
18. Notice tone is conveyed by color only; there is no tone icon or label.
19. Dialog phases show two dismiss controls (header Close plus footer Cancel or Close); the done phase has no primary button.
20. Landing primary (44px, 16px text) and dialog primary (36px, 14px) differ.
21. Literals outside tokens: `#000`, `rgba(11, 16, 23, 0.82)`, `#b9c6d6`, the 4px checkbox radius, the 50% radio, the 250ms progress transition; `.modal-button` and `.dialog-close` have no rules.
22. The native window background `#0e131c` (`app/main.mjs`) differs from `--page` `#0b1017`.
23. The map's satellite core `#41f0ff` (`src/renderer/theme.ts`) differs from the UI accent `#5cd5ff`.
24. The bar uses two rows at exactly 1440px (`max-width: 1440px`); the comment says "below".
25. The transport row at 1024×600 with a loop set is not measured here; the changeset says the bar fits 1024×600.
26. `formatFrameRate` shows 24000/1001 as 23.98 fps.
27. `formatTime` has no hour field, so 61:05 is possible.
28. Open errors prefix the sentence with "Could not open the recording:", so a capitalized sentence follows a colon.
29. `THIRD-PARTY-NOTICES.md` calls the `ui/icons/` set Lucide; seven glyphs are drawn for the app, and their independence was not verified.
30. Over the player a canceled pick is silent, while the landing shows "No recording picked."; the player keeps "Open…" (disabled) while the landing shows "Preparing…".
31. The brief said danger appears only in notices; it also marks invalid fields.
32. Scrim blur is unconditional; the "only where playback holds" rule depends on current use, not on code.
33. No in-app shortcut list or help panel; shortcuts appear only in titles and the README.
34. Out of UI scope: the renderer has no Content-Security-Policy (baseline console warning). Open, for the security owner.

## 17. Change process and drift checklist

**Rules**

1. Read this file before changing anything under `ui/` (section 1).
2. Reuse first: existing tokens (section 4), components (section 10), glyphs (section 8), copy (section 12) and error mapping (section 13). A new color, radius, size, duration, glyph, label or pattern needs a token or a row in this file.
3. A new pattern (component, state, notice tone, dialog phase, button variant) changes this file in the same pull request, in the section that defines it.
4. Tokens change only in the `:root` block of `ui/app/globals.css`, named by role, not appearance. Update section 4 with the contrast of any new text or non-text use.
5. Components: one per file in `ui/components/`; reuse `Notice`, `DialogClose` and `NumberField`; a new dialog uses `.settings-overlay` and `.settings-panel`.
6. Errors follow section 13. New messages are mapped in `ui/lib/errortext.ts` with tests. Raw Node or system text never appears in the main line. "Left untouched" appears only in export outcomes.
7. Heuristics: a change is checked against section 2.2; one that weakens a heuristic is recorded in section 16.
8. Deviations: each deliberate deviation is recorded in section 16 as accepted or open, in the same pull request.
9. Screenshots: a visible UI change includes before and after screenshots of the changed states in the pull request.
10. Tests and changelog follow AGENTS.md: behavior changes ship with tests under `test/ui/`; feat and fix pull requests add a `.changeset/*.md` fragment.

**Pull request checklist (UI)**

- [ ] Values come from tokens; no new literal color, radius, size, duration or font in `ui/`.
- [ ] Existing components, glyphs and notices are reused, or this file defines the new one.
- [ ] Labels follow section 12; failure text follows section 13.
- [ ] Every affected state is covered: default, hover, pressed, focus-visible, disabled, busy, error and empty where applicable.
- [ ] Section 2.2 heuristics are checked; keyboard and reduced-motion behavior are unchanged or documented.
- [ ] Before and after screenshots are attached when the change is visible.
- [ ] This file is updated, and the pull request lists the sections changed.
- [ ] Deviations are recorded in section 16.
