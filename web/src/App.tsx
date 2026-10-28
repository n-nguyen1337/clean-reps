import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "./cloud/account";
import { EXERCISE_KEYS, createExercise } from "./engine/exercises";
import { Speaker } from "./engine/feedback";
import type { SessionRecord } from "./engine/session";
import type { Playback } from "./playback/playback";
import { navigate, useRoute } from "./route";
import { ACHIEVEMENTS, progression, setProgress } from "./store/achievements";
import { deleteSet, saveSet, saveUnlocks, useSets, useUnlocks } from "./store/db";
import { setXp } from "./store/level";
import { previousSet } from "./store/progress";
import { toSessionRecord, toSetRecord, type SetRecord } from "./store/record";
import { acceptDisclaimer, disclaimerAccepted } from "./store/consent";
import { useSettings } from "./store/settings";
import { About } from "./ui/About";
import { AchievementBoard, EarnedInSet, SetProgressPanel } from "./ui/Achievements";
import { Disclaimer } from "./ui/Disclaimer";
import { Home } from "./ui/Home";
import { LiveSession } from "./ui/LiveSession";
import { Progress } from "./ui/Progress";
import { Settings } from "./ui/Settings";
import { Shell } from "./ui/Shell";
import { Summary } from "./ui/Summary";

/** A set in progress or just finished: full screen over the current page, with no URL of its own. */
type Session =
  | { kind: "live"; exercise: string; ending?: boolean }
  | { kind: "summary"; record: SessionRecord; set: SetRecord; playback: Playback | null };

export function App() {
  const configs = useMemo(() => Object.fromEntries(EXERCISE_KEYS.map((k) => [k, createExercise(k).config])), []);
  const speaker = useMemo(() => new Speaker(), []);
  const route = useRoute();
  const [session, setSession] = useState<Session | null>(null);
  const [settings, updateSettings] = useSettings();
  const [picked, setPicked] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(disclaimerAccepted);
  const sets = useSets();
  const unlocks = useUnlocks();
  const account = useAccount();
  const prog = useMemo(() => sets && unlocks && progression(sets, unlocks), [sets, unlocks]);
  // Keep every unlock on the device, so deleting the set that earned it doesn't take it away.
  useEffect(() => {
    if (prog) saveUnlocks(prog.unlocked).catch(() => {});
  }, [prog]);
  const summarySet = session?.kind === "summary" && session.record.reps.length > 0 ? session.set : null;
  const setProg = useMemo(() => summarySet && sets && unlocks && setProgress(sets, summarySet, unlocks),
    [summarySet, sets, unlocks]);
  // Until one is picked, start with the exercise trained last.
  const lastTrained = sets?.[0]?.summary.exercise;
  const exercise = picked ?? (lastTrained && EXERCISE_KEYS.includes(lastTrained) ? lastTrained : EXERCISE_KEYS[0]);

  // The session gets one history entry, so the back button closes it instead of leaving the app.
  const sessionEntry = useRef(false);
  const openSession = (next: Session) => {
    if (!sessionEntry.current) {
      history.pushState({ session: true }, "");
      sessionEntry.current = true;
    }
    setSession(next);
  };
  const closeSession = () => {
    if (sessionEntry.current) history.back(); // the popstate handler closes it
    else setSession(null);
  };
  useEffect(() => {
    const onPop = () => {
      if (!sessionEntry.current) return;
      sessionEntry.current = false;
      // Back during a set ends it as if Finish was tapped, so the camera stops and the set is kept.
      setSession((s) => s?.kind === "live" ? { ...s, ending: true } : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const start = () => {
    speaker.enabled = settings.voice;
    speaker.unlock(); // must happen inside the tap for iOS
    window.scrollTo(0, 0);
    openSession({ kind: "live", exercise });
  };

  if (session?.kind === "live") {
    return <LiveSession exercise={session.exercise} body={settings.body} model={settings.model} speaker={speaker}
      recordVideo={settings.replay} finishNow={session.ending}
      onCancel={() => {
        setSession(null); // nothing to summarise; the popstate that follows finds no live set to end
        closeSession();
      }}
      onDone={(record, playback) => {
        const set = toSetRecord(record);
        if (record.reps.length > 0) saveSet(set).then(account.requestSync).catch(() => {});
        openSession({ kind: "summary", record, set, playback });
      }} />;
  }

  if (session?.kind === "summary") {
    return (
      <Summary record={session.record} previous={sets && previousSet(sets, session.set)} playback={session.playback}
        progress={setProg && <SetProgressPanel progress={setProg} />}>
        <button className="primary" onClick={start}>Go again</button>
        <button className="ghost" onClick={closeSession}>Done</button>
      </Summary>
    );
  }

  const openSet = (set: SetRecord) => navigate({ page: "set", id: set.id });
  let page;
  switch (route.page) {
    case "home":
      page = <Home sets={sets} prog={prog} configs={configs} exercise={exercise} onExercise={setPicked}
        settings={settings} onStart={start} />;
      break;
    case "progress":
      page = <Progress sets={sets} prog={prog} onOpen={openSet}
        onAchievements={() => navigate({ page: "achievements" })} />;
      break;
    case "achievements":
      page = prog && sets
        ? <AchievementBoard prog={prog} sets={sets} onOpen={openSet} onBack={() => navigate({ page: "progress" })} />
        : <main className="page" />;
      break;
    case "set": {
      const set = sets?.find((s) => s.id === route.id);
      if (!sets) {
        page = <main className="page" />;
      } else if (!set) {
        page = (
          <main className="page">
            <a className="back-link" href="#/progress">‹ Progress</a>
            <h1>Set not found</h1>
            <p className="lede">It may have been deleted, or it hasn't synced to this device yet.</p>
          </main>
        );
      } else {
        const earned = prog ? ACHIEVEMENTS.filter((d) => prog.unlocked[d.id]?.setId === set.id) : [];
        page = (
          <Summary key={set.id} record={toSessionRecord(set)} previous={previousSet(sets, set)}
            progress={<EarnedInSet xp={setXp(set.summary)} earned={earned} />}
            back={<a className="back-link" href="#/progress">‹ Progress</a>}>
            <button className="ghost danger" onClick={async () => {
              if (!confirm("Delete this set from your history?")) return;
              await deleteSet(set.id);
              account.requestSync();
              navigate({ page: "progress" }, { replace: true });
            }}>Delete set</button>
          </Summary>
        );
      }
      break;
    }
    case "about":
      page = <About configs={configs} />;
      break;
    case "settings":
      page = <Settings settings={settings} onChange={updateSettings} configs={configs} />;
      break;
  }

  return (
    <Shell route={route}>
      {page}
      {!accepted && <Disclaimer onAccept={() => { acceptDisclaimer(); setAccepted(true); }} />}
    </Shell>
  );
}
