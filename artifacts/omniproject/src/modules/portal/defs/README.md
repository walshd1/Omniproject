# portal · defs

JSON definitions owned by the **portal** module — any client-portal-specific screens, mappings, or
primitives — live here, co-located with the code that renders them. The folder name mirrors the module
name so a def's home is unambiguous from its path alone.

Note: `lib/portal` (the portal/guest data hooks) intentionally stays in the shared `src/lib/` core, not
here, because the settings guest-invite panel also depends on it — only the portal *page* lives here.
