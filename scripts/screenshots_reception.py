"""Screenshots of the signed-out reception home on the demo site (fake data only).
Usage: python3 scripts/screenshots_reception.py [out_dir]  (demo site on port 3500)"""
import sys, os
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:3500'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/meeting_room_paste'
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    m = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2, has_touch=True).new_page()
    m.goto(BASE + '/'); m.wait_for_load_state('networkidle')
    m.wait_for_timeout(3500)                      # let the welcome text finish animating
    m.screenshot(path=OUT + '/reception_mobile_1_top.png'); print('top')
    # frames of the hero changing (about every 7 seconds)
    for i in range(1, 6):
        m.screenshot(path=OUT + '/reception_mobile_frame%d.png' % i); print('frame', i)
        m.wait_for_timeout(7000)
    # scroll through so count-ups run, then full page
    h = m.evaluate('document.body.scrollHeight')
    for y in range(0, h, 500):
        m.evaluate('window.scrollTo(0,%d)' % y); m.wait_for_timeout(250)
    m.wait_for_timeout(2000); m.evaluate('window.scrollTo(0,0)'); m.wait_for_timeout(500)
    m.screenshot(path=OUT + '/reception_mobile_2_full.png', full_page=True); print('full')
    d = b.new_context(viewport={'width': 1280, 'height': 800}).new_page()
    d.goto(BASE + '/'); d.wait_for_load_state('networkidle'); d.wait_for_timeout(3500)
    d.screenshot(path=OUT + '/reception_desktop_1_top.png')
    h = d.evaluate('document.body.scrollHeight')
    for y in range(0, h, 500):
        d.evaluate('window.scrollTo(0,%d)' % y); d.wait_for_timeout(250)
    d.wait_for_timeout(2000); d.evaluate('window.scrollTo(0,0)'); d.wait_for_timeout(500)
    d.screenshot(path=OUT + '/reception_desktop_2_full.png', full_page=True); print('desktop')
    b.close()
