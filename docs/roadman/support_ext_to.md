`https://ext.to/`

Now we wanted to have an A separate scare scrappers and all that logic which is in module level just like cloud stream provide its via repository we wanted to have that kind of community supports for in our app we need to have for some standards to do that and initially we wanted to have first class grabber for Ext 2 torrent provider which is in very good rich library library containing but the only caveat and issue is that it's behind the robot and the captcha and bot access the access permission issues so we wanted to have mechanism when we scrap the media or website when the boat or what are a robo or a something that something security triggered we need to display that page onto the users so they can make a captcha work and they can perform all that security permissions and security validations at that time they can pass that and then again that all handovers to the our scrappers and they do all the job so we need to have a very smart way I have seen there are applications doing that they they are primarily scrappers but they when they hit the robo robot protections or a security concern they hand over to the end user end user perform behalf of them and then again that take over the task so we need to design and that kind of architecture for the plugging extension system for our electron based first class repository system and that repository system we need to have write the first class repository which is supported by extension dot go where I I'm I'm pretty sure they have a cloud flare security and capture verification for bot access so please get the confirmation how it's using it and when it access is denied by the security layers then they can hand over to the users and then again it uses their scrappers to fetch all information what we need for streaming torrent and to download torrent and copy magnet links


---

We wanted to separate scrapers and related logic from the module level, similar to how Cloud Stream provides them via a repository. We aimed to implement this support for community contributions in our app by establishing certain standards.

Initially, we planned to include a first-class scraper for the Ext 2 torrent provider, which is part of a well-developed and feature-rich library. However, the main challenge is that it is protected by Cloudflare bot detection, requiring captcha verification and additional access permissions.

To handle this, we need a mechanism where, if scraping a media or website triggers bot detection or security measures, the user is shown the page to complete the captcha and security validations. Once they pass these checks, the process should automatically hand back control to our scrapers to continue fetching the required data.

We have seen applications adopt this approachΓÇöthey act as scrapers but delegate bot-protected interactions to the end user, who resolves the captcha or security steps. Then, the scraper resumes its task.

We need to design this architecture for our plugin-extension system within an Electron-based first-class repository. This repository should support extensions via `extension.go`, which likely leverages Cloudflare security and captcha verification for bot access.

We should confirm how this mechanism worksΓÇöspecifically, when access is denied by security layers, the process should hand over to the user for completion. After user validation, the scrapers should resume fetching the necessary details for streaming, torrent downloading, and magnet link copying.

---

 describing is a very good fit for the Electron architecture, and I would make it a separate subsystem from the media compatibility engine we discussed earlier.

The key idea is:

```text
CloudStream Desktop
        |
        +-----------------------------+
        |                             |
 Provider Extension System       Playback Engine
        |                             |
        v                             v
Community Providers             Media Compatibility
        |                             |
        +-------------+---------------+
                      |
                 Resolved Source
```

For the provider side, you want something much closer to CloudStream's extension/repository philosophy than hardcoded scrapers inside the Electron application.

## First, confirmation about ext.to

I checked the current external evidence.

`ext.to` is currently behind Cloudflare infrastructure. Cloudflare Radar shows its DNS and hosting through Cloudflare, including Cloudflare nameservers and Cloudflare's AS13335 network. ([Cloudflare Radar][1])

More importantly, there is direct evidence of Cloudflare challenge behavior for ext.to. A current technical scan recorded:

```text
HTTP 403 Forbidden
server: cloudflare
cf-mitigated: challenge
```

for ext.to. ([Even Insight][2])

There is also recent community evidence from August 2026 describing users encountering a Cloudflare verification checkbox on ext.to. ([Reddit][3])

So your assumption is basically correct: **you should design the extension system assuming that an HTTP scraper can encounter Cloudflare/browser challenges.**

I would not, however, hardcode the assumption that every failure is Cloudflare CAPTCHA. Cloudflare can use several mechanisms including JavaScript detection, managed challenges, bot scoring, WAF rules and other signals. ([Cloudflare Docs][4])

There is even an existing third-party ext.to integration that explicitly lists FlareSolverr as required for its ExtTo scraper, which further confirms that automated access to ext.to is a practical issue. ([GitHub][5])

## The architecture I recommend

Do not make the extension itself responsible for solving the challenge.

Instead:

```text
                    Extension Repository
                            |
                            v
                    ExtTo Extension
                            |
                            v
                    ExtTo Scraper
                            |
                            v
                    HTTP Request
                            |
                    +-------+-------+
                    |               |
                    v               v
                 Success         Challenge
                    |               |
                    |               v
                    |        Human Browser
                    |               |
                    |        User completes
                    |          verification
                    |               |
                    |               v
                    |        Browser Session
                    |               |
                    +-------+-------+
                            |
                            v
                    Scraper continues
                            |
                            v
                 Normalized Torrent Results
```

The important part is that **the user does not manually perform the scraping**.

They only temporarily take over the browser session to establish a legitimate authenticated/human session.

Then the extension gets control back.

