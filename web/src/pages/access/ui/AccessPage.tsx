import { GmSetupScreen, InviteScreen, LoginScreen } from "../../../features/access/ui/Login";
import type { UserInfo } from "../../../shared/api/protocol";

type AccessPageProps =
  | { mode: "invite"; token: string; onDone: (user: UserInfo) => void }
  | { mode: "checking" | "scene-loading" }
  | { mode: "gm-setup"; gmKey: string; onDone: (user: UserInfo) => void }
  | { mode: "login"; notice: string | null; onDone: (user: UserInfo) => void; onGmKey: (key: string) => Promise<string | null> };

export function AccessPage(props: AccessPageProps) {
  switch (props.mode) {
    case "invite":
      return <InviteScreen token={props.token} onDone={props.onDone} />;
    case "checking":
      return <div className="gate-wait">Загрузка...</div>;
    case "gm-setup":
      return <GmSetupScreen gmKey={props.gmKey} onDone={props.onDone} />;
    case "login":
      return <LoginScreen notice={props.notice} onDone={props.onDone} onGmKey={props.onGmKey} />;
    case "scene-loading":
      return <div className="gate-wait">Загрузка сцены...</div>;
  }
}
