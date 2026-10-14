---
type: "Todo"
title: "Todo CloudStream #3"
tags: [Todo]
---

- [ ] Get the movie/media from imdb id/url fetch find the correct item and do the auto smart search of the content

- [ ] When user selected item did not work or find any sources, we should move to the next item of results, in results there are many providers responded with sources so we shoul have some workaroun, cureently we have only one way whcih is seach all sources/providers. Make sure that we should some good techniques and methods to get the right and genuine content most of the time, increase the success ratio

- [ ] Do not bloat our results with many TORRENT results, and we make sure we have listing for more reliable and strong sources (its can be stream amd run any Media)

- [ ] When bun dist or any build is executed, make sure when there is missing or required packages,java binary neccessory tools should be promoted to configure and setup thay should install and configure to make dev experience better and flowless

  ````markdown
  Build Environment and Dependency Readiness

  When "bun dist" or any other build, packaging, or distribution command is executed, the project should automatically verify that the complete build environment is available before starting the build.

  The build process should detect all required dependencies, packages, runtimes, Java binaries, command-line tools, and other build requirements.

  Requirements

  - Automatically detect whether all required dependencies and tools are installed.
  - Validate required versions where the project depends on a specific version.
  - Check Node/Bun, Java, Maven, platform-specific tools, project dependencies, and other required build components.
  - Detect missing or incorrectly configured tools before the build begins.
  - Provide a clear and actionable message identifying exactly what is missing.
  - Where safely possible, automatically install or configure missing dependencies.
  - Do not silently modify the user's environment without appropriate confirmation when administrative privileges or potentially destructive changes are required.
  - If automatic installation is not possible, provide the exact command or steps required to resolve the issue.
  - Re-run the environment checks after installation or configuration to confirm that the required dependency is now available.
  - Avoid allowing the build to proceed only to fail later with an unclear dependency or tool error.
  - Ensure the same validation applies to development, build, packaging, and distribution workflows where applicable.

  The goal is to provide a seamless and frictionless development and build experience where a developer can run the standard build command and the project intelligently handles environment readiness, clearly explains anything that cannot be resolved automatically, and minimizes manual setup wherever possible.

  ---

  mostly we see the issues like
  `Test Result: Extension sidecar (cs3-sidecar.jar) is missing.`

  and
  `The extension runtime is not provisioned. Click "Install Required Components" in Settings to set up automatically.`
  make sure we make truly best developer experience.

  we have some setup and work around but this is not enough and good to go for initial and fresh installation and start-ups
  ````

- [x] Now we should change dir name cs3_windows to relative name since now we support all os linux mac and window, so we should rename it generic and good name for our source code

- [ ] NSFW content confirmation

  ```markdown
  Adult Content Privacy, Session Confirmation, and Safe Browsing

  Redesign adult/NSFW content access to provide users with clear control over their privacy and browsing experience across the entire application.

  1. Adult Content Confirmation on Application Launch

  Whenever the application launches, ask the user to confirm whether adult/NSFW content should be enabled for the current session.

  The prompt should clearly explain that enabling adult content may expose NSFW titles, posters, metadata, and search results throughout the application.

  Requirements:

  - Present clear Enable Adult Content and Keep Adult Content Disabled options.
  - Include a Do Not Ask Again option so users can choose whether to suppress future confirmation prompts.
  - Keep adult content disabled by default until the user makes a selection.
  - Respect the user's saved preference when the confirmation prompt is suppressed.
  - Allow users to change their preference at any time through Settings and the Extensions screen.
  - Ensure the confirmation state is initialized before displaying potentially sensitive content.
  - Avoid briefly displaying NSFW content while the application restores its previous state or loads data.

  2. Safe Browsing and Blurred NSFW Content

  When adult content requires confirmation or is disabled, sensitive results should not be exposed immediately.

  Use a privacy-first presentation similar to safe-search experiences in mainstream search engines.

  Requirements:

  - Blur or otherwise obscure NSFW posters, thumbnails, and other sensitive visual content when protection is active.
  - Keep sensitive titles and descriptions hidden or appropriately redacted where necessary.
  - Provide a clear indication that sensitive content is hidden.
  - Allow users to reveal individual results only when permitted by their current adult-content preference.
  - Apply the same protection consistently across Home, Search, Detail, Library, History, Downloads, recommendations, and other relevant screens.
  - Ensure NSFW content does not leak through background images, hover cards, previews, or other secondary UI elements.
  - Restore normal presentation immediately when the user explicitly enables adult content.

  3. Session and Preference Management

  Separate the current session's confirmation from the user's long-term preference.

  - If the user has not chosen Do Not Ask Again, request confirmation on every application launch.
  - If the user selects Do Not Ask Again, persist that choice and respect the saved adult-content preference on subsequent launches.
  - If the user has permanently disabled adult content, do not expose NSFW content while waiting for confirmation.
  - Provide a clear way to restore launch-time confirmation through Settings.
  - Do not interpret dismissing the prompt as permission to enable adult content.
  - Ensure that changes apply consistently across all windows and application views.

  4. Acceptance Criteria

  - Adult content remains disabled until explicitly permitted.
  - Launch-time confirmation appears whenever the user has not opted out of repeated prompts.
  - The Do Not Ask Again choice persists across application restarts.
  - NSFW content remains blurred or hidden whenever protection is active.
  - No sensitive content flashes on screen during startup, navigation, or data restoration.
  - The same privacy rules apply throughout the application.
  - Users can change their preferences at any time.
  - Existing repository, provider, search, and playback functionality continues to work without bypassing the privacy rules.

  Implementation principle: Privacy should be enforced before sensitive content is rendered, not merely by hiding it after loading. Users should always understand when adult content is enabled and retain clear control over its visibility throughout CS3.
  ```

- [ ] Searching and fetching are time consuming and takes a while for play/stream make sure we have good amd priority for API reques to external sources

- [x] Dropzone only activated when dropping content is torrent file. Or suppored media othewise dropzone should be quite and silent. Currently its opens up and responding any any content as soon as users drag event detected

  ```markdown
  Dropzone Activation and Drag-and-Drop Behavior

  The dropzone should only activate when the user drags content that CS3 can actually process.

  Currently, the dropzone responds immediately to any drag event, even when the dragged content is unrelated to supported CS3 inputs. This creates unnecessary visual feedback and makes the interface feel intrusive.

  Requirements

  - Keep the dropzone completely quiet and inactive for unsupported drag content.
  - Activate the dropzone only when the dragged content is a supported input.
  - Supported inputs should include torrent files and supported media files or other file types that the application can legitimately process.
  - Detect the dragged content before displaying the dropzone's active state.
  - Do not activate the dropzone merely because a "dragenter" or "dragover" event occurred.
  - Do not show visual overlays, highlights, messages, or other feedback for unsupported content.
  - When supported content is detected, provide the existing dropzone feedback so the user knows the file can be dropped.
  - If the user drags a mixture of supported and unsupported files, only activate the dropzone when there is at least one supported item, while handling unsupported items according to the existing drop workflow.
  - Ensure drag-and-drop detection does not interfere with normal application interactions or browser/Electron drag behavior.
  - Keep the inactive state visually identical to the normal application state.

  The dropzone should behave as a contextual feature rather than a permanent drag-event responder.

  Implementation principle: Detect whether the dragged content is actually supported before activating the dropzone. Unsupported drag events should remain completely silent, while supported torrent and media files should activate the dropzone only when they can be meaningfully processed.
  ```

