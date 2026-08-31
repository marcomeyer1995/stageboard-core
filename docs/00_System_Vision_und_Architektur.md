# StageBoard: System Vision & Architecture

StageBoard is a Local-First, modular live operating system functioning in two distinct states: a self-sufficient offline sandbox for home preparation, and a distributed hardware mesh powered by a dedicated physical stage server.

## 1. System Vision & Dual-State Architecture

### Home / Solo Sandbox
A standalone offline mode where musicians prepare setlists, edit songs, and practice. Data persists locally in PouchDB and syncs automatically upon reconnecting to the band network.

#### Show & Gig Preparation
* **Catalog Management:** Bandleaders or members can write, edit, and format new songs using the ChordPro data model.
* **Setlist Construction:** Users can build new setlists, reorder entries, and map specific song variants (e.g., assigning the "Acoustic" variant instead of the "Original" default) to specific gigs.
* **Timecode Authoring:** Musicians can manually generate timecodes or use a tap-to-sync feature to lock lyrics, backing tracks, and patch changes to exact milliseconds on the timeline.
* **Live Cue Recording (Dry-Run Listener):** A specialized "listener mode" allowing musicians to perform a dry run of a track while actively making changes on their connected physical hardware (e.g., stomping an effects pedal, adjusting a light controller). The system captures these incoming MIDI/network commands in real-time and automatically injects them into the song's cue list with frame-accurate timestamps for future live playback.
* **Roster Management:** The bandleader can create new Workspaces and add new Profiles (band members and crew) completely offline.

#### Individual Rehearsal
* **Standalone Audio:** The BackingTrackPlayerWidget routes audio directly through the tablet or PC’s local speakers or headphone jack, allowing practice without connecting to the Stage-Server or a mixer.
* **AI Stem Separation & Mixing:** To enhance practice sessions, the system supports AI stem separation. Musicians can isolate, mute, or adjust the volume of specific instruments (e.g., muting the original bass track to play along with the rest of the band).
* **Loop & Speed Trainer:** A dedicated loop player enables musicians to isolate and repeat specific song sections. A "loop trainer" mode can automatically increase the playback tempo with each successive loop, providing a structured way to master difficult passages.
* **Local Tuning:** The TunerWidget utilizes the tablet’s built-in microphone for chromatic tuning, bypassing the need for a stage audio interface.
* **Prompter Practice:** Musicians can rehearse their parts while following the PrompterWidget, testing how the "Smooth Scroll" or "Paginated View" feels at the actual song tempo.

#### UI & Personalization
* **Dashboard Layout:** Users can resize, rearrange, or delete widgets on their personal workspace dashboards offline using the local grid layout.
* **Cosmetic Preferences:** Musicians can swap visual themes (e.g., from "Klassisch" to "Neon Live") and test them under different local lighting conditions.

#### The Reconnection Phase
* **Seamless Merging:** Everything done in the sandbox is saved to the local PouchDB instance. When connected to the Stage-Server, PouchDB quietly syncs all offline edits back to the central CouchDB database, instantly propagating updates to the rest of the band.

### Stage Mesh
The full live experience relies on a dedicated physical Stage-Server (Linux/Docker) running Fastify and CouchDB. This central unit handles low-latency event routing, central database synchronization, and multi-device coordination.

## 2. Onboarding & Network Discovery

* **Server Discovery:** Native apps use mDNS to auto-discover active Stage-Servers. A "Host on this Device" option is explicitly selected by the admin to prevent split-brain networks. Browser users connect via direct IP or QR code scanning.
* **First-Access Gatekeeping:** Joining a workspace requires a printed Access Code or Admin approval. Scanning a QR code bypasses manual typing by embedding the IP, Workspace ID, and token directly.
* **Device Ledger & Revocation:** Every connected device registers its unique clientId. Admins retain full manual control to revoke access rights per device directly from the settings menu without automated token expirations or profile deletions.

## 3. Identity & Preferences

* **Workspaces & Profiles (The Local Layer):** For live stage operations, traditional account creation is bypassed in favor of Workspaces (bands) and Profiles (members). Members tap their profile and enter an optional 4-digit PIN for immediate local access. This ensures zero internet dependency during a gig.
* **Cloud Accounts (The Future Logistics Layer):** While Profiles handle the offline/local mesh, a global "Cloud Account" layer is planned for the future. This will allow musicians to link their local profiles to a global identity for off-stage logistics, such as rehearsal scheduling, gig availability polling, and cross-band song catalog exchange.
* **Session Persistence:** Zustand's persist middleware caches the active session locally, preventing mid-gig lockouts if a tablet reboots or locks its screen.
* **Workspace-Isolated Preferences:** Cosmetic options and dashboard selections use a `byWorkspace` dictionary pattern, allowing musicians playing in multiple bands to switch workspaces while automatically swapping visual themes and personal layouts.

## 4. Hardware Mesh & Precision Execution Engine

To achieve the sub-5ms latency required for professional stage production over local Wi-Fi, the system abandons traditional immediate-execution networking in favor of an NTP-synced, ahead-of-time execution model.

