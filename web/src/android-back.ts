import { Capacitor } from "@capacitor/core";

/** Reuse each dialog's Escape/cancel path, including its pending-operation guard. */
export function backFromDialog(mainMenu: HTMLElement): boolean {
  const dialogs = [...document.querySelectorAll<HTMLElement>(
    'dialog[open], [role="dialog"], .puzzle-ui-overlay:not([data-screen="playing"])',
  )].filter(element => element !== mainMenu && !element.closest('[hidden], [inert]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
  const nativeDialogs = dialogs.filter(element => element instanceof HTMLDialogElement);
  const focusedDialog = document.activeElement?.closest("dialog[open]");
  const dialog = nativeDialogs.find(element => element === focusedDialog) ?? nativeDialogs.at(-1) ?? dialogs.at(-1);
  if (!dialog) return false;
  if (dialog instanceof HTMLDialogElement) {
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
    return true;
  }
  const resultMenu = dialog.querySelector<HTMLButtonElement>("[data-match-menu]");
  if (resultMenu && !resultMenu.hidden) {
    resultMenu.click();
    return true;
  }
  const focused = document.activeElement;
  const target = focused instanceof HTMLElement && dialog.contains(focused) ? focused : dialog;
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Escape", code: "Escape", bubbles: true, cancelable: true,
  }));
  return true;
}

export async function installAndroidBackHandler(handleBack: () => boolean): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!handleBack()) void App.minimizeApp();
  });
  // Keep the native default disabled until our navigation handler is registered.
  await App.toggleBackButtonHandler({ enabled: true });
}
