import { useState } from "react";
import { Instrument } from "./Instrument";
import { useSoloSession } from "./useSoloSession";
import { useSharedSession } from "./useSharedSession";

export function App() {
  const [solo, setSolo] = useState(false);
  const soloSession = useSoloSession();
  const sharedSession = useSharedSession(!solo);
  const session = solo ? soloSession : sharedSession;
  return (
    <Instrument
      key={session.kind}
      session={session}
      onSwitchMode={() => setSolo((previous) => !previous)}
    />
  );
}
