# Moetervlog

A small app for collecting behavioural data during experiments – on your phone, offline, without any server.
Data is organised as **Projects → IDs → status entries (always with a date)** and exported as CSV.

---

## 1. What is in this folder?

| File | What it does | Do you need to touch it? |
|---|---|---|
| `index.html` | The empty page skeleton | rarely |
| `style.css` | Colours, sizes, layout | yes, if you want another look (colours are at the very top) |
| `app.js` | **All the logic** – screens, saving, CSV export. Commented and split into 6 numbered sections | this is where you improve the app |
| `sw.js` | Makes the app work offline | only raise the version number after changes (see 5.) |
| `manifest.json` | Name + icon when installed on the phone | no |
| `icons/` | App icons | no |

It is a so-called **web app (PWA)**: plain HTML/CSS/JavaScript, no build tools, no programming environment needed.
It runs in the browser, but you can "install" it on the home screen and it then looks and works like a normal app – also without internet.

---

## 2. Try it on your computer (2 minutes)

Easiest: open the folder in **VS Code** (free), install the extension **"Live Server"**, right-click `index.html` → *Open with Live Server*.

Alternative, if Python is installed: open a terminal in this folder and run
```
python -m http.server 8000
```
then open http://localhost:8000 in your browser.

(Double-clicking `index.html` also works for a quick look, but offline-mode and installing only work via a server or GitHub Pages.)

---

## 3. Put it on GitHub and onto your phone

**Yes, use GitHub.** It gives you three things for free: a safe copy of your code, a history of every change (you can always go back), and free hosting (GitHub Pages) so the app has a web address you can open on your phone.

1. Create an account on **github.com**.
2. Click **+** (top right) → **New repository**. Name: `moetervlog`. Select **Public** (required for free GitHub Pages; your *data* never goes to GitHub – only the app code does). Click **Create repository**.
3. On the new page click **"uploading an existing file"**. Drag *all* files and the `icons` folder into the window. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch* choose `main` and `/ (root)` → **Save**.
5. After ~1 minute your app is online at
   `https://<your-username>.github.io/moetervlog/`
6. Open that address on your phone in **Chrome** (Android) or **Safari** (iPhone):
   - Android: menu ⋮ → **Install app** / **Add to home screen**
   - iPhone: Share button → **Add to Home Screen**

Done – the app now opens from the home screen, also in the lab without Wi-Fi.

---

## 4. How the app works

- **Start screen** = your experiments (projects). ⋮ top right = settings & backup.
- **Project** = list of IDs. Search field, **Filter** button (several filters at once, they are remembered), export button (↑).
- **New ID**: ID, group, origin, mother, father, collecting date, assembling date.
  "How many?" > 1 creates a series: `F` + 12 → `F01 … F12`.
- **Every ID starts alive.** Adding the status `death` marks it dead on that date.
- **Hold an ID** (~half a second) → selection mode. Tap more IDs, or **All** (= all currently filtered IDs).
  Then **+ Status** adds the same status to all of them, **Group** sets their group.
- **ID page**: all details, links to parents and offspring, other projects of this ID, and the full status history.
  Tap an entry to edit or delete it.
- **Status types**: project menu ⋮ → *Status types*. They appear as quick buttons. Any new type you type is added automatically.

### IDs in several projects
An ID is one real animal, shared by all projects. Use project menu ⋮ → *Add an existing ID*, or simply type an existing ID under *New ID*.

| Shared by all projects | Separate per project |
|---|---|
| ID code, origin, mother, father, collecting date, death | group, assembling date, all status entries |

The CSV export of a project contains only that project's entries.

### CSV export (per project)
- `…_ids.csv` – one row per ID: base data plus, for every status type, the latest value, its date, and how often it was recorded (`molt_last_value`, `molt_last_date`, `molt_n`, …).
- `…_entries.csv` – one row per status entry (id, group, date, time, status, value, note). This "long" format is what R (`read.csv`, `tidyverse`) and Python (`pandas`) like best.

On the phone, **Share** opens the normal share menu → choose Gmail, Google Drive, etc.
Separator comma or semicolon (for German Excel): Settings on the start screen.

---

## 5. ⚠ Your data and backups

The data is stored **only in the browser on that one device** – not on GitHub, not in the cloud.
It survives closing the app and restarting the phone, but it is gone if you *clear the browser data* or uninstall the browser.

→ **Back up regularly**: Start screen ⋮ → *Back up everything* → share the `.json` to Google Drive.
The app reminds you if the last backup is older than 7 days. *Restore from backup* loads it again (also on a new phone).

---

## 6. Changing / improving the app

1. Change a file (on GitHub you can click a file → pencil icon ✏ → edit → *Commit changes*; or edit locally and upload again).
2. In `sw.js` raise `const CACHE = 'moetervlog-v1'` to `'moetervlog-v2'` (then `v3` next time …).
   Otherwise phones keep showing the old version.
3. On the phone: close the app completely and open it again (sometimes twice).

Every commit is saved in the history (*Commits*), so you can always see and undo what changed.

**Working on it with Claude:** upload the current `app.js` (and the other files if needed) and describe what you want – e.g. *"add a field for body size to New ID"*. Ask for the complete changed file, replace it, raise the cache version, done.

### Ideas for later
- Timer / stopwatch for behavioural observations (focal sampling, latencies)
- Photos per entry
- Pedigree view (tree of mothers/fathers)
- Numeric statuses with units and simple plots
- Automatic sync to Google Drive / Sheets (needs a Google login – a bigger step)
