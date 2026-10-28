import { Scope, type App } from "obsidian";
import { createPicker, type Picker, type PickerOption } from "./picker";

/** The shared picker, with Esc closing only the open list instead of the modal or settings window around it. */
export function createObsidianPicker<T extends string>(
  app: App,
  parent: HTMLElement,
  options: PickerOption<T>[],
  value: T,
  onChange: (value: T) => void | Promise<void>,
  label?: string
): Picker<T> {
  return createPicker(parent, options, value, onChange, label, {
    onOpen: (close) => {
      const scope = new Scope(app.scope);
      scope.register([], "Escape", () => {
        close();
        return false;
      });
      app.keymap.pushScope(scope);
      return () => app.keymap.popScope(scope);
    }
  });
}
