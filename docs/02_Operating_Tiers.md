# 02 · Operating tiers: what a band needs for what

Rewritten 2026-11-10 (#784). Marco's decision: the three **operating tiers** of docs/25 replace the five hardware "expansion tiers" of the original docs/02 (August 2026, Raspberry Pi → mini PC → cloud → B-rig). That list tied functions to a shopping list; since then the decisions went elsewhere: band sync needs *any* device as host (docs/25), several outputs hang on the device and the stage map (docs/31, #743), failover comes from the map (#752/#753), stems are computed by a helper program where one exists (docs/32). The history of the old tiers is in git.

## 1. The three tiers

The Stage-Server is a **role** ("host"), not a particular computer (docs/25 §2). What a band needs follows from who hosts:

| Tier | Who hosts | What works | Network |
|---|---|---|---|
| **1 Solo** | nobody - one device for itself | everything for one person: practice, prompter, track, click, count-in, announcements, MIDI and footswitches on the device, stage map of one device | none |
| **2 Band host** | one of the band's own devices: a laptop or Windows tablet today, an Android device later (#781) | several devices in sync: shared show, master, band time, pushes, tracks distributed, post-gig report, stage map, add-ons whose helper runs on that host | Wi-Fi at the venue or the host's hotspot |
| **3 Stage-Server** | a dedicated box (Linux) | everything of tier 2, plus the heavy helpers (stem separation, speech synthesis, scraping), USB audio out of the host itself (#25/#743), later host redundancy (#782) | own router/access point |

Moving up a tier is not an export/import: every device already holds the whole band (PouchDB); the data replicates to the new host (docs/25 §2).

Graceful degradation per tier is the same rule as for missing hardware: the host reports what it can do (`GET /server/capabilities`), the app shows what is missing on this tier, widgets of missing capabilities go into the disabled state (CLAUDE.md core principle 2).

## 2. What a function really needs

Functions do not depend on a tier but on three independent things: a **host tier** (1/2/3, from §1), **gear at the spot** (per device, described on the stage map, docs/31) and, for some add-ons, a **helper program** on the host's platform (docs/32 §8).

| Function | Host tier | Gear at the spot | Helper on the host |
|---|---|---|---|
| Chords, setlists, prompter, practice | 1 | - | - |
| Click, count-in, backing track, announcements on this device | 1 | headphones or speaker | - |
| Bluetooth footswitch, MIDI pedal, MIDI controller | 1 | the pedal (docs/23) | - |
| Shared show, master, band time, pushes | 2 | - | - |
| Tracks distributed to all devices | 2 | - | - |
| Post-gig report, rig check | 2 | - | - |
| MIDI cues to Kemper / MG-30 / RC-500 | 1 (2 for several devices) | MIDI or USB cable from the device that is routed on the map | - |
| Mixer scenes/mutes (CQ-18T, Ui24R) | 2 | network to the mixer | - |
| Light/video over OSC (#484/#768) | 2 | network to the desk; UDP from the host | - |
| Click only to the in-ears, track to FOH (#742) | 1 | Y cable or USB interface on the playing device | - |
| Several channels over a USB interface (#743) | 1 | class-compliant USB interface; native engine (docs/30 §8h) | - |
| Stem separation (#766) | 2 | - | Python + Demucs (laptop/box; not on Android) |
| Speech synthesis for new announcements (#767) | 2 | - | Piper (laptop/box); existing clips play everywhere |
| YouTube download (docs/25 §6b) | 1 | - | yt-dlp on a laptop/box, the helper app on Android |
| Ultimate Guitar import (#765) | 2 | - | Chrome (laptop/box) |
| Failover of an output on the same device (#752) | 1 | a second output defined on the map | - |
| Another device takes over playback (#753) | 2 | - | - |
| Host failure during the gig (#782) | 2/3 | - | - |
| Backup to a second medium (#363) | 2/3 | USB disk or NAS path | - |
| Sync from home over the internet | 3 (or a reachable tier-2 host) | - | - |

"Cloud sync", "automatic backup" and "redundancy" are **capabilities of a host**, not tiers of their own: a box has them, a laptop can have them, a tablet host will not.

## 3. Platforms

Which devices can play and which can host is in docs/25 §5 (Windows/Mac: client and host; Android: client, host after the spike #781; iPad: client with limits, no host).

## 4. What this replaces

- The Raspberry Pi tier: a Pi can still run the host software, but it is not a requirement for band sync; a laptop the band already owns does the same (#780).
- The "cloud & community" tier: internet sync is a host capability (§2), not a step a band has to take.
- The "arena / touring" tier with an identical B-rig: redundancy comes from the stage map and the hosts (#752, #753, #782), not from duplicated hardware (docs/20 §6: that is the one thing competitors cannot do).

Related: docs/25 (host tiers and building blocks, tracking issue #777), docs/16 (licence model Free/Band/Box follows the three tiers), docs/31 (gear at the spot), docs/32 (helpers).
