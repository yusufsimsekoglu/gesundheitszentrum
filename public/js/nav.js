const hamburger = document.getElementById("hamburger");
const navLinks = document.getElementById("nav-links");
const drawerPanel = document.querySelector(".chat-panel-links");
const drawerOverlay = document.getElementById("chat-drawer-overlay");

function isMobileDrawer() {
  return !!drawerPanel && window.matchMedia("(max-width: 900px)").matches;
}

function drawerSchliessen() {
  drawerPanel?.classList.remove("drawer-offen");
  drawerOverlay?.classList.remove("sichtbar");
}

function drawerOeffnen() {
  drawerPanel?.classList.add("drawer-offen");
  drawerOverlay?.classList.add("sichtbar");
}

if (hamburger) {
  hamburger.addEventListener("click", () => {
    if (isMobileDrawer()) {
      drawerPanel.classList.contains("drawer-offen") ? drawerSchliessen() : drawerOeffnen();
    } else if (navLinks) {
      navLinks.classList.toggle("offen");
    }
  });

  document.addEventListener("click", (e) => {
    if (drawerPanel?.classList.contains("drawer-offen")) {
      if (!drawerPanel.contains(e.target) && !hamburger.contains(e.target)) {
        drawerSchliessen();
      }
    }
    if (navLinks?.classList.contains("offen")) {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        navLinks.classList.remove("offen");
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      drawerSchliessen();
      navLinks?.classList.remove("offen");
    }
  });

  drawerOverlay?.addEventListener("click", drawerSchliessen);
}
