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

export function showSnackbar(
  message: string,
  options: { error?: boolean; action?: { label: string; onClick: () => void } } = {},
): void {
  snackbar.textContent = message;
  if (options.action) {
    const { label, onClick } = options.action;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "snackbar-action";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      snackbar.classList.remove("show");
      onClick();
    });
    snackbar.appendChild(btn);
  }
  snackbar.classList.toggle("error", !!options.error);
  snackbar.classList.add("show");
  // Errors tend to be longer and matter more, so give them more reading time;
  // a message with an action stays a bit longer so there's time to click it.
  hideLater(options.error ? 8000 : options.action ? 8000 : 5000);
}

// Hovering keeps it open so a longer message can still be read.
snackbar.addEventListener("mouseenter", () => window.clearTimeout(timer));
snackbar.addEventListener("mouseleave", () => hideLater(2000));
