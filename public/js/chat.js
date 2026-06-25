const socket = io();

const chatForm = document.getElementById("chat-form");
const nachrichtInput = document.getElementById("nachricht-input");
const chatBox = document.getElementById("chat-box");

function holeUhrzeit() {
  const jetzt = new Date();
  return `${String(jetzt.getHours()).padStart(2, "0")}:${String(jetzt.getMinutes()).padStart(2, "0")}`;
}

function nachrichtHinzufuegen(text, typ) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("nachricht-wrapper", typ === "benutzer" ? "wrapper-benutzer" : "wrapper-bot");

  if (typ === "bot") {
    const avatar = document.createElement("div");
    avatar.classList.add("bot-avatar-klein");
    avatar.textContent = "GZ";
    wrapper.appendChild(avatar);
  }

  const nachrichtElement = document.createElement("div");
  nachrichtElement.classList.add("nachricht", typ === "benutzer" ? "benutzer-nachricht" : "bot-nachricht");

  const textElement = document.createElement("span");
  textElement.classList.add("nachricht-text");
  textElement.textContent = text;

  const zeitElement = document.createElement("span");
  zeitElement.classList.add("nachricht-zeit");
  zeitElement.textContent = holeUhrzeit();

  nachrichtElement.appendChild(textElement);
  nachrichtElement.appendChild(zeitElement);
  wrapper.appendChild(nachrichtElement);
  chatBox.appendChild(wrapper);

  chatBox.scrollTop = chatBox.scrollHeight;
}

// Quick-Reply-Vorschläge
function vorschlaegeEntfernen() {
  const alt = document.getElementById("vorschlaege");
  if (alt) alt.remove();
}

function vorschlaegeAnzeigen(vorschlaege) {
  vorschlaegeEntfernen();
  if (!vorschlaege || vorschlaege.length === 0) return;

  const container = document.createElement("div");
  container.id = "vorschlaege";
  container.classList.add("vorschlaege");

  for (const vorschlag of vorschlaege) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.classList.add("vorschlag-chip");
    chip.textContent = vorschlag;
    chip.addEventListener("click", () => sendeNachricht(vorschlag));
    container.appendChild(chip);
  }

  chatBox.appendChild(container);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Nachricht senden
function sendeNachricht(nachricht) {
  const text = nachricht.trim();
  if (!text) return;

  vorschlaegeEntfernen();
  nachrichtHinzufuegen(text, "benutzer");
  socket.emit("benutzer-nachricht", text);
  nachrichtInput.value = "";
  nachrichtInput.focus();
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendeNachricht(nachrichtInput.value);
});

// Beispielfragen in der Seitenleiste
document.querySelectorAll(".beispiel-frage").forEach((element) => {
  element.addEventListener("click", () => {
    sendeNachricht(element.dataset.frage || element.textContent);
  });
});

// Tipp-Indikator
function tippIndikatorAnzeigen() {
  const wrapper = document.createElement("div");
  wrapper.classList.add("nachricht-wrapper", "wrapper-bot");
  wrapper.id = "tipp-indikator";

  const avatar = document.createElement("div");
  avatar.classList.add("bot-avatar-klein");
  avatar.textContent = "GZ";

  const indikator = document.createElement("div");
  indikator.classList.add("nachricht", "bot-nachricht", "tipp-indikator");
  indikator.innerHTML = "<span></span><span></span><span></span>";

  wrapper.appendChild(avatar);
  wrapper.appendChild(indikator);
  chatBox.appendChild(wrapper);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function tippIndikatorEntfernen() {
  const indikator = document.getElementById("tipp-indikator");
  if (indikator) indikator.remove();
}

socket.on("bot-yaziyor", () => {
  vorschlaegeEntfernen();
  tippIndikatorAnzeigen();
});

socket.on("bot-nachricht", (daten) => {
  tippIndikatorEntfernen();

  const text = typeof daten === "string" ? daten : daten.text;
  const vorschlaege = typeof daten === "object" ? daten.vorschlaege : null;

  // Leeren Text nicht als Blase anzeigen (Bot schweigt, nur Buttons bleiben)
  if (text && text.trim()) nachrichtHinzufuegen(text, "bot");
  vorschlaegeAnzeigen(vorschlaege);
});
