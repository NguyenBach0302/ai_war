window.UI = UI;
window.Auth = Auth;
window.Profile = Profile;
window.Admin = Admin;
window.Game = Game;
window.Online = Online;

window.onload = () => {
    MobileViewport.init();
    Auth.checkSession();
};