## Call this a Human Interaction Gateway

I would introduce a generic service:

```typescript
HumanInteractionGateway
```

The scraper should be able to say:

```typescript
await context.request({
  url,
  method: 'GET'
});
```

If everything works:

```text
HTTP Response
     |
     v
Scraper continues
```

If the transport layer detects a challenge:

```text
HTTP Response
     |
     v
Challenge Detected
     |
     v
HumanInteractionGateway
     |
     v
Show Browser
     |
     v
User completes challenge
     |
     v
Session established
     |
     v
Retry original request
     |
     v
Scraper continues
```

This is much cleaner than putting Cloudflare-specific code into the ext.to extension.

## The most important design decision

The extension should **never directly use Electron's `BrowserWindow` for normal scraping**.

Instead give every extension a controlled runtime API:

```typescript
interface ExtensionContext {
  http: HttpClient;
  browser: HumanInteractionGateway;
  storage: ExtensionStorage;
  cache: ExtensionCache;
  logger: ExtensionLogger;
}
```

Then:

```typescript
interface HumanInteractionGateway {
  open(request: BrowserRequest): Promise<BrowserSession>;

  waitForAccess(
    sessionId: string,
    options?: WaitForAccessOptions
  ): Promise<AccessResult>;

  close(sessionId: string): Promise<void>;
}
```

This means the extension doesn't know whether you're using:

```text
BrowserWindow
WebContentsView
hidden Chromium page
visible Chromium page
dedicated BrowserView
```

That becomes an application implementation detail.

## Even better: make HTTP requests session-aware

This is critical.

Do not do this:

```text
Scraper HTTP Client
       |
       v
Cloudflare
       |
       X
       |
Browser solves challenge
       |
       X
Scraper HTTP Client
```

Instead:

```text
                 Session
                   |
       +-----------+-----------+
       |                       |
       v                       v
    HTTP Client          Browser Context
       |                       |
       +-----------+-----------+
                   |
                   v
             ext.to session
```

The browser and scraper must be able to share the relevant session state.

Depending on the site's behavior, that can include:

```text
Cookies
User-Agent
Referer
Origin
Authorization state
Session identifiers
```

For Electron, this is where a dedicated partition/session for the extension becomes valuable.

For example conceptually:

```text
partition:
persist:extension-extto
```

Then:

```text
ExtTo Scraper
      |
      +--> HTTP requests
      |
      +--> Browser challenge
      |
      +--> same session/cookies
```

The exact mechanism should be abstracted behind your runtime API.

## Do not detect only "CAPTCHA"

This is another important improvement.

Your system should have a generic:

```typescript
type AccessIntervention =
  | 'NONE'
  | 'LOGIN_REQUIRED'
  | 'HUMAN_VERIFICATION'
  | 'BOT_CHALLENGE'
  | 'RATE_LIMITED'
  | 'CONSENT_REQUIRED'
  | 'ACCESS_DENIED'
  | 'UNKNOWN';
```

Then:

```typescript
interface AccessChallenge {
  type: AccessIntervention;

  url: string;

  statusCode?: number;

  reason?: string;

  canResume: boolean;

  requiresUserInteraction: boolean;
}
```

Because the future provider might not use Cloudflare.

It could be:

```text
Cloudflare
Turnstile
Login wall
Cookie consent
JavaScript challenge
Rate limit
Akamai
DataDome
Imperva
custom anti-bot
```

Your extension should not care.

## The scraper API should look something like this

```typescript
interface ProviderExtension {
  manifest: ExtensionManifest;

  search(query: string): Promise<TorrentResult[]>;

  getDetails(id: string): Promise<TorrentDetails>;

  getTorrent(id: string): Promise<TorrentSource>;

  getMagnet(id: string): Promise<string>;
}
```

But internally:

```typescript
class ExtToProvider implements ProviderExtension {
  async search(query: string) {
    const response = await this.context.http.get(
      this.buildSearchUrl(query)
    );

    return this.parseSearchResults(response);
  }
}
```

The extension doesn't implement:

```text
Cloudflare
cookies
browser
retry
proxy
TLS
redirects
rate limiting
challenge detection
```

The platform provides those.

That is what makes the ecosystem scalable.

## Your extension repository

I would structure it like this:

```text
Extension Repository
│
├── manifest.json
│
├── extto
│   ├── manifest.json
│   ├── provider.ts
│   ├── parser.ts
│   └── tests/
│
├── provider-b
│   ├── manifest.json
│   └── provider.ts
│
├── provider-c
│   ├── manifest.json
│   └── provider.ts
│
└── ...
```

But I would **not download arbitrary JavaScript and execute it directly in the Electron main process**.

That creates a huge security problem.

Instead use a sandboxed extension runtime.

```text
Extension Repository
        |
        v
Signature / Integrity Check
        |
        v
Extension Sandbox
        |
        +--> HTTP API
        +--> Browser API
        +--> Storage API
        +--> Parser API
        |
        v
Normalized Results
```

The extension should have no direct access to:

