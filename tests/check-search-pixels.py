"""Measure local surface screenshots without treating JPEG as lossless proof."""
import argparse
import importlib.util
import json
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location(
    "control_pixels", Path(__file__).with_name("check-control-pixels.py"))
pixels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixels)

SCOPES = {
    "search": ({"modern-normal", "modern-history", "legacy-history", "mini-active",
                "voice-title", "confirm-title"},
               "Self-authored modern/legacy suggestions, mini-guide and simulated voice/confirmation dialogs."),
    "reading": ({f"{pane}-{role}" for pane in ("description", "comments", "related")
                 for role in ("primary", "secondary", "accent")},
                "Self-authored description, comment and related-result panes, with primary, secondary and native accent foregrounds."),
    "reading-metadata": ({f"{pane}-{role}" for pane in ("metadata", "description", "comments", "related")
                          for role in ("primary", "secondary", "accent")},
                         "Self-authored modern title/channel/description owner, comments and related results, with primary, secondary and native accent foregrounds."),
    "overlays": ({"dialog-primary", "dialog-secondary", "dialog-accent", "player-primary", "player-secondary", "player-secondary-normal"},
                  "Self-authored share-layout dialog and native-shaped player menu. Player foreground composition retains its original 0.9 popup group opacity."),
    "hover-surfaces": ({"card-primary", "card-secondary", "card-accent", "tooltip-modern", "tooltip-paper", "tooltip-legacy", "tooltip-nested", "tooltip-promo"},
                       "Self-authored cached legacy card shapes and known modern/legacy/player tooltip shapes; full-opacity native foregrounds only. Current YouTube hover/portal initialization is not verified.")
}


def verify(manifest_path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    scope = manifest.get("scope", "search")
    assert scope in SCOPES, "Unsupported surface scope"
    expected, scope_text = SCOPES[scope]
    assert manifest["geometryStable"] and manifest["semanticStable"], "Native states or geometry changed"
    measured = manifest["measurements"]
    assert len(measured) == len(expected) and {item["id"] for item in measured} == expected
    view = manifest["viewport"]
    viewport = {"x": 0, "y": 0, "width": view["width"], "height": view["height"]}
    matrix = {(theme, backdrop, level) for theme in ("light", "dark")
              for backdrop in ("white", "black") for level in (0, 1)}
    captures = manifest["captures"]
    assert len(captures) == len(matrix)
    assert {(c["theme"], c["backdrop"], c["level"]) for c in captures} == matrix
    results = []
    for capture in captures:
        assert len(capture["colors"]) == len(measured)
        assert capture["opacities"] == [1] * len(measured), "Translucent foreground group"
        if scope == "overlays":
            assert manifest["nativeOpacityRetained"], "Native popup opacity changed"
            assert capture["groupOpacities"] == [1, 1, 1, .9, .9, .9], "Unexpected native foreground group"
        else:
            assert "groupOpacities" not in capture, "Unverified group compositing outside overlay scope"
        with Image.open(manifest_path.parent / capture["image"]) as source:
            image_format = source.format
            assert image_format in ("PNG", "JPEG"), "Unsupported screenshot format"
            image = source.convert("RGB")
        scale = (image.width / view["width"], image.height / view["height"])
        static_underlays = {}
        if scope == "overlays":
            references = capture["references"]
            assert len(references) == 2 and {r["id"] for r in references} == {"page", "player"}
            expected_underlay = 255 if capture["backdrop"] == "white" else 0
            for reference in references:
                foreground, alpha = pixels.css_color(capture["underlays"][reference["id"]])
                assert alpha == 1 and foreground == [expected_underlay] * 3, "Static underlay is not opaque"
                sample = pixels.sample_background(
                    image, pixels.rectangle(reference["sampleRegion"], "underlay.sample"),
                    pixels.rectangle(reference["rect"], "underlay.rect"), viewport, scale)
                samples = sample.pop("_pixels")
                deviation = max(abs(channel - expected_underlay) for pixel in samples for channel in pixel)
                # These padding references are intentionally far from media,
                # text and shadows. Their decoded pixels must remain exact even
                # in this JPEG matrix; this is not lossless transparency proof.
                assert deviation == 0, "Unfiltered static reference contains other paint"
                static_underlays[reference["id"]] = sample
        for index, item in enumerate(measured):
            face = pixels.rectangle(item["rect"], item["id"])
            region = pixels.rectangle(item["sampleRegion"], item["id"] + ".sample")
            sample = pixels.sample_background(image, region, face, viewport, scale)
            samples = sample.pop("_pixels")
            record = {"capture": capture["label"], "id": item["id"],
                      "imageFormat": image_format, **sample}
            if capture["level"] == 0:
                expected = 255 if capture["backdrop"] == "white" else 0
                deviation = max(abs(channel - expected) for pixel in samples for channel in pixel)
                record["maxBackdropDeviation"] = deviation
                record["exactTransparencyEnforced"] = image_format == "PNG"
                if image_format == "PNG":
                    assert deviation == 0, f'{capture["label"]}/{item["id"]}: backdrop changed by {deviation}'
                else:
                    record["note"] = "JPEG is lossy; this reports sampled deviation and does not prove exact transparency."
            else:
                foreground, alpha = pixels.css_color(capture["colors"][index])
                if scope == "overlays" and capture["groupOpacities"][index] < 1:
                    # Filter Effects 2 draws the foreground into the filtered
                    # buffer, then applies the native group opacity and composites
                    # that buffer onto the static, unfiltered parent reference.
                    # Do not attenuate the glyph a second time over face pixels.
                    assert alpha == 1, "Nested translucent glyph needs separate compositing evidence"
                    group = capture["groupOpacities"][index]
                    underlay = static_underlays["player"]["medianRGB"]
                    foreground = [channel * group + underlay[i] * (1 - group)
                                  for i, channel in enumerate(foreground)]
                    record["nativeGroupOpacity"] = group
                    record["unfilteredStaticUnderlay"] = underlay
                ratio, details = pixels.patch_contrast(foreground, alpha, sample, samples)
                assert ratio >= 4.5, f'{capture["label"]}/{item["id"]}: contrast {ratio:.6f}'
                record.update(details)
            results.append(record)
    return {"pass": True,
            "scope": scope_text + " Actual screenshot backgrounds and resolved native foregrounds, both themes and static extremes. JPEG cannot prove exact zero-shade pixels. Not current YouTube DOM or arbitrary reduced shades.",
            "measurements": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.manifest)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    contrast = [r["contrastRatio"] for r in result["measurements"] if "contrastRatio" in r]
    zero = [r for r in result["measurements"] if "maxBackdropDeviation" in r]
    exact = sum(r["exactTransparencyEnforced"] for r in zero)
    print(f'PASS: {len(contrast)} standard-shade contrast measurements; minimum {min(contrast):.6f}:1. Zero-shade: {exact}/{len(zero)} lossless measurements; remaining JPEG measurements do not certify exact transparency.')
