// SVG-иконки в стиле Lucide (stroke 2, 24×24). Эмодзи как иконки не используем.

const PATHS = {
  play: 'M6 4l14 8-14 8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  retry: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  camera: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  hand: 'M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9z',
  home: 'M3 10l9-7 9 7v11a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  arms: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 3l4 7h6l4-7M9 10v11M15 10v11',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  chevron: 'M9 18l6-6-6-6',
  chart: 'M3 3v18h18M8 17v-5M13 17V8M18 17v-9',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  target:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  close: 'M18 6L6 18M6 6l12 12',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M12 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 8v6M9 10l3 1 3-1M12 14l-2 4M12 14l2 4',
  run: 'M13 4a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM4 17l5 1 1-3M7 11l3-3 4 1 3 4h3M14 9l-2 5 4 3v5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 28, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
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
