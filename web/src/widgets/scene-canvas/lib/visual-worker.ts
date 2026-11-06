import { VisualGeometry, type Point, type Segment } from './visual-geometry';
export type VisualSettings = {
    ambient: 'none' | 'full';
    sources: {
        x: number;
        y: number;
        radius: number;
    }[];
};
export type VisualRequest = {
    generation: number;
    width: number;
    height: number;
    walls: Segment[];
    settings: VisualSettings;
    observer: Point | null;
    gm: boolean;
};
export type VisualResult = {
    generation: number;
    lights: {
        polygon: number[];
        x: number;
        y: number;
        radius: number;
    }[];
    observer: number[] | null;
    available: boolean;
    milliseconds: number;
};
let key = '', geometry: VisualGeometry, lightKey = '', lights: VisualResult['lights'] = [];
const scope = globalThis as unknown as {
    onmessage: (e: MessageEvent<VisualRequest>) => void;
    postMessage: (r: VisualResult) => void;
};
scope.onmessage = ({ data: r }) => {
    const start = performance.now(), result: VisualResult = { generation: r.generation, lights: [], observer: [], available: false, milliseconds: 0 };
    try {
        const next = JSON.stringify([r.width, r.height, r.walls]);
        if (next !== key) {
            geometry = new VisualGeometry(r.width, r.height, r.walls);
            key = next;
            lightKey = '';
        }
        if (!geometry.valid)
            throw Error('geometry unavailable');
        const lk = JSON.stringify(r.settings);
        if (lk !== lightKey) {
            if (!['none', 'full'].includes(r.settings.ambient) || r.settings.sources.length > 15)
                throw Error('invalid lighting');
            lights = r.settings.sources.map(s => { if (!Number.isFinite(s.radius) || s.radius <= 0)
                throw Error('invalid radius'); const polygon = geometry.polygon(s); if (!polygon.length)
                throw Error('source unavailable'); return { ...s, polygon }; });
            lightKey = lk;
        }
        result.lights = lights;
        result.observer = r.gm ? null : r.observer ? geometry.polygon(r.observer) : [];
        result.available = true;
    }
    catch { /* Opaque visual layer, never a grant. */ }
    result.milliseconds = performance.now() - start;
    scope.postMessage(result);
};
