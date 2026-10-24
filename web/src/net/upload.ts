/**
 * Загрузка картинки на сервер: карта сцены, картинка токена.
 *
 * Размер в пикселях узнаём до отправки - слишком большую отсекаем сразу,
 * а не после того, как она легла на сервер. Тип и размер в байтах сервер
 * проверяет сам (по сигнатуре, а не по имени файла).
 */
export async function uploadImage(
  file: File,
  limits: { maxBytes: number; maxSide: number; what: string },
): Promise<{ url: string; width: number; height: number }> {
  if (file.size > limits.maxBytes) throw new Error(`файл больше ${limits.maxBytes / 1024 / 1024} МБ`);
  let width: number, height: number;
  try {
    const bmp = await createImageBitmap(file);
    ({ width, height } = bmp);
    bmp.close();
  } catch {
    throw new Error("это не картинка или формат не поддерживается");
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    throw new Error(`${limits.what} ${width}×${height}, максимум ${limits.maxSide} по стороне - уменьши`);
  }
  // Сессия уходит cookie, права сервер проверяет сам.
  const res = await fetch("/api/uploads", { method: "POST", body: file });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `загрузка не удалась (${res.status})`);
  return { url: body.url, width, height };
}
