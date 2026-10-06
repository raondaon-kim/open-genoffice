# Open GenOffice modifications

Open GenOffice is derived from
[`genspark-ai/genoffice`](https://github.com/genspark-ai/genoffice), beginning
with upstream commit `4da673d4dfa994bd0b4a9bc43430e4a058a17c61`.

The fork's material changes include:

- Codex (ChatGPT sign-in) as the default AI for new installs: the official
  Codex app-server ships with the app, the upstream app-server bridge is ported,
  and AI settings sign in, sign out and show the account and plan;
- first-class OpenRouter, Anthropic, and OpenAI routes alongside Genspark;
- direct bring-your-own-key routes for DeepSeek, GLM (Z.ai), Kimi (Moonshot),
  and MiniMax through their OpenAI-compatible endpoints;
- a Hangul document (`.hwp`/`.hwpx`) editor module built on the MIT-licensed
  rhwp engine, embedded as a fifth shell tab; the rhwp studio UI is built from
  the pinned upstream release and bundled with the app (served from a loopback
  origin, no remote dependency), and the HwpForge document generator and rhwp
  CLI binaries are packaged as application resources; the Hangul AI reads and
  edits open documents through the bundled rhwp CLI (snapshot → verified edit
  chain → reload, one-step undo) and fences document text as data before it
  reaches the model;
- encrypted device-local storage for user-supplied provider keys;
- a global default model and sticky per-document provider/model selection;
- model catalog discovery, compatibility filtering, and key verification;
- cross-model conversation continuation without implicit fallback;
- a collapsible "Thinking" box in all five AI panels (`@genoffice/ui` `ThinkingBox`):
  live while the model thinks, one line afterwards; the thinking is saved with the
  assistant message (`reasoning` and `thinking`, each capped at 32,000 characters)
  and restored when a document reopens. Raw reasoning (DeepSeek
  `reasoning_content`) is sent back to DeepSeek on later requests; reasoning
  summaries (Codex) are display-only;
- DeepSeek V4: the model list is `deepseek-flash` and `deepseek-v4-pro` (the retired
  `deepseek-chat` / `deepseek-reasoner` names in stored routes are read as
  `deepseek-flash`); requests run in thinking mode without `temperature`, with one
  retry in plain mode if the server rejects missing `reasoning_content`;
- "HWP from a form": a Home card opens a copy of a user's form as an untitled
  Hangul tab (bytes only, 50 MB cap, Save As proposes `<form>_작성`); the Hangul
  assistant gains `form_map` (fields, table cells and paragraphs from `rhwp dump`),
  `delete_table`, a document-summary check for forms that fail the engine's save
  round-trip check, 20 turns and clear end-of-run notes. `form_map` also reports each
  paragraph's size, the body text size and the form's thin blank spacer lines, and a
  text edit that leaves written text far below the body size returns a warning with the
  `apply_format` call that fixes it. Font sizes the AI sets are now converted to the
  engine's 1/100 pt unit (they were 100x too small);
- test builds: `GENOFFICE_SEED_DEEPSEEK_API_KEY` pre-loads a DeepSeek key through the
  normal verify-and-encrypt path when the profile has none;
- provider-aware error handling and bounded retry suggestions;
- independent application identity and update isolation;
- Open GenOffice repository, packaging, documentation, and visual identity.

The initial public snapshot is compared to the upstream commit above for the
file-level record of additions and changes. The upstream copyright and
attribution remain in `LICENSE` and `NOTICE`.
