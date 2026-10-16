## Provider Compatibility Audit and Comprehensive Media Playback Testing

### Objective

Implement a robust, repeatable, one-by-one compatibility testing system for all providers and repositories supported by the application.

The application currently supports more than 400 providers, along with multiple repositories, video formats, audio formats, resolutions, subtitle tracks, multiple audio streams, and four playback engines. A fix that works for one provider may fail for another because providers can return different response structures, stream types, headers, URL patterns, and media formats.

We need a comprehensive testing mechanism that systematically validates every provider and identifies what each provider returns, how its responses are structured, which playback capabilities it supports, and whether the application can process and play its sources correctly.

The audit may take one to three hours or longer


---

# 
## PRD: Comprehensive Provider Compatibility and Media Stream Validation System

### 1. Objective

Implement a robust, automated, one-by-one validation system to audit every supported provider and repository in CS3, verify its compatibility with the application, and identify failures across media discovery, source extraction, stream formats, playback, audio, video, subtitles, and resolution handling.

The application currently supports more than 400 providers, with different repositories, response structures, media formats, streaming mechanisms, and playback engine requirements. Fixes that work for one provider may not work for another, resulting in recurring compatibility issues and inconsistent playback behavior.

We need a systematic, repeatable testing mechanism that validates each provider individually, records exactly what it returns, determines how the application handles the returned data, and identifies which capabilities work or fail.

The system must be suitable for periodic developer-run audits, potentially taking one to three hours for a complete run, depending on provider availability and network conditions.

**Core principle:** Every supported provider must be tested independently, using real provider responses and resource-efficient validation methods. Compatibility must be established through measurable results rather than assumptions based on a few working providers.

### 2. Provider-by-Provider Validation

Build a sequential or appropriately rate-limited validation runner that discovers all registered providers and repositories and processes each eligible provider individually.

For every provider, the system must:

- Identify its name, repository, implementation, version, and supported capabilities where available.
- Verify that the provider can initialize and respond to requests.
- Test supported search, catalogue, detail, source extraction, and related workflows where applicable.
- Record the actual response structure and the format in which media sources are returned.
- Validate whether returned sources are usable and compatible with CS3's existing media pipeline.
- Identify unsupported formats, malformed responses, expired URLs, missing headers, authentication requirements, and other compatibility issues.
- Record successful, failed, skipped, unsupported, and inconclusive tests separately.
- Continue testing other providers when one provider fails or times out.
- Produce an individual report for every provider, plus an overall compatibility summary.

Do not treat a provider as fully compatible merely because it responds successfully or returns a source URL. Validate the relevant stages of the workflow and distinguish source discovery from actual stream accessibility and playback compatibility.

### 3. Media Source and Stream Inspection

Inspect the actual media sources returned by each provider and determine how they represent and deliver content.

Validate the following where applicable:

**Video**
- Container and media format, including MP4, MKV, WebM, and other supported formats.
- Video codec and encoding information.
- Resolution, dimensions, frame rate, and bitrate when available.
- Number of video streams and whether the source is a single file or a segmented stream.
- Direct video URLs, HLS playlists, DASH manifests, and provider-specific streaming mechanisms.

**Audio**
- Audio codec and format.
- Number of audio streams or tracks.
- Language metadata and track selection information.
- Channel layout and other available audio properties.
- Whether multiple audio tracks can be discovered and selected correctly.

**Subtitles**
- Number of subtitle tracks.
- Language and format, including embedded and external subtitles.
- Subtitle URL or extraction mechanism.
- Whether subtitles are exposed through standard formats or provider-specific structures.

**Resolution and Quality Variants**
- Available resolution variants, such as 360p, 480p, 720p, 1080p, and higher resolutions when supported.
- Whether variants are separate files, separate source URLs, or representations within adaptive streaming manifests.
- Whether the application receives and displays quality information correctly.
- Whether source selection and playback preserve the selected quality where supported.

**Additional Source Metadata**
- File size, duration, MIME type, response headers, authentication requirements, and expiration information when available.
- Redirect behavior, HTTP range support, and content delivery characteristics.
- Referer, cookies, authorization headers, or other request requirements.
- Provider-specific metadata required by the application's source selection and playback pipeline.

