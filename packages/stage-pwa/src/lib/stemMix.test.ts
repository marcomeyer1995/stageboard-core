import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetStemMixForTests,
  parseStemMix,
  stemGains,
  stemMixFor,
  useStemMixStore,
} from "./stemMix";

beforeEach(() => {
  localStorage.clear();
  __resetStemMixForTests();
});

describe("stem mix (docs/22 §3)", () => {
  it("mute silences a stem; a solo leaves only the soloed stems", () => {
    const store = useStemMixStore.getState();
    store.setChannel("v1", "drums", { level: 0.5 });
    store.setChannel("v1", "guitar", { muted: true });
    const ids = ["drums", "bass", "guitar"];
    expect([
      ...stemGains(stemMixFor("v1", useStemMixStore.getState().byVariant), ids),
    ]).toEqual([
      ["drums", 0.5],
      ["bass", 1],
      ["guitar", 0],
    ]);
    store.setChannel("v1", "bass", { solo: true });
    store.setChannel("v1", "guitar", { solo: true });
    // A muted solo stays silent.
    expect([
      ...stemGains(stemMixFor("v1", useStemMixStore.getState().byVariant), ids),
    ]).toEqual([
      ["drums", 0],
      ["bass", 1],
      ["guitar", 0],
    ]);
  });

  it("is remembered per song variant on this device", () => {
    useStemMixStore.getState().setOn("v1", true);
    useStemMixStore.getState().setSet("v1", "upload");
    const stored = parseStemMix(
      JSON.parse(localStorage.getItem("sb:stems:mix")!),
    );
    expect(stored.v1).toMatchObject({ on: true, set: "upload" });
    expect(stemMixFor("v2", stored)).toMatchObject({ on: false, set: null });
  });

  it("drops broken stored values", () => {
    expect(
      parseStemMix({
        v1: { on: "yes", stems: { a: { level: 7, muted: 1 } } },
        v2: 3,
      }),
    ).toEqual({
      v1: {
        on: false,
        set: null,
        stems: { a: { level: 1, muted: false, solo: false } },
      },
    });
  });
});
