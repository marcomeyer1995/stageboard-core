import { useEffect, useMemo } from "react";
import { cacheKey } from "./audioCache";
import { resolveTrackForEntry } from "./computeQueue";
import { useAudioOutputLatencyMs } from "./latencyCompensation";
import { setLocalTrackSilenced } from "./localAudioEngine";
import { useShowMode } from "./showMode";
import { loadStems, setStemGains, syncStems, unloadStems } from "./stemEngine";
import { stemGains, stemMixFor, useStemMixStore } from "./stemMix";
import { pickStemSet, stemSetsOf } from "./stems";
import { practiceElapsedMsNow } from "./usePracticeElapsedMs";
import { useLoopTrainerStore } from "../store/useLoopTrainerStore";
import { useStemPlaybackStore } from "../store/useStemPlaybackStore";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

/**
 * Plays the current song's stems instead of its track in Solo practice (docs/22 §3), when they are
 * switched on for this song on this device (stemMix.ts). The track's `<audio>` element keeps
 * running silently - position, track end and everything that follows it stay as they are - and is
 * heard again whenever the stems aren't ready (still loading, failed) or are switched off. Not
 * during a Rehearsal Loop (#61): the loop plays its own copy of the track.
 */
export function useStemPlaybackDriver(): void {
  const { mode, queue, elapsedMs, playbackStatus, trackOverride } =
    useShowMode();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const { currentEntry, currentVariant } = queue;
  const loopActive = useLoopTrainerStore((state) => state.active);
  const settings = stemMixFor(
    currentVariant?.id,
    useStemMixStore((state) => state.byVariant),
  );
  const playingTrack = resolveTrackForEntry(
    currentEntry,
    currentVariant,
    trackOverride,
  );
  const set = useMemo(
    () =>
      currentVariant
        ? pickStemSet(
            stemSetsOf(currentVariant.tracks),
            settings.set,
            playingTrack?.id ?? null,
          )
        : null,
    [currentVariant, settings.set, playingTrack?.id],
  );
  const stemIds = useMemo(() => set?.stems.map((s) => s.id) ?? [], [set]);
  const idsKey = stemIds.join(",");
  const wanted =
    mode === "practice" && settings.on && stemIds.length > 0 && !loopActive;
  const status = useStemPlaybackStore((state) => state.status);

  useEffect(() => {
    if (!wanted || !currentVariant) {
      unloadStems();
      setLocalTrackSilenced(false);
      useStemPlaybackStore.setState({ status: "off", cacheKeys: [] });
      return;
    }
    let cancelled = false;
    useStemPlaybackStore.setState({
      status: "loading",
      cacheKeys: stemIds.map((id) => cacheKey(currentVariant.id, id)),
    });
    void loadStems(currentVariant.id, stemIds).then((ok) => {
      if (cancelled) return;
      setLocalTrackSilenced(ok);
      useStemPlaybackStore.setState({ status: ok ? "ready" : "error" });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, currentVariant?.id, idsKey]);

  useEffect(() => {
    setStemGains(stemGains(settings, stemIds));
  }, [settings, stemIds]);

  // Every frame while playing (`elapsedMs` re-renders this). The engine reads the song time itself,
  // right when it reads the audio clock, shifted like the click and the Gig's Web Audio track so it
  // is heard on the song time.
  const latencyMs = useAudioOutputLatencyMs();
  useEffect(() => {
    if (status !== "ready") return;
    syncStems(() => {
      const now = practiceElapsedMsNow(workspaceId);
      return now === null ? null : now + latencyMs;
    }, playbackStatus === "playing");
  }, [status, elapsedMs, latencyMs, playbackStatus, workspaceId]);

  useEffect(
    () => () => {
      unloadStems();
      setLocalTrackSilenced(false);
    },
    [],
  );
}
