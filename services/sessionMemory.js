// Gesprächsspeicher pro Socket-ID

class SessionMemory {
  constructor() {
    this.sitzungen = new Map();
  }

  holeStandardSitzung() {
    return {
      aktuellerProzess: null,
      aktuellerSchritt: null,
      daten: {},
      verlauf: [],
      vorgeschlagenerFachbereich: null,
      letzteNachricht: "",
      wiederholungsZaehler: 0,
      fallbackZaehler: 0,
      schrittFehler: 0,
      abbruchAngebot: false
    };
  }

  holeSitzung(socketId) {
    if (!this.sitzungen.has(socketId)) {
      this.sitzungen.set(socketId, this.holeStandardSitzung());
    }

    return this.sitzungen.get(socketId);
  }

  setzeProzess(socketId, prozessName, schrittName = null) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.aktuellerProzess = prozessName;
    sitzung.aktuellerSchritt = schrittName;
  }

  setzeSchritt(socketId, schrittName) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.aktuellerSchritt = schrittName;
  }

  speichereDatum(socketId, schluessel, wert) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.daten[schluessel] = wert;
  }

  holeDatum(socketId, schluessel) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.daten[schluessel];
  }

  holeAlleDaten(socketId) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.daten;
  }

  // Aktion für die Abschiedszusammenfassung merken
  protokolliereAktion(socketId, eintrag) {
    const sitzung = this.holeSitzung(socketId);
    if (!sitzung.verlauf.includes(eintrag)) {
      sitzung.verlauf.push(eintrag);
    }
  }

  holeVerlauf(socketId) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.verlauf;
  }

  // Fachbereich-Vorschlag aus einer Gegenfrage
  setzeFachbereichVorschlag(socketId, fachbereich) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.vorgeschlagenerFachbereich = fachbereich;
  }

  holeFachbereichVorschlag(socketId) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.vorgeschlagenerFachbereich;
  }

  setzeLetzteNachricht(socketId, nachricht) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.letzteNachricht = nachricht;
  }

  holeLetzteNachricht(socketId) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.letzteNachricht;
  }

  erhoeheWiederholungsZaehler(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.wiederholungsZaehler += 1;
    return sitzung.wiederholungsZaehler;
  }

  setzeWiederholungsZaehlerZurueck(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.wiederholungsZaehler = 0;
  }

  erhoeheFallbackZaehler(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.fallbackZaehler += 1;
    return sitzung.fallbackZaehler;
  }

  setzeFallbackZaehlerZurueck(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.fallbackZaehler = 0;
  }

  erhoeheSchrittFehler(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.schrittFehler += 1;
    return sitzung.schrittFehler;
  }

  setzeSchrittFehlerZurueck(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.schrittFehler = 0;
    sitzung.abbruchAngebot = false;
  }

  setzeAbbruchAngebot(socketId, wert) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.abbruchAngebot = wert;
  }

  holeAbbruchAngebot(socketId) {
    const sitzung = this.holeSitzung(socketId);
    return sitzung.abbruchAngebot;
  }

  // Prozess beenden, Daten zurücksetzen
  beendeProzess(socketId) {
    const sitzung = this.holeSitzung(socketId);
    sitzung.aktuellerProzess = null;
    sitzung.aktuellerSchritt = null;
    sitzung.daten = {};
    sitzung.fallbackZaehler = 0;
    sitzung.schrittFehler = 0;
    sitzung.abbruchAngebot = false;
  }

  loescheSitzung(socketId) {
    this.sitzungen.delete(socketId);
  }
}

module.exports = SessionMemory;
