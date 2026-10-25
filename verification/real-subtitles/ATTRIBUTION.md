# Third-party subtitles: Tears of Steel

(CC) Blender Foundation | [mango.blender.org](https://mango.blender.org/)

Subtitle data and the modified subtitle fixtures in this directory are under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/), not the project's MIT code license.

Official source chain: [film download page](https://mango.blender.org/download/) → [subtitle directory](https://download.blender.org/demo/movies/ToS/subtitles/). The [official sharing page](https://mango.blender.org/sharing/) places published project data under CC BY 3.0 unless otherwise indicated. No subtitle-specific exception was found. This is the basis for using these fixtures; no endorsement by Blender Foundation is implied.

Retrieved 2026-10-24; validation completed 2026-10-25 (Asia/Hong_Kong).

| Local file | Source / modifications |
| --- | --- |
| TOS-en.original.srt | [Official English subtitle](https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt), bytes unchanged |
| TOS-CH.original.srt | [Official simplified Chinese subtitle](https://download.blender.org/demo/movies/ToS/subtitles/TOS-CH.srt), bytes unchanged |
| TOS-CH.normalized.srt | Chinese derivative: trim row-edge whitespace, remove excess blank lines, restore standard block separators, add first ID 0 and missing end milliseconds; preserve all 77 subtitle bodies after row-edge trimming |
| TOS-CH.aligned-control.srt | Normalized derivative: remove the additional 4–6 second opening cue; change cue 9 start from 43.000 to 42.200 seconds to form a controlled matching baseline |
| TOS-CH.controlled-problems.srt | Aligned derivative: remove cue 20, shift cue 40 start/end by +500 ms, empty cue 60 body; artificial defects for testing, not defects attributed to the official translation |

The root `copyright.txt` on the movie download server describes the soundtrack, so its BY-ND terms were not used as the subtitle license. No soundtrack or movie video is included here.

`verify.cjs` is original MIT-licensed test code. `results.json` records test results and SHA-256 checksums. Run from any directory with Node.js 18 or newer: `node path/to/verify.cjs`.
