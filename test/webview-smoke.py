import atexit
import os
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


EXTENSION_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATH = "/test/webview-harness.html"


class ExtensionTestRequestHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
    }


def assert_readable(locator, minimum: float = 4.5) -> None:
    result = locator.evaluate(r"""node => {
      const rgba = value => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
        return [red, green, blue, alpha / 255];
      };
      const linear = value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      };
      const luminance = color => 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
      const foreground = rgba(getComputedStyle(node).color);
      let current = node;
      let background = [255, 255, 255, 1];
      while (current) {
        const candidate = rgba(getComputedStyle(current).backgroundColor);
        if (candidate[3] >= 0.99) {
          background = candidate;
          break;
        }
        current = current.parentElement;
      }
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return {
        ratio: (lighter + 0.05) / (darker + 0.05),
        foreground: getComputedStyle(node).color,
        background: `rgba(${background.join(', ')})`
      };
    }""")
    assert result["ratio"] >= minimum, result


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    subprocess.run(["node", "scripts/create-pdf-fixtures.mjs"], cwd=EXTENSION_ROOT, check=True)
    server = None
    server_thread = None
    if "PAPER_NOTES_SMOKE_URL" not in os.environ:
        handler = partial(ExtensionTestRequestHandler, directory=EXTENSION_ROOT)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server.daemon_threads = True
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        atexit.register(server.server_close)
        atexit.register(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}{DEFAULT_PATH}"
        for attempt in range(40):
            try:
                with urllib.request.urlopen(url, timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                if attempt == 39:
                    raise
                time.sleep(0.1)
    else:
        url = os.environ["PAPER_NOTES_SMOKE_URL"]
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            for attempt in range(5):
                try:
                    page.goto(url)
                    break
                except Exception:
                    if attempt == 4:
                        raise
                    page.wait_for_timeout(250)
            page.wait_for_load_state("networkidle")
            page.locator(".pdfViewer .page").first.wait_for(state="attached", timeout=20_000)
            assert page.locator(".pdfViewer .page").count() >= 2
            page.locator(".textLayer").first.wait_for(state="attached", timeout=20_000)
            assert page.get_by_role("searchbox", name="Search PDF").is_visible()

            search = page.get_by_role("searchbox", name="Search PDF")
            search.fill("sensor")
            search.press("Enter")
            page.wait_for_timeout(500)

            note_link = page.locator('.annotationLayer a[data-paper-notes-target^="note.main."]').first
            note_link.wait_for(state="attached", timeout=20_000)
            # Use a real pointer click here. dispatch_event() bypasses hit-testing
            # and can therefore hide regressions where the PDF text layer covers
            # the semantic link overlay in the actual VS Code webview.
            note_link.click()
            page.wait_for_function(
                "window.__paperNotesMessages.some(message => message.type === 'selectTab' && message.tab === 'notesPdf')"
            )
            page.locator(".pdfViewer .page").first.wait_for(state="attached", timeout=20_000)
            assert page.locator(".pdfViewer .page").count() >= 2

            editor_link = page.locator('.annotationLayer a[data-paper-notes-target^="paper-notes-editor:"]').first
            editor_link.wait_for(state="attached", timeout=20_000)
            editor_link.click()
            title = page.locator("input.title-input")
            title.wait_for(state="visible", timeout=20_000)
            assert title.input_value() == "Why an offset preserves ordering"
            assert_readable(page.locator(".item-header select").first)
            assert_readable(page.locator(".item-header select option").nth(1))

            add = page.get_by_role("button", name="Add annotation")
            add.click()
            assert page.get_by_role("menuitem", name="Translation").is_visible()
            assert page.get_by_role("menuitem", name="Definition").is_visible()
            page.get_by_role("menuitem", name="Translation").click()
            page.wait_for_timeout(650)
            page.wait_for_function(
                "window.__paperNotesMessages.some(message => message.type === 'saveNote' && message.note.items.some(item => item.type === 'translation'))"
            )

            add = page.get_by_role("button", name="Add annotation")
            add.click()
            add.press("ArrowDown")
            page.keyboard.press("Escape")
            assert add.get_attribute("aria-expanded") == "false"

            add.click()
            page.get_by_role("menuitem", name="New custom type…").click()
            dialog = page.get_by_role("dialog", name="New custom type…")
            assert_readable(dialog.locator("h2"))
            assert_readable(dialog.get_by_label("Type name"))
            assert_readable(dialog.locator(".type-preview strong"))
            dialog.get_by_label("Type name").fill("Proof sketch")
            dialog.get_by_label("Hex color").fill("#2F6F9F")
            dialog.get_by_role("button", name="Save type").click()
            page.wait_for_function(
                "window.__paperNotesMessages.some(message => message.type === 'createCustomType' && message.name === 'Proof sketch' && message.color === '#2F6F9F')"
            )

            page.get_by_role("button", name="Project status").click()
            status = page.get_by_role("dialog", name="Project status")
            assert "0.4.0-beta.2" in status.inner_text()
            status.get_by_role("button", name="Close").last.click()

            page.emulate_media(reduced_motion="reduce")
            transition = page.locator("button").first.evaluate("node => getComputedStyle(node).transitionDuration")
            assert transition in ("0s", "0.001s")

            page.locator("body").evaluate("node => node.classList.add('vscode-high-contrast')")
            assert page.locator(".item-card").first.evaluate("node => getComputedStyle(node).borderLeftWidth") != "0px"
            page.locator("body").evaluate("node => node.classList.remove('vscode-high-contrast')")

            page.set_viewport_size({"width": 900, "height": 760})
            page.screenshot(path=str(Path(gettempdir()) / "paper-notes-900.png"), full_page=True)
            dark_page = browser.new_page(viewport={"width": 900, "height": 760})
            dark_url = f"{url}{'&' if '?' in url else '?'}theme=dark"
            dark_page.goto(dark_url)
            dark_page.wait_for_load_state("networkidle")
            dark_page.get_by_role("button", name="Notes", exact=True).click()
            dark_background = dark_page.locator("body").evaluate("node => getComputedStyle(node).backgroundColor")
            assert dark_background in ("rgb(30, 30, 30)", "rgba(30, 30, 30, 1)"), dark_background
            dark_surface = dark_page.locator(".source-card").evaluate("node => getComputedStyle(node).backgroundColor")
            assert dark_surface not in ("rgb(255, 255, 255)", "rgba(255, 255, 255, 1)"), dark_surface
            assert_readable(dark_page.locator(".item-header select").first)
            assert_readable(dark_page.locator(".item-header select option").nth(1))
            dark_page.get_by_role("button", name="Add annotation").click()
            dark_menu_items = dark_page.locator(".annotation-menu [role=menuitem]")
            dark_menu_items.nth(dark_menu_items.count() - 2).click()
            dark_dialog = dark_page.get_by_role("dialog")
            assert_readable(dark_dialog.locator("h2"))
            assert_readable(dark_dialog.get_by_label("Type name"))
            assert_readable(dark_dialog.locator(".type-preview strong"))
            dark_page.screenshot(path=str(Path(gettempdir()) / "paper-notes-dark-dialog-900.png"), full_page=True)
            dark_page.close()
            page.set_viewport_size({"width": 600, "height": 760})
            assert page.get_by_role("button", name="Back to notes").is_visible()
            page.get_by_role("button", name="Back to notes").click()
            assert page.locator(".note-rail").is_visible()
            assert not page.locator(".note-detail").is_visible()
            page.screenshot(path=str(Path(gettempdir()) / "paper-notes-600.png"), full_page=True)
        except Exception:
            screenshot = Path(gettempdir()) / "paper-notes-webview-smoke.png"
            page.screenshot(path=str(screenshot), full_page=True)
            print(f"Webview console errors: {errors}")
            print(f"Rendered body: {page.locator('body').inner_text()[:2000]}")
            print("Annotation links:", page.locator(".annotationLayer a").evaluate_all(
                "nodes => nodes.slice(0, 120).map(node => ({href: node.getAttribute('href'), title: node.getAttribute('title'), data: {...node.dataset}}))"
            ))
            print(f"Screenshot: {screenshot}")
            raise
        if errors:
            raise AssertionError(f"Webview console errors: {errors}")
        browser.close()
    if server is not None:
        server.shutdown()
        server.server_close()
    if server_thread is not None:
        server_thread.join(timeout=2)


if __name__ == "__main__":
    main()
