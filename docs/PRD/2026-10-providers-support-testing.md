## Provider Compatibility Audit and Comprehensive Media Playback Testing

### Objective

Implement a robust, repeatable, one-by-one compatibility testing system for all providers and repositories supported by the application.

The application currently supports more than 400 providers, along with multiple repositories, video formats, audio formats, resolutions, subtitle tracks, multiple audio streams, and four playback engines. A fix that works for one provider may fail for another because providers can return different response structures, stream types, headers, URL patterns, and media formats.

We need a comprehensive testing mechanism that systematically validates every provider and identifies what each provider returns, how its responses are structured, which playback capabilities it supports, and whether the application can process and play its sources correctly.

The audit may take one to three hours or longer