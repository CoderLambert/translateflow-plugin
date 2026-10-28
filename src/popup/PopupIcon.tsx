type IconName = "settings" | "globe" | "translate" | "book" | "arrow" | "sliders" | "cache";

const paths: Record<IconName, string> = {
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 3h4l.7 2.4 2 .9L19 5l2 3.5-1.7 1.8v3.4l1.7 1.8-2 3.5-2.3-1.3-2 .9L14 21h-4l-.7-2.4-2-.9L5 19l-2-3.5 1.7-1.8v-3.4L3 8.5 5 5l2.3 1.3 2-.9L10 3Z",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 4.5 4 13.5 0 18-4-4.5-4-13.5 0-18Z",
  translate: "M3 5h12M9 3v2M5 5c0 5 5 9 9 10M12 5c0 5-5 9-9 10M13 21l4-10 4 10M14.5 17h5",
  book: "M12 5v15M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Z",
  arrow: "M5 12h14M14 7l5 5-5 5",
  sliders: "M4 7h4m4 0h8M4 17h8m4 0h4M8 4v6m4-3H8m8 7v6m-4-3h4",
  cache: "M20 8a8 8 0 1 0 .5 7M20 3v5h-5M12 7v5l3 2"
};

export function PopupIcon({ name }: { name: IconName }) {
  return <svg className="popup-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
