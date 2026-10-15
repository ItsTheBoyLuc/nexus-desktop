# Releasing Nexus (and how the app updates itself)

Plain steps. You do **steps 1 to 3 once**, then **steps 4 to 7 for every release**.

## How it works

- The **source** repository (`nexus-desktop`) stays private. Installers go to a **separate public repository that holds only installers**,
  `ItsTheBoyLuc/nexus-desktop-releases`. No source code is ever uploaded there.
- The installer carries the address of that repository (written by electron-builder from the `publish` block of `electron-builder.yml`).
  **No token is inside the app.** The app reads *published* releases of the public repository without logging in.
- The release script uploads every release as a **draft**. A draft is invisible to the app until **you** publish it on GitHub, so you can look
  at it first.
- In the app: a silent check a little after start and every 6 hours. It only **checks** and shows a small badge on the Preferences button. The user
  opens Preferences, chooses **Download the update**, and when it is ready **Restart and install**. Nothing is downloaded or installed by itself.
  The restart is refused while a save, a post or a delete is still in progress (the app never repeats a write), and a failed check or download
  never breaks the app.
- The download is checked by electron-updater against the SHA-512 in the release's `latest.yml`.

## 1. Create the releases repository (once)

1. On GitHub create a new repository named **`nexus-desktop-releases`** under `ItsTheBoyLuc`. Make it **Public**.
2. Put nothing in it except an optional README line. **Never push source code there.**
3. Check that the name is exactly what `electron-builder.yml` says (`owner: ItsTheBoyLuc`, `repo: nexus-desktop-releases`). The build refuses any
   other value.

## 2. Create the token (once, then when it expires)

1. GitHub, **Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token**.
2. **Resource owner:** `ItsTheBoyLuc`. **Repository access:** *Only select repositories*, and choose **`nexus-desktop-releases` only**.
3. **Repository permissions: Contents = Read and write.** Nothing else. (Metadata read-only is added by GitHub itself.)
4. Give it an expiry (for example 90 days). Copy the token once; GitHub never shows it again.
5. Do **not** save it in a file, in `.env`, in a note in the repository or in the app. It is only used by the release script on your computer.

## 3. Build and hand out the first installer (once)

Everyone who already has an older build (one made before this update feature) **must reinstall once**: older builds do not contain the update
feed and cannot update themselves.

1. Run the release (steps 4 to 6 below) for the first time and publish the draft (step 7).
2. Download `Nexus-Setup-<version>-x64.exe` from the release page of the releases repository and give it to your users. This is the last
   installer they will need to download by hand.
3. The installer is **not signed**, so Windows SmartScreen shows "Windows protected your PC". Users choose **More info, Run anyway**.
4. The portable build (`Nexus-Portable-...exe`) is uploaded too, but it **cannot update itself**. Only the installer updates.

## 4. Set the token in your shell (every time, without saving it)

Use the shell for this one release only. The token must not end up in your command history.

PowerShell (the token is typed into a hidden prompt and exists only in this window):

```powershell
$secure = Read-Host "GH_TOKEN" -AsSecureString
$env:GH_TOKEN = [System.Net.NetworkCredential]::new("", $secure).Password
```

Git Bash (a space before the command keeps it out of the history in most setups; `read -s` hides what you type):

```bash
read -rs GH_TOKEN; export GH_TOKEN
```

Close the window when you are done, or run `Remove-Item Env:GH_TOKEN` (PowerShell) / `unset GH_TOKEN` (Bash). Never paste the token into a command
line, a chat or a file.

## 5. Make sure the source is ready

- Everything is committed, you are on **`main`**, and the working tree is clean (`git status` shows nothing).
- Optional, to see what the script will do without changing anything: `npm run release -- patch --dry-run`

## 6. Run the release

```powershell
npm run release -- patch    # 0.2.0 -> 0.2.1 (fixes)
npm run release -- minor    # 0.2.0 -> 0.3.0 (new things)
npm run release -- major    # 0.2.0 -> 1.0.0 (big changes)
```

The script refuses unless the tree is clean, you are on `main` and `GH_TOKEN` is set (it says which, and never prints the token). Then it runs, in
this order: typecheck, ESLint, the tests, the version bump, the build (with the guard that no mock code and no dev update switch ships, and that the
feed is the releases repository), and the upload of a **draft** release `v<version>`. At the end it commits the version bump and tags it
locally. If a step fails after the bump, `package.json` and `package-lock.json` are put back. If the upload fails halfway, look in the releases
repository for a half-uploaded draft and delete it before you try again.

## 7. Review and publish the draft, then push

1. Open `https://github.com/ItsTheBoyLuc/nexus-desktop-releases/releases`. The new release is marked **Draft**.
2. Check the files: `Nexus-Setup-<version>-x64.exe`, its `.blockmap`, `latest.yml` and the portable `.exe`.
3. Write the **release notes**. The app shows them as plain text (formatting is removed), so a few short lines are best.
4. Do **not** tick *pre-release*: the app never offers pre-releases.
5. Press **Publish release**. From now on installed apps can see it.
6. In the source repository run `git push origin main --tags`.

## What users will see

- A small badge on the **Preferences** button in the sidebar: *Update 0.3.0 available* (after the silent check, within about 6 hours or at the next start).
- In **Preferences, App updates**: the current version, **Check for updates**, and the state: checking, up to date, update available (new version
  and the release notes as plain text), downloading with progress, ready with **Restart and install**, or a plain error message.
- **Restart and install** is switched off, with the reason written next to it, while a save, post or delete is in progress.
- The installer runs silently and Nexus starts again. Settings and the saved sign-in are kept (they live outside the install folder).

## If something goes wrong

- **Nobody sees the update:** the release is still a draft, or it was marked pre-release, or the version is not higher than the installed one.
- **"Could not check for updates":** the user is offline or GitHub is unreachable. The app keeps working; it tries again at the next check.
- **A bad release:** delete or un-publish it on GitHub and publish a fixed one with a higher version. The app never installs an older version.
- **The token leaked:** delete it on GitHub at once (it can only write to the releases repository) and create a new one.

## Unsigned updates: the risk

The installer is not code-signed. The SHA-512 in `latest.yml` protects against a damaged download, but both files come from the same GitHub
release, so **whoever can write to the releases repository (or steals the token) can ship code to every user**. Keep the token short-lived and
limited to that one repository, and consider a code-signing certificate later.
