const icons = {
  play: <path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none" />,
  pause: <path d="M9 6v12M16 6v12" strokeWidth="3" />,
  undo: <path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12" />,
  redo: <path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0 0 12" />,
  clear: <path d="M4 7h16M9 3h6M6 7l1 14h10l1-14M10 11v6m4-6v6" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  sound: (
    <>
      <path d="m10 5-5 4H2v6h3l5 4Z" />
      <path d="M14 8a6 6 0 0 1 0 8m4-12a11 11 0 0 1 0 16" />
    </>
  ),
  mute: (
    <>
      <path d="m10 5-5 4H2v6h3l5 4Z" />
      <path d="m15 9 6 6m0-6-6 6" />
    </>
  ),
};

type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}
