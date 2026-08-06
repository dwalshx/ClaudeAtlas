# Research report 4: Detecting and Classifying Automated Clients — State of the Art (August 2026)

(Verbatim output of research agent 4, 2026-08-04. Scope: what a drop-in *observational* agent-traffic classifier can actually know, per layer and per platform, and where the wall is.)

---

## 0. Bottom line up front

Five findings that should drive the product:

1. **The binary human/bot framing is the single biggest accuracy bug**, and it's now measured. Binary classifiers trained on human-vs-bot misclassify LLM browser agents *as human* 30–39% of the time; adding an explicit third "agent" class eliminates the gap entirely (F1 = 1.000 across 30 runs). The product should be three-class-plus-unknown from day one — and that's a genuine technical differentiator, not just framing. ([arXiv:2607.26935](https://arxiv.org/html/2607.26935v1), 29 Jul 2026)

2. **The durable agent signal is not cursor kinematics — it's browser-automation *API event-generation structure*.** Two features (`mouse_event_rate`, `teleport_click_ratio`) hold 100% agent recall through five escalating evasion levels *including replayed real human mouse trajectories*, because Playwright/CDP simply doesn't emit the raw mousemove/wheel event streams a real input device does. Trajectory-shaping stealth (Bézier curves, GANs, Fitts-law timing) does not help the evader at all. ([arXiv:2607.26935](https://arxiv.org/html/2607.26935v1))

3. **Incumbents are far worse at this than their marketing implies.** FP-Agent's Cloudflare case study: *FP-Agent detects all seven AI browsing agents; Cloudflare detects one* (Manus — and only via self-identification). ([arXiv:2605.01247](https://arxiv.org/html/2605.01247v1), 2 May 2026). Independently, "Shy Guys" measured Cloudflare at 8.4% bot TPR, CrawlerDetect 18.1%, Matomo DeviceDetector 12.0% on their ground-truth set. ([arXiv:2603.28546v2](https://arxiv.org/html/2603.28546v2), 31 Mar 2026)

4. **Server-side-only (no JS) gets you meaningfully far — around 82–85% F1 — and it's mostly free.** TLS alone 74.7% F1, HTTP headers alone 82.0%, behavioral 87.6%, fused 97%; >60% accuracy after only three requests. ([arXiv:2606.20910](https://arxiv.org/html/2606.20910v1), Jun 2026)

5. **The market gap is real.** Searching "AI agent observability" in 2026 returns *LLM tracing* tools (Langfuse, Phoenix, Braintrust, Arize) — instrumenting agents you *build*. Nobody owns classifying agents that *arrive*. The adjacent products are all enforcement-shaped (Cloudflare AI Crawl Control, Vercel BotID, DataDome, HUMAN, cside).

⚠️ **Source-quality caveat:** a large fraction of "2026 state of the art" web content on this topic is vendor blog or SEO filler with circular citations. The four 2026 arXiv papers, primary platform docs, and named vendor research (Castle, DataDome, CHEQ, Fastly, nullpt.rs) are weighted far above the rest; flagged below where a claim rests only on soft sourcing.

---

## 1. The hard case: agents indistinguishable from humans

### 1.1 The taxonomy that actually matters

The threat model splits by **where the automation attaches**, not by vendor:

| Class | Examples | Attachment point | Detectability |
|---|---|---|---|
| **A. Declared crawler** | GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot | HTTP client, self-identifies | Trivial (UA + rDNS + IP list) |
| **B. Declared fetch-on-behalf** | ChatGPT-User, Claude-User, Perplexity-User | HTTP client, self-identifies, signs (RFC 9421) | Trivial → cryptographic |
| **C. Cloud/remote browser agent** | ChatGPT agent mode, Browserbase, Anchor, Skyvern, browser-use in cloud | CDP / Playwright, **datacenter IP** | Easy-to-moderate |
| **D. Stealth-hardened CDP stack** | Patchright, rebrowser-patches, puppeteer-real-browser + residential proxy | CDP, patched, residential IP | **Hard at network layer; still solvable behaviorally** |
| **E. Agentic browser on user's machine** | ChatGPT Atlas, Perplexity Comet, Gemini-in-Chrome | Native Chromium build, **user's real IP, real profile, real GPU** | **Very hard** |
| **F. Extension agent inside the user's own browser** | Claude for Chrome | `chrome.debugger` in the user's real Chrome | **Hardest — "cyborg session"** |
| **G. OS-level input injection** | computer-use, xdotool/PyAutoGUI, macOS Accessibility API | Below the browser entirely | **Effectively unknowable from the web** |

Classes A/B are a solved lookup problem. C/D are where network fingerprinting earns its keep. **E/F/G are the genuinely hard case, and G is out of reach by construction** — it produces OS-level input events that Chrome marks `isTrusted: true` with real device-driver timing.

### 1.2 CDP detection — the strongest browser-layer signal, and its half-life

The canonical tell is the **`Runtime.enable` serialization side-effect**. Puppeteer/Playwright/Selenium-4 call `Runtime.enable` so `page.evaluate()` has an execution context; that enables CDP-side object serialization, which is observable in-page by putting a getter on an `Error`'s `stack` property and logging the object — the getter fires when CDP serializes it. ([DataDome threat research](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/); [Castle, 19 Mar 2025](https://blog.castle.io/how-to-detect-headless-chrome-bots-instrumented-with-playwright/))

Vercel's BotID Basic mode ships exactly this: reverse-engineering shows it creates an `Error` with a custom `stack` getter, plus checks for `domAutomation`, `_WEBDRIVER_ELEM_CACHE`, `__nightmare`, `cdc_adoQpoasnfa76pfcZLmcfl_Array`, `navigator.webdriver`, `navigator.seleniumWebdriver`, `"headless"` in UA, and WebGL vendor/renderer — AES-256-encrypted into an `x-is-human` header. ([nullpt.rs, 30 Jun 2025](https://nullpt.rs/reversing-botid))

**Honest state of the arms race:** this signal is *patched* in the mainstream stealth tooling. `rebrowser-patches` reroutes `Runtime.enable` to per-context calls so the global flag never fires; `patchright` ships pre-patched Playwright binaries with `navigator.webdriver` removed, a consistent `chrome.runtime`, and the CDP leak closed, as a drop-in import. ([rebrowser-patches](https://github.com/rebrowser/rebrowser-patches), [rebrowser-bot-detector](https://github.com/rebrowser/rebrowser-bot-detector)). Two further problems: it **false-positives on any real user with DevTools open** (Castle notes this explicitly), and it says nothing about class E/F agents that never touch CDP from outside — or that touch it *as a legitimate extension*.

**Verdict: commoditized on both sides.** Worth collecting as one weak-positive signal. Do not build on it.

### 1.3 `navigator.webdriver` and static fingerprint leaks

Fully commoditized. `--disable-blink-features=AutomationControlled` kills the flag; the `HeadlessChrome` UA substring and `sec-ch-ua: "HeadlessChrome";v="133"` are one config line away; missing `Accept-Language` in headless Chromium is one more. Playwright-injected globals (`window.__playwright__binding__`, `window.__pwInitScripts`, `__installed` on exposed functions) are enumerable but patched by the stealth forks. ([Castle](https://blog.castle.io/how-to-detect-headless-chrome-bots-instrumented-with-playwright/))

The one *hardware*-grounded static signal that still bites is **WebGL/GPU**: headless Chrome in a cloud VM reports SwiftShader or llvmpipe, and the full constellation of WebGL parameters around a spoofed `UNMASKED_RENDERER` string is hard to fake coherently. But note the scope: this catches **class C** (cloud) and is *useless* against **class E/F**, which run on the user's real GPU.

**The measured ceiling on static browser fingerprints for agent classification is ~0.80 F1**, and it degrades because agents *collide*: FP-Agent found Atlas, Browser Use, and Claude on macOS sharing identical browser fingerprints. ([arXiv:2605.01247](https://arxiv.org/html/2605.01247v1))

### 1.4 Behavioral signals — the actual state of the art

Four 2026 papers converge, and they are the most important inputs to the design.

**FP-Agent** (arXiv:2605.01247, 2 May 2026) measured seven agents — OpenAI Atlas + ChatGPT Agent, Anthropic Claude for Chrome, Perplexity Comet, Meta Manus, Browser Use v0.9.2, Skyvern v0.2.23 — against 56 human participants × 3 task repetitions. Findings:
- Browser fingerprints: ~0.80 F1, with collisions.
- Behavioral: near-1.0 precision/recall/F1, with **agent-specific typing archetypes** — paste-based (ChatGPT Agent, Atlas, Comet), keystroke-based (Browser Use, Skyvern, Manus), programmatic DOM fill (Claude). Inter-key latencies <1ms to ~52ms vs human ranges.
- Scrolling: instantaneous jumps or discrete multi-burst vs human continuous with high duration/distance variance.
- Mouse: **teleport to click target with no intermediate mousemove events.**
- Real-time viability: high accuracy within **1–3 minutes** of observation.
- ⚠️ Honest limitation the authors state: behavioral classifier F1 **dropped by up to 0.37 on held-out tasks**. Behavioral models overfit to task shape. This is the single most important caveat for a drop-in package that will see arbitrary sites.

**Minimal feature sets** (arXiv:2607.26935, 29 Jul 2026, TU Munich + Kontext) is the most operationally useful:
- Binary human/bot evasion rates by agents: MLP 39.1%, SAINT 34.5%, RF 30.0%. Three-class fixes it.
- Optimal 2-feature set `{mouse_event_rate, teleport_click_ratio}`: held-out macro-F1 0.926, agent precision 0.994, ROC-AUC 1.000 at all evasion levels.
- Alternative `{mouse_event_rate, click_duration_std}`: macro-F1 0.904, agent precision **1.000**, 100% recall at all five evasion levels.
- 5 features → macro-F1 ≥ 0.99 for full three-class discrimination.
- **Evasion ladder**: L1 raw Playwright → L2 Bézier + human-sampled click durations → L3 conditional WGAN-GP trajectories → L4 GAN + 1.5px micro-jitter + Fitts-law timing → L5 **replayed real human trajectories warped via KD-tree matching**. Detection stayed at 100% with min P(agent) ≥ 0.999 across 22,990 predictions, zero errors.
- **Why**: the signal is structural. Playwright emits few raw mousemove events, has flat programmatic click-hold delays, and has *no* `scroll.wheel()` method (so no wheel-delta stream). You cannot fix these without refactoring the automation API or patching Chrome itself.
- ⚠️ Explicit out-of-scope: **OS-level input injection (xdotool, PyAutoGUI, macOS Accessibility), DOM-native extensions, and pixel-level computer-use agents bypass CDP and are outside the threat model.** That is precisely classes F and G.
- ⚠️ Also: single LLM (Claude), Playwright only, human baseline from CAPTCHA-solving (a task-domain mismatch they ablate but don't fully resolve).

**"Known By Their Actions"** (arXiv:2605.14786, 14 May 2026) goes further: **which foundation model** is driving the browser is inferable from passive in-page UI traces alone — F1 up to 96% across 14 frontier LLMs, from temporal/structural navigation dynamics rather than headers. Identity is inferable early in an episode and from few traces. Randomized inter-action delays degrade but don't defeat it. Implication: "which agent" is a *tractable* label, not just "is agent."

**"Whose Agent Are You?" / MARK** (arXiv:2606.20910, Jun 2026) is the server-side counterpart — see §5.

### 1.5 Class F: the "cyborg session" — and why the data model must handle it

CHEQ reverse-engineered Claude for Chrome (published **18 Feb 2026**). The extension uses `chrome.debugger` → CDP → `Input.dispatch*Event`, which synthesizes events Chrome marks as **trusted** and which are, in their words, indistinguishable from hardware input. It runs in the user's real Chrome, real profile, real IP, real GPU. Every network and static-fingerprint layer says "human," correctly.

What *is* left, and it's fragile:
- **Web-accessible resource probing** — fetching `chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/assets/accessibility-tree.js-D39zjmMD.js` and branching on promise resolution. (Hash in the filename → breaks on every extension update; the ID is stable.)
- **DOM artifact observation** — `MutationObserver` on `id="claude-agent-stop-container"` (agent actively in control) and the residual `id="claude-agent-animation-styles"` style element (agent ran earlier this session).
- The **conceptual** contribution matters more than the specific selectors: *a session is not a class.* A human logs in, navigates, then hands control to an agent for a task, then takes it back — same session ID, same IP, same fingerprint, control toggling. ([CHEQ](https://cheq.ai/blog/the-cyborg-session-reversing-detecting-claude-ai-agent-chrome-extension/))

**Product implication:** label **interactions/pageviews**, not sessions. A session-level `is_bot` boolean is structurally incapable of representing the fastest-growing traffic class.

### 1.6 Class E: agentic browsers on the user's machine

Atlas and Comet ship a **user agent string identical to stock Chrome on macOS** — no `Atlas` or `Comet` token — and this is a deliberate vendor choice, motivated by "the agent acts as the user." ([HUMAN Security](https://www.humansecurity.com/learn/blog/chatgpt-atlas-vs-perplexity-comet-agentic-browsers/))

The residual signals reported (soft sourcing — treat as leads to verify empirically, not as facts):
- **`CFNetwork`/`Darwin` UA on out-of-band fetches.** Atlas has been observed fetching favicons through OpenAI's Swift networking layer, which leaks a `ChatGPT Atlas` + CFNetwork/Darwin UA on a *different request* than the page load. This is the single most promising class-E signal because it's a **cross-request correlation** — exactly what an observational analytics product is well-positioned to do and an inline blocker is not.
- **Chromium build asymmetries** — extension-manifest gaps, absent Web Speech API TTS voice list vs full Chrome.
- **Referrer + velocity** — traffic from `perplexity.ai` / `chat.openai.com` / `atlas.openai.com` traversing multiple product pages in seconds.
([seresa.io, 21 Apr 2026](https://seresa.io/blog/ai-bot-filtering/chatgpt-atlas-and-perplexity-comet-are-already-in-your-analytics))

Google has stated Gemini agent sessions will be identifiable via UA strings and request headers, though the format isn't finalized. That's the cooperative path.

---

## 2. Network-layer fingerprinting

### 2.1 JA3 / JA4 / JA4+

JA4+ is a suite, not one hash: **JA4** (TLS ClientHello), **JA4S** (server response), **JA4H** (HTTP client incl. header order), **JA4T** (TCP timings), plus **JA4L/JA4X/JA4SSH**. It's BSD-3-Clause with FoxIO explicitly disclaiming patent pursuit for JA4 TLS Client Fingerprinting, and it's adopted by Cloudflare, AWS WAF, Akamai, Fastly, and VirusTotal.

JA4 improved on JA3 by being human-readable and by **sorting cipher/extension lists**, which defeats the Chrome/BoringSSL GREASE-and-shuffle randomization that made raw JA3 unstable.

**Honest limits — Fastly's own assessment** ([20 Jul 2022](https://www.fastly.com/blog/the-state-of-tls-fingerprinting-whats-working-what-isnt-and-whats-next), still the most candid vendor writeup):
- Public JA3 databases are *wrong*. Fastly found ja3er.com mishandling the ALPS extension and x448 curve, producing bad hashes, and recommended defenders not rely on it.
- JA3 "has properties similar to a browser's User-Agent" — inherent false positives.
- Fingerprints collapse across tool families (Cobalt Strike sharing Java's JARM), so blocking on them harms legitimate traffic.
- "Attackers and bot developers alike are aware of fingerprinting and may attempt to emulate the TLS negotiation of a 'good' client" — demonstrated with uTLS.

That last point is now fully commoditized: `curl-impersonate`, `curl_cffi`, uTLS-based Go clients, and [httpcloak](https://github.com/sardanioss/httpcloak) advertise browser-identical JA3/JA4 + Akamai h2 fingerprint + header order across HTTP/1.1/2/3.

**Critical scope note: JA4 is nearly useless for classes E and F.** Atlas, Comet, and Claude-for-Chrome are real Chromium/real Chrome — their TLS fingerprint *is* Chrome's, correctly. JA4 is a class-C/D tool.

### 2.2 HTTP/2 SETTINGS ("Akamai h2") fingerprinting

Chrome's h2 preface is highly specific — `HEADER_TABLE_SIZE=65536`, `INITIAL_WINDOW_SIZE=6291456`, `MAX_HEADER_LIST_SIZE=262144`, followed by `WINDOW_UPDATE` delta `15663105` — and pseudo-header order differs per browser: Chrome `m,a,s,p`; Firefox `m,p,a,s`; Safari `m,s,p,a`. A UA claiming Chrome with Firefox's pseudo-header order is an immediate contradiction.

The **contradiction** is the signal, not the fingerprint. This generalizes: JA4 + JA4H scored *together* catch "wrong-shape Chrome" that a JA3-only match would pass.

**Availability is the problem.** Cloudflare Workers expose `ja3Hash`/`ja4` but **not an h2 fingerprint**. Fastly VCL exposes JA3/JA4 but no h2 SETTINGS variable was found. The h2 fingerprint is realistically available only via [fingerproxy](https://github.com/wi1dcard/fingerproxy) or the nginx modules ([phuslu/nginx-ssl-fingerprint](https://github.com/phuslu/nginx-ssl-fingerprint), [HanadaLee/ngx_ssl_fingerprint_module](https://github.com/HanadaLee/ngx_ssl_fingerprint_module)) — i.e., self-hosted only. **A drop-in package cannot count on it.**

### 2.3 IP reputation: datacenter vs residential vs residential-proxy

Three tiers, increasing cost:

**Free / built-in:** ASN. Cloudflare gives `request.cf.asn` + `asOrganization` on every plan. A static list of hosting ASNs (AWS/GCP/Azure/Hetzner/OVH/DigitalOcean/Vultr) plus known agent-infra ASNs catches all of class C at zero marginal cost. Also: **AS15169 (Google) carries Googlebot *and* Anthropic production; AS8075 (Microsoft) carries Bingbot *and* OpenAI production compute** — so ASN alone cannot separate "search crawler" from "AI operator," and ASN-only heuristics will mislabel.

**Cheap:** free/community IP-range JSON feeds published by the operators themselves (Google's `common-crawlers.json`, plus OpenAI, Anthropic, Perplexity, Common Crawl ranges). Fetch + CIDR-match + cache. This is the correct basis for *verification*, not just classification.

**Paid, and the only thing that touches class D:** residential-proxy detection.
- **IPinfo** launched self-service residential-proxy detection (announced **30 Jun 2026**): **107M+ directly observed** residential-proxy IPs across **126 providers**, ~2.3× YoY growth, built from direct observation rather than ASN/hostname inference. They claim >99% for VPN/proxy detection generally. ([Businesswire](https://www.businesswire.com/news/home/20260630961747/en/IPinfo-Launches-Self-Service-Residential-Proxy-Detection-API-With-IPinfo-Max))
- **Spur** — Context API, 20+ attributes/IP, 1,000+ proxy/VPN services, notably strong on compromised residential exit nodes. ([spur.us](https://spur.us/platform/residential-proxy-detection))

⚠️ **Vendor accuracy claims are unaudited.** ">99%" without a stated base rate and a published FPR is a marketing number. And note the asymmetry that matters most: **residential-proxy detection does nothing for class E/F, because those agents aren't proxied — they're on the user's genuine ISP connection.**

**Weak-but-free proxy signal:** `request.cf.clientTcpRtt` (and `clientQuicRtt`). Tunneled/proxied connections have anomalous RTT relative to their claimed geolocation. Noisy, but free and additive.

---

## 3. What each platform gives you for free

This determines what a drop-in package can promise per adapter.

### Cloudflare Workers

**Free on every plan** (`IncomingRequestCfProperties`, [docs](https://developers.cloudflare.com/workers/runtime-apis/request/)):

| Field | Classification value |
|---|---|
| `asn`, `asOrganization` | **High** — datacenter/agent-infra detection, free |
| `clientTcpRtt`, `clientQuicRtt` | Medium — tunnel/proxy anomaly |
| `tlsVersion`, `tlsCipher` | Low-medium — coarse TLS shape |
| `httpProtocol` | Medium — HTTP/1.1 in 2026 is itself a script signal |
| `country`/`city`/`timezone`/`lat`/`lon` | Medium — cross-check vs JS-reported `Intl` timezone |
| `colo` | Low — routing sanity |

**Gated behind Enterprise + Bot Management add-on** (`request.cf.botManagement` is, per docs, "only set when using Cloudflare Bot Management"): `score`, `verifiedBot`, `signedAgent`, `staticResource`, `ja3Hash`, `ja4`, `detectionIds`, `jsDetection.passed`. Confirmed: `cf.bot_management.score` requires Enterprise with Bot Management; the free plan's Bot Fight Mode gives *no per-request score, no JA3/JA4, no detection IDs, no custom rules*. ([bot-management-variables](https://developers.cloudflare.com/bots/reference/bot-management-variables), [free plan](https://developers.cloudflare.com/bots/plans/free))

**Ambiguous — verify empirically before shipping:**
- `cf.verified_bot_category` / `request.cf.verifiedBotCategory` — appears in the ruleset-engine docs; plan availability unclear.
- **`clientTrustScore`** — the field most often cited in community threads as "available without Bot Management," but **absent from the official Workers runtime-API reference**. Treat as undocumented; probe it, don't depend on it.
- **Web Bot Auth verification is the exception that's genuinely free**: Cloudflare stated signature verification is "available for all Free and Pro plans," rolling out to Business/Enterprise. ([blog.cloudflare.com/verified-bots-with-cryptography, 1 Jul 2025](https://blog.cloudflare.com/verified-bots-with-cryptography/))

➡️ **Practical read:** on a free Cloudflare Worker you get **ASN + RTT + protocol + geo + coarse TLS**, and you must compute everything else yourself from headers and (optionally) a JS beacon. That's actually a decent floor — and it's a strong argument for the package doing its *own* classification rather than proxying a bot score most customers can't afford.

### Vercel

- The [request-headers doc](https://vercel.com/docs/edge-network/headers/request-headers) (last updated 2025-12-13) lists only `host`, `x-forwarded-*`, `x-real-ip`, `x-vercel-id`, `x-vercel-deployment-url`, geo headers, `x-vercel-signature`. **It does not list `x-vercel-ja4-digest`.**
- `x-vercel-ja4-digest` *is* documented in Firewall material and readable via `request.headers.get("x-vercel-ja4-digest")` — but a community thread titled ["JA4 Fingerprint 'not working' as expected"](https://community.vercel.com/t/ja4-fingerprint-not-working-as-expected/2154) and a standing feature request for the full JA4+ suite say the surface is thin. **Feature-detect it; don't assume it.**
- No ASN header. You get an IP and geo — ASN requires your own lookup (MaxMind GeoLite ASN / IPinfo / Team Cymru).
- **BotID** is enforcement-shaped and constrained: `checkBotId()` runs only in Next.js route handlers or server actions, **not middleware**. Basic mode is client-JS signals (§1.2) in an `x-is-human` header; Deep Analysis routes to Kasada. nullpt.rs found Basic mode "allows everything to pass as human" at time of testing — consistent with telemetry-first rollout. ([nullpt.rs](https://nullpt.rs/reversing-botid); [vercel.com/docs/botid](https://vercel.com/docs/botid))

### Fastly

Best free network layer of the managed platforms: **`tls.client.ja3_md5` and `tls.client.ja4` are plain VCL variables**, no Bot Management license required, readable in Compute. JA4 landed in Fastly Bot Management in Feb 2025 (Edge deployment ≥ 2.10.0). ([tls.client.ja4](https://www.fastly.com/documentation/reference/vcl/variables/client-connection/tls-client-ja4/), [changelog](https://www.fastly.com/documentation/reference/changes/2025/02/ja4-fingerprinting-now-supported-in-bot-management/))

### nginx / Caddy / self-hosted

Nothing for free, but the **highest ceiling** — the only tier where you can get the h2 fingerprint:
- [phuslu/nginx-ssl-fingerprint](https://github.com/phuslu/nginx-ssl-fingerprint) and [HanadaLee/ngx_ssl_fingerprint_module](https://github.com/HanadaLee/ngx_ssl_fingerprint_module) — JA3 + JA4 + **HTTP/2** for nginx (require patched OpenSSL/BoringSSL and a recompile).
- [lua-resty-ja4](https://opm.openresty.org/package/nemethhh/lua-resty-ja4) — JA4 + JA4H via LuaJIT FFI in `ssl_client_hello_by_lua*`, no recompile.
- [fingerproxy](https://github.com/wi1dcard/fingerproxy) — reverse proxy that computes JA3/JA4/Akamai-h2 and injects them as request headers. **This is the cleanest deployment story for a drop-in package**: one sidecar, all platforms, header-based contract.
- No Caddy JA3/JA4 module surfaced in search.

**Universal free signal available everywhere, including plain nginx: raw header order and HTTP/2 pseudo-header order** — nginx must be configured to preserve it, but it costs nothing.

### Per-platform capability matrix

| Signal | CF Workers (free) | CF Workers (Ent+BM) | Vercel | Fastly | nginx |
|---|---|---|---|---|---|
| ASN / AS org | ✅ | ✅ | ❌ (own lookup) | ✅ (VCL) | ❌ (own lookup) |
| JA3/JA4 | ❌ | ✅ | ⚠️ JA4 only, flaky | ✅ **free** | ✅ (module) |
| HTTP/2 fingerprint | ❌ | ❌ | ❌ | ❌ | ✅ (module) |
| Header order | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bot score | ❌ | ✅ | ⚠️ BotID verdict | ✅ (BM) | ❌ |
| Verified/signed agent | ✅ (WBA verify, Free/Pro) | ✅ | ⚠️ | ⚠️ | ❌ (DIY) |
| TCP RTT | ✅ | ✅ | ❌ | ✅ | ✅ |

---

## 4. The commoditized layer

**Fully commoditized — ship as table stakes on day one:**

- **`isbot`** — ~15.2M weekly npm downloads, community-maintained regex over UA lists, covers ChatGPT/Claude/Perplexity strings. Documented fallback benchmark: **75% bot coverage, 1% FPR**. ([github.com/omrilotan/isbot](https://github.com/omrilotan/isbot))
- **`crawler-user-agents`** (monperrus) — single JSON, npm/Go/PyPI distributions, PR-driven. ([repo](https://github.com/monperrus/crawler-user-agents))
- **Known Agents** (formerly Dark Visitors) — the most comprehensive public catalog, categorized (AI Agents / AI Assistants / AI Search Crawlers / AI Data Scrapers / SEO / etc.), with API access and auto-generated robots.txt. ([knownagents.com](https://knownagents.com/), [api.darkvisitors.com](https://api.darkvisitors.com/))
- **device-detector / Matomo, CrawlerDetect** — mature but measured *weak* on modern bots: 12.0% and 18.1% TPR respectively in the "Shy Guys" evaluation.

**How good are the lists on AI agents specifically?** Good on *declared* class A/B — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Agent, Google-NotebookLM, Amazonbot, CCBot, Applebot, DuckAssistBot, MistralAI-User are all well covered, and update lag is days-to-weeks (community PR speed).

**They are structurally incapable of covering class C–G**, because those emit no distinguishing UA at all. This isn't a coverage gap that better list maintenance fixes — it's a category error. Any product whose AI-agent detection is a UA list is measuring only the agents that volunteered.

**Reverse-DNS verification** is the correct hardening for class A/B and is genuinely cheap: PTR on the source IP → confirm hostname suffix matches the claimed vendor domain → forward-resolve → confirm it returns the source IP (FCrDNS, [Google's documented method](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests)). Or CIDR-match published ranges, which is faster and cacheable but goes stale.

⚠️ **UA + rDNS mismatch is one of the highest-value labels and nobody surfaces it well.** Cloudflare's own Perplexity investigation (4 Aug 2025) rested exactly on this shape: declared UA first, then on block, a **generic Chrome-on-macOS impersonation with rotating source ASNs**, plus failure to fetch robots.txt. Perplexity's rebuttal — that 3–6M daily requests were unrelated BrowserBase traffic vs. their own <45k/day — is itself an argument that **attribution, not detection, is the hard part**, and that a neutral observational tool has a real role here.

---

## 5. Behavioral / log-based classification with no JavaScript

This is the layer with the best effort-to-value ratio for a drop-in package, and it's underserved.

### 5.1 The strongest recent result

**MARK** (arXiv:2606.20910, Jun 2026) is server-side-only, no client instrumentation. Six agents: AutoGen, Browser Use, Claude, Gemini, Operator, Skyvern.

| Layer | F1 |
|---|---|
| TLS (JA3/JA4) | 74.7% |
| HTTP headers | 82.0% |
| Behavioral | 87.6% |
| Temporal alone | 100% (but not real-time usable) |
| **Fused** | **~97%** |

**>60% accuracy after just three requests** — the number that makes streaming classification viable.

Named discriminators worth stealing directly:
- **Browser Use violates `Sec-Fetch` semantics in 100% of requests.**
- **Skyvern has a uniquely identifiable TLS/H2 fingerprint** (17 extensions vs 16 for others).
- **Claude and Gemini share near-identical network fingerprints but diverge behaviorally** — i.e., network layer bottoms out at "some Chromium agent," and only behavior gives attribution.

Stated limits: cannot separate agents sharing a backend; features decay as agents ship updates; behavioral accuracy varies with site complexity.

### 5.2 `Sec-Fetch-*` and Client Hints incoherence — free, server-side, no JS

The most actionable no-JS heuristic set ([sicuranext, 16 Dec 2025](https://blog.sicuranext.com/sec-fetch-and-client-hints-a-powerful-tool-against-automation/)):
- `Sec-Fetch-Site: none` on a request that is clearly internal site navigation.
- XHR or form POST carrying `sec-fetch-mode: navigate`.
- `Sec-Fetch-Dest: document` on XHR/POST.
- Missing `Sec-Fetch-User: ?1` where a user gesture must have occurred.
- `Sec-CH-UA-Platform: Windows` while the UA claims Linux/macOS.
- UA says `Chrome/140`, Client Hints say `v="100"`.
- No UA-CH at all from a claimed Chrome 140+.
⚠️ Author's own caveat, and it's serious: **Android WebView legitimately exhibits missing Client Hints and absent Sec-Fetch headers.** Don't treat these as automation without a WebView carve-out.

### 5.3 Classic log heuristics — validated but weak alone

**"Shy Guys"** (arXiv:2603.28546v2, 31 Mar 2026) — 4.6M requests, 54,945 unique UA strings, two honeypots (one indexed, one not) + LMS logs from authenticated users, multi-region, Crypto-PAn anonymized:
- **Favicon heuristic**: real browsers cache and fetch favicons; headless scrapers skip. Rotating the favicon URL daily forces re-requests and suppresses false positives.
- **UA coherence**: absence of the `Mozilla/5.0` prefix; browser/OS versions >2 years old.
- Results: **TPR 67.6%, FPR 3.0%, TNR 97.0%** — vs. Cloudflare 8.4%, CrawlerDetect 18.1%, Matomo DeviceDetector 12.0% on the same ground truth.
- Honest limitations: **32.4% false negatives** (sophisticated bots evade); favicon logic degrades under IP hopping (university NAT); positioned as first-line filtering only.

Older literature that still holds up for feature ideas: **"Access Patterns for Robots and Humans in Web Archives"** ([arXiv:1309.4009](https://arxiv.org/pdf/1309.4009)) — robots.txt requesters classified as robots, image-to-HTML ratio, browsing speed. Plus the ML-on-logs line: [Efficient on-the-fly Web bot detection](https://www.sciencedirect.com/science/article/pii/S0950705121003373), [New biostatistics features for detecting web bot activity](https://www.sciencedirect.com/science/article/abs/pii/S0167404820302741).

### 5.4 The under-exploited feature: **path-coverage shape**

No published work cleanly separates *crawler shape* from *agent shape* on this axis — a defensible differentiator. The hypothesis is well-grounded in the taxonomy:

- **Crawler (class A):** breadth-first, high unique-path count, low repeat rate, follows sitemap/pagination structure, fetches `robots.txt`, heavy conditional-GET (`If-None-Match`/`If-Modified-Since`) usage on re-crawl, near-zero asset fetches, near-flat inter-request intervals.
- **Agent (class B–F):** **shallow, targeted, goal-shaped** — 1–8 pages, often search → result → detail → form; frequently arrives with a referrer from an AI origin; fetches assets (real browser) but may skip images; intervals show **inference-latency plateaus** (seconds of nothing, then a burst), *not* the flat regularity of a crawler or the long-tail dwell of a human.
- **Human:** irregular intervals with reading dwell, full asset load, back-navigation, mid-session abandonment.

Two derived features that are free at the edge and, as far as could be found, unexploited commercially:
- **Asset-load ratio** — assets fetched ÷ assets referenced in the HTML. ~0 = HTTP client; ~1 = real browser; **partial-and-selective** (CSS+JS but no images) is a strong agent tell, since agents that parse DOM don't need pixels.
- **Conditional-GET ratio** — crawlers use it, agents essentially never do (they're one-shot).

---

## 6. Observation vs. blocking — the honest-classifier argument

**Yes, and it's a substantive technical argument, not just positioning.** Six reasons an observational classifier can be *more accurate and more honest* than a blocking one:

1. **You escape the adversarial loop.** Every published evasion tool — patchright, rebrowser-patches, curl-impersonate, uTLS, httpcloak — exists to defeat *blocking*. An observational label creates no incentive to evade. Ground truth stays clean longer; signals decay more slowly.

2. **You can spend latency.** Blockers decide inline in single-digit milliseconds. An observer can classify asynchronously, aggregate across a whole session or across days, and do reverse-DNS lookups, IP-reputation calls, and cross-request correlation that no inline path affords. **The Atlas favicon/CFNetwork signal is only reachable by cross-request correlation** — structurally unavailable to a blocker.

3. **You can relabel with hindsight.** MARK needs three requests for >60% and more for 97%; FP-Agent needs 1–3 minutes. A blocker must commit on request one. An observer can emit `unknown` at t=0 and upgrade to `agent:claude, 0.94` at t=90s, then rewrite the earlier events. Retroactive labeling is a feature of the observational architecture.

4. **The false-positive cost function is entirely different, so the operating point is different.** Blocking a human is a lost customer; mislabeling one in a dashboard is a rounding error. This allows higher recall — and honesty about uncertainty instead of a forced binary. Documented harms of the blocking operating point: screen readers, keyboard-only navigation, and form-filling extensions all look anomalous to behavioral models, and threshold-based exclusion disproportionately hits accessibility users, international users, and low-end devices. ([Pivotal Accessibility](https://www.pivotalaccessibility.com/2025/01/the-hidden-cost-of-false-positives-in-accessibility-testing/), [Prolific research](https://researcher-help.prolific.com/en/articles/445222-understanding-the-limitations-of-recaptcha-bot-detection-in-research))

5. **Probabilistic output is the product, not a liability.** Every serious vendor already scores probabilistically internally (Cloudflare's bot score is 1–99) and then *destroys the information* by thresholding it into allow/challenge/block. Shipping the distribution — plus the evidence that produced it — is a genuine product, and it's what makes the "unknown automated" bucket honest rather than a cop-out.

6. **Privacy/regulatory posture is materially better, and this is a real go-to-market asset.** The EDPB has extended ePrivacy Art. 5(3) to cover fingerprinting; the practical 2026 compliance consensus is **server-side signal collection + minimized client-side fingerprinting + a documented LIA + session-scoped retention + strict purpose limitation**. Crucially, *retaining fingerprints indefinitely or repurposing anti-fraud fingerprints for audience analytics collapses the legitimate-interest case immediately* — which means the classification pipeline must be architecturally separate from any identity/analytics join, with hashed + salted + short-TTL session keys. A server-log-first design is not just cheaper, it's the compliant default; the JS beacon should be optional and consent-gated.

**Prior art in this framing** (all partial — nobody has fully claimed the space): Cloudflare AI Crawl Control (CF-only, operator-granularity, enforcement-pointed; from **15 Sep 2026, new domains get Training and Agent blocked by default on ad-bearing pages**); Cloudflare's Search/Agent/Training taxonomy (adopt it, don't invent a new one); Adobe LLM Optimizer "Agentic Traffic" dashboard (enterprise-locked); cside (honest three-bucket framing: *"the catch is not one perfect signal; it is the contradictions between them"*). **Nothing** occupies: cross-platform drop-in, session-and-interaction-granular, probabilistic, explicitly non-enforcing, with a first-class `unknown automated` bucket.

---

## 7. Recommended layered architecture

Design as **five tiers, evaluated cheapest-first, all contributing evidence to one probabilistic verdict** — never short-circuiting to a hard label except at L0.

### L0 — Cryptographic verification (confidence 1.0, ~0 cost)
Verify RFC 9421 HTTP Message Signatures / Web Bot Auth: check `Signature`, `Signature-Input`, `Signature-Agent`; fetch the Ed25519 public key from the agent's `/.well-known/http-message-signatures-directory`; verify; check expiry. Cache JWKS aggressively.
→ Emits `verified_agent:<operator>`, confidence **1.0**.
**This is the only tier that is certain, and it is the tier that should grow.** Expect it to carry ~2% of traffic now and 30%+ in two years.

### L1 — Identity assertion + verification (confidence 0.9–0.99, ~1 DNS lookup)
UA match against `isbot` + `crawler-user-agents` + Known Agents categories → **then verify** via FCrDNS or published CIDR ranges.
Three distinct outputs, the third being the highest-value label:
- `declared_agent:<op>` + verified → **0.99**
- `declared_agent:<op>` + unverifiable → **0.5, flag `unverified_claim`**
- **`impersonation_suspected`** — UA claims generic Chrome, but rDNS/ASN says AI-operator infrastructure, or UA rotates across a stable ASN+JA4 identity. The Perplexity-shaped signal; it belongs in the product.

### L2 — Network & transport coherence (confidence 0.7–0.9, free-to-cheap)
- ASN classification: hosting / AI-operator / residential / mobile / known-proxy.
- Optional paid enrichment: IPinfo or Spur residential-proxy lookup (cache by /24, TTL days).
- JA4 where the platform provides it.
- **Coherence checks — the real value, all free everywhere:** JA4 ↔ UA family mismatch; HTTP/2 pseudo-header order ↔ claimed browser; raw header order ↔ claimed browser (alphabetically sorted headers = strong tell); `Sec-CH-UA-Platform` ↔ UA platform; Client Hints major version ↔ UA version; `Sec-Fetch-*` semantic violations (with an Android WebView carve-out); `httpProtocol: HTTP/1.1` from a claimed modern Chrome; `clientTcpRtt` ↔ claimed geolocation.
→ Emits `automated:transport_incoherent` with per-check evidence. Count contradictions; **any single one is weak, three concurrent ones are near-decisive.**

### L3 — Session shape from logs, no JS (confidence 0.6–0.85, free, needs 3+ requests)
Per rolling session key (salted hash of IP + UA + Accept-Language, **short TTL, never joined to identity**):
- asset-load ratio (0 → HTTP client; ~1 → browser; selective CSS/JS-no-images → agent)
- path-coverage shape: unique-path breadth vs. depth; sitemap adherence vs. targeted funnel
- conditional-GET ratio (crawler-high, agent-near-zero)
- robots.txt fetch (present → crawler-shaped; absent + high breadth → impersonating crawler)
- inter-request interval distribution: flat-regular (crawler) / plateau-then-burst = inference latency (agent) / long-tail dwell (human)
- favicon fetch (Shy Guys heuristic — rotate the URL daily)
- referrer origin ∈ {chat.openai.com, atlas.openai.com, perplexity.ai, gemini.google.com}
- **cross-request out-of-band UA correlation** — the Atlas CFNetwork/Darwin favicon leak; look for *two different UAs from one IP within one session window*
→ Emits `crawler_shaped` / `agent_shaped` / `human_shaped` with calibrated confidence. **MARK's ~82% headers-only F1 is roughly the realistic ceiling here; ~60% after 3 requests.** The default tier for customers who won't or can't run a JS beacon.

### L4 — Behavioral beacon, opt-in and consent-gated (confidence 0.9–0.99, needs JS + 30–180s)
Ship the **minimal** feature set the research validates, not a 250-signal kitchen sink:

**Core three (mandatory):** `mouse_event_rate` (raw mousemove Hz), `teleport_click_ratio` (clicks preceded within 100ms by a raw mousemove jump >100px in <50ms), `click_duration_std` (SD of mousedown→mouseup intervals).

**Extended two (for three-class discrimination → macro-F1 ≥ 0.99):** `typing_speed_std`, `scroll_speed_variance`; plus `has_*` presence flags per event class — **wheel-event absence is a Playwright structural tell** (Playwright has no `scroll.wheel()`).

**Cheap adjuncts (weak, collect but weight low):** CDP `Runtime.enable` probe (false-positives on DevTools-open humans, patched by stealth forks); `navigator.webdriver`; WebGL SwiftShader/llvmpipe (class C only); extension DOM artifacts (high value, high brittleness; version and monitor).

**Two hard rules:**
- **NEVER deploy a single behavioral feature.** `cursor_path_linearity` is "solo-perfect" and collapses into an always-agent classifier (precision 0.33, macro-F1 0.17). A documented diagnostic trap.
- **Label interactions, not sessions** (the CHEQ cyborg-session finding). Emit a control-attribution timeline: `human 0–45s → agent 45–120s → human 120s+`.

### Fusion and output contract

Do **not** average into one 0–100 number. Emit a structured verdict:

```
{
  class:      "human" | "agent" | "crawler" | "automated_unknown" | "unknown",
  confidence: 0.0–1.0,               // calibrated, not a heuristic sum
  operator:   "openai" | "anthropic" | ... | null,
  method:     "cryptographic" | "verified_identity" | "declared_unverified"
            | "transport_incoherence" | "session_shape" | "behavioral",
  evidence:   [ { signal, value, weight, tier } ],   // always show your work
  attribution_timeline: [ { t_start, t_end, class, confidence } ]
}
```

Rules that keep it honest:
- **`unknown` is a first-class, non-embarrassing output.** If L0–L3 are silent and there's no beacon, say `unknown` — do not default to `human`. Defaulting to human is exactly the 30–39% binary-classifier failure mode.
- **`automated_unknown`** for high-confidence automation with no operator attribution. Most class-D traffic lands here permanently, and that is the correct answer.
- **Never let L2/L3 overturn L0.** Cryptographic identity dominates.
- **Calibrate.** Ship reliability diagrams. Confidence 0.8 must mean 80% correct in production or the whole "honest classifier" pitch is a lie.
- **Contradiction count is a first-class metric.** Surface it: "this request presented 4 mutually inconsistent identity claims."

---

## 8. What will remain UNKNOWABLE without agent-side cooperation

Stated plainly, because the product's credibility depends on saying it out loud:

**Structurally unknowable — no signal exists at any layer:**

1. **OS-level input injection.** computer-use, xdotool, PyAutoGUI, macOS Accessibility API. Events carry `isTrusted: true` with genuine device-driver timing, on a real machine and IP. No proposed technique reaches it. **Unknowable, full stop.**

2. **Extension agents synthesizing trusted input via `chrome.debugger`.** Claude for Chrome, per CHEQ, produces clicks and keystrokes "indistinguishable from human hardware input" inside the user's real browser. Only *incidental* artifacts betray it — and every one breaks on the next extension release. A maintenance treadmill with a permanent detection lag, never a reliable signal.

3. **Agentic browsers doing pure DOM manipulation on the user's machine.** Real Chromium, real GPU, real residential IP, real cookie jar, correct-by-construction TLS and h2 fingerprints, deliberately Chrome-identical UA. Residual signals (CFNetwork favicon leak, TTS voice-list gaps) are **implementation accidents, not invariants** — they will be closed, and closing them is cheap for the vendor.

4. **Human-in-the-loop / cyborg sessions.** When a human drives 90% of a session and delegates one form submission, no session-level classifier can be right. Interaction-level attribution helps but has a hard floor.

**Practically unknowable — theoretically detectable, economically not:**

5. **Class D at low volume.** A patchright + residential-proxy + rate-limited-to-human-speed stack, hitting a handful of pages. The behavioral event-structure signal *does* still catch it — but only with the JS beacon, only after 30–180 seconds, and only until the automation frameworks refactor their input APIs to emit realistic raw event streams. **That refactor is the single change that would invalidate the strongest current signal**, and it is a normal roadmap item for any stealth vendor. Assume a 12–24 month half-life and design for graceful degradation.

6. **Attribution when agents share infrastructure.** MARK cannot separate agents on the same backend; FP-Agent found Atlas/Browser Use/Claude-on-macOS sharing identical browser fingerprints. The Cloudflare↔Perplexity↔BrowserBase dispute is the canonical illustration: when agent vendors rent the same cloud-browser infrastructure, "which operator" is genuinely undecidable from traffic alone.

7. **Anything behind an aggressive privacy setup.** Users with fingerprint-resistant browsers, disabled JS, or VPNs are *systematically* misclassified as automated. This is the failure mode most likely to embarrass publicly. Weight incomplete fingerprints *lower*, never higher, and never let missing-signal become evidence-of-automation.

**The strategic conclusion:** the trajectory of this problem is *away* from detection and *toward* declaration. Web Bot Auth (IETF WG chartered 2026, RFC plausible 2027) and WebMCP (`document.modelContext` — relocated from `navigator.modelContext` on 21 Jul 2026 — Chrome origin trial through Chrome 156, adoption "approximately zero," and no mechanism to detect *which* agent is calling tools) are both moving the ecosystem toward agents identifying themselves.

That is good news for an observational product and bad news for a blocking one. **Blocking products' value evaporates as declaration wins; an observational product's value compounds** — because the thing customers will want to know is not "was this a bot" but "which of the fourteen agent operators sent traffic, on whose behalf, doing what," and declaration answers that far better than any fingerprint ever will.

So: **build L0 first and evangelize it, ship L1–L3 as the honest free floor, treat L4 as a decaying asset, and label the residue `unknown` without apology.** The `unknown` bucket is the product's integrity.

---

## Sources

Primary research (2026 arXiv):
- [What Does It Take to Detect an AI Agent? Minimal Feature Sets for Behavioral Detection under Browser Automation](https://arxiv.org/html/2607.26935v1) — arXiv:2607.26935, 29 Jul 2026
- [Whose Agent Are You? Multi-Layer Fingerprinting and Attribution of Autonomous Web Agents (MARK)](https://arxiv.org/html/2606.20910v1) — arXiv:2606.20910, Jun 2026
- [Known By Their Actions: Fingerprinting LLM Browser Agents via UI Traces](https://arxiv.org/abs/2605.14786) — arXiv:2605.14786, 14 May 2026
- [FP-Agent: Fingerprinting AI Browsing Agents](https://arxiv.org/html/2605.01247v1) — arXiv:2605.01247, 2 May 2026
- [Shy Guys: A Light-Weight Approach to Detecting Robots on Websites](https://arxiv.org/html/2603.28546v2) — arXiv:2603.28546v2, 31 Mar 2026

Platform docs, vendor research, tooling, and policy sources cited inline throughout (Cloudflare Workers/Bots docs, Vercel BotID + request headers, Fastly VCL variables, Google/Bing verification docs, CHEQ cyborg-session, Castle, nullpt.rs, DataDome, Fastly TLS-fingerprinting, sicuranext, Arcjet, HUMAN Security, cside, seresa.io, Scrapfly, isbot, crawler-user-agents, Known Agents, rebrowser/patchright, fingerproxy, nginx fingerprint modules, IPinfo, Spur, WebMCP state, EDPB/ePrivacy guidance, accessibility false-positive research.)
