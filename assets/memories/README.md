# Memory tunnel

Drop files here and list them in manifest.json. The page reads the manifest at load.

manifest.json shape:
[
  {"file":"bts-01.mp4", "type":"video", "start":0, "secs":6, "caption":"optional, mono, small"},
  {"file":"set-day.jpg", "type":"photo", "caption":""}
]

Rules of thumb
- Videos: H.264 mp4, 720p, no audio track needed (muted anyway), 4 to 10 s each, 12 to 20 clips.
- Photos: jpg, longest side 1600 px, 10 to 30 of them.
- Keep the total under 60 MB or the loader will feel it.
- Nothing here goes live until Kirtan has cleared it (client NDA rules apply).
