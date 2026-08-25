/**
 * All iconography is inline SVG on purpose. Fraunces and Plus Jakarta Sans are
 * both missing common symbol codepoints, so Unicode glyphs render as empty
 * tofu boxes while every text assertion still passes. Nothing here relies on
 * a font shipping a glyph.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const make = (paths) => function Icon(props) {
  return <svg {...base} {...props}>{paths}</svg>;
};

export const IconPlus = make(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>);
export const IconFolder = make(<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.2.6l.9 1.2a1.5 1.5 0 0 0 1.2.6h6.5A1.5 1.5 0 0 1 20 9.9v7.6a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3 17.5z" />);
export const IconStack = make(<><path d="M4 8.5 12 4.5l8 4-8 4z" /><path d="m4 13 8 4 8-4" /></>);
export const IconArchive = make(<><rect x="3.5" y="4.5" width="17" height="4" rx="1.2" /><path d="M5 8.5v9a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-9" /><path d="M10 12h4" /></>);
export const IconPin = make(<><path d="M9 3.5h6l-.8 5.2 3 3.1H6.8l3-3.1z" /><path d="M12 11.8V20" /></>);
export const IconTrash = make(<><path d="M4.5 6.5h15" /><path d="M9.5 6.5V4.8h5v1.7" /><path d="M6.8 6.5 7.7 19a1.2 1.2 0 0 0 1.2 1.1h6.2a1.2 1.2 0 0 0 1.2-1.1l.9-12.5" /></>);
export const IconShare = make(<><path d="M9 12.8 15.5 9" /><path d="m9 11.2 6.5 3.8" /><circle cx="18" cy="7" r="2.6" /><circle cx="18" cy="17" r="2.6" /><circle cx="6.5" cy="12" r="2.6" /></>);
export const IconCheck = make(<path d="m5 12.8 4.4 4.2L19 7.4" />);
export const IconCopy = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" /></>);
export const IconClose = make(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>);
export const IconMenu = make(<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>);
export const IconBack = make(<><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>);
export const IconPencil = make(<><path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M14.5 6.5l3 3" /></>);
export const IconRestore = make(<><path d="M4.5 10.5A7.5 7.5 0 1 1 5 15" /><path d="M4 5.5v5h5" /></>);
export const IconBullets = make(<><path d="M9 6.5h11" /><path d="M9 12h11" /><path d="M9 17.5h11" /><circle cx="4.8" cy="6.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.8" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.8" cy="17.5" r="1.2" fill="currentColor" stroke="none" /></>);
export const IconNumbers = make(<><path d="M10 6.5h10" /><path d="M10 12h10" /><path d="M10 17.5h10" /><path d="M4 4.8h1.4v3.6" /><path d="M3.6 8.4h2.4" /><path d="M3.6 10.9a1.3 1.3 0 1 1 2.2.9L3.6 14h2.4" /><path d="M3.7 16.4h2.2l-1.3 1.5a1.2 1.2 0 1 1-.9 2" /></>);
export const IconChecklist = make(<><path d="M11 7h9" /><path d="M11 17h9" /><path d="m3.2 7 1.6 1.6L8 5.4" /><rect x="3.2" y="14.2" width="4.8" height="4.8" rx="1.2" /></>);
export const IconQuote = make(<><path d="M4.5 5v14" /><path d="M9 8.5h11" /><path d="M9 15.5h8" /></>);
export const IconCode = make(<><path d="m8.5 8.5-4 3.5 4 3.5" /><path d="m15.5 8.5 4 3.5-4 3.5" /><path d="m13.4 5.5-2.8 13" /></>);
export const IconUndo = make(<><path d="M4 9.5h9.5a5 5 0 0 1 0 10H8" /><path d="M7.5 5.5 4 9.5l3.5 4" /></>);
export const IconRedo = make(<><path d="M20 9.5h-9.5a5 5 0 0 0 0 10H16" /><path d="m16.5 5.5 3.5 4-3.5 4" /></>);
export const IconSignOut = make(<><path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17" /><path d="M10 12h10" /><path d="m17 8.5 3.5 3.5L17 15.5" /></>);
export const IconStrike = make(<><path d="M5 12h14" /><path d="M16.5 6.8c-1.2-1.2-3-1.6-4.8-1.3-2.4.4-4.2 2-4.2 3.8 0 1.2.8 2.2 2 2.7" /><path d="M7.5 17.2c1.2 1.2 3 1.6 4.8 1.3 2.4-.4 4.2-2 4.2-3.8 0-.8-.4-1.5-1-2" /></>);
export const IconTable = make(<><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 10h16" /><path d="M4 15h16" /><path d="M10 5v14" /></>);
