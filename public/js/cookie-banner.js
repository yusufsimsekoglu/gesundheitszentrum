// Cookie-Banner: DSGVO-konformes Einwilligungsbanner

(function () {
  if (localStorage.getItem("cookie-einwilligung")) return;

  const banner = document.createElement("div");
  banner.id = "cookie-banner";
  banner.innerHTML = `
    <div class="cookie-text">
      <strong>Diese Website verwendet Cookies.</strong>
      Wir nutzen technisch notwendige Cookies, um die Funktionalität des Chatbots
      sicherzustellen. Weitere Informationen finden Sie in unserer
      <a href="/pages/datenschutz.html">Datenschutzerklärung</a>.
    </div>
    <div class="cookie-buttons">
      <button id="cookie-ablehnen">Nur notwendige</button>
      <button id="cookie-akzeptieren">Alle akzeptieren</button>
    </div>
  `;
  document.body.appendChild(banner);

  function schliesseBanner(wert) {
    localStorage.setItem("cookie-einwilligung", wert);
    banner.classList.add("cookie-versteckt");
    setTimeout(() => banner.remove(), 400);
  }

  document.getElementById("cookie-akzeptieren").addEventListener("click", () => schliesseBanner("alle"));
  document.getElementById("cookie-ablehnen").addEventListener("click", () => schliesseBanner("notwendig"));
})();
