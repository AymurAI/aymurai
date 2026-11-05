import { electronApp, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain } from "electron";

import createWindow from "./createWindow";
import { installExtensions } from "./extensions";
import { excel, feedback, subprocess, taskbar } from "./utils";

// Must run before Chromium initializes (i.e. before `app.whenReady()`), and
// alongside `index.html`'s `lang="es-AR"` -- together these get the native
// `<input type="date">` calendar popup's month/day names into Spanish
// (ICU-driven, keyed off the page's `lang`).
//
// Must be a locale Electron actually ships a .pak for (see
// `node_modules/electron/dist/locales/`) -- there is no `es-AR.pak`, only
// `es.pak` and `es-419.pak`, so `--lang=es-AR` silently falls back to the
// default (en-US) no matter how many times the app is restarted.
//
// Known limitation, accepted as-is: the popup's own "Hoy"/"Borrar" button
// labels stay in English regardless. Those come from Chromium's native
// resource bundle, whose locale is resolved during Electron's native
// startup -- earlier than any JS in this file runs, `appendSwitch` included
// -- so this switch can't reach it. Long-standing, still-unfixed upstream
// bug: https://github.com/electron/electron/issues/17995 (open since 2019,
// reproduced as recently as Electron 38.1.0). The one workaround reported
// there (`app.relaunch` with `--lang` baked into a fresh process's argv) is
// unreliable per the thread's own later comments and would add a visible
// relaunch on every startup -- not worth it for two button labels.
app.commandLine.appendSwitch("lang", "es");

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.handle("EXPORT_FEEDBACK", (_, fileName: string, data: object) =>
    feedback.export(fileName, data),
  );
  ipcMain.handle("EXCEL_READ", excel.read);
  ipcMain.handle("EXCEL_WRITE", (_, buffer: ArrayBuffer) =>
    excel.write(buffer),
  );
  ipcMain.handle("EXCEL_OPEN", excel.open);

  // TASKBAR
  ipcMain.handle("TASKBAR_NOTIFY", taskbar.notify);

  ipcMain.handle("RUN_BATCH", subprocess.run);

  await installExtensions();
  createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", async () => {
  subprocess.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
