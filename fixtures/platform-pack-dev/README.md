# Platform Pack Dev Fixture

This fixture is for Tauri hand testing the Plugin Development Workspace `platform-pack` profile.

Workflow:

1. Prepare a writable copy:

```powershell
node scripts/platform-pack-dev-fixture.mjs prepare
```

2. In the app, open `Plugin Development Workspace`, switch to `Platform Pack`, and select the printed fixture directory.
3. Bind the dev instance, then click `Open Workspace`.
4. Change the visible runtime text:

```powershell
node scripts/platform-pack-dev-fixture.mjs set-text "PMP Dev Fixture v2"
```

5. For manual reload smoke, click `Reload Pack`. The platform workspace should remount and show the new text.
6. For watcher smoke, enable `Auto reload`, run `set-text` again, and verify the watcher records a runtime-only change and an automatic reload. Manifest or contract edits should appear as pending and wait for `Confirm Reload`.

Current local branch note: after `refactor(platform): archive p-login platform module`, the full `PackWorkspaceMount` GUI target is not present in the active source tree. The fixture and script still preserve the repeatable smoke protocol for the next branch that restores the platform workspace chain.
