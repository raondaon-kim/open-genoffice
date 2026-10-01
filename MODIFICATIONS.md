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
- provider-aware error handling and bounded retry suggestions;
- independent application identity and update isolation;
- Open GenOffice repository, packaging, documentation, and visual identity.

The initial public snapshot is compared to the upstream commit above for the
file-level record of additions and changes. The upstream copyright and
attribution remain in `LICENSE` and `NOTICE`.
