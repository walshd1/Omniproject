# definitions · defs

JSON definitions owned by the **definitions** module — any definitions-admin-specific screens, mappings,
or primitives — live here, co-located with the code that renders them. The folder name mirrors the
module name so a def's home is unambiguous from its path alone.

Note: the shared def data/policy layers (`lib/defs`, `lib/def-policy`) and shared def components
(`components/defs`) intentionally stay in the core — the whole app renders from them — so only the
definitions *page* lives in this module.
