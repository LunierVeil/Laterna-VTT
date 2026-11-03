import { useUi } from "../../state/store";
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
  const res = await fetch("/api/gm/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.needs_setup) onSetup(key);
  else if (res.ok) useUi.getState().setMe(data as UserInfo);
  else return data.detail || "ключ ГМ не подошёл";
  return null;
}

