# Project instructions

## Song format

- Use ChordPro as the canonical song format.
- Follow the [official ChordPro documentation](https://www.chordpro.org/chordpro/chordpro-introduction/). Prefer standard directives over custom syntax.
- Preserve unsupported directives during editing and round trips. Use source editing when the visual editor cannot preserve them.
- Document and test the supported subset. Do not claim full ChordPro support until compatibility is verified.

## Expo runtime

- Expo Go compatibility is optional, not a project requirement.
- Use native modules and development builds when they improve the app.
- Do not limit features or UI quality to preserve Expo Go compatibility.
- Use Expo Go for convenient checks when supported. Verify native changes in a development or production build.
