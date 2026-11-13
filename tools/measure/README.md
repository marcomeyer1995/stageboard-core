# measure - click/track offset, crosstalk, silence after unplugging

For the acceptance measurements of #742 (the sound follows the map): the tablet plays the
Rig-Check song (System → Rig-Check, quick run: click 1000/1500 Hz from the app, track = beeps
300-840 Hz on every beat plus drums). Its headphone jack goes through a Y cable into inputs 1 (L)
and 2 (R) of an audio interface on the laptop (tested with a UMC204HD).

Python with numpy - the stem separation's venv has it: `P=~/stageboard-data/stems/venv/bin/python`.
First `$P tools/measure/measure_out.py selftest` → `SELFTEST OK` (builds the real Rig-Check track
from the app's code and checks the analysis against known offsets and crosstalk).

Start every recording 1-2 s **before** Play - that stretch is the noise floor. Input level so the
click peaks around -12 dBFS.

1. **Offset** (click on L, track on R, both playing):
   `$P tools/measure/measure_out.py rec v-dev.wav --secs 45` → `... analyze v-dev.wav`.
   Median and spread; positive = the track comes later. Known detection bias +0.5 ms.
2. **Crosstalk**, two passes (take the other source out of the matrix):
   only click on L → `rec x-click.wav`; only track on R → `rec x-track.wav`;
   `... crosstalk x-click.wav x-track.wav` → target < -60 dB. In one pass the track's hi-hats
   mask the click, hence two.
3. **Unplugging** (laptop microphone, click + track playing, pull the plug at ~10 s):
   `... rec z.wav --secs 25 --device hw:1,0` → `... unplug z.wav --at <second of unplugging>`.
   OK = nothing above the noise afterwards.
