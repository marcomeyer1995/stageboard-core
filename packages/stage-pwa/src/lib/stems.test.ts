import { describe, expect, it } from "vitest";
import type { TrackMeta } from "shared-types";
import {
  guessStemRole,
  labelFromFileName,
  playableTracks,
  stemLengthsDiffer,
  stemsOf,
  uploadedStems,
} from "./stems";

const track = (id: string, extra: Partial<TrackMeta> = {}): TrackMeta => ({
  id,
  kind: "stem",
  label: id,
  source: "upload",
  parentTrackId: null,
  mimeType: "audio/mpeg",
  addedAt: 0,
  ...extra,
});

describe("stem sets (docs/22 §2)", () => {
  const tracks = [
    track("mix", { kind: "band-mix" }),
    track("drums", { parentTrackId: "mix", source: "stem-separation" }),
    track("keys"),
    track("orphan", { parentTrackId: "removed-track" }),
  ];

  it("splits separated and uploaded stems; stems are never the backing track", () => {
    expect(playableTracks(tracks).map((t) => t.id)).toEqual(["mix"]);
    expect(stemsOf(tracks, "mix").map((t) => t.id)).toEqual(["drums"]);
    // A stem whose track is gone still shows, with the uploaded ones - never invisible.
    expect(uploadedStems(tracks).map((t) => t.id)).toEqual(["keys", "orphan"]);
  });

  it("reports stems of different length", () => {
    expect(
      stemLengthsDiffer([
        track("a", { durationMs: 180_000 }),
        track("b", { durationMs: 180_400 }),
      ]),
    ).toBe(false);
    expect(
      stemLengthsDiffer([
        track("a", { durationMs: 180_000 }),
        track("b", { durationMs: 182_000 }),
      ]),
    ).toBe(true);
    expect(
      stemLengthsDiffer([track("a", { durationMs: 180_000 }), track("b")]),
    ).toBe(false);
  });
});

describe("stems from files", () => {
  it.each([
    ["01_Kick.wav", "drums"],
    ["Bassdrum.wav", "drums"],
    ["Drums.mp3", "drums"],
    ["Bass.wav", "bass"],
    ["Bass Guitar.wav", "bass"],
    ["E-Gitarre links.wav", "guitar"],
    ["Lead Gtr.wav", "guitar"],
    ["Hammond.wav", "keys"],
    ["Synth Pad.wav", "keys"],
    ["Lead Vocals.wav", "vocals"],
    ["Backing Vocals.wav", "choir"],
    ["Chor hoch.wav", "choir"],
    ["Click.wav", "click"],
    ["Didgeridoo.wav", undefined],
  ])("%s → %s", (file, role) => {
    expect(guessStemRole(file)).toBe(role);
  });

  it("names a stem after its file", () => {
    expect(labelFromFileName("03_Hammond Orgel.wav")).toBe("Hammond Orgel");
    expect(labelFromFileName("12 - Chor hoch.mp3")).toBe("Chor hoch");
    expect(labelFromFileName("Bass.flac")).toBe("Bass");
  });
});
