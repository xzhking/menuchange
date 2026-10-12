# Menu Pinner

[中文](README.md) | **English**

<img src="icon.png" width="96" alt="icon">

**Pin any command to the top of a VS Code context menu** — or hide menu items you never use.

Instead of hunting for `Open with Live Server`, `Run Code` or `Open In Default Browser` somewhere in the middle of a long right-click menu, put it on the first line.

- Supported menus: editor context menu, explorer context menu, editor tab context menu, terminal context menu
- Searchable command picker; you can also type a command id manually
- **Reversible**: every manifest is backed up before it is touched, and everything can be restored with one command
- Automatic self-check: if an extension update overwrites a manifest, Menu Pinner offers to re-apply

---

## Installation

Pick **one** of the two methods below — you do not need both. The installed extension id is `menuchange.menu-pinner`.

### Method 1 — install the VSIX (recommended, no manual file editing)

**Step 1 · Get the `.vsix` file** (any one of these three):

| Source | How |
|---|---|
| **Download from this repo** (easiest) | Click [`dist/menuchange.menu-pinner-1.0.0.vsix`](dist/menuchange.menu-pinner-1.0.0.vsix) and hit **Download** on the file page |
| **Releases page** | **Releases** → the version you want → **Assets** → `menuchange.menu-pinner-x.y.z.vsix` (built automatically by GitHub Actions when a tag is pushed) |
| **Build it yourself** | `node tools/package-vsix.js` (no dependencies; output lands in `dist/`) |

**Step 2 · Install** (choose **one** of the two, they are not sequential):

- **UI**: in VS Code press `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → select the file from step 1
- **CLI**: `code --install-extension <path to the file from step 1>`, for example:

  ```bash
  code --install-extension dist/menuchange.menu-pinner-1.0.0.vsix
  ```

  If `code` is not recognized, the VS Code `bin` folder is not on your PATH — use the full path instead, e.g. on Windows:
  `& "D:\...\Microsoft VS Code\bin\code.cmd" --install-extension <path>`

**Step 3 · Restart VS Code** (quit all windows, then start it again).

### Method 2 — drop the folder in manually (for people who want to run the source)

Use this **instead of** method 1. Copy `package.json`, `extension.js`, `icon.png` and `lib/` from this repo into a folder that must be named `menuchange.menu-pinner-1.0.0`:

| OS | Directory |
|---|---|
| Windows | `%USERPROFILE%\.vscode\extensions\menuchange.menu-pinner-1.0.0\` |
| macOS / Linux | `~/.vscode/extensions/menuchange.menu-pinner-1.0.0/` |

Then quit and restart VS Code. VS Code picks it up while scanning at startup (the log shows `Added extensions to default profile from external source`); if it does not show up in the Extensions view, restart once more.

> This method is not auto-updated and carries no version bookkeeping. For long-term use, prefer method 1.

### Upgrading

| Installed via | How to upgrade |
|---|---|
| Method 1 (VSIX) | Install the new VSIX; the same id replaces the old one: `code --install-extension dist/menuchange.menu-pinner-<new>.vsix --force` |
| Method 2 (folder) | Overwrite the files in that folder with the new source, then restart VS Code |

---

## Usage

`Ctrl+Shift+P` → type `Menu Pinner`:

| Command | What it does |
|---|---|
| **Pin a command to the top of a context menu** | Choose a menu → choose a command (searchable, or type an id) → it edits the manifest and tells you to restart |
| **Hide a context menu item** | Sets that item's `when` to `false` so it disappears from the menu |
| **Show / restore changes** | Multi-select list; tick an entry to restore it, or open `pins.json` to see the original values |
| **Re-apply all changes** | One click after an extension update overwrote the manifest |
| **Restore all changes (from records)** | Writes the original `group` / `when` values back |
| **Restore from backup files** | Overwrites the manifest with `<package.json>.menuPinner.bak` (the most thorough rollback) |
| **Restore and uninstall this extension** | One-shot teardown: restore everything + clear records + uninstall Menu Pinner (see [Uninstall](#uninstall)) |

### Three steps to try it

1. Run **Menu Pinner: Pin a command to the top of a context menu**
2. Pick "editor context menu" → type `live server` → choose `Open with Live Server`
3. **Quit VS Code completely** (close every window) and start it again — the item is now the first entry

> ⚠️ `Developer: Reload Window` and `Restart Extension Host` are **not** enough. Menu order lives in the extension manifest, which is only read at startup.

---

## How it works

VS Code builds context menus from **static contributions** in extension manifests (`package.json`). There is no runtime API to reorder them:

```jsonc
"contributes": {
  "menus": {
    "editor/context": [
      { "command": "extension.liveServer.goOnline", "group": "myGrp@liveServer", "when": "resourceLangId == html" }
    ]
  }
}
```

The sorting rules (verified against `workbench.desktop.main.js` in VS Code 1.141):

```js
if (a.group === "navigation") return -1;   // the "navigation" group always comes first
if (b.group === "navigation") return 1;
// other groups are compared with localeCompare; inside a group, the number after "@" wins
order = Number(group.substr(c + 1)) || undefined
```

So Menu Pinner finds **the extension that contributes the menu item** and rewrites its `group` to `navigation@-1000` (the smallest `order` used by built-in items is `-11` in practice, so `-1000` always wins). Additional pins use `-1000 / -1001 / …`, so the most recently pinned item ends up on top.

## Safety

Menu Pinner edits the `package.json` of **other extensions you have installed**, so it takes these precautions:

- the manifest is backed up to `<package.json>.menuPinner.bak` before the first change (once per manifest)
- edits replace only the target character range — **every other byte is left untouched** (key order, indentation and formatting stay as they were)
- the result is validated with `JSON.parse` immediately; if it does not parse, the change is dropped and **the file is never left broken**
- every change is recorded in `pins.json`, so it can be restored item by item or wholesale from backups
- every edit is printed line by line in the **Menu Pinner** output channel

State file location:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Code\User\globalStorage\menuchange.menu-pinner\pins.json` |
| macOS | `~/Library/Application Support/Code/User/globalStorage/menuchange.menu-pinner/pins.json` |
| Linux | `~/.config/Code/User/globalStorage/menuchange.menu-pinner/pins.json` |