```text
Node.js
fs
child_process
shell
Electron APIs
OS environment
arbitrary network sockets
```

unless explicitly exposed through your extension API.

## This gives you a very powerful model

Your application becomes:

```text
                    CloudStream Desktop
                           |
                    Extension Manager
                           |
        +------------------+------------------+
        |                  |                  |
     Extension          Extension          Extension
       A                    B                  C
        |                  |                  |
     Scraper             Scraper            Scraper
        |                  |                  |
        +------------------+------------------+
                           |
                     Normalized Results
                           |
                           v
                    Source Selection
                           |
                           v
                   Playback Engine
```

And the playback engine doesn't know or care whether the source came from:

```text
ExtTo
Provider X
Provider Y
Google Drive
GDFlix
HLS provider
DASH provider
Torrent provider
```

That is exactly the separation you want.

## ExtTo should be your first-class reference implementation

I would actually build the first extension as the specification for the entire ecosystem.

Something like:

```text
ExtTo Extension
│
├── Search
│
├── Browse
│
├── Details
│
├── Torrent metadata
│
├── Magnet extraction
│
├── Torrent file extraction
│
├── Pagination
│
└── Human challenge handling
```

Your extension API should be designed while implementing ExtTo, rather than designing a giant generic API first.

That will expose the real requirements.

For example, ExtTo already exposes rich torrent search/filter functionality including categories, seeders, file count, size, uploader, IMDb ID and hash search. ([Ext.to][6])

That makes it a good stress test for your extension API.

## The user handoff should feel like this

From the user's perspective:

```text
Searching ExtTo...

       ↓

Cloud protection detected

┌─────────────────────────────────────┐
│                                     │
│       Complete verification         │
│                                     │
│       [ Embedded Browser ]           │
│                                     │
│       User completes challenge      │
│                                     │
│             [ Done ]                │
│                                     │
└─────────────────────────────────────┘

       ↓

Access restored

       ↓

Resuming ExtTo search...

       ↓

247 results found
```

The user should never need to understand:

```text
Cloudflare
cookies
tokens
HTTP 403
challenge cookies
browser context
```

## One important safety/security rule

Do not implement this as a mechanism to automatically bypass or defeat the site's anti-bot controls.

Instead, explicitly model it as:

**"Human-assisted access"**

The browser is genuinely visible to the user, the user completes whatever verification the website requires, and the application resumes using the resulting session.

That distinction is architecturally cleaner and much safer.

Cloudflare itself describes challenges as a mechanism for distinguishing humans from automated traffic, and its bot systems can block or challenge suspicious requests. ([Cloudflare Docs][7])

## Final architecture

I would therefore add this as a completely separate major subsystem to your existing PRD:

```text
                 ┌─────────────────────────────┐
                 │       Extension System      │
                 └──────────────┬──────────────┘
                                │
                    Community Extensions
                                │
                ┌───────────────┴───────────────┐
                │                               │
         ExtTo Extension                   Other Extensions
                │                               │
                └───────────────┬───────────────┘
                                │
                         Extension Runtime
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
       HTTP API            Browser Gateway       Storage API
          │                     │                     │
          │              Human Interaction          │
          │                     │                     │
          │               User solves challenge      │
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                │
                         Normalized Sources
                                │
                                v
                    Media Compatibility Engine
                                │
                ┌───────────────┼───────────────┐
                │               │               │
             Direct           Remux          Transcode
                │               │               │
                └───────────────┼───────────────┘
                                │
                                v
                         Playback Session
                                │
                                v
                         Electron Player
```

This is the direction I would take.

The particularly important architectural principle is:

**Extensions own provider-specific knowledge. The platform owns networking, browser intervention, session management, media inspection, playback, security, caching and lifecycle.**

That gives you the equivalent of a CloudStream-style community provider ecosystem while keeping the Electron application itself stable even when individual websites change.

[1]: https://radar.cloudflare.com/domains/domain/ext.to?utm_source=chatgpt.com "ext.to Domain Information | Cloudflare Radar"
[2]: https://eveninsight.com/safety-checker/website/ext.to?utm_source=chatgpt.com "Ext.to Review: Legit or Scam?"
[3]: https://www.reddit.com/r/torrents/comments/1vecn8c/extto_down_for_anyone/?utm_source=chatgpt.com "ext.to down for anyone?"
[4]: https://developers.cloudflare.com/bots/additional-configurations/custom-rules/?utm_source=chatgpt.com "Custom rules · Cloudflare bot solutions docs"
[5]: https://github.com/sooti/sootio-stremio-addon/blob/main/.env.example?utm_source=chatgpt.com "sootio-stremio-addon/.env.example at main · sooti/sootio-stremio-addon · GitHub"
[6]: https://ext.to/advanced/?utm_source=chatgpt.com "Advanced Search - EXT Torrents"
[7]: https://developers.cloudflare.com/bots/concepts/bot-detection-engines/?utm_source=chatgpt.com "Bot detection engines · Cloudflare bot solutions docs"
