"""Screenshots of the Guest (sponsor/vendor) pages on the demo site (fake data only).
Usage: python3 scripts/screenshots_guests.py [out_dir]   (demo site must be running on port 3500)"""
import sys, os
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:3500'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/meeting_room_paste'
os.makedirs(OUT, exist_ok=True)
PW = 'Demo-Password-123'

def login(page, email, pw):
    page.goto(BASE + '/sign-in'); page.fill('#email', email); page.fill('#password', pw)
    page.click('button[type=submit]'); page.wait_for_load_state('networkidle')

def shot(page, name, path=None, full=True):
    if path: page.goto(BASE + path); page.wait_for_load_state('networkidle')
    page.evaluate("window.scrollTo(0,0)"); page.wait_for_timeout(1200)
    page.evaluate("document.querySelectorAll('[data-reveal]').forEach(e=>e.classList.add('in'))")
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full); print('saved', name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for label, args in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                        ('mobile', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2, has_touch=True))):
        pre = 'partners_%s_' % label
        anon = b.new_context(**args).new_page()
        shot(anon, pre + '2_signup', '/guests/sign-up')
        shot(anon, pre + '2b_guest_page', '/guests')
        admin = b.new_context(**args).new_page(); login(admin, 'interschoolmusic@gmail.com', 'Demo-Admin-Password-1')
        shot(admin, pre + '3_admin_guests', '/admin/guests')
        shot(admin, pre + '4a_admin_meetings', '/admin/meetings')
        admin.goto(BASE + '/admin/meetings/new'); admin.wait_for_load_state('networkidle')
        admin.fill('#title', 'Sponsor thank-you call'); admin.select_option('#audience', 'invited')
        admin.fill('#date', '2026-11-18'); admin.fill('#agenda', '1. Thank you\n2. Next steps')
        admin.fill('#link', 'https://meet.google.com/abc-defg-hij')
        shot(admin, pre + '4_admin_new_meeting')
        spon = b.new_context(**args).new_page(); login(spon, 'sponsor.demo@example.test', PW)
        shot(spon, pre + '5_guest_room_sponsor', '/guest')
        vend = b.new_context(**args).new_page(); login(vend, 'vendor.demo@example.test', PW)
        shot(vend, pre + '5b_guest_room_vendor', '/guest')
        vol = b.new_context(**args).new_page(); login(vol, 'ada.us@example.test', PW)
        shot(vol, pre + '6_volunteer_view_no_guest_meetings', '/meeting-room')
        shot(vol, pre + '6b_volunteer_opens_guest_page', '/guest', full=False)
    b.close()
