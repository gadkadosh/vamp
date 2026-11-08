import { Instrument } from "./Instrument";
import { useSoloSession } from "./useSoloSession";

export function App() {
  const session = useSoloSession();
  return <Instrument session={session} />;
}
