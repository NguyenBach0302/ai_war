const UI = (function() {
    function forceReset() {
        const overlays = ['auth-overlay', 'setup-overlay', 'resume-overlay', 'admin-overlay', 'victory-overlay', 'profile-overlay'];
        overlays.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        console.log("UI Force Reset executed.");
    }
    return { forceReset };
})();

