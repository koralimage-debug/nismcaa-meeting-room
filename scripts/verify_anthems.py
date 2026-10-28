from playwright.sync_api import sync_playwright
BASE='http://localhost:3500'; OUT='/workspace/meeting_room_paste'
HOOK="""window.__a=[];const O=window.Audio;window.Audio=function(){const a=new O();window.__a.push(a);return a};"""
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    m=b.new_context(viewport={'width':390,'height':844}, is_mobile=True, device_scale_factor=2, has_touch=True).new_page()
    m.add_init_script(HOOK); errs=[]; m.on('console', lambda x: errs.append(x.text) if x.type=='error' else None)
    m.goto(BASE+'/'); m.wait_for_load_state('networkidle')
    print('tappable', m.evaluate("[...document.querySelectorAll('.flag-wave.playable')].map(e=>e.dataset.anthem)"), 'total flags', m.evaluate("document.querySelectorAll('.flag-wave').length"))
    for code in ['us','ca','gb','au']:
        m.locator(f'.flag-wave[data-anthem={code}]').click(force=True); m.wait_for_timeout(1800)
        print(code, m.evaluate("(()=>{const a=window.__a[0];return {t:+a.currentTime.toFixed(2),paused:a.paused,src:a.src.split('/').pop(),vol:a.volume,preload:a.preload}})()"))
    m.locator('.flag-wave[data-anthem=au]').click(force=True); m.wait_for_timeout(300)
    print('stopped', m.evaluate("window.__a[0].paused"))
    # silent flags: tapping does nothing, no errors
    m.locator('.flag-wave:not(.playable)').first.click(force=True); m.wait_for_timeout(300)
    print('console errors', errs)
    m.locator('.flag-strip').scroll_into_view_if_needed(); m.locator('.flag-wave[data-anthem=gb]').click(force=True); m.wait_for_timeout(1200)
    m.screenshot(path=OUT+'/anthem_final_mobile_flags_playing.png')
    m.goto(BASE+'/anthem-credits'); m.screenshot(path=OUT+'/anthem_final_credits.png', full_page=True)
    b.close()
