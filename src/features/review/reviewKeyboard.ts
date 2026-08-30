const ARROW_KEY_CONTROL_SELECTOR = [
  "input",
  "select",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='listbox']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='grid']",
  "[role='tree']",
].join(", ");

/** Keeps review navigation global without stealing arrows from active widgets. */
export function shouldPreserveReviewArrowKey(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : document.activeElement;
  const ownerDocument = element?.ownerDocument ?? document;
  if (ownerDocument.querySelector("[role='dialog'], [role='menu'], [popover]:not([hidden])")) {
    return true;
  }
  return Boolean(element?.closest(ARROW_KEY_CONTROL_SELECTOR));
}
