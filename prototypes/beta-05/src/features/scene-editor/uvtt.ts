import { emptyScene, uid, type MapObject, type Point, type Scene } from '../../entities/model';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function point(value: unknown): Point | undefined {
  const { x, y } = record(value);
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y) ? { x, y } : undefined;
}
export function readUvtt(text: string, filename: string): { scene: Scene; version: string; omitted: number } {
  const data = record(JSON.parse(text) as unknown);
  const version = String(data.format);
  if (version !== '0.2' && version !== '0.3') throw new Error('Поддерживаются UVTT 0.2 и 0.3.');
  const resolution = record(data.resolution);
  const size = point(resolution.map_size);
  const origin = point(resolution.map_origin) ?? { x: 0, y: 0 };
  if (!size || size.x < 1 || size.y < 1 || typeof resolution.pixels_per_grid !== 'number' || resolution.pixels_per_grid <= 0) {
    throw new Error('В файле отсутствуют допустимые размеры карты или сетки.');
  }
  const image = data.image;
  if (typeof image !== 'string' || !/^[a-zA-Z0-9+/]+={0,2}$/.test(image)) throw new Error('В файле отсутствует подложка Base64.');
  const format = image.startsWith('iVBOR') ? 'png' : image.startsWith('/9j/') ? 'jpeg' : image.startsWith('UklGR') ? 'webp' : '';
  if (!format) throw new Error('Подложка должна быть PNG, JPEG или WebP.');
  const grid = Math.min(1100 / size.x, 760 / size.y);
  const width = size.x * grid;
  const height = size.y * grid;
  const x = (1100 - width) / 2;
  const y = (760 - height) / 2;
  const project = (p: Point): Point => ({ x: x + (p.x - origin.x) * grid, y: y + (p.y - origin.y) * grid });
  const objects: MapObject[] = [];
  let omitted = 0;
  function segment(kind: 'wall' | 'door', start: unknown, end: unknown, open?: boolean) {
    const a = point(start), b = point(end);
    if (!a || !b || a.x === b.x && a.y === b.y) { omitted++; return; }
    objects.push({ id: uid(), kind, name: kind === 'wall' ? 'Стена из UVTT' : 'Дверь из UVTT', ...project(a), end: project(b), open });
  }
  for (const polyline of [...list(data.line_of_sight), ...list(data.objects_line_of_sight)]) {
    const points = list(polyline);
    if (points.length < 2) omitted++;
    for (let i = 1; i < points.length; i++) segment('wall', points[i - 1], points[i]);
  }
  for (const portal of list(data.portals)) {
    const { bounds, closed } = record(portal);
    const [start, end] = list(bounds);
    segment('door', start, end, closed === false);
  }
  for (const entry of list(data.lights)) {
    const light = record(entry);
    const position = point(light.position);
    if (!position || typeof light.range !== 'number' || !Number.isFinite(light.range) || light.range <= 0) { omitted++; continue; }
    const color = typeof light.color === 'string' && /^[0-9a-f]{6}$/i.test(light.color) ? '#' + light.color : '#f0b14a';
    objects.push({ id: uid(), kind: 'light', name: 'Свет из UVTT', ...project(position), radius: light.range * grid, color });
  }
  return { scene: { ...emptyScene(filename.replace(/\.[^.]+$/, ''), 'Без папки'), grid, objects,
    background: { image: `data:image/${format};base64,${image}`, x, y, width, height } }, version, omitted };
}