Do not assume every provider supports every capability. Record unsupported or unavailable capabilities accurately rather than marking them as failures.

### 4. Custom and Nonstandard Provider Responses

Some providers use nonstandard response formats or unconventional URL extensions. The validation system must identify these cases instead of relying exclusively on file extensions, MIME types, or standard response conventions.

For example, a provider may return a URL ending in `.jpg` that actually delivers a large video stream rather than an image.

Requirements:

- Compare the URL extension with the actual response headers and content characteristics.
- Use HTTP metadata and partial content inspection where possible to identify the real resource type.
- Detect mismatches between declared content types and actual media resources.
- Identify provider-specific response schemas, custom manifests, wrapped URLs, redirects, and nonstandard stream representations.
- Record how each provider exposes audio, video, subtitles, and quality variants.
- Determine whether the existing application can correctly interpret the response.
- Identify where an adapter, parser, normalization rule, or provider-specific compatibility handler is required.
- Avoid modifying provider behavior or assuming that every unusual response is invalid.

Document the actual response structure and the handling required for each nonstandard case.

### 5. Resource-Efficient and Network-Friendly Testing

The validation system must be designed to avoid downloading complete movies, episodes, or large media files.

Some sources may represent hundreds of megabytes or several gigabytes. Downloading entire streams during compatibility checks would waste bandwidth, increase execution time, and unnecessarily burden providers.

Requirements:

- Prefer lightweight HTTP requests, such as HEAD requests, when the server supports them reliably.
- Use small HTTP Range requests to inspect resource headers, initial bytes, or relevant portions of a media file when supported.
- Inspect HLS playlists, DASH manifests, and other metadata without downloading all media segments.
- Use bounded, minimal probing for codecs, stream counts, resolution, audio tracks, and subtitle information.
- Stop probing once sufficient evidence has been collected.
- Enforce strict byte limits, request timeouts, and per-provider execution limits.
- Avoid downloading complete media files merely to verify source accessibility or metadata.
- If a source requires additional bytes or segments for reliable inspection, fetch only the minimum necessary.
- Record when a server ignores Range requests, rejects metadata requests, or requires a different validation strategy.
- Never automatically fall back to a full media download during validation.
- Ensure temporary files are bounded, cleaned up, and not retained unnecessarily.

A source that cannot be validated through lightweight requests must be marked inconclusive or tested through a controlled alternative. Do not incorrectly classify it as broken solely because the server does not support HEAD or Range requests.

### 6. Validate the Complete CS3 Media Pipeline

Provider validation must extend beyond the provider implementation to verify compatibility with the application's existing source handling and playback architecture.

For each returned source, determine whether the application correctly handles:

1. Provider response parsing.
2. Source normalization and metadata extraction.
3. URL resolution, redirects, headers, and authentication.
4. Media type and format detection.
5. Video, audio, and subtitle stream discovery.
6. Resolution and quality representation.
7. Source selection and compatibility with the appropriate playback engine.
8. Error reporting and fallback behavior when a source cannot be used.

CS3 supports multiple playback engines and format-specific handling. The test runner must identify the relevant engine or engines for each source based on the application's existing routing logic.

Where full playback testing is necessary, use controlled test cases with strict download and execution limits. Do not launch unrestricted playback or download entire media files for every provider.

Clearly distinguish the following outcomes:

- Provider request successful.
- Source URL extracted.
- Source reachable.
- Media metadata detected.
- Required streams identified.
- Compatible with the selected playback engine.
- Playback verified through a controlled test, when performed.

A successful result at one stage must not automatically imply success at subsequent stages.

### 7. Execution Strategy and Scheduling

The system must support a complete developer-triggered audit and smaller targeted validation runs.

**Full audit**
- Enumerate all registered providers and repositories.
- Test each eligible provider individually.
- Record every result and continue after individual failures.
- Produce a consolidated compatibility report.
- Support runs lasting approximately one to three hours or longer when actual provider conditions require it.

**Targeted audit**
- Test a selected provider, repository, provider category, media format, or previously failing compatibility case.
- Allow developers to reproduce specific failures without rerunning the entire catalogue.

