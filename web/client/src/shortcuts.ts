// Tag hotkeys shared by the library view and Review & Tag mode.
// Index N in this list tags eventTypes[N].
export const TAG_KEYS = [
  '1','2','3','4','5','6','7','8','9','0',
  'Q','W','E','R','T','Y','U','I','O','P',
];

// Returns the event-type index for a keydown, or -1. Ignores modified keys so
// browser shortcuts (Cmd+R, Ctrl+W, ...) never create tags.
export function tagIndexForKey(e: KeyboardEvent): number {
  if (e.metaKey || e.ctrlKey || e.altKey) return -1;
  return TAG_KEYS.indexOf(e.key.toUpperCase());
}

// True when a keydown originated in a text field and should be left alone.
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && (el as HTMLInputElement).type !== 'range'
    || el.isContentEditable;
}
