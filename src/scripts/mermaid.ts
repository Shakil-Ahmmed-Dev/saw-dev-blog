const COPY_RESET_MS = 1500;
const copyTimers = new WeakMap<HTMLButtonElement, number>();

function handleTabClick(button: HTMLButtonElement): void {
  const targetView = button.dataset.mermaidTab;
  if (targetView !== "diagram" && targetView !== "source") return;

  const figure = button.closest<HTMLElement>(".mermaid-diagram");
  if (!figure) return;

  figure.dataset.mermaidView = targetView;

  const buttons = figure.querySelectorAll<HTMLButtonElement>(
    "button[data-mermaid-tab]"
  );
  for (const btn of buttons) {
    btn.setAttribute(
      "aria-pressed",
      btn.dataset.mermaidTab === targetView ? "true" : "false"
    );
  }

  const diagramPanel = figure.querySelector<HTMLElement>(
    ".mermaid-panel-diagram"
  );
  const sourcePanel = figure.querySelector<HTMLElement>(
    ".mermaid-panel-source"
  );

  if (diagramPanel) diagramPanel.hidden = targetView !== "diagram";
  if (sourcePanel) sourcePanel.hidden = targetView !== "source";
}

async function handleCopyClick(button: HTMLButtonElement): Promise<void> {
  const figure = button.closest<HTMLElement>(".mermaid-diagram");
  const code = figure?.querySelector<HTMLElement>(
    "pre[data-mermaid-source] code"
  );
  const text = code?.innerText ?? "";
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }

  button.dataset.copied = "true";
  button.setAttribute("aria-label", "Copied Mermaid source");
  button.setAttribute("title", "Copied");

  const existingTimer = copyTimers.get(button);
  if (existingTimer) window.clearTimeout(existingTimer);

  const timer = window.setTimeout(() => {
    delete button.dataset.copied;
    button.setAttribute("aria-label", "Copy Mermaid source");
    button.setAttribute("title", "Copy Mermaid source");
    copyTimers.delete(button);
  }, COPY_RESET_MS);

  copyTimers.set(button, timer);
}

const win = window as unknown as { __mermaidBound?: boolean };
if (!win.__mermaidBound) {
  win.__mermaidBound = true;

  document.addEventListener("click", event => {
    const target = event.target as Element | null;
    if (!target) return;

    const tabButton = target.closest<HTMLButtonElement>(
      "button[data-mermaid-tab]"
    );
    if (tabButton) {
      handleTabClick(tabButton);
      return;
    }

    const copyButton = target.closest<HTMLButtonElement>(
      "button[data-mermaid-copy]"
    );
    if (copyButton) {
      void handleCopyClick(copyButton);
    }
  });
}
