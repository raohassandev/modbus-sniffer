# WP-15 acceptance invariants

- source Register Lab identity and values survive generation;
- definitions, confidence and evidence provenance are retained;
- generated models are drafts and never auto-start;
- writable simulator areas default to disabled;
- generated Simulator servers require a distinct explicit approval before start;
- removing a twin never tears down a running server silently;
- automation writes cannot bypass confirmation or server-side write safety.