- [ ] Some time, providers produce multiple links for same media with diff resolutions can we have smart inteligent on that am seeing sometime one media is having all resolutions links in source, can we make something that way we can have this options in our resolution selector but this will not the case with alwyas so we need to have care, and need to have smart logic for that (links and titles may contains 1080, 720 etc

  ```markdown
  ## 99. Intelligent Resolution Detection and Grouping

  Some providers return multiple playable links for the same media at different resolutions, such as 360p, 480p, 720p, and 1080p. In some cases, these links are already available together in the same source list, while in other cases, the provider returns only one resolution or exposes different resolutions through separate source entries.

  Implement an intelligent resolution detection and grouping mechanism so that users can select available resolutions directly from the player's resolution selector whenever the source data supports it.

  ### Requirements

  - Detect resolution information from provider-supplied titles, link labels, filenames, URLs, and available media metadata.
  - Recognize common resolution labels such as 2160p, 1440p, 1080p, 720p, 480p, and 360p, along with equivalent formats such as 4K and Full HD where appropriate.
  - Identify when multiple links represent different resolutions of the same media.
  - Group confirmed resolution variants under a shared media/source identity rather than displaying them as unrelated sources.
  - Populate the resolution selector with the resolutions that are actually available.
  - When only one resolution is available, show the normal source selection and playback experience without introducing unnecessary resolution-selection controls.
  - When multiple resolutions are available, allow the user to switch between them through the existing resolution selector.
  - Preserve the original provider, source, language, audio, and other relevant metadata for each resolution variant.
  - Ensure that selecting a resolution plays the corresponding link rather than accidentally reusing another variant's URL.
  - Respect the existing source selection, playback, caching, and source-expiry mechanisms.

  ### 99.1 Conservative Resolution Detection

  Resolution detection must be intelligent but conservative. A number appearing in a title or URL does not necessarily indicate video resolution.

  For example, `1080p` or `720p` in a source label is useful evidence, while a title containing a year such as `1920` or a number unrelated to video quality must not be interpreted as a resolution.

  Use a confidence-based approach that considers the available evidence:

  - Explicit resolution labels supplied by the provider should receive the highest confidence.
  - Resolution labels in filenames and URLs can be used when their meaning is unambiguous.
  - Media inspection results may be used to verify the actual resolution when available.
  - Ambiguous or conflicting information should not be treated as confirmed resolution data.

  Do not invent a resolution when it cannot be established reliably.

  ### 99.2 Safe Grouping of Resolution Variants

  Only group links when there is sufficient evidence that they represent the same media and playback variant.

  Consider the following when determining whether links belong together:

  - Normalized media title.
  - Season and episode for episodic content.
  - Provider and source identity.
  - Language and audio track information.
  - Release or edition information.
  - Resolution and quality labels.
  - Other available media identifiers and metadata.

  Do not group unrelated titles, different episodes, different edits, or incompatible language variants merely because they share a provider or a similar title.

  Different providers may offer equivalent resolutions for the same media, but their links must not automatically be treated as interchangeable. Preserve provider provenance and the existing source-selection rules.

  ### 99.3 Dynamic Resolution Selector

  The resolution selector should reflect the resolutions that are genuinely available for the currently selected media.

  - Show only verified or sufficiently confident resolution options.
  - Avoid duplicate entries for the same resolution and playback variant.
  - Preserve the association between each option and its actual playable source.
  - Update the available options when sources are refreshed or re-resolved.
  - If a selected link expires or becomes unavailable, use the existing source-refresh and recovery mechanisms without losing the user's intended resolution where possible.
  - If the requested resolution is no longer available, explain this clearly and offer the remaining valid options.

  Do not display a fixed list of resolutions that implies unavailable qualities can be selected.

  ### 99.4 Preserve Normal Playback Behavior

  Resolution grouping must not disrupt the existing playback pipeline.

  When a provider returns a single link, playback should continue exactly as it does today.

  When a provider returns multiple confirmed resolution variants, the application should expose the additional choices without breaking source selection, playback preparation, media inspection, transcoding, downloads, or recovery from expired URLs.

  If grouping is uncertain, retain the existing separate-source behavior rather than risking incorrect playback.

  ### 99.5 Validation and Acceptance Criteria

  - Multiple confirmed resolutions for the same media appear as options in the resolution selector.
  - A single available resolution does not introduce unnecessary controls.
  - Resolution detection works with provider labels, filenames, URLs, and available media metadata.
  - Ambiguous titles and unrelated numeric values are not misclassified as resolutions.
  - Different episodes, languages, editions, and unrelated media are not incorrectly grouped.
  - Every resolution option plays its corresponding source.
  - Source refreshes and expired-link recovery preserve resolution information where possible.
  - Existing playback and download workflows continue to work when grouping is unavailable.
  - Regression tests cover multiple resolutions, single-resolution sources, ambiguous labels, duplicate variants, and incorrect grouping.

  **Implementation principle:** Make resolution selection smarter when the provider supplies enough reliable information, but never sacrifice correct source identification or playback reliability merely to present a unified resolution selector.
  ```

- [ ] My info (Author and UPI info for donations and creating the page for accepting donations

  ```markdown
  ## 100. Developer and Author Information

  The application should provide a dedicated section that introduces the developer and author, explains the project's purpose, and gives users a straightforward way to make contact.

  The application is developed as a free, hobby-driven project. The interface should communicate this clearly while maintaining a professional, polished presentation.

  ### Requirements

  - Display the developer or author information in a dedicated section within Settings.
  - Include the developer's name or preferred public identity.
  - Include a contact email address or another preferred public contact method.
  - Provide links to relevant public developer profiles, the project repository, or a portfolio where available.
  - Allow users to contact the developer for questions, collaboration, service requests, business opportunities, feedback, or other project-related enquiries.
  - Use clickable links for email addresses and external profiles where appropriate.
  - Keep personal information private by displaying only contact details and identities explicitly intended for public use.
  - Make the information easy to discover without overwhelming the Settings interface.

  The information should be configurable so that public developer details can be updated without requiring a redesign of the Settings screen.

  ## 101. Donations and Community Support

  CS3 is free to use and developed as a hobby project. Add a dedicated Donations and Support section near the top of Settings so users who appreciate the application can easily support its continued development.

  The donation experience should be welcoming and unobtrusive. It should communicate that donations are voluntary and help support the time and effort involved in maintaining and improving the project.

  ### Requirements

  - Place the Donations and Support section near the top of Settings, before the other settings categories.
  - Give the section enough visual prominence to make it discoverable without making it feel like an advertisement.
  - Explain briefly that CS3 is free to use and that community support is appreciated.
  - Provide links to established third-party donation platforms, such as Buy Me a Coffee or other suitable services.
  - Allow users to open a donation platform through an external link.
  - Support multiple donation methods where appropriate.
  - Keep donation destinations configurable so the developer can change or add platforms later.
  - Do not require donations to use the application.
  - Do not introduce payment processing infrastructure unless it provides a clear benefit that justifies its complexity.

  ## 102. Dismissible Donation Section

  The donation section should be visible by default, but users must be able to dismiss its prominent presentation if they do not want to see it repeatedly.

  ### Requirements

  - Provide a subtle dismiss control.
  - Persist the dismissal preference in the user's application settings.
  - After dismissal, hide the prominent donation section from the top of Settings.
  - Keep donation access available through a smaller Support or Donations entry elsewhere in Settings.
  - Allow the prominent section to be restored through an appropriate setting or action.
  - Do not repeatedly show the dismissed section after application restarts or updates.
  - Do not confuse dismissing the donation section with disabling donations or removing the developer information.

  The objective is to make donations easy to discover while respecting users who prefer not to see the section every time they open Settings.

  ## 103. Donation Methods and Privacy

  The donation experience should use established third-party payment and donation services wherever practical, rather than requiring the developer to publish personal banking information directly in the application.

  ### Requirements

  - Prefer reputable donation platforms that support creator or project contributions.
  - Support international payment methods through suitable third-party services.
  - Provide a UPI donation option for users in India.
  - Use a donation platform or payment provider that supports the required payment methods and settlement arrangements.
  - Avoid displaying personal bank account numbers, account statements, or unnecessary personal financial information in the application.
  - Do not collect or store payment credentials in CS3.
  - Do not introduce an application-managed payment backend unless it is genuinely necessary.
  - Clearly identify external donation links before users open them.
  - Avoid implying that donations are tax-deductible or that donors receive benefits unless those claims are verified and applicable.

  If UPI is offered, use an explicitly configured public donation destination or a suitable payment provider. Do not assume that a payment method conceals the recipient's identity or personal details. Verify what information the selected service exposes before publishing it.

  ## 104. External Donations Versus In-App Payments

  External donation platforms should be the default implementation.

  An in-app donation flow may be considered only if it can be implemented safely and simply without introducing substantial payment infrastructure, maintenance overhead, or unnecessary complexity.

  ### Preferred approach

  1. Display the Donations and Support section in Settings.
  2. Show the available donation methods.
  3. Let the user select a preferred method.
  4. Open the corresponding external donation or payment destination.
  5. Keep the donation process outside CS3 unless a simple, secure in-app option offers a clear advantage.

  The application should not handle payment card details, bank credentials, or other sensitive financial information directly.

  ## 105. Developer Information and Donations Integration

  Developer information and donations should be presented as related but distinct sections within Settings.

  The Donations and Support section should appear first, followed by the developer or author information.

  The developer section should remain available even when the donation section has been dismissed.

  Recommended structure:

  1. **Support CS3:** A concise explanation, donation methods, and a dismiss control for the prominent presentation.
  2. **About the Developer:** Public identity, contact information, project links, and relevant professional or collaboration links.

  Both sections should use the same design system and feel like native parts of Settings rather than unrelated external additions.

  ## 106. Configurable Public Information

  Developer details and donation destinations should be maintained through a clear, centralized configuration rather than being scattered throughout UI components.

  The configuration should support:

  - Public developer or author identity.
  - Contact email.
  - Public profile and project links.
  - Donation platform links.
  - UPI donation destination.
  - Optional short descriptions for donation methods.

  Missing optional information should be handled gracefully. For example, if a donation platform has not been configured, its option should not be displayed as an active destination.

  Do not invent contact details, payment destinations, developer identities, or public links. Use only information explicitly provided or verified for publication.

  ## 107. Acceptance Criteria

  - Developer and author information is accessible through Settings.
  - Users can easily find public contact information and project links.
  - Donations appear prominently near the top of Settings by default.
  - Users can dismiss the prominent donation section.
  - The dismissal preference persists across application restarts and updates.
  - Donation access remains available after the prominent section is dismissed.
  - External donation platforms can be configured without redesigning the UI.
  - An appropriate UPI option can be provided for Indian users.
  - No personal banking details are hardcoded into the application.
  - No unnecessary payment-processing infrastructure is introduced.
  - Developer information remains available independently of the donation section's visibility.
  - The interface remains calm, professional, and consistent with the rest of CS3.

  **Implementation principle:** Make it easy for users to discover the people behind CS3 and voluntarily support the project, while protecting personal information, respecting user preferences, and keeping the application free and straightforward to use.
  ```

- [ ] Bug Fixes ( Streaming buffer sometime shows wrong buffer when user jumps the timeline on in-app player that buffer get wrong data. it should be display accurate and correct buffer cached content on timeline. Shift + Right/Left arrow +-3 move. do not display large notifications/snakbars on volume up/down it should calm and not attention catching, if do not display multiple notifications in app player it should display one popover/snag but intelligently contains information for multiple attempt and redistricted key events for volume /jumps in time etc.

  ```markdown
  ## 108. Player Buffer Accuracy and Timeline Seeking

  Fix the in-app player's buffering indicator, which sometimes displays incorrect buffered content after the user seeks to another position on the timeline.

  The player must accurately represent the media ranges that are currently buffered and available for playback, even after repeated forward and backward seeks.

  ### Requirements

  - Display the actual buffered ranges reported by the active playback engine.
  - Update the buffer visualization when the user seeks to a different timeline position.
  - Recalculate or refresh the displayed buffered ranges when the underlying media buffer changes.
  - Handle multiple buffered ranges correctly rather than assuming all buffered content forms one continuous range.
  - Do not display stale buffer data from the previous playback position.
  - Keep the buffered-content indicator synchronized with the actual playback timeline.
  - Handle source changes, playback recovery, and media reloads without retaining obsolete buffer information.
  - Ensure the buffer visualization remains accurate during repeated and rapid seeking.

  The buffered indicator must represent actual buffered media, not an estimated range based only on the current playback position or the last known buffer state.

  ## 109. Keyboard Shortcuts for Timeline Seeking

  Add keyboard shortcuts for precise timeline navigation in the in-app player.

  ### Requirements

  - `Shift + Right Arrow`: Seek forward by 3 seconds.
  - `Shift + Left Arrow`: Seek backward by 3 seconds.
  - Apply the seek relative to the current playback position.
  - Respect the beginning and end of the media timeline.
  - Ensure repeated key presses are handled correctly.
  - Do not interfere with text inputs, editable fields, or other controls where these shortcuts should not apply.
  - Avoid triggering the same seek action more than once for a single key event.

  The shortcuts should integrate with the existing player keyboard controls and use the same seeking logic as the timeline interface.

  ## 110. Subtle Volume and Playback Notifications

  Volume changes and timeline-seeking actions should not generate large, attention-grabbing notifications or repeated snackbars.

  The current notification behavior can become visually noisy when users repeatedly adjust volume or seek through a video.

  Redesign these interactions to use a single, compact, unobtrusive overlay or popover within the player.

  ### Requirements

  - Avoid large snackbars for routine volume adjustments.
  - Avoid displaying a separate notification for every volume or seeking key press.
  - Use a compact player-local indicator for volume changes and timeline seeking.
  - Keep the indicator visually subtle and consistent with the player design.
  - Display useful feedback, such as the current volume level or the resulting playback position.
  - Ensure notifications do not obscure important video content unnecessarily.
  - Do not allow repeated keyboard interactions to create stacked or overlapping notifications.

  ## 111. Intelligent Player Feedback Aggregation

  When users repeatedly press volume or seeking shortcuts, consolidate the feedback into a single notification surface rather than creating multiple notifications.

  For example, if a user presses the volume-up shortcut several times, the same indicator should update to reflect the latest volume level. If the user repeatedly seeks forward or backward, the indicator should update to reflect the resulting playback position.

  ### Requirements

  - Reuse a single player-local feedback component for related keyboard interactions.
  - Update the existing indicator when another relevant action occurs.
  - Reflect the latest state rather than showing outdated intermediate values.
  - Handle rapid repeated key presses without creating notification queues.
  - Support volume adjustments, forward/backward seeking, and other relevant player keyboard actions where appropriate.
  - Keep feedback visible long enough to be useful without permanently occupying the player.
  - Ensure that the displayed values correspond to the actual player state.
  - Avoid unnecessary animation, layout shifts, or visual interruptions.

  The feedback mechanism should be state-aware and event-driven rather than creating an independent notification for every input event.

  ## 112. Acceptance Criteria

  - Buffered ranges remain accurate after forward and backward seeking.
  - Stale buffer information is not displayed after seeking, changing sources, or reloading media.
  - `Shift + Right Arrow` seeks forward by 3 seconds.
  - `Shift + Left Arrow` seeks backward by 3 seconds.
  - Repeated keyboard interactions produce the correct playback position and volume.
  - Volume adjustments do not trigger large, attention-grabbing snackbars.
  - Repeated volume or seeking actions update a single compact indicator instead of stacking notifications.
  - Feedback reflects the latest actual player state.
  - Existing playback controls and keyboard shortcuts continue to work correctly.

  **Implementation principle:** Keep playback feedback accurate and immediately understandable while making routine player interactions quiet, responsive, and unobtrusive.

  ---

  On DetailView screen `ESC` should be registred as back navigation.
  ```

- [ ] On src/views/SearchView.tsx:253:14 When there is not search attempt we display `Nothing found` which is not good and correct UI, we need to display more relatable and Better UX/UI

- [ ] We need to improve in player control The subtitle Control and Quality and language control be supposed to have a centred currently we Placed all the controllers on the two places on the very left and very right of the bottom below the timeline so subtitle and the language Control can be moved on to the centre with just like currently has Netflix Player interface so it's going to be more user intuitive and more relatable controls and the rest of our currently we are having on the right side which is good extra controls and when we have subtitle control on the centre and the selected language we should display heat So if you're watching an Contain and it has a subtitle turned on then we should display the which language it was its English Hindi Ram Neel whatever language is we should Display full The word of that language just like in Netflix display that one and make sure that when because we are fetching the subtitles from the online it has a names with ears and all that meta info of the content so we make sure that we extract only what we needed so F has a multiple English or any language subtitle then we can display 123 that item so make sure that we do not make that subtitle title very long and very large Non intuitive and not good user interface Similarly the language interface where if user is playing any of the language it is supposed to render current language and make sure that also language supposed to render what language is and also we can have We have some same interface for the language as well so current language is rendered on the centre item and it renders as run which audio is played sometime we do not have language it says multiple visualisations so that kind of thing centred That three component just like on Netflix player has one is for subtitle 1 is for regulation and one is for the language so We can have this and it all it makes sure that it is supposed to be not acquired or take whole all the bottom if the risk providers provide with very large Label or text so we said we make sure that we have smart something that only XI what we need and that rendered on that player native on the central

  ```markdown
  ## 113. Player Control Bar Redesign: Subtitles, Quality, and Audio Language

  Redesign the in-app player's bottom control bar to make subtitle, video quality, and audio language controls easier to discover and use.

  Currently, these controls are split between the far left and far right of the control bar below the timeline. Move them into a dedicated, centered group inspired by the familiar layout used by Netflix and other modern streaming players.

  ### 113.1 Centered Control Group

  Position the following three controls together in the center of the player control bar, below the timeline:

  1. **Subtitles:** Display the current subtitle state and selected subtitle language.
  2. **Quality:** Display the current video resolution or quality.
  3. **Audio Language:** Display the currently active audio language or track.

  Keep the existing additional playback controls on the right side where appropriate. Preserve the current player functionality while reorganizing the layout into a more intuitive hierarchy.

  Requirements:

  - Align the three controls consistently in the center of the control bar.
  - Use compact, recognizable controls that fit naturally into the existing player design.
  - Keep the controls visually balanced and appropriately spaced.
  - Maintain responsive behavior across supported window sizes.
  - Avoid allowing the centered group to overlap the timeline, playback controls, or right-side actions.
  - Ensure the layout remains usable in full-screen and windowed playback.

  ### 113.2 Display the Currently Selected Subtitle Language

  When subtitles are enabled, display the selected language directly on the subtitle control.

  For example, show `English`, `Hindi`, or the appropriate full language name rather than a generic subtitle icon alone.

  Requirements:

  - Display the full, human-readable language name whenever space permits.
  - Clearly distinguish enabled subtitles from subtitles that are disabled.
  - When subtitles are disabled, show a suitable state such as `Off`.
  - When the language cannot be determined reliably, use a neutral fallback such as `Unknown`.
  - Keep the label synchronized with the currently active subtitle track.
  - Ensure changing subtitle tracks updates the displayed language immediately.

  ### 113.3 Intelligent Subtitle Label Normalization

  Subtitle providers frequently return lengthy track names containing release information, filenames, resolution labels, timestamps, provider names, and other metadata that should not appear in the player control bar.

  Extract and normalize the relevant subtitle information before displaying it.

  For example, a track named:

  `Movie.2026.1080p.WEB-DL.English.Subtitles.ProviderName.srt`

  should display a concise language label such as `English`, not the complete filename.

  Requirements:

  - Prefer explicit language metadata supplied by the subtitle source.
  - Normalize language codes into human-readable language names.
  - Remove irrelevant filename fragments, release metadata, provider labels, and technical details from display labels.
  - Preserve meaningful distinctions such as forced subtitles, SDH/CC subtitles, or other track types when relevant.
  - Do not confuse a release year, resolution, or unrelated text with a language.
  - Use safe fallbacks when the language cannot be determined confidently.
  - Keep the original subtitle metadata intact internally; normalize only the presentation label.

  When multiple subtitle tracks are available in the same language, use concise disambiguation such as `English 1`, `English 2`, or another suitable numbered format. Only add numbering when needed to distinguish multiple tracks.

  Do not create unnecessarily long labels or allow provider-supplied filenames to dominate the control bar.

  ### 113.4 Video Quality Control

  The centered quality control should display the actual quality or resolution of the active video source whenever it is known.

  Examples include `1080p`, `720p`, `4K`, or an appropriate fallback when resolution is unavailable.

  Requirements:

  - Use verified resolution information when available.
  - Prefer actual media inspection results when they are available and reliable.
  - Otherwise, use sufficiently reliable provider-supplied resolution metadata.
  - Keep the displayed quality synchronized with the active source.
  - Update the label when the user switches sources or resolutions.
  - Do not display a resolution that is merely assumed or unavailable.
  - Preserve the existing source selection and intelligent resolution-grouping behavior.

  The quality control should remain compact and consistent with the subtitle and audio language controls.

  ### 113.5 Display the Currently Active Audio Language

  The audio language control should display the language of the currently active audio track or source whenever that information is available.

  For example, show `English`, `Hindi`, or the corresponding language name.

  Requirements:

  - Display the full, human-readable language name when practical.
  - Keep the label synchronized with the active audio track.
  - If the source contains multiple audio tracks, reflect the track actually selected for playback.
  - If the source does not expose separate audio tracks, use reliable source metadata when available.
  - If the audio language is unknown, show a neutral fallback rather than guessing.
  - If multiple audio tracks are available but their languages cannot be determined, use an appropriate label such as `Multiple` only when that accurately describes the available information.
  - Ensure switching audio tracks immediately updates the displayed language.

  Do not display `Multiple` simply because the provider returns several source links. The label must represent actual audio-track information, not the number of available providers or resolutions.

  ### 113.6 Compact and Consistent Presentation

  All three controls must remain compact, regardless of the metadata supplied by providers.

  Requirements:

  - Use normalized display labels rather than raw provider strings.
  - Apply sensible maximum widths and text overflow handling.
  - Avoid wrapping long labels across multiple lines.
  - Keep the control bar height consistent.
  - Use tooltips or accessible labels for additional information when necessary.
  - Ensure icons and text remain legible without making the controls oversized.
  - Maintain consistent typography, spacing, and interaction behavior across all three controls.

  The interface should adapt to available space without allowing long language names or malformed metadata to push other controls out of position.

  ### 113.7 Acceptance Criteria

  - Subtitle, quality, and audio language controls appear together in the center of the bottom control bar.
  - Existing right-side controls remain accessible and do not overlap the centered group.
  - The active subtitle language is displayed correctly.
  - The active audio language is displayed correctly when known.
  - The displayed quality reflects the actual active source when reliable information is available.
  - Long subtitle filenames and provider metadata are normalized into concise labels.
  - Multiple subtitle tracks in the same language can be distinguished without excessively long labels.
  - Unknown or ambiguous metadata does not produce misleading labels.
  - Labels update immediately when the user changes tracks, quality, or sources.
  - The layout remains usable in full-screen and windowed playback.

  **Implementation principle:** Make the player feel familiar and intuitive by centering subtitle, video quality, and audio language controls, while displaying concise, accurate information derived from the active playback state rather than unprocessed provider metadata.

  ## 114. Subtitle Selection and Management UX Redesign

  Redesign the subtitle interface to make subtitle activation, selection, searching, and configuration immediately understandable.

  Currently, the subtitle controls are not sufficiently discoverable, and users have to search for the appropriate control to enable, disable, or change subtitles. The experience should follow familiar streaming-player conventions while providing a more polished and efficient interface.

  The redesign should complement the previously defined centered player controls and subtitle-language labels. The centered subtitle control will provide quick access to common actions, while the existing subtitle sidebar will remain the dedicated interface for searching, discovering, and managing subtitle tracks.

  ### 114.1 Quick Subtitle Selection in the Player

  The centered subtitle control should provide an intuitive, immediately accessible way to enable, disable, and switch subtitles without requiring users to open the sidebar.

  Requirements:

  - Make the subtitle control easy to recognize and locate.
  - Display the currently selected subtitle language directly on the control.
  - Clearly communicate when subtitles are enabled or disabled.
  - Allow users to turn subtitles off with a single interaction.
  - Present available subtitle tracks in a compact, easy-to-scan selection menu.
  - Use concise, normalized language labels such as `English`, `Hindi`, or `Tamil`.
  - Distinguish multiple tracks in the same language using compact labels such as `English 1`, `English 2`, and `English 3` when necessary.
  - Update the active selection and displayed language immediately when the user selects a track.
  - Avoid requiring users to open the subtitle sidebar for routine subtitle changes.

  The quick-selection experience should feel familiar to users of mainstream streaming platforms.

  ### 114.2 Dedicated Subtitle Sidebar

  Retain and redesign the subtitle sidebar as the comprehensive subtitle discovery and management interface.

  The sidebar should open when users want to search for subtitles, explore all available tracks, or access additional subtitle options.

  Requirements:

  - Provide a clearly identifiable entry point from the player.
  - Organize available subtitle tracks in a clean, searchable list.
  - Make the currently active subtitle track visually obvious.
  - Provide an immediately accessible `Off` option.
  - Allow users to search for and discover subtitles through the existing subtitle search functionality.
  - Keep subtitle selection, search, and related configuration controls logically grouped.
  - Show loading, empty, error, and successful-search states clearly.
  - Preserve the current playback position when the sidebar opens or closes.
  - Avoid unnecessary navigation away from the player.
  - Keep the interface usable with long subtitle lists and multiple tracks in the same language.

  The sidebar should complement quick selection rather than duplicate it unnecessarily.

  ### 114.3 Clear Subtitle Enable and Disable Controls

  The ability to turn subtitles off must be obvious and must not be buried among subtitle tracks or configuration options.

  Requirements:

  - Display `Off` as a clearly identifiable selection option.
  - Make the active state visually distinguishable from inactive tracks.
  - Ensure users can disable subtitles without navigating through multiple panels.
  - Keep the selected subtitle track and subtitle-enabled state synchronized.
  - When subtitles are disabled, update the centered control to reflect that state.
  - Reopening the sidebar should accurately reflect the current selection.
  - Avoid ambiguous icons or controls that require users to guess whether subtitles are enabled.

  ### 114.4 Subtitle Track Labels and Metadata Normalization

  Subtitle providers may return long filenames or titles containing release names, resolution information, years, provider identifiers, language codes, and other technical metadata.

  Do not display these raw values directly in the player controls or subtitle list when a concise representative label can be derived.

  For example, a subtitle filename such as:

  `Movie.2026.1080p.WEB-DL.English.Subtitles.ProviderName.srt`

  should display a concise label such as `English`.

  Requirements:

  - Prefer explicit language metadata supplied by the subtitle source.
  - Convert recognizable language codes into human-readable language names.
  - Extract the language and other genuinely useful identifying information from filenames when structured metadata is unavailable.
  - Remove irrelevant release metadata, resolution information, provider names, file extensions, and redundant text from the display label.
  - Preserve meaningful distinctions such as forced subtitles, SDH/CC tracks, or other relevant subtitle types.
  - Do not mistake years, resolution numbers, or unrelated filename fragments for language identifiers.
  - Use a safe fallback when the language cannot be determined confidently.
  - Preserve the original subtitle metadata internally for identification, diagnostics, and playback.
  - Normalize presentation labels without modifying the actual subtitle source or its identity.

  ### 114.5 Multiple Subtitle Tracks in the Same Language

  When several subtitle tracks use the same language, users must be able to distinguish them without reading excessively long filenames.

  For example:

  - English 1
  - English 2
  - English 3
  - Hindi
  - Tamil

  Requirements:

  - Group or label duplicate-language tracks consistently.
  - Add numbering only when necessary to distinguish tracks.
  - Where useful metadata exists, use concise distinctions such as `English (Forced)` or `English (SDH)` instead of arbitrary numbering.
  - Avoid displaying duplicate entries that represent the same track.
  - Preserve the original track identity so selecting a displayed label always selects the correct subtitle source.
  - Keep the labels short enough to fit comfortably within the player and sidebar.

  ### 114.6 Subtitle Search and Discovery

  The subtitle sidebar should make finding subtitles straightforward, even when many subtitle sources are available.

  Requirements:

  - Provide an accessible search control.
  - Search using the current media's relevant identifiers and metadata where supported.
  - Present results in a consistent, easy-to-scan layout.
  - Show language, relevant track characteristics, and other useful identifying information without exposing unnecessarily long provider titles.
  - Clearly distinguish the currently active subtitle from other available results.
  - Provide straightforward selection and deselection actions.
  - Preserve the existing subtitle download and loading workflows.
  - Provide clear feedback when no subtitles are available or a search fails.

  The interface should minimize unnecessary steps between finding a subtitle and using it.

  ### 114.7 Consistent Subtitle Control Design

  The centered subtitle control, subtitle selection menu, and subtitle sidebar must follow the same design system.

  Requirements:

  - Use consistent typography, spacing, iconography, and interaction states.
  - Make the current subtitle language visible wherever it improves usability.
  - Apply sensible width constraints and text truncation.
  - Prevent long provider-supplied strings from expanding the player control bar.
  - Use tooltips or secondary details for information that does not fit in the primary label.
  - Keep the subtitle sidebar visually consistent with the audio-language and quality-selection interfaces.
  - Ensure the controls remain usable in full-screen and windowed playback.

  ### 114.8 Acceptance Criteria

  - Users can immediately find the subtitle control.
  - Users can enable, disable, or switch subtitles without opening the sidebar.
  - The centered control accurately displays the selected language or `Off`.
  - The subtitle sidebar provides a complete interface for searching and managing tracks.
  - The active track is clearly identifiable.
  - Multiple tracks in the same language are distinguishable.
  - Long provider filenames are converted into concise representative labels.
  - Relevant distinctions such as forced subtitles and SDH/CC are preserved.
  - Subtitle labels remain accurate even when provider metadata is incomplete or ambiguous.
  - Selecting a track activates the correct subtitle source.
  - Opening and closing the sidebar does not interrupt playback or reset the timeline.
  - Existing subtitle search, download, and loading functionality continues to work.

  **Implementation principle:** Provide two complementary experiences: instant subtitle control directly from the player and a comprehensive subtitle-management sidebar for discovery and advanced options. Both should be intuitive, visually consistent, and driven by normalized, meaningful metadata rather than raw provider-supplied titles.

  ## 115. Reliable Audio Track, Subtitle, and Resolution Selection

  Audio language, subtitle language, and video resolution are core playback controls that users may change frequently. These controls must work reliably and consistently across supported providers, playback engines, and external players.

  Although the current implementation generally works, these options are sometimes missing even when the provider or media source supports them. Conduct a thorough cross-check of the complete playback pipeline to identify and resolve these inconsistencies.

  ### 115.1 Accurate Capability Detection

  The application must accurately determine which audio tracks, subtitle tracks, and resolution options are available for the currently selected source.

  - Detect multiple audio tracks and their available language metadata.
  - Detect multiple subtitle tracks and their available language metadata.
  - Detect available video resolutions using reliable source metadata and media inspection where supported.
  - Distinguish actual selectable tracks and resolutions from information merely mentioned in provider titles or filenames.
  - Update the available options when the source changes, playback is refreshed, or media is re-resolved.
  - Avoid displaying selectable options that are not genuinely available.
  - Do not hide valid options simply because one metadata field is missing when other reliable evidence establishes that the option exists.

  ### 115.2 Conditional Control Visibility

  Audio, subtitle, and resolution controls must be displayed according to the capabilities of the active source and playback engine.

  - If multiple audio tracks are available, display the audio selection control.
  - If multiple subtitle tracks are available, display the subtitle selection control.
  - If multiple resolutions are available and supported by the playback pipeline, display the resolution selection control.
  - If only one option exists, avoid unnecessary selection controls unless they provide a useful action, such as enabling or disabling subtitles.
  - If the source or playback engine does not support a particular capability, hide the unsupported control or display an appropriate disabled state where useful.
  - Never hide a supported selection option because of incomplete or incorrectly mapped metadata.

  The application should distinguish between a capability that is unavailable and one that is available but has not yet been detected.

  ### 115.3 Reliable Selection and Playback Integration

  Every displayed option must correspond to the actual track, source, or resolution it represents.

  - Selecting an audio language must activate the correct audio track.
  - Selecting a subtitle language must activate the correct subtitle track.
  - Selecting a resolution must use the corresponding valid source or playback variant.
  - Keep the displayed selection synchronized with the actual playback state.
  - Preserve selections when reopening the relevant menus.
  - Handle source changes and playback recovery without displaying stale selections.
  - Provide clear feedback when an option becomes unavailable or cannot be activated.
  - Do not report a selection as successful until the playback engine confirms the change or the resulting state can otherwise be verified.

  ### 115.4 Provider and Playback Engine Compatibility

  Cross-check the complete integration across supported providers and playback engines, including the in-app player and external players where applicable.

  Verify that:

  - Provider metadata is correctly translated into the application's internal track and source models.
  - Audio and subtitle track information is preserved through playback preparation.
  - Resolution information remains available throughout source selection and playback.
  - Playback-engine capabilities are correctly detected.
  - Track selections are passed to the correct engine using its supported interfaces.
  - External players receive the appropriate source and playback configuration where supported.
  - Unsupported capabilities are handled gracefully without breaking playback.
  - Switching sources does not incorrectly reuse track identifiers or selections belonging to a previous source.

  Do not assume that every provider or external player supports the same capabilities. Use the actual capabilities of the selected source and engine.

  ### 115.5 Regression Testing and Cross-Checking

  Conduct a systematic review of the current implementation rather than relying only on the observation that it usually works.

  Test scenarios should include:

  - Sources with multiple audio tracks.
  - Sources with multiple subtitle tracks.
  - Sources with multiple available resolutions.
  - Sources supporting all three capabilities.
  - Sources supporting only some capabilities.
  - Sources with incomplete language or resolution metadata.
  - Sources where track information becomes available after playback starts.
  - Source refreshes and expired-link recovery.
  - Switching between providers and playback engines.
  - Reopening selection menus after changing tracks.
  - Playback recovery and media reloads.
  - Cases where a provider advertises a capability that the actual media or playback engine cannot support.

  Fix any identified defects and add regression tests for the underlying causes.

  ### 115.6 Acceptance Criteria

  - Supported audio, subtitle, and resolution options are consistently detected and displayed.
  - Users can reliably select and change available tracks and resolutions.
  - Displayed labels accurately reflect the active playback state.
  - Controls are hidden or disabled appropriately when a capability is genuinely unsupported.
  - Missing metadata does not incorrectly suppress otherwise detectable options.
  - Switching sources does not leave stale or invalid selection states.
  - In-app and external playback behave correctly within their respective capabilities.
  - Existing playback functionality remains stable.
  - Identified defects are resolved and covered by regression tests.

  **Implementation principle:** Treat audio language, subtitle language, and resolution selection as core playback functionality. Every capability supported by the active source and playback engine must be reliably discoverable, correctly represented, and usable. Do not invent unsupported options, but never hide valid options because of integration defects.

  ## 116. Bulk Selection and Item Management in Library, History, and Downloads

  Add a consistent, reliable bulk-selection workflow to the Library, History, and Downloads screens so users can remove a single item or manage multiple items in one operation.

  The selection interface should remain visually subtle and unobtrusive during normal use. Bulk management is an important utility, but it should not compete with the primary purpose of these screens or distract users who are simply browsing their content.

  ### 116.1 Selection and Bulk Actions

  Users must be able to select individual items or multiple items and perform supported actions in a single operation.

  Requirements:

  - Allow users to select an individual item.
  - Allow users to select multiple items.
  - Provide **Select All**, **Invert Selection**, and **Select None** actions.
  - Display the number of selected items when selection mode is active.
  - Provide a clear bulk-action control for removing the selected items.
  - Require confirmation before destructive bulk operations where appropriate.
  - Provide clear success and failure feedback.
  - Handle partial failures without silently losing track of items that were not removed.
  - Prevent duplicate operations caused by repeated clicks.
  - Update the list immediately after successful removal.

  Selection must work reliably even when the list contains many items.

  ### 116.2 Ambient Selection Interface

  Bulk-selection controls should be available without being permanently prominent.

  Requirements:

  - Keep the default screen focused on browsing and managing content.
  - Provide a subtle entry point for selection mode, such as a compact selection icon or contextual menu action.
  - Show selection checkboxes or equivalent selection indicators when selection mode is active.
  - Present bulk actions in a compact contextual toolbar only when relevant.
  - Avoid displaying large, attention-grabbing selection controls when nothing is selected.
  - Keep control dimensions, spacing, typography, and interaction patterns consistent across Library, History, and Downloads.
  - Make selection mode easy to enter, understand, and exit.

  The interface should reveal the required controls when users need them without adding permanent visual clutter.

  ### 116.3 Category-Aware Selection

  The Library includes categorized collections such as **On Hold**, **Watching**, **Dropped**, and other existing library buckets. Bulk selection must work naturally within these categories.

  Requirements:

  - Support selecting items within the currently active category.
  - Make Select All operate on the current filtered or categorized view by default.
  - Make Invert Selection invert the selection within the same scope.
  - Make Select None clear the current selection.
  - Preserve the user's current category, filters, search query, and sorting while selecting or removing items.
  - Ensure category pills and selection controls work together without interfering with each other.
  - Clearly communicate the scope of destructive actions when necessary.

  Do not unexpectedly select items from hidden categories or unrelated filtered results.

  ### 116.4 Consistent Behavior Across Screens

  Implement the same selection interaction model across:

  - **Library:** Remove selected entries and support relevant existing bulk-management actions.
  - **History:** Remove selected history entries.
  - **Downloads:** Remove selected download entries and provide appropriate handling for active downloads.

  The available actions must reflect each screen's actual capabilities and data model. Do not assume that removing a download record, deleting a downloaded file, and cancelling an active download are equivalent operations.

  For Downloads, clearly distinguish between removing an entry from the list, deleting the associated downloaded file, and cancelling an active download. Confirm destructive file deletion where appropriate.

  ### 116.5 State Preservation and Reliability

  The selection workflow must integrate with existing search, filtering, categorization, and navigation behavior.

  Requirements:

  - Avoid losing selections unexpectedly during harmless UI updates.
  - Clear or reconcile selections when items are removed or no longer belong to the active view.
  - Prevent stale selections from targeting the wrong items after sorting, filtering, or list refreshes.
  - Use stable item identities rather than visible list positions.
  - Handle loading, empty, and error states correctly.
  - Keep selection state consistent when the underlying list changes.
  - Restore the normal browsing interface when selection mode is exited.

  ### 116.6 Accessibility and Usability

  - Make selection controls keyboard-accessible.
  - Provide clear selected and unselected states.
  - Ensure actions have understandable labels and accessible names.
  - Keep touch and pointer targets usable without making the interface unnecessarily large.
  - Provide an easy way to cancel selection mode.
  - Avoid relying exclusively on color to communicate selection.

  ### 116.7 Acceptance Criteria

  - Users can select one, several, or all items in the current view.
  - Select All, Invert Selection, and Select None work correctly.
  - Bulk removal operates only on the intended items.
  - Category pills, filters, search, and sorting remain functional during selection.
  - Downloads distinguish between removing entries, deleting files, and cancelling active downloads.
  - Selection controls remain subtle during normal browsing.
  - Bulk actions appear contextually when relevant.
  - Large lists can be managed without excessive manual interaction.
  - The same interaction patterns work consistently across Library, History, and Downloads.

  **Implementation principle:** Make bulk management powerful when needed and nearly invisible when it is not. Users should be able to clean up large collections efficiently without sacrificing the calm, consistent browsing experience of CS3.
  ```

- [x] On the history and library Options what if the user wanted to remove multiple or many or a single item from the list so we need an reliable option so user can do it it's supposed to include select all reverse revert select none and user can select one or multiple items in the single time so they can clean it on the history library or a download section so that control supposed to be silently and ambiently blend in our user they are not primary or any useful for everyone so make sure that is not an attention get attention and make user distract so that is supposed to be an ambiently and very silently minimally blend into the our ux and it is only visible when user look for it So make sure that we design good interface where we have multiple items In a library history downloads and also we have categorised pills like on the library we have on hold watch watching drop plant so that controls workflowlessly in every screen every category very well

  ```markdown

  ```

- [x] Central element for the subtitles resolution and language So we should have And good user interface and relatable designs currently if there were only one resolution is supported like say 1080p Then there is no clicking effect will going to have any effect so we need to have a better user interface that indicated that that is only 1 and there is this is not an clickable element since it is an only 1 resolution or only one language is supported which is currently rendered with correct label so make sure that we have an ui and style that smartly indicate and differentiate between what has more option and clickable item and what is not so we should indicate via the The styles and good user interface And from the subtitle we have very Popular icon for subtitle in youtube Netflix Amazon Prime everywhere uses icon with all the cc so make sure that we adopt as well so we don't invent our app language if there is a widely community and widely accepted in world of related icons and everything make sure that we use that only for easy and Good interface that I already known so user don't have to learn anything extra from our app

  ```markdown
  ## 117. Intelligent Player Controls and Standardized Subtitle Icons

  Refine the centered subtitle, video quality, and audio language controls so users can immediately distinguish between informational indicators and interactive controls.

  Currently, these controls display the correct labels, but their appearance does not always communicate whether additional options are available. For example, when only one resolution, audio language, or subtitle track is available, clicking the control may have no meaningful effect.

  The interface should communicate availability and interactivity through familiar visual conventions rather than requiring users to discover behavior through trial and error.

  ### 117.1 Distinguish Interactive Controls from Informational Indicators

  Determine whether each control has meaningful alternative options before deciding how it should appear.

  - When multiple resolutions are available, display the quality control as an interactive selector.
  - When only one resolution is available, display the current resolution as a subtle, non-interactive indicator.
  - When multiple audio languages or tracks are available, provide an interactive audio selector.
  - When only one audio option is available, display its language as a non-interactive indicator.
  - When multiple subtitle tracks are available, provide an interactive subtitle selector.
  - When subtitles are unavailable, do not present a misleading selector.
  - When subtitles are available but only one track exists, retain an obvious way to enable or disable subtitles where applicable.

  A single available option should not appear clickable if clicking it cannot perform a meaningful action. However, subtitle controls must remain interactive when they support enabling or disabling subtitles, even if only one track is available.

  ### 117.2 Visual Treatment and Interaction States

  Use consistent styling to distinguish selectors from informational indicators.

  **Interactive controls:**

  - Use a recognizable control treatment, such as a subtle background, hover state, or dropdown indicator.
  - Provide appropriate hover, focus, pressed, and keyboard-accessible states.
  - Open the relevant selection menu when activated.
  - Clearly communicate that alternative options are available.

  **Informational indicators:**

  - Use a quieter visual treatment without misleading dropdown indicators or unnecessary hover effects.
  - Display the current resolution or language clearly.
  - Avoid suggesting that the user can change a value when no alternative exists.
  - Maintain visual alignment with the interactive controls.

  The controls should remain visually consistent even when their interaction states differ.

  ### 117.3 Standardized Subtitle and Closed-Caption Iconography

  Use widely recognized subtitle and closed-caption iconography rather than inventing a proprietary visual language.

  Adopt the familiar subtitle/CC symbol commonly used in streaming services and video players, such as YouTube, Netflix, and Amazon Prime Video.

  Requirements:

  - Use a recognizable subtitles or closed-caption icon for the subtitle control.
  - Prefer established icon-library equivalents where available.
  - Keep the icon consistent across the player control bar, subtitle selector, and subtitle sidebar.
  - Use familiar symbols for enabled, disabled, and selected states where appropriate.
  - Ensure icons remain understandable at compact player-control sizes.
  - Provide accessible labels and tooltips so the controls remain clear to screen readers and users unfamiliar with an icon.
  - Avoid introducing unnecessary custom symbols when established conventions already exist.

  Use standardized icons for audio selection, video quality, and other playback controls where suitable.

  ### 117.4 Consistent Player Control Design

  The centered subtitle, quality, and audio language controls should share a common design language.

  - Keep control heights, spacing, typography, and alignment consistent.
  - Display concise, normalized labels.
  - Ensure non-interactive indicators do not visually compete with interactive selectors.
  - Preserve clear visual feedback when the active language or resolution changes.
  - Maintain a responsive layout without overlapping adjacent controls.
  - Keep the existing right-side player controls accessible.

  ### 117.5 Acceptance Criteria

  - Users can immediately identify which controls are interactive.
  - Single-option resolution and audio controls appear as non-interactive indicators.
  - Subtitle controls remain interactive when enabling or disabling subtitles is possible.
  - Multi-option selectors visibly communicate that additional choices are available.
  - Standard subtitle/CC iconography is used consistently.
  - No misleading dropdown indicators or ineffective click interactions remain.
  - Keyboard navigation and accessibility labels work correctly.
  - The interface remains consistent across supported player layouts.

  **Implementation principle:** Use familiar visual conventions and capability-aware controls. Make interactive selectors obvious, informational indicators quiet, and subtitle functionality recognizable through established industry-standard iconography.
  ```

- [ ] When a option to select all and instal all repose trees and provider at all at once so when user had a search and that search has a results then we should select all means that current selection or current search item all and if there were no select on the extension or repository that means all across the repositories supposed to be installed and uninstalled on Extensions Screen, Repos, browse, With this extra option or any controls our existing ui supposed to be not look bloated and button and control Bloated it's supposed to be minimal and very sit on the us so it's only available when user need it otherwise it's hidden from the user interface and It's supposed to be there but only found by when user want it so we need to have it ambiently set that options on that screen

  ```markdown
  ### 118. Context-Aware Bulk Selection and Installation for Extensions and Repositories

  **Objective**

  Provide an efficient way to select and install all relevant extensions, providers, or repositories at once without cluttering the Extensions interface. Bulk actions must adapt to the user's current search, selection, and browsing context, while keeping the default interface minimal and easy to use.

  #### 118.1 Context-Aware Select All

  - When the user searches within the Extensions screen, provide a **Select All** action that selects all items matching the current search and active filters, not every item across the entire application.
  - When no search or filter is active, **Select All** applies to the items in the current view or management scope.
  - Selection must respect the current tab and hierarchy, including Browse, Installed, repository details, and provider or extension lists.
  - Clearly distinguish between selecting all visible or matching results and selecting all eligible items across the current repository or management scope.
  - Do not automatically select every repository, extension, or provider simply because the user has not manually selected an item.

  #### 118.2 Bulk Installation and Repository Management

  - Provide context-aware bulk actions such as **Install Selected**, **Install All**, **Enable Selected**, **Update Selected**, and other applicable actions.
  - Show only actions that are valid for the current items and their states. For example, do not show Install All when no eligible uninstalled items exist.
  - If the user has selected specific items, apply the action only to those selected items.
  - If no explicit selection exists, allow the user to discover bulk actions through a contextual menu or selection-mode control. Do not interpret an empty selection as an unconditional request to install everything.
  - Support bulk installation of eligible extensions and providers across repositories where the existing architecture permits it. Handle repository-level installation separately when a repository must first be added or configured before its contents become available.
  - Exclude items that are already installed, disabled when installation is intended, incompatible, unavailable, or otherwise ineligible from installation actions, as appropriate.
  - When an operation spans multiple repositories, report individual successes and failures without allowing one failed repository or item to interrupt all remaining operations.

  #### 118.3 Minimal, Contextual Controls

  - Keep the default Extensions interface clean, with no permanently visible row of bulk-action buttons.
  - Reveal bulk controls only when they become relevant, such as when the user enters selection mode, selects one or more items, opens a contextual actions menu, or requests additional actions.
  - Prefer a compact overflow menu, contextual toolbar, or similarly unobtrusive pattern that fits the existing design system.
  - Show a concise selection count and the available actions when selection mode is active.
  - Provide an obvious way to exit selection mode and clear the current selection.
  - Avoid duplicate controls, excessive toolbars, large persistent buttons, and unnecessary confirmation dialogs.

  #### 118.4 Selection Scope and State Management

  - Maintain a clear distinction between:
    - All items currently visible.
    - All items matching the current search and filters.
    - All eligible items within the current repository.
    - All eligible items within the current management scope.
  - Make the scope apparent before executing a bulk operation, especially when it extends beyond the visible results.
  - Preserve selection while the user inspects item details or navigates within the same management workflow, where appropriate.
  - Clear or reconcile selections when search results, filters, repository contents, or item eligibility change, so actions cannot unintentionally target stale or hidden items.
  - Use stable item identifiers and prevent duplicate operations on the same extension, provider, or repository.

  #### 118.5 Execution Feedback and Safety

  - Provide unobtrusive progress feedback for bulk operations, including the number of completed, pending, successful, and failed items where practical.
  - Allow cancellation of pending operations when supported, without misrepresenting already completed operations as cancelled.
  - Keep the interface responsive when processing large selections or multiple repositories.
  - Present actionable error details for failed items and allow retrying eligible failures without repeating successful operations unnecessarily.
  - Use confirmation dialogs only for genuinely consequential actions, such as removing repositories or performing destructive operations, rather than routine selection or installation.

  #### 118.6 Acceptance Criteria

  - Users can select all results matching the current search and filters without affecting unrelated items.
  - Users can discover and execute bulk actions without permanent visual clutter.
  - An empty selection never silently triggers installation across every repository.
  - Bulk actions are limited to eligible items and respect their current installation and enablement states.
  - Repository-level and extension-level operations remain distinct wherever the architecture requires it.
  - Large bulk operations provide clear progress, partial-failure handling, and appropriate cancellation behavior.
  - Existing search, filtering, repository navigation, selection, and installation workflows continue to work correctly without duplicated functionality or unnecessary UI complexity.
  ```

##

### 119. Subtitle Selection and Search Experience Redesign

**Objective**

Redesign the subtitle selection workflow to make it simpler, more intuitive, and less visually cluttered, especially for users who are new to CS3. Preserve existing subtitle search, language filtering, metadata, recommendations, and playback functionality while presenting only the information users need to make a selection.

The interface should prioritize subtitle titles, language identification, and quick selection. Additional metadata must remain accessible without being permanently displayed on every result.

#### 119.1 Simplified Subtitle Result Items

- Redesign the subtitle result component to display a concise, readable title as its primary content.
- Show only essential secondary information inline, such as the language and a small language flag where appropriate.
- Remove verbose metadata, provider descriptions, technical details, and other nonessential information from the default result layout.
- Add a subtle information icon to each result when additional metadata is available.
- Clicking or hovering over the information icon should reveal a compact popover containing relevant details, such as the subtitle provider, source, release or episode matching information, format, and other available metadata.
- Display only information supported by the actual result. Do not invent missing metadata or show empty fields.
- Ensure the information popover does not obstruct subtitle selection, overwhelm the interface, or require users to open a separate page.
- Keep subtitle items compact and consistent across original-source subtitles and globally searched results.

#### 119.2 Quick Subtitle Selection from the Player

- Make the subtitle control in the central player interface the primary entry point for subtitle selection.
- When the user clicks or hovers over the subtitle control, expose a compact quick-selection menu with the currently available original-source subtitle tracks.
- Place **Off** as the first item, followed by available subtitle tracks in a sensible order, such as English, Hindi, and other languages.
- Display concise labels and language indicators rather than lengthy technical descriptions.
- Allow users to select a subtitle directly from this menu without opening the full subtitle sidebar.
- Keep the quick-selection menu lightweight and visually consistent with the existing player controls.

#### 119.3 One-Step Subtitle Off Control

- Make disabling subtitles possible directly from the quick-selection menu.
- The **Off** option must be immediately accessible and must not require opening the subtitle panel and locating a separate control at the top of the sidebar.
- Clearly indicate the currently active subtitle track or the Off state.
- When the user selects Off, disable subtitles immediately and update the player control to reflect the new state.
- Keep the Off action available even when only one subtitle track exists.

#### 119.4 Automatic Global Subtitle Search

- If original-source subtitle tracks are available, show them in the quick-selection menu first.
- If no original-source subtitles are available, selecting the subtitle control should open the subtitle panel and automatically start a global subtitle search for the current media.
- Use the current title and, where available, season, episode, release, and other reliable matching metadata to identify relevant subtitle results.
- Do not require users to manually enter the title or initiate the first search when the current media context is already known.
- Show the available results progressively as providers return them, where supported by the existing search architecture.
- Avoid launching duplicate searches when the panel is reopened or when a search for the same media is already running.
- Provide appropriate loading, empty, and error states without filling the panel with unnecessary explanatory text.

#### 119.5 Subtitle Search and Language Filtering

- Provide a simple search field that allows users to search for subtitles by title, episode, release, or other supported search terms.
- Support language-specific subtitle filtering so users can narrow results to languages such as English, Hindi, or other available languages.
- Make language filtering discoverable without introducing a large collection of permanently visible controls.
- Allow users to combine text search and language filtering where supported.
- Clearly distinguish between searching for subtitle results and filtering results that have already been retrieved.
- Preserve the current media context when searching so the user does not need to repeatedly enter the title and episode.
- Ensure language labels and language identifiers are normalized consistently across providers.
- Do not exclude potentially valid subtitles solely because optional language or release metadata is missing. Handle uncertain matches conservatively.

#### 119.6 Subtitle Panel Information Hierarchy

- Redesign the subtitle panel around three primary elements:
  1. A compact search field.
  2. Simple language filtering.
  3. A comprehensive list of available subtitle results.
- Keep advanced controls and detailed metadata out of the primary visual hierarchy unless the user explicitly requests them.
- Avoid repeating the media title, provider information, format details, and matching diagnostics in every result when this information can be accessed through the information popover.
- Ensure the result list uses available space efficiently and remains readable when many subtitles are returned.
- Maintain consistent spacing, typography, icon sizing, and interaction behavior with the rest of the CS3 interface.
- Preserve the panel's existing capabilities unless they are explicitly replaced by this redesign or verified to be redundant.

#### 119.7 Original-Source and Global-Search Results

- Distinguish original-source subtitle tracks from globally discovered subtitles without creating unnecessary visual complexity.
- Prefer original-source tracks in the initial quick-selection menu because they are already associated with the selected playback source.
- When the user opens the full subtitle panel, allow access to the broader set of globally discovered results.
- Ensure globally discovered results are matched to the current title and episode as accurately as available metadata permits.
- Avoid presenting unrelated subtitles as valid matches merely because their titles share a few words.
- Keep provider identity available through a subtle indicator or the information popover rather than rendering verbose provider details on every row.
- Preserve the relationship between each subtitle result and its actual downloadable or selectable resource.

#### 119.8 Subtle Recommended Subtitle Indicator

- Retain the existing recommendation or favorite-style indicator for the subtitle considered the best match for the current media.
- Redesign its appearance so it communicates a recommendation without dominating the list or distracting users from other results.
- Prefer a small, restrained icon or subtle visual treatment rather than a prominent badge, bright background, or strongly highlighted result card.
- Make the recommendation understandable through familiar iconography, a tooltip, or accessible labeling.
- Base recommendations on reliable matching information and existing recommendation logic rather than arbitrary ordering.
- Do not imply that a subtitle is verified or guaranteed to synchronize correctly when the available evidence does not support that claim.
- Ensure recommended and non-recommended results remain equally readable and selectable.

#### 119.9 Accessibility and Interaction Behavior

- Support keyboard navigation and selection throughout the quick menu, search field, language filters, result list, and information popovers.
- Provide accessible labels for subtitle controls, language indicators, recommendation icons, and the Off action.
- Do not rely on hover alone to expose essential information or actions. Equivalent interactions must be available through clicking and keyboard navigation.
- Keep the currently selected subtitle state visually clear without excessive highlighting.
- Ensure popovers and quick menus dismiss appropriately when clicking outside them, while avoiding accidental closure during interaction.
- Preserve responsive behavior and prevent popovers or menus from being clipped by the player, sidebar, or application window.

#### 119.10 Implementation and Compatibility

- Review the existing subtitle panel, result components, player subtitle control, language normalization, search pipeline, and subtitle-selection logic before making changes.
- Reuse existing search and playback services wherever possible rather than implementing duplicate subtitle discovery or selection logic.
- Preserve compatibility with supported playback engines and subtitle formats.
- Ensure selecting a globally discovered subtitle correctly applies or downloads the selected resource through the existing subtitle workflow.
- Keep original-source tracks and globally discovered subtitles distinguishable internally so the correct selection and application logic is used.
- Handle unavailable, expired, invalid, or incompatible subtitle resources gracefully.
- Do not alter unrelated playback, audio-track, or resolution-selection behavior.

#### 119.11 Acceptance Criteria

- Users can select an available subtitle or disable subtitles directly from the player control without opening the full subtitle panel.
- The Off option is always easy to find in the quick-selection menu.
- Original-source subtitle tracks appear first when available.
- When no original-source tracks are available, opening the subtitle control initiates a global search using the current media context.
- Users can search for subtitles and filter results by language.
- Subtitle results display concise titles and essential language information by default.
- Additional provider and technical metadata is available through a compact information popover.
- Recommended subtitles are identifiable without visually overpowering other results.
- Large result lists remain compact, readable, and easy to navigate.
- Existing subtitle search, matching, downloading, selection, and playback functionality remains reliable.
- The redesigned experience reduces visual clutter and the number of interactions required for common subtitle tasks without removing useful capabilities.

### 120. Reliable Metadata Enrichment, Related Content Discovery, and Deduplicated Recommendations [ ]

**Objective**

Improve the accuracy, completeness, and reliability of metadata and related-content discovery across CS3. Existing searches for directors, writers, screenwriters, producers, editors, studios, cast members, and other contributors sometimes return incomplete, irrelevant, or inconsistent results. Investigate the current implementation, strengthen metadata aggregation, integrate suitable public metadata APIs, and introduce useful related-content recommendations.

The goal is to help users discover both **more content connected to what they already enjoy** and **new movies or shows that offer a similar viewing experience**, while preventing duplicate results and incorrect associations.

#### 120.1 Audit Existing Metadata and Related-Content Workflows

- Inspect the current metadata providers, API integrations, search services, enrichment pipeline, related-content components, data models, caching, and existing deduplication logic before implementing changes.
- Identify why searches for directors, screenwriters, producers, writers, editors, studios, cast members, and other contributors sometimes fail or return incomplete or unrelated results.
- Determine whether failures originate from missing source data, incorrect person or title matching, incomplete API responses, unsupported search paths, pagination, inconsistent identifiers, query construction, caching, or UI rendering.
- Verify whether existing related-content features use authoritative relationships, text similarity, genre matching, or other heuristics.
- Reuse and improve existing metadata aggregation and related-content functionality instead of creating duplicate services or parallel implementations.
- Establish a test set covering popular franchises, lesser-known films, television series, shared creators, similar titles, and films with different genres but comparable audience appeal.

#### 120.2 Multi-Source Metadata Enrichment

- Evaluate and integrate additional suitable metadata sources where they improve coverage, accuracy, or reliability.
- Prefer structured APIs with stable identifiers, documented endpoints, clear licensing terms, and predictable response formats.
- Investigate the following sources and capabilities:
  - **The Movie Database (TMDB):** Search, discover, title details, cast and crew credits, people, and related-content endpoints. TMDB supports text search across original, translated, and alternative titles, and can retrieve content through known external identifiers. <Link url="https://developer.themoviedb.org/docs/finding-data" title="TMDB data discovery documentation"/>. <Link url="https://developer.themoviedb.org/docs/getting-started" title="TMDB API getting started"/>.
  - **Wikidata:** Structured relationships between films, people, organizations, and other entities. Its SPARQL query service can supplement missing credits or relationships when queries are sufficiently specific. It should not be treated as a general-purpose fuzzy-search engine. <Link url="https://www.wikidata.org/wiki/Help:Data_access" title="Wikidata data access documentation"/>.
  - **IMDb:** Investigate its official datasets and API options if licensing, access requirements, cost, and permitted usage are appropriate. IMDb provides downloadable non-commercial datasets, while its real-time API is available through AWS Data Exchange with subscription and authentication requirements. <Link url="https://www.imdb.com/interfaces/" title="IMDb non-commercial datasets"/>. <Link url="https://data.imdb.com/documentation/api-documentation/" title="IMDb API documentation"/>.

- Treat these sources as candidates for evaluation, not mandatory integrations. Verify current API capabilities, terms, rate limits, attribution requirements, and commercial-use restrictions before adoption.
- Do not rely on unofficial scraping or undocumented endpoints as a substitute for supported APIs.
- Preserve the ability to add or replace metadata providers without rewriting the entire enrichment pipeline.

#### 120.3 Robust Search for People, Credits, Studios, and Production Companies

- Support searching for media associated with a specific person or organization across all relevant supported roles.
- Normalize role names and map provider-specific credit categories into consistent internal roles, including director, writer, screenwriter, story, producer, executive producer, editor, cinematographer, composer, studio, network, and production company.
- Preserve the distinction between writing credits, directing credits, production credits, and other contributions. Do not treat every person associated with a title as its writer or director.
- Prefer searches based on stable person, company, and title identifiers whenever available.
- When an identifier is unavailable, combine normalized names, original names, known aliases, title identity, release year, media type, and other available evidence.
- Handle alternate spellings, transliterations, localized names, punctuation differences, and common name variations without merging unrelated people or organizations.
- Query all relevant supported sources and paginate results where necessary, subject to reasonable request and latency limits.
- Merge results progressively when practical so users can see useful content before every provider finishes.
- If one source is unavailable or returns incomplete data, continue with the remaining sources and preserve any valid results already obtained.
- Distinguish an empty result set from a provider failure, timeout, rate limit, or incomplete response.

#### 120.4 Canonical Identity, Deduplication, and Conflict Resolution

- Introduce or strengthen a canonical metadata identity model so the same movie, television series, person, studio, or production company is not displayed repeatedly when multiple sources return it.
- Prefer stable external identifiers and provider-specific IDs mapped to a canonical entity.
- When identifiers are unavailable, use conservative matching based on normalized title, original title, release year, media type, season or episode identity, and other relevant metadata.
- Do not merge distinct films or series solely because they share a title, franchise name, cast member, or creator.
- Preserve genuinely different releases, adaptations, remakes, and works with the same or similar names.
- Deduplicate people and organizations using reliable identifiers where available, while retaining legitimate distinctions between people with similar names.
- Merge complementary metadata fields rather than discarding useful information from secondary sources.
- Resolve conflicting values using field-specific source reliability, identifier confidence, completeness, freshness, and provenance. Do not assume that one provider is always authoritative for every field.
- Preserve the source and confidence of merged values internally so incorrect associations can be diagnosed and corrected.
- Apply deduplication consistently before rendering search results, related-content rails, creator filmographies, studio collections, and other aggregated content.
- Make deduplication deterministic so repeated searches produce stable results and do not reorder items arbitrarily.

#### 120.5 Related Content: Two Distinct Discovery Modes

Implement or improve two complementary discovery modes. They serve different user intentions and must not be conflated.

**A. Connected content and franchise discovery**

Find content with an explicit relationship to the selected movie or series, including:

- Sequels and prequels.
- Remakes and adaptations.
- Shared cinematic universes and franchises.
- Related television series, spin-offs, and specials.
- Other entries in an established series or collection.
- Content connected through verified creators, characters, or other meaningful relationships.

For example, a user watching Spider-Man should be able to discover the relevant Spider-Man films and, where reliable relationships exist, other connected Marvel films and series.

Use structured franchise, collection, sequel, prequel, and external relationship data wherever available. Do not infer that two works share a universe simply because they contain a similar character name or genre.

**B. Similar movies and audience-oriented discovery**

Recommend content that may appeal to someone who enjoyed the selected title, even when the recommended content is not part of the same franchise, does not share its genre, and has no common creator.

For example, a user who enjoyed _Green Book_ might appreciate _The Intouchables_ because of similarities in themes, character relationships, emotional tone, and storytelling, even though the films are not part of the same series.

Evaluate available API recommendation and similarity endpoints first. TMDB provides movie and television discovery capabilities, and its documented API includes movie recommendations for user accounts. Investigate the title-based similar-content and recommendation endpoints supported by the current API version rather than assuming account-specific recommendations satisfy this requirement. <Link url="https://developer.themoviedb.org/reference/discover-movie" title="TMDB movie discovery"/>. <Link url="https://developer.themoviedb.org/v4/reference/account-movie-recommendations" title="TMDB account movie recommendations"/>.

If external recommendations are insufficient, evaluate a local ranking layer using available metadata, including:

- Genre and subgenre overlap.
- Plot themes, synopsis similarity, and subject matter.
- Tone, mood, pacing, and storytelling style where these attributes can be derived reliably.
- Character archetypes and relationship dynamics where structured information is available.
- Shared cast, directors, writers, or other creators.
- Audience ratings and popularity, with appropriate safeguards against popularity dominating relevance.
- Franchise and collection relationships, treated separately from general similarity.
- Existing user interactions, such as watch history, completed titles, and explicit favorites, where appropriate and permitted.

Do not claim that a user personally likes a movie merely because it is similar to another title. Present recommendations as suggestions based on available evidence, not guarantees of individual preference.

#### 120.6 Recommendation Ranking and Explainability

- Rank related content by the relevance of its relationship to the selected title and the user's discovery intent.
- Use separate ranking logic or clearly separated groups for franchise-related content and broadly similar recommendations.
- Prioritize strong, verified relationships when displaying chronological or franchise-related content.
- For general recommendations, combine API-provided recommendations with local similarity signals when useful, avoiding duplicate or contradictory results.
- Avoid recommending the same title repeatedly across multiple related-content sections.
- Apply quality thresholds so weak matches are not presented as strong recommendations merely to fill a rail.
- Where useful, show a short, restrained explanation such as "Same director," "Related franchise," "Similar themes," or "Similar audience interests." Only display explanations supported by actual metadata or recommendation signals.
- Avoid excessive badges, verbose explanations, or prominent confidence scores that clutter the detail page.
- If there are insufficient reliable matches, show fewer results rather than padding the interface with unrelated content.

#### 120.7 User Experience and Detail Page Integration

- Integrate improved creator, studio, franchise, and similar-content discovery into the existing detail-page architecture and related-content components.
- Keep existing franchise rails and related-media collections consistent with the new discovery logic.
- Provide clear distinctions between franchise chronology, creator filmography, production-company collections, and general recommendations.
- Preserve the selected title's canonical identity when navigating to related content.
- Ensure selecting a recommendation opens the correct media detail page and retains the correct title, year, media type, and external identifiers.
- Load additional content progressively where possible, while avoiding repeated loading indicators and layout shifts.
- Use cached metadata to display known content promptly while refreshing stale or incomplete information in the background when appropriate.
- Keep the interface useful when some metadata sources are unavailable, no recommendations exist, or a title has incomplete credits.

#### 120.8 API Integration, Performance, and Caching

- Centralize external metadata requests through the existing metadata service architecture.
- Define a provider contract for authentication, request construction, response normalization, pagination, timeouts, retries, rate limits, errors, and source attribution.
- Use bounded parallel requests where appropriate rather than serially waiting for every provider.
- Apply per-provider concurrency limits and request budgets to avoid unnecessary traffic or rate-limit failures.
- Avoid repeating identical requests when multiple screens or components request the same metadata.
- Cache normalized title details, credits, people, company information, franchise relationships, and recommendation results using appropriate cache keys and freshness policies.
- Include canonical entity identifiers, query parameters, locale, and other relevant dimensions in cache keys.
- Distinguish complete responses from partial results and failed requests so transient failures do not become permanent empty-result cache entries.
- Use stale cached metadata when appropriate if an external provider is temporarily unavailable, while allowing refresh when connectivity returns.
- Respect API terms governing caching, storage, attribution, and redistribution.
- Do not expose private API credentials in the renderer, logs, exported diagnostics, or user-visible errors. Follow the existing secure configuration approach for external credentials.

#### 120.9 Testing and Validation

Create automated tests covering the following scenarios:

- A movie with complete credits from multiple providers.
- A movie whose director or screenwriter is missing from one source but available from another.
- A person with multiple film and television credits.
- Different people with identical or similar names.
- Different movies with identical or similar titles.
- Alternate titles, transliterations, and localized titles.
- Duplicate results returned by several metadata providers.
- Conflicting release dates, credit roles, and production-company information.
- API pagination, timeouts, rate limits, malformed responses, and partial provider failures.
- Franchise and chronological relationships.
- Similar movies without shared franchise or creator relationships.
- Movies with incomplete metadata or no meaningful recommendations.
- Repeated searches and navigation between related titles.
- Cache refreshes and recovery after temporary network failures.
- Stable ordering and deduplication across repeated requests.

#### 120.10 Acceptance Criteria

- Creator, crew, and production-company searches return more complete and relevant results across supported sources.
- Missing metadata from one source can be supplemented by another source without duplicating the same entity.
- Different works, people, and organizations are not incorrectly merged.
- Conflicting metadata is resolved using documented, field-specific rules, with provenance retained.
- Users can discover both explicitly connected content and broadly similar movies or shows.
- Franchise chronology and general recommendations remain clearly distinguishable.
- Similar-content recommendations do not require a shared genre, creator, or franchise when other meaningful similarities exist.
- Duplicate titles do not appear repeatedly within or across related-content sections.
- Search and recommendation workflows remain responsive, with graceful degradation when providers fail.
- API usage complies with applicable authentication, licensing, attribution, rate-limit, and caching requirements.
- Existing metadata enrichment, detail-page navigation, search, library identity, and related-content behavior remain functional.

#### 120.11 Research and Implementation Decision

Before selecting integrations, inspect the existing source code and document which required capabilities are already implemented, which are incomplete, and which require new providers or services.

Compare candidate APIs against metadata coverage, related-content quality, stable identifiers, licensing, commercial-use restrictions, request limits, availability, latency, and operational cost. Prefer a small number of complementary, well-supported sources over integrating many unreliable sources.

Implement the highest-value improvements first: correct identity matching, reliable credits retrieval, canonical deduplication, and connected-content discovery. Then add or improve audience-oriented recommendations using documented API capabilities and available metadata.

Do not assume every external API is free, commercially usable, or capable of providing personalized recommendations without user data. Verify these constraints before implementation and document any capability that cannot be delivered reliably with the selected sources.

#

- [ ]

### 121. Reliable Multi-Track Playback, Automatic Player Fallback, and External Player Integration

**Objective**

Investigate and improve CS3's playback pipeline so users can reliably play supported media regardless of resolution, container format, video codec, audio codec, or available language tracks. Some providers supply multiple resolutions and audio languages, but CS3 does not always expose the available choices. Some streams also fail in the native player even though they could be played through the integrated MPV engine or an installed external player.

Review the entire playback pipeline, from provider source discovery and media inspection through track selection, native playback, MPV fallback, external player discovery, and stream handoff. Fix the underlying causes rather than adding isolated workarounds.

The target experience is straightforward: **use the native player when it can reliably play the stream, fall back to the integrated MPV engine when appropriate, and allow users to open compatible streams in supported external players when needed.**

#### 121.1 Audit the Existing Playback Architecture

- Inspect the existing implementation before modifying it, including `playbackSession.ts`, `media/playbackEngine.ts`, `media/decisionEngine.ts`, `media/mediaInspector.ts`, `media/mpvEngine.ts`, `mediaTranscoder.ts`, `mediaProxy.ts`, `contentService`, `IndexerRegistry`, and the source-selection workflow.
- Trace how a provider's source metadata, direct URL, request headers, cookies, subtitle tracks, audio tracks, and resolution information move through the application.
- Identify where valid source capabilities or metadata are lost, normalized incorrectly, cached incompletely, or omitted from the player interface.
- Determine how CS3 currently decides whether to use native playback, Shaka Player, integrated MPV, transcoding, or an external player.
- Verify whether fallback decisions are based on actual media compatibility, declared MIME types, file extensions, codec information, probe results, or overly broad error handling.
- Investigate why some streams fail in the native player but work through the existing download or external playback pipeline.
- Check for incorrect assumptions that a reachable URL is necessarily playable or that an unsuccessful probe necessarily means the stream is unsupported.
- Preserve existing functionality and reuse current playback services rather than introducing competing player-selection logic.

#### 121.2 Reliable Audio Language and Track Detection

- Detect all available audio tracks exposed by the provider, manifest, media container, or supported media inspection tools.
- Normalize language identifiers, language names, track titles, default-track flags, channel layouts, and other relevant metadata.
- Support multiple audio languages within the same media resource when the underlying stream provides them.
- Make the available audio-language selector visible and usable in the player whenever multiple selectable tracks are detected.
- Display understandable labels such as English, Hindi, Japanese, or the appropriate language name, supplemented by useful track information when necessary.
- Identify the currently active audio track and update the player interface immediately after a successful switch.
- Preserve track selection across playback recovery, quality changes, and other supported source transitions when the equivalent track is available.
- Do not present a language selector as actionable when only one audio track exists and no meaningful selection action is possible.
- If language metadata is missing, retain valid tracks and use a neutral label such as "Unknown language" rather than hiding them.
- Distinguish actual embedded or manifest audio tracks from separate provider sources that happen to offer different language versions.

#### 121.3 Resolution Detection and Selection

- Detect available resolutions and quality variants from provider metadata, streaming manifests, adaptive streaming representations, or other reliable source information.
- Support common resolutions, including SD, 720p, 1080p, 1440p, 2160p/4K, and higher resolutions when supported by the source and playback engine.
- Do not hardcode a fixed list that excludes valid resolutions returned by providers.
- Normalize resolution labels and avoid duplicate entries for the same underlying representation.
- Display a quality selector when multiple meaningful quality options are available.
- For adaptive streams, distinguish between automatic quality selection and explicit resolution selection.
- Ensure that selecting a resolution actually changes the active representation or selects the corresponding source, rather than merely updating the displayed label.
- Where a provider returns separate URLs for different qualities, preserve the correct URL, headers, metadata, and source identity for each option.
- Where the stream exposes only one quality option, avoid presenting a nonfunctional selector.
- If resolution information cannot be established reliably, do not invent a resolution based solely on the file extension or an unreliable provider label.

#### 121.4 Track and Quality Selection Must Reflect Actual Capabilities

- Build the player controls from the capabilities actually available for the active media resource and playback engine.
- Distinguish between:
  - Multiple tracks embedded in one media resource.
  - Multiple representations within an adaptive streaming manifest.
  - Multiple provider sources or URLs for different qualities.
  - Separate sources offering different language versions.
- Route each selection to the appropriate playback or source-selection mechanism.
- Do not expose audio or subtitle switching controls that cannot work with the active engine.
- Do not hide valid audio tracks or resolutions simply because optional provider metadata is missing.
- Refresh the available options when the source changes, playback is recovered, or a new media resource is loaded.
- Prevent stale track options from a previous source from appearing after switching titles or providers.
- Keep the existing compact player UI principles: show only useful controls, with clear selected states and no redundant buttons.

#### 121.5 Native Playback and Compatibility Detection

- Determine native playback compatibility using the actual capabilities of the selected engine and available media information.
- Inspect the container, video codec, audio codec, codec profile, resolution, streaming protocol, and other relevant characteristics where available.
- Consider the limitations of Chromium-based playback and the actual capabilities of the configured Shaka Player implementation.
- Distinguish between unsupported codecs, unsupported containers, inaccessible URLs, expired links, missing request headers, network failures, authentication problems, and malformed media.
- Do not classify every native playback error as a format incompatibility.
- Avoid unnecessarily launching another player when a transient network or authentication failure is the actual problem.
- When reliable compatibility information is available before playback, choose an appropriate engine proactively.
- When compatibility is uncertain, attempt playback through the preferred engine and use meaningful failure diagnostics to determine the next step.
- Preserve playback position and relevant session state whenever switching engines is necessary.

#### 121.6 Intelligent Playback Fallback

Implement a predictable fallback strategy that uses the existing player architecture.

1. **Native playback:** Prefer the native player and Shaka Player for streams they can handle reliably.
2. **Integrated MPV:** When native playback cannot support the stream's format, codec, or required playback behavior, attempt playback through the integrated MPV engine when it is available and suitable.
3. **Other supported external players:** If integrated MPV is unavailable or fails for a recoverable compatibility reason, offer or use the next appropriate supported external player according to the user's configured preference.
4. **Actionable failure:** If all suitable engines fail, show a concise error with the underlying failure category and relevant diagnostic information.

- Treat the sequence as capability-driven rather than assuming every failure requires trying every player.
- Do not repeatedly retry the same invalid resource through multiple engines without a reason.
- Preserve the original source URL, required request headers, authentication context, subtitle information, and relevant playback metadata throughout fallback.
- Preserve the playback position as accurately as possible when moving between engines.
- Prevent duplicate playback sessions, overlapping player processes, and stale event handlers during engine transitions.
- Clearly communicate when a fallback occurs without interrupting the user with unnecessary dialogs.

#### 121.7 External Player Discovery and Management

- Detect installed and supported external players on the current operating system.
- Support integrated MPV and discover other compatible installed players, such as VLC, where the existing architecture and platform permit.
- Use platform-appropriate discovery mechanisms for Windows, macOS, and Linux, respecting installation methods and executable locations.
- Do not assume every installation uses a standard path or that a player exists merely because a configuration entry is present.
- Validate the discovered executable and verify that it can be launched with the expected arguments.
- Provide a compact player-selection interface in Settings and, where appropriate, an **Open in external player** action from the playback interface.
- Let users choose their preferred external player when multiple compatible players are available.
- Retain an automatic fallback policy when the preferred player is unavailable or cannot handle the selected stream.
- Offer a way to configure a custom executable path when automatic discovery is insufficient.
- Display useful installation or configuration guidance when no supported external player can be found.
- Never silently switch to an unrelated executable or construct unsafe shell commands from provider-controlled values.

#### 121.8 Reliable Stream Handoff to External Players

- Audit the existing stream handoff and player-launch implementation to determine which source information is currently preserved and which information is lost.
- Pass the correct playable URL or supported local proxy URL to the selected player.
- Preserve required HTTP headers, including `Referer`, `User-Agent`, authorization headers, cookies, and other provider-specific requirements, where supported by the target player's launch interface.
- Account for temporary URLs, signed links, expiring tokens, and source-specific session requirements.
- Preserve relevant subtitle resources and language information when the target player can consume them.
- Do not assume that launching an executable with a URL is sufficient for every streaming protocol or authenticated provider.
- Use a secure, platform-compatible argument-passing mechanism rather than unsafe command-string concatenation.
- Keep provider-controlled URLs and metadata out of shell interpretation contexts.
- Ensure that the application does not expose credentials or authorization headers in logs, error messages, or diagnostic exports.
- If the target player cannot receive a required header or authentication parameter, detect that limitation and use an appropriate supported proxy or show an actionable error rather than launching a predictably unplayable stream.
- Do not route all streams through a proxy unnecessarily. Preserve direct playback when the target player can access the source safely and correctly.

#### 121.9 Player Bridge and Process Lifecycle

- Establish reliable communication between CS3 and supported external players where the target player exposes a usable control interface.
- Reuse existing IPC, playback-session, and process-management infrastructure wherever possible.
- Track player startup, launch failures, process exit, unexpected termination, and playback handoff status.
- Avoid treating a successfully spawned process as proof that playback actually started.
- When the external player exposes suitable capabilities, support playback-state reporting and useful controls such as play, pause, and seek.
- Do not promise track-selection, progress synchronization, or remote-control functionality when a particular external player does not expose the required interface.
- Handle external player closure without crashing the application or corrupting the playback session.
- Prevent orphaned processes and clean up temporary resources and proxy sessions when playback ends.
- Keep native playback and external playback states consistent enough that the application does not incorrectly show a stream as actively playing after the external process has exited.
- Make integration failures diagnosable without requiring users to inspect raw process logs.

#### 121.10 Format and Codec Coverage

- Review supported containers, video codecs, audio codecs, subtitle formats, and streaming protocols across the native, Shaka, integrated MPV, transcoding, and external playback paths.
- Create a capability matrix based on the actual configured builds and runtime capabilities, rather than assuming support based solely on a player's name.
- Include relevant formats such as MP4, WebM, MKV, HLS, DASH, and other formats already supported by the application or its dependencies.
- Consider common video codecs such as H.264, HEVC/H.265, VP9, and AV1, plus relevant audio codecs such as AAC, Opus, AC-3, E-AC-3, and FLAC, subject to the capabilities of each engine and operating system.
- Handle unusual codecs, unsupported profiles, encrypted streams, and hardware-decoding limitations explicitly.
- Use integrated MPV or another compatible playback path when the native engine lacks required capabilities.
- Preserve audio and subtitle selection when the fallback engine supports the corresponding tracks.
- Do not claim universal format support. The objective is broad, reliable compatibility with graceful fallback for unsupported combinations.

#### 121.11 Playback Diagnostics and Failure Recovery

- Record structured, privacy-conscious diagnostics for source resolution, engine selection, compatibility checks, track discovery, player launch, and fallback decisions.
- Distinguish between source-resolution failures, HTTP errors, expired links, unsupported media, decoder failures, player-launch failures, and track-switching failures.
- Reuse existing media inspection and source-recovery logic instead of introducing duplicate probes or retry systems.
- Avoid excessive probing that delays playback or sends unnecessary requests to providers.
- Ensure media inspection preserves required request headers and other source-specific authentication context.
- Treat a failed media probe as inconclusive when the inspection tool cannot access the resource under its actual request requirements.
- Allow recovery to refresh expired source links when appropriate, while preserving the user's intended title, episode, and playback position.
- Do not repeatedly refresh or retry a permanently unsupported resource.
- Surface concise user-facing errors and retain detailed diagnostics for troubleshooting.

#### 121.12 Implementation and Regression Testing

- Trace representative streams through the full pipeline: provider source discovery, metadata normalization, track detection, native playback, failure detection, MPV fallback, and external player handoff.
- Test streams with multiple audio languages, multiple resolutions, adaptive streaming variants, embedded subtitles, separate subtitle resources, and varying container and codec combinations.
- Test sources that require custom headers, signed URLs, cookies, redirects, or temporary authentication.
- Test expired URLs, HTTP 403/404 responses, network interruptions, malformed media, unsupported codecs, missing player installations, invalid executable paths, and external player crashes.
- Verify that the native player remains the preferred path when compatible.
- Verify that an unsupported native format falls back to the integrated MPV engine when available.
- Verify that a configured external player can receive a playable resource with the required request context.
- Test systems with no external players, one external player, and multiple detected players.
- Verify that track selection changes the actual playback track or resource and that the UI reflects the resulting state.
- Verify that playback position, title identity, source provenance, and recovery state survive supported engine transitions.
- Test supported behavior on Windows, macOS, and Linux wherever the project claims platform compatibility.
- Preserve all existing working playback and download flows while fixing the identified issues.

#### 121.13 Acceptance Criteria

- Available audio languages and resolutions are detected and exposed whenever the active source and playback engine support selecting them.
- Selecting a track or quality changes the actual playback configuration, not just the UI.
- The application does not hide valid options because optional metadata is absent.
- Native playback is used when compatible, with intelligent fallback to integrated MPV when necessary.
- Supported external players are discovered, validated, and presented when multiple choices are available.
- External handoff preserves the required stream URL, headers, authentication context, and supported track metadata.
- Player launch failures and stream incompatibilities produce actionable errors rather than silent failures.
- Playback position and relevant session state are preserved during supported fallback transitions.
- Unsupported formats are handled gracefully without endless retries or duplicate playback sessions.
- The application remains responsive and secure throughout player discovery, stream handoff, and fallback.
- Existing source selection, downloading, metadata matching, subtitle handling, and playback recovery continue to work correctly.

#### 121.14 Implementation Principle

Base all changes on the current source code and actual engine capabilities. Identify the root causes of missing track selectors and failed playback before changing the architecture. Prefer small, well-defined improvements to existing services, and avoid duplicate compatibility checks, external-player registries, proxy implementations, or fallback orchestration when equivalent functionality already exists.

The final experience should make supported streams play reliably with minimal user intervention, while providing clear controls for language and resolution selection and a dependable route to integrated MPV or other supported external players when native playback is insufficient.


#

[ ]

### 122. Automatic Cleanup of Obsolete Application-Generated Files and Cache Storage

**Objective**

Implement an automatic storage-management mechanism that identifies and removes old, unnecessary files generated by CS3. Over time, cached media, temporary playback files, obsolete processing artifacts, and other application-generated content can consume significant disk space on the user's system.

The cleanup mechanism must reclaim storage safely without deleting user-owned content, active playback resources, downloaded media that the user intends to keep, or essential application runtimes and configuration.

**Scope clarification:** This requirement concerns locally generated files and stored content, not expired provider source URLs or source-link refresh logic.

#### 122.1 Inventory and Categorize Application-Generated Files

- Audit the existing application storage directories, caches, temporary files, media-processing outputs, proxy artifacts, transcoding outputs, and other files generated during normal application use.
- Identify which services create, read, retain, and delete each category of file.
- Classify files into clear categories:
  - **Temporary files:** Intermediate files created during playback, processing, extraction, or other operations that should not persist after their lifecycle ends.
  - **Disposable caches:** Regenerable metadata, artwork, media inspection results, and other cached content that can be fetched or rebuilt when needed.
  - **Generated media artifacts:** Temporary transcoding outputs, proxy segments, thumbnails, and other application-generated media data.
  - **