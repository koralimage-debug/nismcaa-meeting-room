import os
from playwright.sync_api import sync_playwright
BASE='http://localhost:3500'; OUT='/workspace/meeting_room_paste'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':844}, is_mobile=True, device_scale_factor=2, has_touch=True)
    m=ctx.new_page()
    def shot(name,path,full=True):
        m.goto(BASE+path); m.wait_for_load_state('networkidle'); m.wait_for_timeout(1500)
        h=m.evaluate('document.body.scrollHeight')
        for y in range(0,h,600): m.evaluate('window.scrollTo(0,%d)'%y); m.wait_for_timeout(150)
        m.evaluate('window.scrollTo(0,0)'); m.wait_for_timeout(2500)
        m.screenshot(path=OUT+'/'+name+'.png', full_page=full); print(name)
    shot('mobile_signin','/sign-in'); shot('mobile_volunteer_signup','/sign-up'); shot('mobile_guest_signup','/guests/sign-up')
    shot('mobile_course','/course'); shot('mobile_home_full','/'); shot('mobile_entry','/enter')
    m.goto(BASE+'/sign-in'); m.fill('#email','ada.us@example.test'); m.fill('#password','Demo-Password-123'); m.click('button[type=submit]'); m.wait_for_load_state('networkidle')
    shot('mobile_member_room','/meeting-room'); shot('mobile_member_chat','/meeting-room/chat/united-states')
    b.close()
