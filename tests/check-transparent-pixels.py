"""Verify actual zero-shade PNG pixels; separate from text-contrast checks."""
import argparse
import importlib.util
import json
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("control_pixels", Path(__file__).with_name("check-control-pixels.py"))
pixels = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixels)


def verify(manifest):
    captures = json.loads(manifest.read_text(encoding="utf-8-sig"))
    assert captures, "No transparency captures"
    results, backdrops = [], set()
    for capture in captures:
        meta = capture["metadata"]
        assert meta["surfaceDensity"] == 0 and meta["ambientActive"], "Requires the active zero endpoint"
        backdrop = meta["backdrop"]
        assert backdrop in ("black", "white"), "Requires a uniform black or white reference"
        expected = 0 if backdrop == "black" else 255
        backdrops.add(backdrop)
        native = meta["nativeChecks"]
        assert not native["failures"], native["failures"]
        assert native["originalSvgCount"] == native["expectedSvgCount"] > 0
        image_path = manifest.parent / capture["image"]
        with Image.open(image_path) as source:
            assert source.format == "PNG", "Use lossless PNG for exact transparency"
            image = source.convert("RGB")
        view = meta["viewport"]
        viewport = {"x": 0, "y": 0, "width": view["width"], "height": view["height"]}
        scale = (image.width / view["width"], image.height / view["height"])
        measured = meta["measurements"]
        assert {item["id"] for item in measured} == set(pixels.EXPECTED_ROLES), "Missing controls"
        assert len(measured) == len(pixels.EXPECTED_ROLES), "Duplicated controls"
        auxiliary = [meta["themeHover"]] if "themeHover" in meta else []
        for item in measured + auxiliary:
            face = pixels.rectangle(item["rect"], item["id"])
            region = pixels.rectangle(item["sampleRegion"], item["id"] + ".sample")
            sample = pixels.sample_background(image, region, face, viewport, scale)
            assert pixels.css_color(item["backgroundColor"])[1] == 0, "Face paint is not transparent"
            deviation = max(abs(channel - expected) for pixel in sample["_pixels"] for channel in pixel)
            assert deviation == 0, f'{capture["label"]}/{item["id"]}: backdrop changed by {deviation}'
            results.append({"capture": capture["label"], "id": item["id"], "pixelCount": sample["pixelCount"], "maxBackdropDeviation": deviation})
    assert backdrops == {"black", "white"}, "Both bright and dark references are required"
    return {"pass": True, "scope": "Active zero-shade faces preserve every sampled black/white PNG pixel; text contrast is intentionally tested separately at the standard shade.", "measurements": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.manifest)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f'PASS: {len(result["measurements"])} fully transparent face measurements; every backdrop pixel unchanged.')
