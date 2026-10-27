"""Take screenshots of the demo site (fake data only). Usage: python3 scripts/screenshots.py [base_url]
Needs the demo site running (npm run demo:seed && npm run demo:start). Saves PNGs to ./screenshots/."""
import sys, os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3500'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'screenshots')
os.makedirs(OUT, exist_ok=True)
PW = 'Demo-Password-123'
ADMIN = ('interschoolmusic@gmail.com', 'Demo-Admin-Password-1')

def login(page, email, pw):
    page.goto(BASE + '/sign-in'); page.fill('#email', email); page.fill('#password', pw)
    page.click('button[type=submit]'); page.wait_for_load_state('networkidle')

def shot(page, name, path, full=True, scroll_to=None):
    page.goto(BASE + path); page.wait_for_load_state('networkidle')
    if scroll_to:
        page.evaluate("(sel)=>{const e=document.querySelector(sel); if(e) e.scrollIntoView();}", scroll_to)
    page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)
    print('saved', name)

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, ctxargs in (('desktop', dict(viewport={'width': 1280, 'height': 900})),
                           ('mobile', dict(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2, has_touch=True))):
        d = label == 'desktop'
        pre = '' if d else 'mobile_'
        anon = b.new_context(**ctxargs).new_page()
        if d: shot(anon, '01_home', '/')
        shot(anon, pre + '02_sign_up', '/sign-up')
        if d: shot(anon, '03_sign_in', '/sign-in')
        shot(anon, pre + '04_course', '/course', full=d)
        if d: shot(anon, '04b_course_lesson_tables', '/course#o3', full=False)

        admin = b.new_context(**ctxargs).new_page(); login(admin, *ADMIN)
        shot(admin, pre + '05_waiting_for_approval_admin', '/admin/pending')
        if d:
            shot(admin, '05b_admin_dashboard', '/admin')
            shot(admin, '05c_admin_people', '/admin/people')
            shot(admin, '05d_admin_answer_key', '/admin/key', full=False)
            shot(admin, '05e_admin_head_seats', '/admin/heads', full=False)
            shot(admin, '05f_admin_settings', '/admin/settings')
            shot(admin, '10_global_rollup', '/meeting-room/plan/global')
            shot(admin, '10b_action_plan_change_log', '/meeting-room/plan/log')

        vol = b.new_context(**ctxargs).new_page(); login(vol, 'ada.us@example.test', PW)
        shot(vol, pre + '06_id_card', '/meeting-room/id-card')
        shot(vol, pre + '07_meeting_room', '/meeting-room')
        shot(vol, pre + '07b_chat', '/meeting-room/chat/united-states', full=d)
        if d: shot(vol, '07c_notes', '/meeting-room/notes')

        ng = b.new_context(**ctxargs).new_page(); login(ng, 'chioma.ng@example.test', PW)
        shot(ng, pre + '08_action_plan_nigeria_technology', '/meeting-room/plan/nigeria/technology', full=d)
        if d:
            shot(ng, '08b_action_plan_nigeria_all', '/meeting-room/plan/nigeria/all', full=False)
            shot(ng, '08c_head_remarks', '/meeting-room/plan/nigeria/technology', scroll_to='h2:last-of-type', full=False)
            shot(ng, '08d_member_page', '/meeting-room/member/%d' % 4)
        ca = b.new_context(**ctxargs).new_page(); login(ca, 'dana.ca@example.test', PW)
        shot(ca, pre + '09_action_plan_flags_canada', '/meeting-room/plan/canada/technology', full=d)

        if d:
            # the ID card image itself, and the public check page
            ctx = vol.context
            r = ctx.request.get(BASE + '/meeting-room/id-card.png')
            open(os.path.join(OUT, '06b_id_card_download.png'), 'wb').write(r.body())
            r2 = ctx.request.get(BASE + '/meeting-room/id-card.pdf')
            open(os.path.join(OUT, '06c_id_card_download.pdf'), 'wb').write(r2.body())
            shot(anon, '06d_verify_page', '/verify/NISMCAA-VOL-0001', full=False)
    b.close()