* **Local Hardware Probing:** Tablets run local browser probes (WebMIDI, Web Audio) to detect attached gear (e.g., Kemper via USB) and register these capabilities with the Stage-Server's health monitor.
* **NTP-Style Clock Sync (The Burst Handshake):** Upon connection, tablets execute a rapid 5-10 message "ping-pong" burst with the Fastify server. By measuring round-trip times, the client calculates a highly accurate offset between its local hardware clock and the server's master clock, eliminating network lag from its timekeeping.
* **Ahead-of-Time Dispatch:** The Fastify server never commands a tablet to execute an action "now." Instead, real-time transport commands (Play/Pause, Quick Actions) are bundled with a future targetTimestamp (e.g., Now + 200ms). This buffer ensures all devices receive the packet before execution, completely neutralizing Wi-Fi jitter.
* **Sub-5ms Execution Rules:** The client strictly bans the use of JavaScript `setTimeout` for stage cues.
  * **Audio:** Future timestamps are mapped to the Web Audio API's `audioContext.currentTime` space, allowing the browser's C++ audio thread to trigger backing tracks with sample accuracy (`sourceNode.start(time)`).
  * **MIDI:** Future timestamps are mapped to the local `performance.now()` timeline and handed to the WebMIDI API (`midiOutput.send(data, time)`).
  * **UI:** The PrompterWidget relies on a `requestAnimationFrame` loop mathematically locked to the master ServerTime for perfectly smooth, 60Hz scrolling.
* **Vamping & Transport:** Supports standard pause commands (freezing the audio and timeline) and configurable section looping via Web Audio API nodes (`AudioBufferSourceNode`) for gapless, sample-accurate cyclic playback.

## 5. Hardware Abstraction Layer (HAL) & Auto-Binding

To ensure the show data never breaks when hardware changes between home practice and stage performance, StageBoard strictly decouples logical cues from physical ports.

* **Logical Roles:** Cues in the song database are assigned to abstract roles (e.g., `lead_guitar_fx`, `main_playback`) rather than specific devices or IP addresses. The bandleader defines these roles once for the workspace.
* **Plug, Prompt, and Play UX:** When a musician plugs in a device (e.g., a Kemper via USB), the browser detects it and shows a simple toast notification: "New Device: Kemper. What role should this play?"
* **Auto-Memory:** Once assigned, the tablet caches the hardware ID. The next time that specific gear is plugged into that specific tablet, it binds to its assigned role silently and automatically.

### Conflict Prevention & Technician Override
* **Strict 1-to-1 Mapping:** The system enforces a strict rule where only one device can claim a specific logical role at a time. If a second tablet attempts to claim an active role, the server rejects the claim and throws a clear UI error to prevent duplicate execution (e.g., double audio).
* **Centralized Technician Dashboard:** To manage the chaos of stage setup, the admin settings feature a central "Hardware Routing Matrix". This allows the stage technician to view all active hardware claims across the network in real-time, force-disconnect conflicting hardware, or manually overwrite role assignments remotely.

### Dual Execution Contexts
* **Predefined Timeline Cues (Zero Network Traffic):** Because the database is pre-synced via PouchDB, timeline cues do not travel over the network during a song. As the synced local clock unrolls the timeline, each tablet locally filters the cues. If a tablet holds the `lead_guitar_fx` role, it fires the local USB command when the time arrives. Other tablets safely ignore it.
* **Ad-Hoc / Asynchronous Events:** For unpredictable triggers (e.g., a singer hitting a manual override button), the command routes through the Fastify server. The server checks its active routing table to find which tablet holds the target role and forwards the payload ahead-of-time to that specific device.

## 6. Plugin Architecture & Extensibility

To keep the StageBoard core lean and maintainable, specific hardware integrations (such as Kemper Profilers, Ableton Live Link, or DMX Lighting controllers) are stripped out of the base installation and implemented as modular Plugins.

* **Lean Core Philosophy:** The StageBoard Core strictly handles universal operational mechanics: Time Sync (NTP), State Persistence (PouchDB), Transport Control (Play/Pause), and the Hardware Abstraction Layer (HAL). Plugins act as domain translators that interface with these core engines.
* **Anatomy of a StageBoard Plugin:** A plugin (e.g., `@stageboard/plugin-kemper`) is a self-contained module exposing specific hooks to the core:
  * **Client-Side UI (React):** Custom widgets for the performer dashboard and custom cue editing panels for the Song Editor.
  * **Client-Side Execution (Translator):** Logic translating standardized JSON cue payloads from PouchDB into native browser API calls (WebMIDI, Web Audio, WebSockets).
  * **Server-Side API (Fastify - Optional):** Backend routes when hardware control requires server-level execution or direct serial/network access on the Stage-Server.

### Integration Hooks (The Kemper Example)
* **Hardware Discovery Probe (`StageBoard.HAL.registerProbe`):** Plugins register probe functions with HAL. When a USB device is attached, HAL queries active probes to identify the gear and register its logical capability roles (e.g., `lead_guitar_fx`).
* **Song Authoring Extension (`StageBoard.UI.registerEditorPanel`):** Plugins extend the Song Editor with user-friendly controls (e.g., selecting named rigs instead of typing raw MIDI HEX bytes) and output standard payload envelopes to PouchDB:

```json
{
  "targetRole": "lead_guitar_fx",
  "targetTimestamp": 12345678,
  "pluginId": "kemper",
  "payload": { "rigName": "Clean Chorus", "slot": 3 }
}
```

## 7. Graceful Degradation

* **Local-First Resiliency:** Network drops never crash the UI.
* **Disabled States:** If a backend plugin or hardware node vanishes, affected widgets safely transition into a disabled state to protect the performer's visual muscle memory.