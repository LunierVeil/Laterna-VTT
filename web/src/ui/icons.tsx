/** Иконки колонки инструментов: обводка 24x24, цвет - currentColor. */
const PATHS = {
  select: "M5 3l14 8-6 2-3 6z",
  token: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6.5 17.5c1.5-2 3.4-3 5.5-3s4 1 5.5 3",
  ruler: "M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2",
  wall: "M3 5h18v14H3zM3 12h18M9 5v7M15 12v7",
  door: "M6 21V3h12v18M3 21h18M14 12h.01",
  erase: "M7 21h12M5 15l9-9 5 5-9 9H7z",
  combat: "M5 3l9 9M3 5l9 9M14.5 17.5L20 12M17 15l4 4M13 5l6 6M19 3l2 2-8 8",
  eyeOff: "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.4M6.6 7.6C4.4 9.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  gear: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Фонарь из макета - логотип. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="11" y="8" width="18" height="24" rx="3" stroke="var(--accent)" strokeWidth="2.5" />
      <path d="M20 14c-3 4-3 7 0 10 3-3 3-6 0-10z" fill="var(--accent)" />
      <path d="M15 6h10M13 35h14" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
