// ── SHOW SCREEN override to handle Le Guide nav ───────────────
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  window.scrollTo(0,0);

  const isWishlist = id === 'wishlist';
  const isLg = id.startsWith('lg-') || (isWishlist && wishlistMode === 'restaurant');
  setLgMode(isLg && id!=='lg-result' ? true : (isWishlist ? false : lgMode));

  if(!isLg){
    ['home','rate','stats','wishlist','settings'].forEach(n=>{
      const b=document.getElementById('nav-'+n);
      if(b) b.classList.toggle('active',
        n===id ||
        ((id==='search'||id==='score'||id==='round'||id==='result'||id==='quick'||id==='tv-search'||id==='tv-select')&&n==='rate') ||
        ((id==='stats'||id==='tv-stats')&&n==='stats')
      );
    });
  } else {
    ['lg-home','lg-rate','lg-stats','lg-wishlist','lg-back'].forEach(n=>{
      const b=document.getElementById('nav-'+n);
      if(b) b.classList.toggle('active',
        (n==='lg-rate'&&(id==='lg-search'||id==='lg-score'||id==='lg-round'||id==='lg-quick'))||
        (n==='lg-stats'&&id==='lg-stats')||
        (n==='lg-wishlist'&&id==='wishlist')
      );
    });
  }

  document.getElementById('main-nav').style.display=id==='pin'?'none':'flex';
  if(id==='settings') openSettings();
}

// ── ADMIN PIN MODAL ──────────────────────────────────────────
let adminPinEntered = "";

function promptAdminPin(){
  adminPinEntered = "";
  updateAdminDots();
  document.getElementById("admin-error").textContent = "";
  const modal = document.getElementById("admin-modal");
  modal.style.display = "flex";
}

function closeAdminModal(){
  document.getElementById("admin-modal").style.display = "none";
  adminPinEntered = "";
}

function adminKey(k){
  if(adminPinEntered.length >= 4) return;
  adminPinEntered += k;
  updateAdminDots();
  if(adminPinEntered.length === 4) checkAdminPin();
}
function adminBack(){ adminPinEntered = adminPinEntered.slice(0,-1); updateAdminDots(); }
function adminClear(){ adminPinEntered = ""; updateAdminDots(); }
function updateAdminDots(){
  for(let i=0;i<4;i++){
    document.getElementById("ad"+i).classList.toggle("filled", i < adminPinEntered.length);
  }
}
async function checkAdminPin(){
  try{
    const data = await apiCall("loginAdmin", {pin: adminPinEntered});
    adminToken = data.adminToken || data.token;
    closeAdminModal();
    await syncUsersFromSheets();
    settingsLoaded = false;
    showScreen("settings");
  }catch(e){
    document.getElementById("admin-error").textContent = e.message || "Incorrect PIN.";
    adminPinEntered = "";
    updateAdminDots();
  }
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded",async ()=>{
  applyTheme(getStoredTheme());
  bindPinInput();
  applyStoredConfig();
  await syncUsersFromSheets();
  setSavedUser(null);
  sessionToken = null;
  currentUser = null;
  showLogin();
});

// Pre-populate settings config fields when entering settings
// Load settings fields only when first entering settings, not on every mutation
let settingsLoaded = false;
function openSettings(){
  if(!settingsLoaded){
    loadConfigFields();
    settingsLoaded = true;
  }
  renderSettingsUsers();
}
