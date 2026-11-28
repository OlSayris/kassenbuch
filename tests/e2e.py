"""Ende-zu-Ende-Test der Kassenbuch-App im Handyformat (Playwright, Chromium headless).

Aufruf (startet den Server automatisch):
  python <skills>/webapp-testing/scripts/with_server.py --server "node scripts/serve.js 8137" --port 8137 -- python tests/e2e.py
Screenshots landen in tests/screenshots/.
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("KB_URL", "http://localhost:8137/")
SHOTS = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SHOTS, exist_ok=True)
errors = []


def step(name):
    print(f"  ✓ {name}")


def add_entry(page, amount, category, note="", repeat=None):
    page.click("#fab")
    page.fill("#amount", amount)
    if repeat:
        page.click(f"#repSeg [data-rep={repeat}]")
    if note:
        page.fill("#note", note)                     # Notizfeld ist direkt sichtbar
    page.click(f"#tiles button:has-text('{category}')")   # Kategorie nur auswählen …
    page.click("#btnSave")                           # … gespeichert wird mit dem Knopf


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 360, "height": 780}, locale="de-DE", has_touch=True)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())          # confirm() bestätigen
    page.goto(URL)
    page.wait_for_load_state("networkidle")

    expect(page.locator("#list .empty")).to_contain_text("Tippe unten rechts auf")
    step("Leere Monatsansicht zeigt Hinweis")

    add_entry(page, "12,50", "Lebensmittel", "Bäcker")
    expect(page.locator("#list li[data-id]")).to_have_count(1)
    expect(page.locator("#sumOut")).to_have_text("12,50 €")
    step("Ausgabe erfassen (Betrag + Kachel)")

    page.click("#fab")
    page.fill("#amount", "9")
    page.click("#tiles button:has-text('Freizeit')")
    expect(page.locator("#sheet")).to_have_attribute("open", "")     # Kachel allein speichert nicht
    page.keyboard.press("Escape")
    expect(page.locator("#list li[data-id]")).to_have_count(1)
    page.click("#fab")
    page.fill("#amount", "9")
    page.click("#btnSave")
    expect(page.locator("#sheet")).to_have_attribute("open", "")     # ohne Kategorie kein Speichern
    page.keyboard.press("Escape")
    step("Kategorie wählt nur aus, Speichern-Knopf nötig, Kategorie Pflicht")

    page.click("#fab")
    page.click("#typeSeg [data-type=in]")
    page.fill("#amount", "2.500")
    page.click("#tiles button:has-text('Gehalt')")
    page.click("#btnSave")
    expect(page.locator("#saldo")).to_have_text("2.487,50 €")
    step("Einnahme erfassen, „Übrig“ stimmt (Tausenderpunkt)")

    page.click("#list li:has-text('Bäcker')")
    expect(page.locator("#sheetTitle")).to_have_text("Buchung bearbeiten")
    page.fill("#amount", "15")
    page.click("#btnSave")
    expect(page.locator("#sumOut")).to_have_text("15,00 €")
    step("Buchung bearbeiten")

    page.click("#list li:has-text('Bäcker')")
    page.click("#btnDelete")
    expect(page.locator("#list li:has-text('Bäcker')")).to_have_count(0)
    step("Buchung löschen (im Bearbeiten-Dialog)")

    # Tastatur-Simulation: bei 480 px Höhe muss „Speichern“ sichtbar bleiben (klebt unten im Dialog)
    page.set_viewport_size({"width": 360, "height": 480})
    page.click("#fab")
    bottom = page.evaluate("document.querySelector('#btnSave').getBoundingClientRect().bottom")
    assert bottom <= 480, f"Speichern-Knopf verdeckt (unten bei {bottom}px)"
    page.screenshot(path=os.path.join(SHOTS, "erfassen-tastatur.png"))
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 360, "height": 780})
    step("Speichern-Knopf bei offener Tastatur sichtbar")

    add_entry(page, "60", "Versicherung", "Haftpflicht", repeat="halfyearly")
    expect(page.locator("#list li:has-text('Haftpflicht')")).to_contain_text("halbjährlich")
    step("Halbjährliche Buchung")

    page.click("#list li:has-text('Haftpflicht')")
    page.click("#btnCopy")
    expect(page.locator("#sheetTitle")).to_contain_text("Kopie")
    expect(page.locator("#amount")).to_have_value("60,00")
    expect(page.locator("#tiles button.sel")).to_contain_text("Versicherung")
    page.click("#btnSave")
    expect(page.locator("#list li:has-text('Haftpflicht')")).to_have_count(2)
    step("Buchung kopieren")

    page.click("#fab")
    page.fill("#amount", "4,20")
    page.click("#tiles .newcat")
    page.fill("#inpFields input:not([type=hidden])", "Kaffee")
    page.click("#inpFields .emojis button:has-text('☕')")
    page.click("#inpForm button[type=submit]")
    expect(page.locator("#tiles button.sel")).to_contain_text("Kaffee")
    page.click("#btnSave")
    expect(page.locator("#list li:has-text('Kaffee')")).to_contain_text("☕")
    step("Neue Kategorie direkt beim Erfassen, Symbol per Antippen")

    for view, title in [("year", "Jahr"), ("budget", "Budget"), ("accounts", "Konten"), ("month", "")]:
        page.click(f"#tabbar [data-view={view}]")
        expect(page.locator(f"#{view}View")).to_be_visible()
        if title:
            expect(page.locator("#title")).to_contain_text(title)
        page.screenshot(path=os.path.join(SHOTS, f"{view}.png"), full_page=True)
    step("Untere Leiste: alle Bereiche erreichbar")

    page.click("#searchBtn")
    page.fill("#sQ", "gehalt")
    expect(page.locator("#sList li[data-id]")).to_have_count(1)
    page.click("#searchBtn")
    expect(page.locator("#monthView")).to_be_visible()
    step("Suche über Lupe, zweiter Tipp führt zurück")

    add_entry(page, "30", "Lebensmittel")              # Ausgabe, die das Budget überschreitet
    page.click("#tabbar [data-view=budget]")
    page.fill("#bList input[data-i='1']", "10")
    page.press("#bList input[data-i='1']", "Enter")
    expect(page.locator("#bList .bitem").nth(1)).to_contain_text("überschritten")
    step("Budget je Kategorie, Überschreitung wird angezeigt")

    width = page.evaluate("document.documentElement.scrollWidth")
    assert width <= 360, f"Horizontales Scrollen: {width}px"
    step("Kein horizontales Scrollen bei 360 px")

    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#list li[data-id]")).to_have_count(5)
    step("Daten nach Neuladen erhalten")

    # Datenverlust simulieren: Hauptdaten weg → App stellt die automatische Sicherung wieder her
    backups = page.evaluate("Object.keys(JSON.parse(localStorage.getItem('kassenbuch-backups') || '{}'))")
    assert backups, "Keine automatische Sicherung angelegt"
    page.evaluate("localStorage.removeItem('kassenbuch')")
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#list li[data-id]").first).to_be_visible()
    step(f"Automatische Sicherung vorhanden ({len(backups)}) und Wiederherstellung nach Datenverlust")

    browser.close()

if errors:
    print("FEHLER in der Konsole:\n  " + "\n  ".join(errors))
    sys.exit(1)
print("Alle E2E-Schritte bestanden.")
