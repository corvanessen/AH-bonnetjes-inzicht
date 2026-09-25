/**
 * Transient status message at the bottom of the screen — used instead of
 * window.alert() for anything that doesn't need a decision (those stay
 * window.confirm()).
 */
const snackbar = document.getElementById("snackbar") as HTMLElement;
let timer: number | undefined;

function hideLater(ms: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => snackbar.classList.remove("show"), ms);
}

export function showSnackbar(message: string, options: { error?: boolean } = {}): void {
  snackbar.textContent = message;
  snackbar.classList.toggle("error", !!options.error);
  snackbar.classList.add("show");
  // Errors tend to be longer and matter more, so give them more reading time.
  hideLater(options.error ? 8000 : 5000);
}

// Hovering keeps it open so a longer message can still be read.
snackbar.addEventListener("mouseenter", () => window.clearTimeout(timer));
snackbar.addEventListener("mouseleave", () => hideLater(2000));
