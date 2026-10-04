"""Reproducible store/source archives. Python 3.9+, standard library only."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
if json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"] != VERSION:
    raise ValueError("manifest.json and package.json versions must match before building")
EXTENSION_FILES = ["settings-store.js", "black-bar-detector.js", "renderer.js", "gpu-renderer.js", "flash-monitor.js", "worker-client.js",
                   "worker-host.html", "worker-host.js", "ambient-worker.js", "lucide-icons.js", "ambient.js", "ambient.css", "watch-sidebar.js", "watch-sidebar.css", "site-registry.js", "playback-card.js", "choice-menu.js", "color-picker.js", "quick-panel.js", "settings-backup.js", "settings-dialog.js", "media-controller.js", "site-appearance.js", "extension-background.js", "settings.html", "settings-page.js", "channel-card.js", "channel-bridge.js", "LICENSE", "THIRD-PARTY-NOTICES.txt"] + [
    f"assets/icon-{size}.png" for size in (16, 32, 48, 96, 128)
]
# Explicit public source allowlist. Private development context and captures are excluded.
SOURCE_FILES = ["manifest.json", "README.md", "PRIVACY.md", "CONTRIBUTING.md", "LICENSE", ".gitignore", ".gitattributes",
                ".github/workflows/quality.yml", "package.json", "scripts/build.py", "scripts/create_assets.py",
                "scripts/native-preview.cjs", "scripts/import-design-capture.py", "docs/LISTING.md", "docs/PUBLISHING.md", "docs/VALIDATION-3.1.3.md"] + [
    p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "tests").iterdir()) if p.suffix in (".js", ".cjs", ".html", ".css", ".py")
]
STORE_FILES = ["assets/store-promo-440x280.png", "assets/store-settings-1280x800.png", "assets/store-channel-1280x800.png"]
FIREFOX_SETTINGS = {"gecko": {"id": "flexible-ui@rezerv-amaghini.github.io", "strict_min_version": "140.0",
                               "data_collection_permissions": {"required": ["none"]}}}


def validate_manifest(manifest, browser, files):
    """Reject browser-incompatible background declarations before delivery."""
    if manifest.get("manifest_version") != 3:
        raise ValueError("Flexible UI requires Manifest V3")
    background = manifest.get("background", {})
    if browser == "chrome":
        if not background.get("service_worker") or any(key in background for key in ("scripts", "page", "persistent")):
            raise ValueError("Chrome Manifest V3 requires a service_worker without scripts, page or persistent")
        if "browser_specific_settings" in manifest:
            raise ValueError("Firefox-specific settings must not appear in the Chrome manifest")
        scripts = [background["service_worker"]]
    elif browser == "firefox":
        if not background.get("scripts") or "service_worker" in background or "page" in background:
            raise ValueError("Firefox requires background scripts without service_worker or page")
        if manifest.get("browser_specific_settings") != FIREFOX_SETTINGS:
            raise ValueError("Firefox must use the Flexible UI extension identity and minimum version")
        scripts = background["scripts"]
    else:
        raise ValueError("Unknown browser target")
    if any(script not in files for script in scripts):
        raise ValueError("A background entry point is missing from the extension files")


def archive(name, entries):
    target = DIST / name
    if target.parent.resolve() != DIST.resolve():
        raise ValueError("Output must remain in dist")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for filename, content in sorted(entries.items()):
            info = zipfile.ZipInfo(filename, (2026, 9, 30, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            output.writestr(info, content)
    with zipfile.ZipFile(target) as output:
        assert output.testzip() is None
    return {"file": name, "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def main():
    DIST.mkdir(exist_ok=True)
    base = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    entries = {name: (ROOT / name).read_bytes() for name in EXTENSION_FILES}
    validate_manifest(base, "chrome", entries)
    reports = []
    for browser in ("chrome", "firefox"):
        manifest = json.loads(json.dumps(base))
        if browser == "firefox":
            manifest.pop("minimum_chrome_version", None)
            manifest["background"] = {"scripts": ["extension-background.js"]}
            manifest["browser_specific_settings"] = json.loads(json.dumps(FIREFOX_SETTINGS))
        validate_manifest(manifest, browser, entries)
        package = {**entries, "manifest.json": (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()}
        reports.append(archive(f"flexible-ui-{browser}-{VERSION}.zip", package))
        folder = DIST / browser
        folder.mkdir(exist_ok=True)
        for name, content in package.items():
            destination = folder / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    public_files = list(dict.fromkeys(SOURCE_FILES + EXTENSION_FILES + STORE_FILES))
    reports.append(archive(f"flexible-ui-source-{VERSION}.zip",
        {name: (ROOT / name).read_bytes() for name in public_files}))
    store = {Path(name).name: (ROOT / name).read_bytes() for name in STORE_FILES}
    store["icon-128.png"] = (ROOT / "assets/icon-128.png").read_bytes()
    store["LISTING.md"] = (ROOT / "docs/LISTING.md").read_bytes()
    reports.append(archive(f"flexible-ui-store-assets-{VERSION}.zip", store))
    (DIST / "SHA256SUMS.txt").write_text("".join(f'{r["sha256"]}  {r["file"]}\n' for r in reports), encoding="utf-8")
    print(json.dumps(reports, indent=2))


if __name__ == "__main__":
    main()
