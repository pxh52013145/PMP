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

5. Click `Reload Pack` in the Plugin Development Workspace. The platform workspace should remount and show the new text.
