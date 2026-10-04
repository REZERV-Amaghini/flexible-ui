"""Import a browser MHTML export into the private local design stage cache."""
import html
import json
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".tool-cache"
folder = Path(sys.argv[1]).resolve()
if not folder.is_relative_to(CACHE.resolve()):
    raise ValueError("Capture must stay inside the project's private tool cache")
output = folder / "rendered"
output.mkdir(exist_ok=True)
(output / "assets").mkdir(exist_ok=True)
message = BytesParser(policy=policy.default).parsebytes((folder / "source.mhtml").read_bytes())
parts = [part for part in message.walk() if not part.is_multipart()]
page = next(part for part in parts if part.get_content_type() == "text/html")
page_html = page.get_payload(decode=True).decode(page.get_content_charset() or "utf-8")
extensions = {"text/css": ".css", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
              "image/avif": ".avif", "image/svg+xml": ".svg", "font/woff2": ".woff2", "font/woff": ".woff"}
assets, replacements, styles = [], {}, {}
for part in parts:
    mime = part.get_content_type()
    if mime not in extensions:
        continue
    name = str(len(assets)) + extensions[mime]
    local = "/design-native/assets/" + name
    aliases = [part.get("Content-Location"), "cid:" + part.get("Content-ID", "").strip("<>")]
    for alias in aliases:
        if alias and alias != "cid:":
            replacements[alias] = local
    payload = part.get_payload(decode=True)
    if mime == "text/css":
        styles[local] = payload.decode(part.get_content_charset() or "utf-8")
    assets.append((name, mime, payload))


def local_urls(text):
    for remote, local in sorted(replacements.items(), key=lambda item: -len(item[0])):
        text = text.replace(remote, local).replace(html.escape(remote, quote=True), local)
    return text


class HeadStyles(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_head = False
        self.css = []

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.in_head = True
        if not self.in_head or tag != "link":
            return
        attrs = dict(attrs)
        if "stylesheet" not in attrs.get("rel", ""):
            return
        source = styles.get(local_urls(attrs.get("href", "")))
        if source is None:
            return
        media = attrs.get("media")
        self.css.append(f"@media {media}{{{source}}}" if media and media != "all" else source)

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False


head = HeadStyles()
head.feed(page_html)
injected_css = []
injected_file = folder / "injected-rules.json"
if injected_file.exists():
    # Browser-injected extension styles are omitted by MHTML. Copy their
    # actual matched declarations rather than inventing substitute styles.
    for rule in json.loads(injected_file.read_text(encoding="utf-8")):
        declarations = []
        for prop in rule["style"].get("shorthandEntries", []) + rule["style"]["cssProperties"]:
            if not prop.get("value") or prop.get("disabled"):
                continue
            value = prop["value"]
            if prop.get("important") and "!important" not in value:
                value += " !important"
            declarations.append(prop["name"] + ":" + value)
        injected_css.append(rule["selector"] + "{" + ";".join(declarations) + "}")
capture = json.loads((folder / "capture.json").read_text(encoding="utf-8"))
records = json.loads((folder / "dom-raw.json").read_text(encoding="utf-8"))
for record in records:
    if "attrs" in record:
        record["attrs"] = [[name, local_urls(value)] for name, value in record["attrs"]]
for name, mime, payload in assets:
    if mime == "text/css":
        payload = local_urls(styles["/design-native/assets/" + name]).encode("utf-8")
    (output / "assets" / name).write_bytes(payload)
(output / "captured.css").write_bytes(local_urls("\n".join(injected_css + head.css)).encode("utf-8"))
(output / "rendered.html").write_bytes(local_urls(capture["body"]).encode("utf-8"))
(output / "dom.json").write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
metadata = {key: value for key, value in capture.items() if key != "body"}
metadata.update({"stylesheetCount": len(head.css), "injectedRuleCount": len(injected_css),
                 "assetCount": len(assets), "elementCount": len(records)})
(output / "capture.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
(output / "controls.json").write_bytes((folder / "controls.json").read_bytes())
selection = CACHE / "design-stage-native" / "source.json"
selection.parent.mkdir(exist_ok=True)
selection.write_text(json.dumps({"folder": output.relative_to(ROOT).as_posix()}), encoding="utf-8")
print(json.dumps({"source": capture["source"], "stylesheets": len(head.css), "assets": len(assets),
                  "nodes": len(records), "folder": output.relative_to(ROOT).as_posix()}))
