import { projectionActions } from "../../state/bridge";
import type { UserInfo } from "../../shared/api/protocol";

/**
 * Ключ ГМ приходит один раз в ссылке ?gm=... Забираем его при загрузке
 * модуля (а не в эффекте: StrictMode запускает эффекты дважды, и второй
 * запуск уже не нашёл бы ключ в адресе) и сразу убираем из адресной
 * строки - чтобы не светить при показе экрана. Дальше нужна только сессия.
 */
function takeFromUrl(param: string): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(param);
  if (value) {
    url.searchParams.delete(param);
    history.replaceState(null, "", url);
  }
  return value;
}

export const GM_KEY_FROM_URL = takeFromUrl("gm");
// Приглашение от мастера - так же: забрать и убрать из адреса.
export const INVITE_FROM_URL = takeFromUrl("invite");

/**
 * Вход мастера по ключу - из ссылки ?gm=... или с экрана входа. Первый
 * раз (аккаунта ещё нет) - на экран "придумай имя и пароль".
 * Возвращает текст ошибки или null.
 */
export async function gmKeyLogin(
  key: string,
  onSetup: (key: string) => void,
): Promise<string | null> {
  const current = projectionActions.captureSession();
  const res = await fetch("/api/gm/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (!current()) return null;
  if (res.ok && data.needs_setup) onSetup(key);
  else if (res.ok) acceptSession(data as UserInfo);
  else return data.detail || "ключ ГМ не подошёл";
  return null;
}

/** Auth projection write; a changed identity atomically resets private client data. */
export function acceptSession(user: UserInfo | null): void {
  projectionActions.setMe(user);
}

/** Lease for asynchronous bootstrap auth; no projection data is exposed. */
export const captureSession = projectionActions.captureSession;
