const MobileViewport = (function() {
    let frame = null;

    function sync() {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            frame = null;
            const vv = window.visualViewport;
            const height = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight);
            document.documentElement.style.setProperty('--app-height', `${height}px`);
            document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
        });
    }

    function init() {
        sync();
        window.addEventListener('resize', sync, { passive: true });
        window.addEventListener('orientationchange', () => setTimeout(sync, 250), { passive: true });
        window.visualViewport?.addEventListener('resize', sync, { passive: true });
        window.visualViewport?.addEventListener('scroll', sync, { passive: true });
        document.addEventListener('fullscreenchange', sync);
    }

    return { init, sync };
})();

