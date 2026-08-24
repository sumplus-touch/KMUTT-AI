# CLI UX/UI Recommendations — `kmutt`

**A design specification for the terminal front end of the KMUTT rules & knowledge base.**

| | |
|---|---|
| **Reviewed** | `D:\KMUTT` — `tiger_cowork-main` (cowork v0.4.3) + `stitch_kmutt_ai_assistant` |
| **Stack** | Node · TypeScript · Fastify · Pinecone |
| **Audience** | KMUTT faculty and student officers |
| **Status** | Recommendation — no code changed |

> Line references point at the code as it stands today. All terminal blocks below are *designed output*, not captured runs.

---

## Table of contents

- [0. What is actually in the repo](#0-what-is-actually-in-the-repo)
- [1. Visual hierarchy & formatting](#1-visual-hierarchy--formatting)
- [2. Colour & typography](#2-colour--typography)
- [3. Feedback & interactivity](#3-feedback--interactivity)
- [4. Clarity & copywriting](#4-clarity--copywriting)
- [5. Implementation](#5-implementation)
- [6. What to change, in order](#6-what-to-change-in-order)

---

## 0. What is actually in the repo

### The premise to correct

**There is no CLI yet.** `tiger_cowork-main` is a Fastify + React web application (`cowork` v0.4.3, branded Tigrimos) with a Pinecone-backed knowledge base. Its entire terminal surface is four `console.log` lines and a raw pino JSON firehose. `stitch_kmutt_ai_assistant` is a set of Stitch-generated web mockups.

That is good news, not bad. This is a *greenfield* CLI design rather than a rescue, and the domain model underneath is already the right shape to build on — in particular the citation registry, which is the hardest part of a source-backed assistant and is already correct.

### Inventory

| Location | Finding |
|---|---|
| `server/index.ts:39` | **Fastify `logger: true` with no transport.** Every request prints an unformatted pino JSON object. The single worst thing on screen today — it buries the two lines a human actually needs. |
| `server/index.ts:230` | **Bare startup line.** `Tigrimos running on http://localhost:3001` — no banner, no readiness state, no indication of whether the knowledge base is connected. |
| `server/index.ts:97` | **A secret printed as an ordinary log line.** The auto-generated file access token scrolls past at the same visual weight as everything else. A user who blinks loses it into the JSON firehose above. |
| `server/services/toolbox.ts:749` | **Turn-scoped citation registry — keep this.** Reference numbers persist across every search in a turn, and the comment records the exact bug that motivated it. The CLI must reuse this numbering, not invent its own. |
| `server/services/data.ts:230` | **`KnowledgeDoc` already carries display state.** `status`, `chunkCount`, `error`, `access`, `fileMissing`. Every one maps to something on screen. No schema change needed. |
| `server/routes/knowledge.ts` | **A complete REST surface.** `/status`, `/documents`, `/documents/:id/reindex`, `/search`. The CLI is a client of this, not a rewrite of it. |

### The recommendation in one line

Build `kmutt` as a thin TypeScript client over the existing `/api/knowledge/*` routes, ship it as a workspace inside the same repo, and fix the server's own terminal output as a same-day side quest.

### The command surface

```
kmutt — KMUTT rules & knowledge, from the terminal

Ask
  ask <question>       Answer from the knowledge base, with sources
  search <query>       Show matching passages only — no AI answer

Curate
  add <file>           Add a document and index it
  ls                   List documents
  show <id>            Document detail, status and errors
  reindex <id>         Re-index after the source file changed
  rm <id>              Remove a document and its vectors

Operate
  doctor               Check connection, index and workspace
  login                Save an access token for this machine
  serve                Start the web app

Global flags
  --json               Machine-readable output (disables colour + spinners)
  --lang th|en         Message language (default: from system locale)
  --no-color           Plain text
  -y, --yes            Skip confirmations

Try  kmutt ask "ยื่นขอลาพักการศึกษาต้องทำอย่างไร"
```

**Why grouped, not alphabetical.** Three verbs a professor uses, four a student officer uses, three an admin uses. Grouping by job means each reader finds their row without reading the others. The example at the bottom is Thai because most first questions will be.

---

## 1. Visual hierarchy & formatting

A terminal has one typeface, one size, and no bold headings worth the name. Hierarchy comes almost entirely from **vertical rhythm and horizontal alignment** — which means whitespace is your only real layout tool, and you must spend it deliberately.

### Eight rules to hold the whole app together

1. **Answer first, sources second, diagnostics last.** Inverted pyramid. A professor reading a regulation answer should never scroll past retrieval metadata to reach the sentence they asked for.
2. **Exactly one blank line between blocks.** Never two, never zero. Consistent rhythm is what makes output scannable; irregular gaps read as bugs.
3. **Two indent levels, maximum.** Body content indents two spaces under its label. Anything needing a third level needs to be its own block instead.
4. **Wrap at `Math.min(process.stdout.columns - 4, 80)`.** Never let prose run to a 200-column window — the eye loses the line return.
5. **A left rail ties multi-step flows together.** `◆ │ └` down the left edge turns six separate prompts into one visible transaction with a beginning and an end.
6. **Align on a label column.** Pad labels to a fixed width so every value starts at the same column. Misaligned key–value pairs are the most common thing that makes a CLI feel amateur.
7. **Inline `[1]` must match the source list `[1]`.** Reuse the registry at `toolbox.ts:749`. This is the entire product promise — a rule you can trace to its source.
8. **Segment Thai text before wrapping.** Thai does not use spaces between words. A naive character-boundary wrap splits words mid-syllable and can strand a tone mark on its own line. Use `Intl.Segmenter('th', { granularity: 'word' })` — built into Node 18+ — to find legal break points.

### The core screen: `kmutt ask`

#### Today

There is no `ask` command at all. This is the closest thing to user-facing terminal output the app has — three lines of signal under eleven lines of machine noise, and a credential in the middle of it:

```
{"level":30,"time":1755561203981,"pid":9142,"hostname":"KMUTT-01","msg":"Server listening at http://0.0.0.0:3001"}
{"level":30,"time":1755561204012,"reqId":"req-1","req":{"method":"POST","url":"/api/knowledge/search","host":"localhost:3001"},"msg":"incoming request"}
{"level":30,"time":1755561206871,"reqId":"req-1","res":{"statusCode":200},"responseTime":2859,"msg":"request completed"}
Tigrimos running on http://localhost:3001
Sandbox directory: /app
[Security] Auto-generated file access token: k3f9a2c8e1
```

#### Recommended

```
$ kmutt ask "How long can a student defer study?"

✓ Searched 42 documents · 1.8s

A student may defer enrolment for up to two consecutive
semesters, and no more than four semesters in total
across the degree. [1]

Deferral must be requested before the add–drop deadline
of the semester concerned. [2]

──────────────────────────────────────────────────────
Sources

[1] KMUTT Academic Regulations B.E. 2566
    Clause 12.4 · p.31 · 94% match
    academic-regulations-2566.pdf

[2] Registration Office Announcement 4/2567
    p.2 · 88% match
    reg-announcement-4-2567.pdf

kmutt show [1] to open the full clause
```

Answer at the top in plain sentences. Bold carries the one number that matters (`two consecutive semesters`, `four semesters`). Citations are cyan and clickable via OSC 8, and the source block is separated by a rule, not a blank void.

### Density: `kmutt ls`

```
$ kmutt ls

ID       TITLE                              CAT        CHUNKS  STATUS
a3f91c   Academic Regulations B.E. 2566     academic      412  ✓ indexed
7b2e08   Student Code of Conduct            conduct        88  ✓ indexed
c41d55   ระเบียบการเบิกจ่ายค่าเดินทาง              finance       156  ✓ indexed
e90a17   Thesis Submission Guide 2567       graduate        0  ! processing
2d8b43   Scholarship Handbook (scan)        finance         0  ✗ failed

5 documents · 656 chunks · 1 needs attention

✗ Scholarship Handbook (scan) could not be indexed.
  The PDF has no text layer — it is a scan, and there is
  no OCR step. Export a text PDF, or run OCR first, then:
  kmutt reindex 2d8b43
```

**Two design decisions here.** First, the failure is repeated *below* the table in full prose — a table cell can never hold an actionable explanation, so do not try. Second, the summary line ends with "1 needs attention" rather than making the reader count red rows themselves.

> **⚠ Column width with Thai text**
>
> Thai combining marks — vowels above and below, tone marks (`U+0E31`, `U+0E34`–`U+0E3A`, `U+0E47`–`U+0E4E`) — occupy no horizontal space but each counts as one in `String.length`. Padding columns by string length will push every Thai row left by the number of marks it contains. Measure with a width function that strips those marks first (code in §5), and verify with your own titles before trusting any table library's built-in measurement.

---

## 2. Colour & typography

You already have a palette — `DESIGN.md` in the Stitch folder defines a full Material token set built on a burnt orange. Carrying it into the terminal is what makes the CLI and the web app feel like one product rather than two tools that happen to share a database.

### Semantic tokens

| Role | Used for | Hex | ANSI 256 | Glyph |
|---|---|---|---|---|
| **brand** | Command names, section labels, the wordmark | `#f68320` | `214` | — |
| **ref** | Citation numbers, document IDs, links | `#00acf4` | `39` | `[n]` |
| **ok** | Indexed, completed, connected | `#3f9142` | `71` | `✓` |
| **warn** | Processing, degraded, file missing | `#c98a00` | `178` | `!` |
| **stop** | Failed, unauthorised, not found | `#ba1a1a` | `167` | `✗` |
| **muted** | Paths, timings, scores, hints, chrome | `dim` | `2m` | — |

Note that **brand orange and warning yellow are adjacent hues**. Keep them apart structurally: brand orange appears only in labels and command names, never on a status line; warning yellow appears only next to a `!`. If they ever collide in one column, drop brand to plain white there.

### Rules

- **Colour is never the only signal.** Every coloured status carries a glyph. Roughly 1 in 12 men has a colour vision deficiency, and your logs will be pasted into tickets, piped to files, and read over a projector.
- **Bold marks one noun per line.** Bold the fact the reader came for — the number of semesters, the document title — and nothing else. Bold everywhere is bold nowhere.
- **Dim is the workhorse.** Timestamps, file paths, match scores, and hints should all be `\x1b[2m`. Most of the perceived cleanliness of a modern CLI is aggressive use of dim, not clever use of colour.
- **No underline.** It collides with terminal hyperlink rendering — many emulators already underline OSC 8 links, so your underline becomes invisible or your link becomes ambiguous.
- **No italics.** Unreliable in Windows console hosts; frequently renders as inverse video or is dropped entirely.
- **Background colour for one thing only.** A single inverse badge — `ACCESS TOKEN`, `FAILED` — and never for body text.

### Windows specifics — this matters for your users

You are on Windows 11, and so are most KMUTT staff machines. Windows Terminal handles truecolor and box-drawing glyphs correctly; the legacy `conhost` in `cmd.exe` does not, and a Thai-locale machine on code page 874 will render `✓ ◆ │ └ ─` as garbage. Detect with `is-unicode-supported` and keep a full ASCII fallback set:

| Meaning | Unicode | ASCII fallback |
|---|---|---|
| success | `✓` | `[ok]` |
| failure | `✗` | `[x]` |
| warning | `!` | `[!]` |
| step marker | `◆` | `*` |
| rail | `│` | `\|` |
| corner | `└` | `` ` `` |
| rule | `─` | `-` |
| spinner frames | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `-` `\` `\|` `/` |

Honour `NO_COLOR`, `FORCE_COLOR`, `--no-color`, and `!process.stdout.isTTY` — in that precedence. When output is piped, emit no colour, no spinners, and no cursor movement at all.

### Typography

You get one font, chosen by the user, so "typography" in a CLI means *the shape of the glyph grid*. Two practical consequences for a Thai-language product:

- Most programming fonts have no Thai coverage, so Thai falls back to a proportional system face and **your columns will not align in mixed-script tables**. Design tables so the Thai column is the *last* one — then a fallback that measures wide breaks nothing to its right.
- Recommend a font in your docs (Windows Terminal ships with fallback that handles Thai acceptably; `Sarabun` or `Noto Sans Thai Mono` as an explicit fallback entry is better) rather than assuming.

---

## 3. Feedback & interactivity

Your two slow operations — embedding a 400-page regulation PDF, and a retrieval-plus-generation round trip — both take long enough that silence reads as a hang. Neither has any progress indication today.

| Moment | Duration | What to show |
|---|---|---|
| `add <file>` | 10s – 5min | **Phased spinner, then a determinate bar.** `chunkCount` is known once chunking finishes, so the upsert loop can drive a real percentage. Never a bare "Loading…". |
| `ask` | 2 – 15s | **Spinner naming the corpus** ("Searching 42 documents…"), then **stream tokens** as they arrive. A streaming answer feels twice as fast as the same answer delivered whole. |
| `rm` | instant | **Confirmation showing title and chunk count.** Destructive and, for shared documents, destructive for everyone. |
| `ls` | instant | **Table when piped, arrow-key select when interactive.** Selecting a row opens `show`. |
| `doctor` | 1 – 5s | **A checklist that resolves line by line** — each check flips from spinner to ✓/✗ in place. |
| first run | — | **Guided setup**, not an error. See below. |

### Guided `add` — the flow a student officer runs weekly

```
$ kmutt add ./regulations-2566.pdf

 kmutt add  regulations-2566.pdf · 4.2 MB · PDF
│
◆ Title
│  KMUTT Academic Regulations B.E. 2566
│
◆ Category
│  ❯ academic   Regulations, curriculum, grading
│    conduct    Discipline and student conduct
│    finance    Fees, scholarships, reimbursement
│    graduate   Thesis, defence, graduation
│
◆ Who can see it?
│  ❯ shared     Everyone at KMUTT
│    private    Only you
│
└ Indexing…

  ✓ Extracted text        318 pages
  ✓ Split into passages   412 chunks
  ⠹ Uploading to index    ████████████░░░░░ 71% 292/412
```

**Why phases beat a single spinner.** Extraction, chunking, and upload fail for completely different reasons. Naming the phase means the failure message can be specific, and the user learns where the time goes.

### Destructive confirmation — `rm`

```
$ kmutt rm a3f91c

! Remove "KMUTT Academic Regulations B.E. 2566"?

  412 chunks will be deleted from the index.
  Shared — this removes it for everyone at KMUTT.
  The source PDF stays in your workspace.

  Type the document ID to confirm › a3f91c_
```

**Type-to-confirm, not y/N.** Reserved for shared documents only — a private document gets a plain `y/N`. Escalating friction by blast radius is the rule; making every deletion painful just trains people to reach for `--yes`.

### First run should teach, not scold

Today's equivalent names a screen the terminal user cannot see, and gives no way forward:

```
Error: Knowledge base is not configured. Add a Pinecone API key and enable it in Settings.
```

Recommended — diagnose everything at once, then expand only the failure into a fix the reader can copy:

```
$ kmutt doctor

✓ Server            localhost:3001 · v0.4.3
✓ Access token      valid
✗ Knowledge base    not connected
✓ Workspace         /app · writable

✗ Knowledge base not connected

  Search and kmutt ask need a Pinecone index.
  You have a key already? Set it:

    kmutt config set pinecone.apiKey <key>

  Need one? console.pinecone.io — free tier is
  enough for ~50 regulation PDFs.
```

---

## 4. Clarity & copywriting

Your existing error strings are better than average — the scanned-PDF message in `routes/knowledge.ts` actually explains the cause. But most are written from the server's point of view, and none end with something to do.

### Six rules for every string

- **Say what happened, why, then what to do.** In that order, on separate lines.
- **End with a command the reader can copy.** If you cannot name one, the message is not finished.
- **Never name a screen the reader is not on.** "in Settings" is meaningless in a terminal.
- **Second person, active voice, no apologies.** No "Sorry", no "please", no exclamation marks.
- **Include the specific value.** The path you looked in, the extension you rejected, the ID you could not find.
- **Never blame the reader.** "Invalid input" blames; "Titles cannot be empty" describes.

### Rewrites from your actual source

| Location | Current string | Rewrite |
|---|---|---|
| `index.ts:129` | `Unauthorized — invalid or missing access token` | **Not signed in to localhost:3001.**<br>Run `kmutt login` and paste the token from your admin. |
| `knowledge.ts:140` | `Knowledge base is not configured. Add a Pinecone API key and enable it in Settings.` | **Knowledge base is not connected.**<br>Search needs a Pinecone index. Run `kmutt doctor` to see what is missing. |
| `knowledge.ts:136` | `title required` | **Every document needs a title — it is what shows in citations.**<br>`kmutt add rules.pdf --title "Academic Regulations 2566"` |
| `knowledge.ts:150` | `File not found in workspace` | **No file at `knowledge/rules.pdf`.**<br>Paths are relative to the workspace (`/app`). Run `kmutt ls --files` to see what is there. |
| `knowledge.ts:153` | `Unsupported file type. Supported: .pdf, .docx…` | **`.pptx` files cannot be indexed.**<br>Supported: PDF, Word, Excel, Markdown, text. Export the slides to PDF and try again. |
| `knowledge.ts:38` | `No text could be extracted. This looks like a scanned PDF — text-layer extraction has no OCR…` | **This PDF is a scan, so there is no text to index.**<br>Pages are images and there is no OCR step. Run OCR, then `kmutt reindex a3f91c`.<br>*(Good content already — just needs the 3-line shape.)* |
| `toolbox.ts:741` | `No matching documents in the knowledge base. Consider web_search instead.` | **Nothing in the knowledge base matches that.**<br>42 documents searched. Try different wording, or `kmutt ask --web` to search outside KMUTT sources. |
| `index.ts:97` | `[Security] Auto-generated file access token: abc123` | **Boxed, inverse-badged, and printed *last* at startup.**<br>A credential must be the final thing on screen, not the eleventh line of a JSON firehose. See §6. |

### Thai and English

Your audience is Thai professors and student officers, and the regulations themselves are Thai. Three decisions that will save rework:

- **Commands and flags stay English** — `add`, `ls`, `--json`. They are code, they are what documentation and Stack Overflow will use, and they type without an IME switch.
- **Messages are translatable from day one.** Put every string behind a key from the start, even while there is only one language. Retrofitting i18n across 200 inline strings is a week you will not want to spend.
- **Give every error a stable code** — `KB_NOT_CONNECTED`, `FILE_UNSUPPORTED`. Print it dimmed at the end of the message. One code maps to one help page regardless of the language the user saw, and it makes support tickets searchable.

```
✗ ยังไม่ได้เชื่อมต่อฐานความรู้

  การค้นหาต้องใช้ Pinecone index
  ตรวจสอบการตั้งค่าด้วยคำสั่ง kmutt doctor

  KB_NOT_CONNECTED · kmutt.kmutt.ac.th/help/KB_NOT_CONNECTED
```

Same structure, same code, same command. Only the prose changes.

---

## 5. Implementation

TypeScript on Node, matching the server. Everything below is current, actively maintained, and small — the whole stack adds well under 2 MB.

| Package | Job | Why this one |
|---|---|---|
| `commander` | Commands, flags, help | The boring, correct choice. Auto-generated help, subcommands, good TS types. `citty` if you want something lighter. |
| `@clack/prompts` | Prompts, spinners, flow | **The single biggest aesthetic win.** The rail-and-diamond flow in §3 is what clack renders by default. Replaces `inquirer` + `ora` + your own layout. |
| `picocolors` | Colour | ~2 kB, faster than chalk, handles `NO_COLOR`/`FORCE_COLOR`/TTY detection for free. |
| `cli-table3` | Tables | Feed it your own width function for Thai (below). Or hand-roll — a padded table is 30 lines. |
| `cli-progress` | Determinate bars | For the chunk-upsert loop, where you know the total. |
| `terminal-link` | OSC 8 hyperlinks | **Central to your product.** Makes a citation clickable — straight to the source PDF. Degrades to plain text where unsupported. |
| `marked` + `marked-terminal` | Render answers | The model returns Markdown. This renders it as terminal text instead of leaking raw asterisks. |
| `is-unicode-supported` | Glyph fallback | Drives the ASCII fallback table in §2. Necessary for Thai-locale `cmd.exe`. |
| `pino-pretty` | Server logs | Not for the CLI — for fixing `index.ts:39` today. |

### Layout

```
tiger_cowork-main/
├── server/                 // unchanged
├── client/                 // unchanged
└── cli/
    ├── package.json        // bin: { "kmutt": "./dist/index.js" }
    ├── src/
    │   ├── index.ts        // commander wiring, global flags
    │   ├── api.ts          // typed fetch client for /api/knowledge/*
    │   ├── config.ts       // token + host, ~/.kmutt/config.json
    │   ├── ui/
    │   │   ├── theme.ts    // colours, glyphs, capability detection
    │   │   ├── width.ts    // Thai-aware width + wrap
    │   │   ├── table.ts    // padded table using width.ts
    │   │   └── sources.ts  // the [1] citation block
    │   ├── i18n/{en,th}.ts // message catalogue by key
    │   └── commands/       // ask, add, ls, show, search, rm, doctor…
    └── tsconfig.json
```

### `ui/theme.ts` — the whole visual system in one file

```ts
import pc from "picocolors";
import isUnicodeSupported from "is-unicode-supported";

const uni = isUnicodeSupported();

/** Semantic colours. Never call pc.red() directly in a command. */
export const t = {
  brand: pc.yellow,                            // KMUTT orange
  ref:   pc.cyan,                              // [1], document IDs
  ok:    pc.green,
  warn:  pc.yellow,
  stop:  pc.red,
  muted: pc.dim,
  key:   (s: string) => pc.bold(pc.white(s)),  // the one fact per line
};

/** Glyphs, with the ASCII fallback from section 2. */
export const g = uni
  ? { ok: "✓", stop: "✗", warn: "!", step: "◆", rail: "│", end: "└", rule: "─" }
  : { ok: "[ok]", stop: "[x]", warn: "[!]", step: "*", rail: "|", end: "`", rule: "-" };

/** One place decides whether output is for a human. */
export const interactive =
  process.stdout.isTTY && !process.env.CI && !process.argv.includes("--json");

/** Prose width. Never the full terminal — the eye loses the line return. */
export const width = Math.min((process.stdout.columns ?? 80) - 4, 80);

/** Status line: glyph + colour together, never colour alone. */
export const status = (s: "indexed" | "processing" | "failed") =>
  s === "indexed"    ? t.ok(`${g.ok} indexed`) :
  s === "processing" ? t.warn(`${g.warn} processing`)
                     : t.stop(`${g.stop} failed`);
```

### `ui/width.ts` — the Thai fix

```ts
/**
 * Thai combining marks take no horizontal space but each counts as one
 * in String.length. Padding by .length pushes every Thai row left by the
 * number of marks it contains.
 *
 * U+0E31          MAI HAN AKAT
 * U+0E34–U+0E3A   above/below vowels
 * U+0E47–U+0E4E   tone marks, thanthakhat, nikhahit
 */
const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;

export function visualWidth(s: string): number {
  return [...s.replace(/\x1b\[[0-9;]*m/g, "")   // strip ANSI
           .replace(THAI_COMBINING, "")].length;
}

export function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - visualWidth(s)));
}

/**
 * Thai has no spaces between words, so a character-boundary wrap splits
 * words mid-syllable. Intl.Segmenter (Node 18+, full-ICU) knows where
 * the legal breaks are.
 */
export function wrap(text: string, max: number, locale = "th"): string[] {
  const seg = new Intl.Segmenter(locale, { granularity: "word" });
  const lines: string[] = [];
  let line = "";
  for (const { segment } of seg.segment(text)) {
    if (visualWidth(line + segment) > max && line) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += segment;
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}
```

> **Verify this against your own data.** The combining-mark regex covers standard Thai, but test it with real titles from `data/knowledge.json` before trusting any table alignment — and check whether the table library you pick lets you override its width function at all. `cli-table3` does not expose one cleanly, which is a fair reason to hand-roll the 30-line padded table instead.

### `ui/sources.ts` — the citation block

```ts
import terminalLink from "terminal-link";
import { t, g, width } from "./theme";

/**
 * Hits come from POST /api/knowledge/search, already carrying `ref`
 * from the turn-scoped registry in toolbox.ts:749. Do not renumber.
 */
export function renderSources(hits: Hit[], host: string): string {
  const out = ["", t.muted(g.rule.repeat(width)), t.brand("Sources"), ""];

  for (const h of hits) {
    const url   = `${host}/sandbox/${h.filePath}#page=${h.page ?? 1}`;
    const title = terminalLink(h.title, url, { fallback: () => h.title });

    // Only the parts that exist — never "p.undefined".
    const facts = [
      h.clause && `Clause ${h.clause}`,
      h.page   && `p.${h.page}`,
      `${Math.round(h.score * 100)}% match`,
    ].filter(Boolean).join(" · ");

    out.push(`${t.ref(`[${h.ref}]`)} ${t.key(title)}`);
    out.push(`    ${t.muted(facts)}`);
    out.push(`    ${t.muted(h.fileName)}`, "");
  }
  return out.join("\n");
}
```

Three details worth calling out: the reference number comes from the server and is never recomputed client-side; missing metadata is filtered rather than printed as `undefined`; and `terminalLink` degrades to the bare title where OSC 8 is unsupported, so nothing is lost on an old console.

---

## 6. What to change, in order

Sequenced by ratio of visible improvement to effort. The first phase touches the existing server and needs no new code.

### Phase 1 — Stop the noise · *one afternoon*

- `server/index.ts:39` — replace `logger: true` with a `pino-pretty` transport in dev, and drop to `level: "warn"` in production. **This alone removes about 90% of what is on screen.**
- `server/index.ts:230` — replace the two bare lines with a startup block: wordmark, version, URL, and a readiness line per subsystem (knowledge base, MCP, scheduler).
- `server/index.ts:97` — move the access token to the *last* thing printed, in a box with an inverse `ACCESS TOKEN` badge and a one-line note on where to paste it.
- `server/index.ts:234` — settle on one prefix convention. You currently mix `[Security]`, `[MCP]`, and unprefixed. Pick dimmed lowercase tags and apply them everywhere.

### Phase 2 — Ship the read path · *week one*

- Scaffold `cli/` with commander, `theme.ts`, `width.ts`, and the typed API client.
- `kmutt ask`, `kmutt search`, `kmutt ls`, `kmutt doctor`. Read-only commands cannot damage anything, so they can go to real users immediately.
- Wire `--json` and the TTY detection from day one — retrofitting it means touching every command twice.

### Phase 3 — Ship the write path · *week two*

- `kmutt add` with the clack flow and phased progress; `reindex`, `rm`, `show`.
- Move every string into the `i18n/` catalogue with stable error codes, and rewrite them using the table in §4.

### Phase 4 — Polish · *later*

- Thai message catalogue, once the English strings have stopped moving.
- Shell completions for document IDs and categories — `commander` can emit these.
- `kmutt ask --watch` for a REPL, so a professor asking five follow-up questions does not pay startup cost five times.

---

## The one thing to protect

Every design decision here serves a single promise: **an answer you can trace to the clause it came from.**

When a trade-off comes up — and it will, most often as pressure to make output denser — the citation block is the part that does not get compressed. It is the reason a professor will trust this over a search box.
