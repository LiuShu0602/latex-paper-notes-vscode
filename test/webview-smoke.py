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


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    subprocess.run(["node", "scripts/create-pdf-fixtures.mjs"], cwd=EXTENSION_ROOT, check=True)
    server = None
    server_thread = None
    if "PAPER_NOTES_SMOKE_URL" not in os.environ:
        handler = partial(SimpleHTTPRequestHandler, directory=EXTENSION_ROOT)
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
            search.fill("coordinate")
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