**Periodic audit**
- Support occasional or monthly full compatibility checks.
- Allow comparison with previous results to identify regressions, improvements, newly broken providers, and newly supported capabilities.

Do not run an expensive full audit automatically during ordinary application startup. Keep comprehensive validation as an explicit developer or maintenance operation, with any recurring schedule configured separately.

### 8. Logging, Reporting, and Diagnostics

Produce structured, machine-readable results alongside a concise human-readable summary.

For each provider, record:

- Provider and repository identifiers.
- Test timestamp and software version.
- Test stages completed.
- Request duration and response status.
- Source extraction results.
- Observed media formats, codecs, resolutions, audio tracks, subtitle tracks, and other available metadata.
- Relevant response headers and content-type mismatches.
- Playback engine compatibility results.
- Failure stage, error category, and concise diagnostic details.
- Bytes transferred and whether Range requests were honored.
- Retry count and final classification.

Avoid logging sensitive cookies, authorization headers, access tokens, or other credentials. Redact sensitive query parameters and URLs where necessary.

The final report should include:

- Total providers discovered and tested.
- Passed, failed, skipped, unsupported, and inconclusive counts.
- Provider-specific compatibility results.
- Common failure categories and recurring issues.
- Unsupported or nonstandard response mechanisms.
- Providers requiring individual adapters or compatibility fixes.
- Regressions compared with previous runs.
- A prioritized list of issues requiring investigation.

Preserve detailed logs for diagnosis without producing excessively verbose output during routine execution.

### 9. Failure Handling and Reliability

Implement robust handling for unreliable external providers.

- Apply bounded retries with backoff for transient network failures.
- Respect rate limits and avoid excessive concurrent requests.
- Use per-provider timeouts and an overall execution limit.
- Continue the audit after isolated failures.
- Avoid repeatedly testing permanently invalid sources within the same run.
- Distinguish transient failures from repeatable compatibility problems.
- Support cancellation without corrupting stored results or leaving temporary resources behind.
- Record incomplete tests explicitly.
- Make test runs repeatable and safe to rerun.
- Avoid changing provider configurations, user preferences, or production data as a side effect of validation.

Use controlled concurrency where beneficial, while preserving per-provider isolation and respecting external services.

### 10. Implementation and Acceptance Criteria

Before implementation, inspect the existing provider registry, repository management, source extraction services, media probing utilities, playback engine selection, stream normalization logic, and existing tests.

Reuse the application's established architecture and media handling mechanisms. Avoid introducing duplicate provider registries or a separate media detection system that conflicts with the production pipeline.

The implementation is complete when:

1. The runner discovers and individually tests all eligible registered providers and repositories.
2. Every provider receives a clearly classified result, including skipped and inconclusive cases.
3. Source inspection captures available video, audio, subtitle, resolution, and format information.
4. Nonstandard provider responses and URL/content-type mismatches can be identified and reported.
5. Testing avoids full media downloads and enforces strict resource limits.
6. Provider failures do not stop the remaining audit.
7. The report distinguishes source discovery, reachability, metadata detection, engine compatibility, and verified playback.
8. Developers can rerun failed tests or target individual providers.
9. Results can be compared across audit runs to identify regressions.
10. Logs are actionable, structured, and safe from credential exposure.
11. Tests cover malformed responses, expired URLs, HTTP errors, unsupported formats, missing headers, Range request failures, timeouts, and partial metadata.
12. Existing provider functionality, source extraction, playback, and download behavior remains intact.

### Files / References (Optional)

Inspect the existing implementation before identifying the final scope. Relevant areas may include:

- Provider registration and repository management.
- Provider search and source extraction services.
- Source normalization and metadata parsing.
- Media probing and stream inspection utilities.
- Playback engine selection and format compatibility logic.
- HTTP networking, request headers, redirects, and authentication handling.
- Existing provider tests and integration test infrastructure.
- Logging, diagnostics, and test report generation.

Use the current source code as the primary reference for determining supported providers, formats, capabilities, and playback behavior. Validate actual responses rather than assuming that all providers follow the same standards.

**Expected outcome:** A repeatable, resource-efficient compatibility audit that provides reliable evidence of what every supported provider returns, how CS3 interprets it, which playback capabilities work, and where provider-specific compatibility fixes are needed.