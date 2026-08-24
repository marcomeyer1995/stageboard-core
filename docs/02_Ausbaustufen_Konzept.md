# Hardware-Matrix: Ausbaustufen von StageBoard

StageBoard ist modular aufgebaut. Du entscheidest selbst, wie viel Technik (und Budget) deine Band benötigt. Du kannst jederzeit mit Stufe 1 starten und das System später aufrüsten.

## Übersicht der Ausbaustufen

| Feature | Stufe 1: Solo/Akustik | Stufe 2: Garage Band | Stufe 3: Club Gig | Stufe 4: Cloud | Stufe 5: Arena (Touring) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Kosten (ca.)** | 0 € | ~50–80 € | ~300–500 € | +5 €/Monat (VPS) | 2x Hardware-Kosten |
| **Hardware** | Eigene Tablets / Handys | + Raspberry Pi & WLAN-Router | + Dell Mini-PC, Audio/MIDI-Interface, USV | + Cloud-Server oder Heim-NAS | + Zweiter (identischer) Stage-Server (B-Rig) |
| **Chords & Setlisten lokal** | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja |
| **Bluetooth Fußtaster** | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja |
| **Musician Toolkit (Tuner etc.)** | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja |
| **Band-Sync (Tablet)** | ☐ Nein | ☑ Ja (über lokales WLAN) | ☑ Ja | ☑ Ja | ☑ Ja |
| **Master-Token & Live-Queue** | ☐ Nein | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja |
| **Post-Gig Report (Log)** | ☐ Nein | ☑ Ja | ☑ Ja | ☑ Ja | ☑ Ja |
| **Mehrkanal Audio-Routing** | ☐ Nein | ☑ Nur Stereo-Klinke | ☑ Ja (USB Interface) | ☑ Ja | ☑ Ja (Auto-Failover / Dante) |
| **MIDI Show Control (Hardware)** | ☐ Nein | ☐ Nein | ☑ Ja | ☑ Ja | ☑ Ja |
| **In-Ear "More Me" & Licht** | ☐ Nein | ☐ Nein | ☑ Ja | ☑ Ja | ☑ Ja |
| **Auto-Sync von Zuhause** | ☐ Nein (Manueller Export) | ☐ Nein (Sync erst im Proberaum) | ☐ Nein | ☑ Ja (Globale Cloud) | ☑ Ja |
| **KI Stem-Trennung** | ☑ Nur lokales WebGPU | ☑ Nur lokales WebGPU | ☑ Nur lokales WebGPU | ☑ Ja (Server Queue) | ☑ Ja (Queue) |
| **Backup-Strategie** | Manuell (ZIP Export/Import in PWA) | Auto-Backup auf USB-Stick am Pi | Auto-Sync auf lokales NAS | Vollautomatisch (Cloud-Storage) | Vollautomatisch (Cloud-Storage) |
| **Live-Redundanz (A/B Failover)**| ☐ Nein | ☐ Nein | ☐ Nein | ☐ Nein | ☑ Ja |

---

## Detail-Ansicht der Stufen

### Stufe 1: "Solo / Akustik" (Zero Hardware)
* **Setup:** Die Musiker rufen einfach die PWA (Web-App) von StageBoard auf ihrem iPad/Tablet auf.
* **Wie es funktioniert:** Die App nutzt PouchDB, um alle Songs und Setlists lokal auf dem Gerät zu speichern. Jeder Musiker blättert per Wischgeste oder Bluetooth-Fußtaster selbst um.

### Stufe 2: "Garage Band" (Der schlanke Stage-Server)
* **Setup:** Ein einfacher Raspberry Pi (mit dem StageBoard "Core" Plugin) und ein billiger WLAN-Router.
* **Wie es funktioniert:** Alle Tablets loggen sich in das Band-WLAN ein. Der Pi fungiert als Master-Datenbank. Wechselt der Sänger den Song, wechseln alle Tablets mit.

### Stufe 3: "Club Gig" (Das Pro-Rig)
* **Setup:** Ein robuster Mini-PC (z. B. gebrauchter Dell Optiplex) ersetzt den Pi. Dazu kommen ein USB-Audio-Interface, ein MIDI-Interface und eine USV.
* **Wie es funktioniert:** Vollautomatisierte Show. Audio, Licht und Instrumenten-Sounds werden zeitsynchron vom PC gesteuert.

### Stufe 4: "Cloud & Community" (Maximale Flexibilität)
* **Setup:** Zusätzlich zur Bühnen-Hardware mietet die Band einen kleinen Cloud-Server (VPS) oder nutzt ein Heim-NAS.
* **Wie es funktioniert:** Automatische Sync-Prozesse über das Internet, asynchrones KI-Processing und vollautomatische Off-Site-Backups.

### Stufe 5: "Arena / Touring" (High Availability & Redundanz)
* **Setup:** Die Band nutzt ein "A-Rig" (Main) und ein exaktes Duplikat als "B-Rig" (Backup-Server).
* **Wie es funktioniert:** Beide Server laufen parallel. Stürzt der Main-Server ab, übernimmt das "Redundanz-Plugin" sofort.