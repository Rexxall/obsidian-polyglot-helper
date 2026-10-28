// Capsule picker from the shared glass kit: a button that opens a glass list,
// used in place of a native <select>. No Obsidian API, so the same file works in web apps.

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  desc?: string;
}

export interface PickerHooks {
  /** Called when the list opens, with a function that closes it; returns a clean-up for when it closes.
   *  A host whose own shortcuts run first (Obsidian's Esc closes the modal) routes Esc here. */
  onOpen?: (close: () => void) => () => void;
}

export interface Picker<T extends string> {
  button: HTMLButtonElement;
  set(value: T): void;
  close(): void;
}

export function createPicker<T extends string>(
  parent: HTMLElement,
  options: PickerOption<T>[],
  value: T,
  onChange: (value: T) => void | Promise<void>,
  label?: string,
  hooks: PickerHooks = {},
): Picker<T> {
  const doc = parent.ownerDocument;
  const button = parent.createEl("button", { cls: "ap-picker", attr: { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" } });
  if (label) button.setAttr("aria-label", label);
  const valueEl = button.createSpan({ cls: "ap-picker-value" });
  let current = value;
  let menu: HTMLElement | null = null;
  let focused = 0;
  let releaseHost: (() => void) | undefined;

  const render = () => {
    const option = options.find((item) => item.value === current);
    valueEl.setText(option?.label ?? current);
    if (option?.desc) button.setAttr("title", option.desc);
  };

  const onOutside = (event: MouseEvent) => {
    if (menu && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  };
  const onScroll = (event: Event) => {
    if (menu && !menu.contains(event.target as Node)) close();
  };

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    button.setAttr("aria-expanded", "false");
    doc.defaultView?.removeEventListener("keydown", onKey, true);
    releaseHost?.();
    releaseHost = undefined;
    doc.removeEventListener("mousedown", onOutside, true);
    doc.removeEventListener("scroll", onScroll, true);
  }

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    close();
    button.focus();
    if (option.value !== current) {
      current = option.value;
      render();
      void onChange(current);
    }
  };

  const move = (index: number) => {
    if (!menu) return;
    focused = (index + options.length) % options.length;
    const items = Array.from(menu.querySelectorAll<HTMLElement>(".ap-menu-item"));
    items.forEach((item, i) => item.toggleClass("is-focused", i === focused));
    items[focused]?.scrollIntoView({ block: "nearest" });
  };

  const open = () => {
    menu = doc.body.createDiv({ cls: "ap ap-menu", attr: { role: "listbox", tabindex: "-1" } });
    if (label) menu.setAttr("aria-label", label);
    options.forEach((option, index) => {
      const item = menu!.createDiv({ cls: "ap-menu-item", attr: { role: "option", "aria-selected": String(option.value === current) } });
      item.createSpan({ cls: "ap-menu-label", text: option.label });
      if (option.desc) item.createSpan({ cls: "ap-menu-desc", text: option.desc });
      item.addEventListener("mousemove", () => move(index));
      item.addEventListener("click", () => choose(index));
    });
    const rect = button.getBoundingClientRect();
    const view = doc.defaultView;
    const width = view?.innerWidth ?? 1024;
    const height = view?.innerHeight ?? 768;
    menu.style.setProperty("min-width", `${Math.max(180, rect.width)}px`);
    const box = menu.getBoundingClientRect();
    // Line the list up with the button's nearer edge, then keep it on screen.
    const start = rect.left + rect.width / 2 > width / 2 ? rect.right - box.width : rect.left;
    const left = Math.min(Math.max(8, start), width - box.width - 8);
    const below = rect.bottom + 6;
    const top = below + box.height > height - 8 ? Math.max(8, rect.top - box.height - 6) : below;
    menu.style.setProperty("left", `${left}px`);
    menu.style.setProperty("top", `${top}px`);
    button.setAttr("aria-expanded", "true");
    move(Math.max(0, options.findIndex((option) => option.value === current)));
    doc.defaultView?.addEventListener("keydown", onKey, true);
    releaseHost = hooks.onOpen?.(close);
    menu.focus();
    doc.addEventListener("mousedown", onOutside, true);
    doc.addEventListener("scroll", onScroll, true);
  };

  function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") move(focused + 1);
    else if (event.key === "ArrowUp") move(focused - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(options.length - 1);
    else if (event.key === "Enter" || event.key === " ") choose(focused);
    else if (event.key === "Escape" || event.key === "Tab") {
      close();
      button.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  button.addEventListener("click", () => (menu ? close() : open()));
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!menu) open();
    }
  });
  render();

  return {
    button,
    set(next: T) {
      current = next;
      render();
    },
    close,
  };
}
