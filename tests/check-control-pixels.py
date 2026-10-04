#!/usr/bin/env python3
"""Verify shared-control contrast from actual browser screenshots.

Usage: python tests/check-control-pixels.py captures.json [--output result.json]
The manifest is a nonempty [{label, image, metadata}] list. Relative image paths
are resolved against the manifest directory. Metadata is parsed from the local
control fixture's #fixture-control-result.dataset.measurements. No background
color is reconstructed from CSS or a filter formula.
"""

import argparse
import json
import math
import re
import statistics
import sys
from pathlib import Path

from PIL import Image


MIN_PATCH_SIDE = 9
MAX_CHANNEL_DEVIATION = 12
MAX_CHANNEL_RANGE = 24
THRESHOLDS = {"primary": 4.5, "icon": 3.0, "disabled": None, "semantic": None}
# A partial capture must not silently turn "all shared controls" into a smaller
# passing subset. These are the named cases in control-fixture.html.
EXPECTED_ROLES = {"tonal": "primary", "filled": "primary", "outline": "primary",
                  "text": "primary", "selected": "primary", "disabled": "disabled",
                  "chip-normal": "primary", "chip-selected": "primary", "chip-arrow": "icon",
                  "enhancer": "icon", "search-modern": "primary", "search-legacy": "primary",
                  "search-modern-button": "icon", "search-legacy-button": "icon"}


class MeasurementError(ValueError):
    pass


