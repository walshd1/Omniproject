# settings · defs

JSON definitions owned by the **settings** module — any settings-specific screens, mappings, or
primitives — live here, co-located with the code that renders them. The folder name mirrors the module
name so a def's home is unambiguous from its path alone.

Note: the shared admin-panel cluster (`components/settings/*`) and settings libs stay in the core —
the Configurator and guards depend on them too — so only the settings *hub page* lives in this module.