> `pins.json` is owned by the extension: editing it by hand **while VS Code is running** will be overwritten by the in-memory state. Make changes from inside the extension instead ("Show / restore changes").

### Uninstall

**One command**: `Menu Pinner: Restore and uninstall this extension`. It will:

1. write the original `group` / `when` back for every recorded change;
2. overwrite each modified extension manifest with `<package.json>.menuPinner.bak` (this also wipes any manual leftovers), deleting each backup right after a successful restore;
3. clear the records and ask VS Code to uninstall the extension.

Afterwards, **quit VS Code completely and start it again**.

> Uninstalling does **not** delete the `globalStorage` folder (that is how VS Code behaves for every extension). Step 3 removes `pins.json`; if an empty folder remains, you can delete it yourself.

Equivalent manual steps:

1. Run **Menu Pinner: Restore all changes (from records)** — or **Restore from backup files**, which is more thorough
2. Uninstall from the Extensions view, or `code --uninstall-extension menuchange.menu-pinner`
3. Restart VS Code

⚠️ If you uninstall **without** restoring first, the modified extension manifests keep your current ordering — everything still works, it is just no longer managed by Menu Pinner. In that case use "Restore from backup files", or simply copy `<package.json>.menuPinner.bak` back over `package.json`.

---

## Known limitations

1. **VS Code has to be restarted manually.** Two attempts at one-click auto-restart both failed:
   - starting a new instance after a fixed delay: it races the single-instance lock, so the new process forwards to the old instance and exits — VS Code closes and never comes back;
   - a separate helper process that waits for the old instance to exit and then relaunches it: VS Code manages child processes with a Job Object configured for kill-on-job-close, so the helper is killed with VS Code (it never even manages to write its log).

   Menu Pinner therefore only tells you to restart — it will not risk leaving you with an editor that closed and never came back.
2. **Built-in VS Code commands** (such as "Format Document") live in the application bundle, so they **cannot be hidden**; pinning one adds **a second entry** at the top while the original stays where it was. Built-in extensions under `resources/app/extensions` are treated the same way.
3. Changes are written **into extension manifests**, so updating a modified extension overwrites them. Menu Pinner checks 3 seconds after startup and offers to re-apply when it detects that.
4. Designed for **local desktop** use. With Remote / WSL / Dev Containers the extension runs on the remote side and edits remote manifests — verify the behaviour yourself.
5. Requires VS Code **1.75+**.

---

## Development

```bash
git clone <this-repo>
cd menuchange

# Run the tests (plain node, no dependencies to install)
node test/manifest-utils.test.js       # manifest rewriting engine: parse/insert/replace/remove/multi-patch offsets/JSONC tolerance/real-manifest replay
node test/nls.test.js                  # %key% localized title resolution

# List what a given menu actually contains (read-only)
node test/scan-preview.js explorer/context

# Regenerate the icon
node tools/make-icon.js

# Package the VSIX → dist/menuchange.menu-pinner-<version>.vsix
node tools/package-vsix.js
```

- `lib/manifest-utils.js` — the text-level manifest rewriting engine (no `vscode` dependency, fully unit-testable)
- `lib/nls.js` — resolves `%key%` titles through `package.nls*.json`
- Releasing: bump `version` in `package.json` → `git tag v1.0.0 && git push --tags`; GitHub Actions packages the VSIX and attaches it to the Release

### Change these three things before publishing

1. `"publisher": "menuchange"` in `package.json` → your own GitHub id (this changes the extension id and the install folder name)
2. the repository URL placeholders in this document
3. if you changed `publisher`/`name`, update `SELF_ID` at the top of `extension.js` to `"<publisher>.<name>"`

### Publishing to the VS Code Marketplace

You need an Azure DevOps organization plus a Personal Access Token:

```bash
npx @vscode/vsce publish -p <token>
```

(The default GitHub Release distribution does not need any of this.)

## License

[MIT](LICENSE)