def finite(value, label, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise MeasurementError(f"{label} must be a finite number")
    if minimum is not None and value < minimum:
        raise MeasurementError(f"{label} must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise MeasurementError(f"{label} must be at most {maximum}")
    return float(value)


def numeric_string(value, label, minimum=0, maximum=1):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise MeasurementError(f"{label} is not numeric") from error
    return finite(number, label, minimum, maximum)


def rectangle(value, label):
    if not isinstance(value, dict):
        raise MeasurementError(f"{label} must be an object")
    return {key: finite(value.get(key), f"{label}.{key}", 0 if key in ("width", "height") else None)
            for key in ("x", "y", "width", "height")}


def contains(outer, inner, tolerance=0.01):
    return (inner["x"] >= outer["x"] - tolerance and inner["y"] >= outer["y"] - tolerance
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tolerance
            and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + tolerance)


def css_color(value):
    """Parse resolved RGB/RGBA colors; unsupported color spaces fail explicitly."""
    if not isinstance(value, str):
        raise MeasurementError("computed foreground must be a resolved RGB color")
    match = re.fullmatch(r"rgba?\(([^()]+)\)", value.strip(), re.IGNORECASE)
    if not match:
        raise MeasurementError(f"Unsupported computed foreground: {value!r}")
    parts = re.split(r"\s*[,/]\s*|\s+", match.group(1).strip())
    if len(parts) not in (3, 4):
        raise MeasurementError(f"Invalid computed foreground: {value!r}")
    channels = []
    for index, part in enumerate(parts):
        maximum = 255 if index < 3 else 1
        try:
            amount = float(part[:-1]) * maximum / 100 if part.endswith("%") else float(part)
        except ValueError as error:
            raise MeasurementError(f"Invalid computed foreground: {value!r}") from error
        channels.append(finite(amount, "color component", 0, maximum))
    return channels[:3], channels[3] if len(channels) == 4 else 1.0


def composite(foreground, alpha, background):
    return [foreground[i] * alpha + background[i] * (1 - alpha) for i in range(3)]


def luminance(rgb):
    values = [channel / 255 for channel in rgb]
    values = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
              for value in values]
    return sum(value * weight for value, weight in zip(values, (0.2126, 0.7152, 0.0722)))


def contrast(foreground, background):
    high, low = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def sample_background(image, region, target, viewport, scale):
    if target["width"] <= 0 or target["height"] <= 0:
        raise MeasurementError("target has empty geometry")
    if region["width"] <= 0 or region["height"] <= 0:
        raise MeasurementError("background sample has empty geometry")
    if not contains(target, region):
        raise MeasurementError("background sample extends beyond its control face")
    if not contains(viewport, region, 0):
        raise MeasurementError("background sample is outside the captured viewport")
    # Select pixel centers inside the CSS rectangle. This retains all nine
    # pixels of a 9px region even when its CSS origin is a half pixel.
    left = math.ceil(region["x"] * scale[0] - 0.5)
    top = math.ceil(region["y"] * scale[1] - 0.5)
    right = math.ceil((region["x"] + region["width"]) * scale[0] - 0.5)
    bottom = math.ceil((region["y"] + region["height"]) * scale[1] - 0.5)
    if left < 0 or top < 0 or right > image.width or bottom > image.height:
        raise MeasurementError("mapped sample is outside the screenshot")
    if right - left < MIN_PATCH_SIDE or bottom - top < MIN_PATCH_SIDE:
        raise MeasurementError("mapped background patch must be at least 9x9 image pixels")
    patch = image.crop((left, top, right, bottom))
    # Pillow 12.3 deprecates getdata(); retain compatibility with earlier bundled
    # runtimes without adding another dependency or changing the sampled pixels.
    pixels = list(patch.get_flattened_data() if hasattr(patch, "get_flattened_data") else patch.getdata())
    median = [statistics.median(pixel[channel] for pixel in pixels) for channel in range(3)]
    deviations = [max(abs(pixel[channel] - median[channel]) for channel in range(3)) for pixel in pixels]
    channel_ranges = [max(pixel[channel] for pixel in pixels) - min(pixel[channel] for pixel in pixels)
                      for channel in range(3)]
    stats = {"medianRGB": median, "pixelRect": {"x": left, "y": top,
             "width": right - left, "height": bottom - top}, "pixelCount": len(pixels),
             "maxChannelDeviation": max(deviations), "channelRanges": channel_ranges}
    if max(deviations) > MAX_CHANNEL_DEVIATION or max(channel_ranges) > MAX_CHANNEL_RANGE:
        raise MeasurementError("background patch is nonuniform or contaminated by glyphs, shadows, "
                               f"rounded edges or a gradient: {json.dumps(stats)}")
    # Retain the exact decoded screenshot samples for the stricter contrast
    # decision. These private pixels are removed before constructing JSON.
    stats["_pixels"] = pixels
    return stats


def patch_contrast(foreground, alpha, sampled, pixels):
    median_foreground = composite(foreground, alpha, sampled["medianRGB"])
    median_ratio = contrast(median_foreground, sampled["medianRGB"])
    # JPEG ringing can perturb an otherwise blank patch. Permit a small codec
    # spread, but never average away a low-contrast pixel: every retained pixel
    # participates, with its own alpha-composited foreground.
    ratio, index = min((contrast(composite(foreground, alpha, pixel), pixel), index)
                       for index, pixel in enumerate(pixels))
    worst_background = list(pixels[index])
    details = {"contrastRatio": round(ratio, 6), "medianContrastRatio": round(median_ratio, 6),
               "compositedForegroundRGB": median_foreground,
               "worstBackgroundRGB": worst_background,
               "worstCompositedForegroundRGB": composite(foreground, alpha, worst_background),
               "worstPixelOffset": {"x": index % sampled["pixelRect"]["width"],
                                    "y": index // sampled["pixelRect"]["width"]}}
    return ratio, details


def check_target(target, image, viewport, scale, active):
    if not isinstance(target, dict):
        raise MeasurementError("measurement must be an object")
    identifier = target.get("id")
    if not isinstance(identifier, str) or not identifier.strip():
        raise MeasurementError("measurement id must be nonempty")
    role = target.get("role")
    if role not in THRESHOLDS or EXPECTED_ROLES.get(identifier) != role:
        raise MeasurementError(f"{identifier}: unsupported or missing role {role!r}")
    expected = THRESHOLDS[role]
    if "minContrast" not in target or target["minContrast"] != expected:
        raise MeasurementError(f"{identifier}: minContrast must be {expected!r} for role {role}")
    box = rectangle(target.get("rect"), f"{identifier}.rect")
    region = rectangle(target.get("sampleRegion"), f"{identifier}.sampleRegion")
    sampled = sample_background(image, region, box, viewport, scale)
    pixels = sampled.pop("_pixels")
    foreground, alpha = css_color(target.get("computedForeground"))
    uses_placeholder = target.get("usesPlaceholder", False)
    if not isinstance(uses_placeholder, bool):
        raise MeasurementError(f"{identifier}: usesPlaceholder must be boolean")
    if uses_placeholder:
        placeholder = target.get("placeholder")
        if not isinstance(placeholder, dict):
            raise MeasurementError(f"{identifier}: placeholder metadata is missing")
        foreground, alpha = css_color(placeholder.get("color"))
        alpha *= numeric_string(placeholder.get("opacity"), f"{identifier}.placeholder.opacity")
    opacity = numeric_string(target.get("opacity"), f"{identifier}.opacity")
    if expected is not None and opacity != 1:
        raise MeasurementError(f"{identifier}: translucent control group cannot be validated "
                               "as opaque primary/icon text from one background patch")
    ratio, contrast_details = patch_contrast(foreground, alpha, sampled, pixels)
    record = {"id": identifier, "role": role, **sampled, **contrast_details,
              "computedForeground": foreground, "foregroundAlpha": alpha, "elementOpacity": opacity,
              "minimumContrast": expected, "usesPlaceholder": uses_placeholder,
              "thresholdEnforced": active and expected is not None,
              "pass": not active or expected is None or ratio >= expected, "icons": []}
    if role == "disabled":
        record["note"] = "Reported CSS foreground ratio does not certify disabled group appearance."
    icons = target.get("icons")
    if not isinstance(icons, list):
        raise MeasurementError(f"{identifier}: icons must be an array")
    for index, icon in enumerate(icons):
        if not isinstance(icon, dict) or not isinstance(icon.get("semanticPink"), bool):
            raise MeasurementError(f"{identifier}: malformed icon metadata")
        icon_rgb, icon_alpha = css_color(icon.get("fill"))
        icon_box = rectangle(icon.get("rect"), f"{identifier}.icons[{index}].rect")
        point = icon.get("point")
        if not isinstance(point, dict):
            raise MeasurementError(f"{identifier}: icon sampling point is missing")
        icon_point = {"x": finite(point.get("x"), "icon point.x"),
                      "y": finite(point.get("y"), "icon point.y"), "width": 0, "height": 0}
        if (icon_box["width"] <= 0 or icon_box["height"] <= 0 or not contains(box, icon_box)
                or not contains(viewport, icon_box, 0) or not contains(icon_box, icon_point, 0)):
            raise MeasurementError(f"{identifier}: icon geometry is empty or outside the capture/control")
        icon_ratio, icon_details = patch_contrast(icon_rgb, icon_alpha, sampled, pixels)
        semantic = icon["semanticPink"]
        if semantic and (icon_rgb != [255.0, 64.0, 129.0] or icon_alpha != 1):
            raise MeasurementError(f"{identifier}: native semantic pink fill changed")
        enforce = active and not semantic and role != "disabled"
        icon_pass = not enforce or icon_ratio >= 3
        record["icons"].append({"index": index, "fillRGB": icon_rgb, "fillAlpha": icon_alpha,
                                "semanticPink": semantic, **icon_details,
                                "thresholdEnforced": enforce, "minimumContrast": None if semantic else 3,
                                "pass": icon_pass,
                                "evidence": "Resolved SVG fill against screenshot background; "
                                            "solid point is geometry-validated, not pixel-sampled."})
        record["pass"] = record["pass"] and icon_pass
    return record


def check_capture(capture, manifest_directory):
    record = {"label": capture.get("label") if isinstance(capture, dict) else None,
              "pass": False, "measurements": [], "failures": []}
    try:
        if not isinstance(capture, dict):
            raise MeasurementError("capture must be an object")
        if not isinstance(record["label"], str) or not record["label"].strip():
            raise MeasurementError("capture label must be nonempty")
        image_value = capture.get("image")
        if not isinstance(image_value, str) or not image_value.strip():
            raise MeasurementError("capture image path must be nonempty")
        image_path = Path(image_value)
        if not image_path.is_absolute():
            image_path = manifest_directory / image_path
        record["image"] = str(image_path.resolve())
        metadata = capture.get("metadata")
        if not isinstance(metadata, dict):
            raise MeasurementError("metadata must be a parsed object")
        if metadata.get("mode") not in ("dark", "light"):
            raise MeasurementError("metadata.mode must be dark or light")
        if not isinstance(metadata.get("ambientActive"), bool):
            raise MeasurementError("metadata.ambientActive must be boolean")
        if metadata.get("backdrop") not in ("black", "white", "color"):
            raise MeasurementError("metadata.backdrop is invalid")
        view = metadata.get("viewport")
        if not isinstance(view, dict):
            raise MeasurementError("metadata.viewport must be an object")
        viewport = {"x": 0, "y": 0,
                    "width": finite(view.get("width"), "viewport.width", 1),
                    "height": finite(view.get("height"), "viewport.height", 1)}
        finite(view.get("devicePixelRatio"), "viewport.devicePixelRatio", 0.1, 16)
        finite(view.get("scrollX"), "viewport.scrollX")
        finite(view.get("scrollY"), "viewport.scrollY")
        native = metadata.get("nativeChecks")
        if not isinstance(native, dict) or not isinstance(native.get("failures"), list):
            raise MeasurementError("metadata.nativeChecks.failures must be an array")
        count = native.get("originalSvgCount")
        if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
            raise MeasurementError("native original SVG count must be a positive integer")
        expected_count = native.get("expectedSvgCount")
        if isinstance(expected_count, bool) or not isinstance(expected_count, int) or expected_count <= 0:
            raise MeasurementError("expected original SVG count must be a positive integer")
        if count != expected_count:
            raise MeasurementError("original SVG count differs from expected count")
        if not all(isinstance(failure, str) and failure for failure in native["failures"]):
            raise MeasurementError("native failures must contain nonempty strings")
        if not isinstance(native.get("offRestoration"), bool):
            raise MeasurementError("native offRestoration must be boolean")
        if native["offRestoration"] != (not metadata["ambientActive"]):
            raise MeasurementError("native OFF restoration evidence disagrees with ambient state")
        record["nativeChecks"] = native
        record["failures"].extend(native["failures"])
        measurements = metadata.get("measurements")
        if not isinstance(measurements, list) or not measurements:
            raise MeasurementError("metadata.measurements must be a nonempty array")
        ids = [item.get("id") for item in measurements if isinstance(item, dict)]
        if len(ids) != len(measurements) or len(set(str(identifier) for identifier in ids)) != len(ids):
            raise MeasurementError("measurement ids must be unique")
        if set(ids) != set(EXPECTED_ROLES):
            raise MeasurementError("capture must include all fixture cases; missing="
                                   f"{sorted(set(EXPECTED_ROLES) - set(ids))}, "
                                   f"extra={sorted(set(ids) - set(EXPECTED_ROLES))}")
        if sum(len(item.get("icons", [])) for item in measurements) != count:
            raise MeasurementError("measured icon count differs from original SVG count")
        with Image.open(image_path) as source:
            if source.width < 1 or source.height < 1:
                raise MeasurementError("screenshot is empty")
            # A transparent screenshot cannot establish the final painted backdrop.
            if ("A" in source.getbands() or "transparency" in source.info) and source.convert("RGBA").getchannel("A").getextrema() != (255, 255):
                raise MeasurementError("screenshot contains transparent pixels")
            image = source.convert("RGB")
        scale = (image.width / viewport["width"], image.height / viewport["height"])
        if abs(scale[0] - scale[1]) / max(scale) > 0.005:
            raise MeasurementError("screenshot aspect ratio differs from its CSS viewport; "
                                   "use an uncropped viewport screenshot and matching metadata")
        record.update({"mode": metadata["mode"], "ambientActive": metadata["ambientActive"],
                       "backdrop": metadata["backdrop"], "viewport": view,
                       "imageSize": {"width": image.width, "height": image.height},
                       "scale": {"x": scale[0], "y": scale[1]}})
        for target in measurements:
            try:
                measured = check_target(target, image, viewport, scale, metadata["ambientActive"])
                record["measurements"].append(measured)
                if not measured["pass"]:
                    record["failures"].append(f"{measured['id']}: measured foreground/icon contrast below threshold")
            except (MeasurementError, TypeError, ValueError) as error:
                record["failures"].append(f"{target.get('id', '<unknown>')}: {error}")
        record["pass"] = not record["failures"] and len(record["measurements"]) == len(measurements)
    except (OSError, MeasurementError, TypeError, ValueError) as error:
        record["failures"].append(str(error))
    return record


def print_summary(result, output_path, exit_code):
    captures = result["captures"]
    passed = sum(capture["pass"] for capture in captures)
    state = "PASS" if exit_code == 0 else "FAIL"
    print(f"{state}: {len(captures)} captures ({passed} passed), "
          f"{result.get('measurementCount', 0)} measurements, "
          f"{result.get('failureCount', 0)} failures.")
    for key, label in (("worstPrimary", "Worst primary"), ("worstNativeIcon", "Worst native icon fill")):
        worst = result.get(key)
        if worst is None:
            print(f"{label}: no valid active measurement.")
        else:
            index = f" / icon {worst['iconIndex']}" if "iconIndex" in worst else ""
            print(f"{label}: {worst['contrastRatio']:.6f}:1 "
                  f"({worst['label']} / {worst['id']}{index}).")
    # Keep stdout usable even when a whole capture matrix fails. The complete
    # per-measurement values and every failure remain in the output JSON.
    detail_budget = 24
    omitted = 0
    for failure in result["failures"]:
        print(f"- {failure}")
    for capture in captures:
        failures = capture["failures"]
        if not failures:
            continue
        print(f"- {capture['label']}: {len(failures)} failure(s)")
        for failure in failures:
            if detail_budget <= 0:
                omitted += 1
                continue
            brief = " ".join(failure.split())
            if len(brief) > 300:
                brief = brief[:297] + "..."
            print(f"  {brief}")
            detail_budget -= 1
    if omitted:
        print(f"{omitted} additional failure details are in the full JSON.")
    print(f"Full JSON: {output_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = {"pass": False,
              "scope": "Actual screenshot patch pixels plus resolved CSS foreground alpha; "
                       "every patch pixel is alpha-composited individually and the minimum "
                       "contrast decides pass/fail. Median values are reporting only. "
                       "Local fixture evidence only. No CSS background/filter formula is used. "
                       "Icon ratios use resolved SVG fill, not sampled glyph pixels, and do not "
                       "certify glyph rasterization or native YouTube initialization.",
              "patchPolicy": {"minimumImageSide": MIN_PATCH_SIDE,
                              "maximumChannelDeviation": MAX_CHANNEL_DEVIATION,
                              "maximumChannelRange": MAX_CHANNEL_RANGE,
                              "codecSpread": "Small decoded JPEG spread is tolerated; larger "
                                             "glyph/edge/gradient contamination is rejected.",
                              "passContrastStatistic": "Minimum across every actual patch pixel; "
                                                       "primary 4.5 and icon 3 thresholds unchanged."},
              "captures": [], "failures": []}
    exit_code = 1
    try:
        captures = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        if not isinstance(captures, list) or not captures:
            raise MeasurementError("capture manifest must be a nonempty array")
        labels = [item.get("label") for item in captures if isinstance(item, dict)]
        if len(labels) != len(captures) or len(set(str(label) for label in labels)) != len(labels):
            raise MeasurementError("capture labels must be unique")
        result["captures"] = [check_capture(capture, args.manifest.resolve().parent) for capture in captures]
        result["measurementCount"] = sum(len(capture["measurements"]) for capture in result["captures"])
        result["failureCount"] = sum(len(capture["failures"]) for capture in result["captures"])
        primary = []
        native_icons = []
        for capture in result["captures"]:
            for measured in capture["measurements"]:
                if measured["thresholdEnforced"]:
                    item = {"label": capture["label"], "id": measured["id"],
                            "contrastRatio": measured["contrastRatio"], "pass": measured["pass"]}
                    (primary if measured["role"] == "primary" else native_icons).append(item)
                for icon in measured["icons"]:
                    if icon["thresholdEnforced"]:
                        native_icons.append({"label": capture["label"], "id": measured["id"],
                                             "iconIndex": icon["index"], "contrastRatio": icon["contrastRatio"],
                                             "pass": icon["pass"]})
        result["worstPrimary"] = min(primary, key=lambda item: item["contrastRatio"], default=None)
        result["worstNativeIcon"] = min(native_icons, key=lambda item: item["contrastRatio"], default=None)
        if not primary or not native_icons:
            result["failures"].append("No active primary/icon contrast evidence; OFF-only or failed samples cannot establish a contrast pass.")
        result["pass"] = not result["failures"] and all(capture["pass"] for capture in result["captures"])
        exit_code = 0 if result["pass"] else 1
    except (OSError, MeasurementError, json.JSONDecodeError) as error:
        result["failures"].append(str(error))
        exit_code = 2
    result["failureCount"] = (sum(len(capture["failures"]) for capture in result["captures"])
                              + len(result["failures"]))
    rendered = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        try:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        except OSError as error:
            print(f"Cannot write result: {error}", file=sys.stderr)
            exit_code = 2
        print_summary(result, args.output, exit_code)
    else:
        print(rendered, end="")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
