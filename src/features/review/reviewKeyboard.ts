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
  const activeLayer = Array.from(
    ownerDocument.querySelectorAll<HTMLElement>("[role='dialog'], [role='menu'], [popover]"),
  ).some((layer) => {
    if (layer.hidden || layer.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = ownerDocument.defaultView?.getComputedStyle(layer);
    return style?.display !== "none" && style?.visibility !== "hidden";
  });
  if (activeLayer) {
    return true;
  }
  return Boolean(element?.closest(ARROW_KEY_CONTROL_SELECTOR));
}
