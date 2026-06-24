// Termine: speichern, suchen, stornieren, verschieben

const fs = require("fs");
const path = require("path");

const TERMINE_PFAD = path.join(__dirname, "../data/termine.json");
const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf-8"));

function ladeTermine() {
  try {
    return JSON.parse(fs.readFileSync(TERMINE_PFAD, "utf-8"));
  } catch {
    return [];
  }
}

function speichereTermine(termine) {
  fs.writeFileSync(TERMINE_PFAD, JSON.stringify(termine, null, 2), "utf-8");
}

// true wenn Slot frei
function pruefeVerfuegbarkeit(datum, uhrzeit) {
  const termine = ladeTermine();
  return !termine.some(t => t.datum === datum && t.uhrzeit === uhrzeit);
}

function bucheTermin(daten) {
  const termine = ladeTermine();
  const termin = { id: Date.now().toString(), ...daten, erstellt: new Date().toISOString() };
  termine.push(termin);
  speichereTermine(termine);
  return termin;
}

// Termin per Name + Datum suchen
function findeTermin(name, datum) {
  const termine = ladeTermine();
  const normName = name.toLowerCase().trim();
  return termine.find(t => t.name.toLowerCase().trim() === normName && t.datum === datum) || null;
}

function storniereTermin(id) {
  const termine = ladeTermine();
  const index = termine.findIndex(t => t.id === id);
  if (index === -1) return false;
  termine.splice(index, 1);
  speichereTermine(termine);
  return true;
}

function verschiebeTermin(id, neuesDatum, neueUhrzeit) {
  const termine = ladeTermine();
  const termin = termine.find(t => t.id === id);
  if (!termin) return false;
  termin.datum = neuesDatum;
  termin.uhrzeit = neueUhrzeit;
  speichereTermine(termine);
  return true;
}

// Alle Termine eines Namens
function findeTermineNachName(name) {
  const termine = ladeTermine();
  const normName = name.toLowerCase().trim();
  return termine.filter(t => t.name.toLowerCase().trim() === normName);
}

// true wenn diese E-Mail in den letzten 24 Stunden schon gebucht hat
function hatKuerzlichGebucht(email) {
  if (!email) return false;
  const termine = ladeTermine();
  const normEmail = email.toLowerCase().trim();
  const grenze = Date.now() - 24 * 60 * 60 * 1000;
  return termine.some(t =>
    (t.email || "").toLowerCase().trim() === normEmail &&
    t.erstellt && new Date(t.erstellt).getTime() >= grenze
  );
}

// Freie Slots innerhalb der Öffnungszeiten
function findeFreieSlots(datum, gewuenschteUhrzeit) {
  const { start, ende } = scenario.oeffnungszeiten;
  const intervall = scenario.slotIntervallMinuten;
  const max = scenario.maxSlotVorschlaege;

  // Wunschzeit in Minuten (nahe Slots zuerst)
  const [wStunde, wMinute] = gewuenschteUhrzeit.split(":").map(Number);
  const wunschMinuten = wStunde * 60 + wMinute;

  const freie = [];
  for (let m = start * 60; m < ende * 60; m += intervall) {
    const uhrzeit = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (pruefeVerfuegbarkeit(datum, uhrzeit)) {
      freie.push({ uhrzeit, abstand: Math.abs(m - wunschMinuten) });
    }
  }

  return freie
    .sort((a, b) => a.abstand - b.abstand)
    .slice(0, max)
    .map(s => s.uhrzeit)
    .sort();
}

module.exports = { pruefeVerfuegbarkeit, bucheTermin, findeTermin, findeTermineNachName, findeFreieSlots, storniereTermin, verschiebeTermin, hatKuerzlichGebucht };
