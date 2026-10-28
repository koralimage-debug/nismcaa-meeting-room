"""Door frames (closed, unlocking, swinging, open) and the entry page. Demo site on port 3500."""
import sys, os
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:3500'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/meeting_room_paste'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    m = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2, has_touch=True).new_page()
    m.goto(BASE + '/'); m.wait_for_load_state('networkidle')
    sc = m.locator('.door-scene'); sc.scroll_into_view_if_needed(); m.wait_for_timeout(1500)
    m.evaluate("document.querySelector('.door-scene').scrollIntoView()"); m.wait_for_timeout(800)
    sc.screenshot(path=OUT + '/reception_door_1_closed.png')
    # real click, frames taken while it animates
    m.evaluate("window.__t=Date.now()")
    m.click('[data-door-open]')
    for i, ms in enumerate([300, 700, 1000, 300], 2):
        m.wait_for_timeout(ms)
        sc.screenshot(path=OUT + '/reception_door_%d_click_frame.png' % i)
    m.wait_for_url('**/enter', timeout=8000); m.wait_for_load_state('networkidle'); m.wait_for_timeout(2500)
    m.screenshot(path=OUT + '/reception_door_6_entry_page_top.png')
    m.screenshot(path=OUT + '/reception_door_7_entry_page_full.png', full_page=True)
    d = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
    d.goto(BASE + '/'); d.wait_for_load_state('networkidle')
    d.evaluate("document.querySelector('.door-scene').scrollIntoView()"); d.wait_for_timeout(1500)
    d.locator('.door-scene').screenshot(path=OUT + '/reception_door_desktop_closed.png')
    b.close()
