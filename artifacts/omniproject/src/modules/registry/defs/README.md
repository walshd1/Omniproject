# registry · defs

JSON definitions owned by the **registry** module — any registry-specific screens, mappings, or
primitives — live here, co-located with the code that renders them. The folder name mirrors the module
name so a def's home is unambiguous from its path alone.

Note: `lib/registry` (the registry data hooks) intentionally stays in the shared `src/lib/` core, not
here, because the screen renderer depends on it — only the registry *page* lives in this module.
