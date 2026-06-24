// Chatbot-Logik

const fs = require("fs");
const path = require("path");
const { erkenneIntentMitCLU } = require("../services/cluService");
const { pruefeVerfuegbarkeit, bucheTermin, findeTermin, findeTermineNachName, findeFreieSlots, storniereTermin, verschiebeTermin, hatKuerzlichGebucht } = require("../services/terminService");
const { sendeVerifizierungsCode } = require("../services/mailService");

const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf-8"));
const FACHBEREICHE = scenario.fachbereiche;
const MONATE = scenario.monate;

class BotController {
  constructor(responses, sessionMemory) {
    this.responses = responses;
    this.sessionMemory = sessionMemory;
  }

  zufaelligeAntwort(liste) {
    return liste[Math.floor(Math.random() * liste.length)];
  }

  // {platzhalter} im Text ersetzen
  fuelleVorlage(vorlage, daten) {
    return vorlage.replace(/\{(\w+)\}/g, (_, key) => daten[key] ?? "");
  }

  istBestaetigung(text) {
    return scenario.bestaetigungWoerter.some(w => text.includes(w));
  }

  istAblehnung(text) {
    return scenario.ablehnungWoerter.some(w => text.includes(w));
  }

  istAbbruch(text) {
    const norm = this.normalisiereText(text);
    return scenario.abbruchWoerter.some(w => norm.includes(w));
  }

  // Nach 2 Fehlern Abbruch anbieten
  mitSchrittFehler(socketId, fehlermeldung) {
    const fehler = this.sessionMemory.erhoeheSchrittFehler(socketId);
    if (fehler >= 2) {
      this.sessionMemory.setzeAbbruchAngebot(socketId, true);
      return { text: this.responses.abbruchAngebot, vorschlaege: scenario.vorschlaege.abbruchAngebot };
    }
    return fehlermeldung;
  }

  // Levenshtein-Distanz (Tippfehler)
  levenshtein(a, b) {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return matrix[a.length][b.length];
  }

  // Freie Slots vorschlagen wenn besetzt
  holeSlotVorschlag(datum, gewuenschteUhrzeit, besetztText) {
    const freieSlots = findeFreieSlots(datum, gewuenschteUhrzeit);
    if (freieSlots.length === 0) return this.responses.keineSlotsFrei;
    const text = `${besetztText}\n${this.fuelleVorlage(this.responses.slotVorschlag, { slots: freieSlots.join(", ") })}`;
    return { text, vorschlaege: [...freieSlots, "Abbrechen"] };
  }

  normalisiereText(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[?!.,;:()[\]{}"'`´'„""_-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  fuehreNullHinzu(wert) {
    return String(wert).padStart(2, "0");
  }

  datumZuString(datum) {
    return `${this.fuehreNullHinzu(datum.getDate())}.${this.fuehreNullHinzu(datum.getMonth() + 1)}.${datum.getFullYear()}`;
  }

  // Nächsten Wochentag berechnen
  erkenneWochentag(normText) {
    const wochentage = scenario.wochentage;
    const praefixe  = scenario.wochentagPraefixe;

    let zielTag = null;
    let istUebernachste = false;

    for (const [name, tagNr] of Object.entries(wochentage)) {
      if (!normText.includes(name)) continue;

      zielTag = tagNr;

      const hatUebernachste = ["ubernachste", "ubernachsten"].some(p => normText.includes(p));
      istUebernachste = hatUebernachste;
      break;
    }

    if (zielTag === null) return null;

    const heute = new Date();
    heute.setHours(0, 0, 0, 0);
    const heuteTag = heute.getDay(); // 0=So … 6=Sa

    let diff = (zielTag - heuteTag + 7) % 7;
    if (diff === 0) diff = 7; // heute -> nächste Woche
    if (istUebernachste) diff += 7;

    const ergebnis = new Date(heute);
    ergebnis.setDate(heute.getDate() + diff);
    return this.datumZuString(ergebnis);
  }

  // Datum aus Zahlen oder Monatsnamen erkennen
  formatiereDatum(eingabe) {
    const normText = this.normalisiereText(eingabe);
    const aktuellesJahr = new Date().getFullYear();

    // "heute" / "morgen" / "übermorgen"
    if (normText === "heute") {
      return this.datumZuString(new Date());
    }
    if (normText === "morgen") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return this.datumZuString(d);
    }
    if (normText === "ubermorgen") {
      const d = new Date();
      d.setDate(d.getDate() + 2);
      return this.datumZuString(d);
    }

    // "nächsten Donnerstag", "kommenden Montag", "diesen Freitag", "Donnerstag" usw.
    const wochentagDatum = this.erkenneWochentag(normText);
    if (wochentagDatum) return wochentagDatum;

    // Monatsname suchen (z.B. "07 Juli", "Juli 7", "7. Juli 2026")
    for (const [monatsName, monatsNummer] of Object.entries(MONATE)) {
      if (normText.includes(monatsName)) {
        const ohneMonat = normText.replace(monatsName, " ");
        const zahlen = ohneMonat.match(/\d+/g) || [];

        let tag = null;
        let jahr = aktuellesJahr;

        if (zahlen.length >= 2) {
          const a = parseInt(zahlen[0]);
          const b = parseInt(zahlen[1]);
          // Unterscheide Tag von Jahr
          if (b > 31) {
            tag = a;
            jahr = b;
          } else {
            tag = a;
            jahr = b < 100 ? 2000 + b : b;
          }
        } else if (zahlen.length === 1) {
          tag = parseInt(zahlen[0]);
        }

        if (!tag || tag < 1 || tag > 31) return null;
        const tageImMonat = new Date(jahr, monatsNummer, 0).getDate();
        if (tag > tageImMonat) return null;

        return `${this.fuehreNullHinzu(tag)}.${this.fuehreNullHinzu(monatsNummer)}.${jahr}`;
      }
    }

    // Zahlenformat: dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy
    const bereinigt = eingabe.trim().replace(/[/-]/g, ".");
    const teile = bereinigt.split(".").filter(Boolean);

    if (teile.length !== 3) return null;

    let [tag, monat, jahr] = teile;

    if (!/^\d{1,2}$/.test(tag) || !/^\d{1,2}$/.test(monat) || !/^\d{2,4}$/.test(jahr)) {
      return null;
    }

    tag = Number(tag);
    monat = Number(monat);
    jahr = Number(jahr);

    if (jahr < 100) jahr += 2000;
    if (monat < 1 || monat > 12) return null;

    const tageImMonat = new Date(jahr, monat, 0).getDate();
    if (tag < 1 || tag > tageImMonat) return null;

    return `${this.fuehreNullHinzu(tag)}.${this.fuehreNullHinzu(monat)}.${jahr}`;
  }

  // Zahlwörter -> Ziffern ("elf" -> "11")
  ersetzeZahlwoerter(text) {
    let ergebnis = text;
    const woerter = Object.keys(scenario.zahlwoerter).sort((a, b) => b.length - a.length);
    for (const wort of woerter) {
      ergebnis = ergebnis.replace(new RegExp(`\\b${wort}\\b`, "g"), String(scenario.zahlwoerter[wort]));
    }
    return ergebnis;
  }

  // Uhrzeit erkennen
  formatiereUhrzeit(eingabe) {
    // Zahlwörter + Füllwörter entfernen
    let norm = this.ersetzeZahlwoerter(this.normalisiereText(eingabe));
    norm = norm.replace(/\b(um|gegen|circa|ca|etwa|so)\b/g, " ").replace(/\s+/g, " ").trim();

    // "halb 11" → 10:30
    const halbMatch = norm.match(/^halb\s+(\d{1,2})$/);
    if (halbMatch) {
      const stunde = Number(halbMatch[1]) - 1;
      if (stunde < 0 || stunde > 23) return null;
      return `${this.fuehreNullHinzu(stunde)}:30`;
    }

    // "Viertel nach 10" → 10:15
    const viertelNachMatch = norm.match(/viertel\s+nach\s+(\d{1,2})/);
    if (viertelNachMatch) {
      const stunde = Number(viertelNachMatch[1]);
      if (stunde > 23) return null;
      return `${this.fuehreNullHinzu(stunde)}:15`;
    }

    // "Viertel vor 11" → 10:45
    const viertelVorMatch = norm.match(/viertel\s+vor\s+(\d{1,2})/);
    if (viertelVorMatch) {
      const stunde = Number(viertelVorMatch[1]) - 1;
      if (stunde < 0 || stunde > 23) return null;
      return `${this.fuehreNullHinzu(stunde)}:45`;
    }

    // "10 Uhr 30" oder "10 Uhr"
    const uhrMatch = norm.match(/(\d{1,2})\s*uhr\s*(\d{0,2})/);
    if (uhrMatch) {
      const stunde = Number(uhrMatch[1]);
      const minute = uhrMatch[2] ? Number(uhrMatch[2]) : 0;
      if (stunde > 23 || minute > 59) return null;
      return `${this.fuehreNullHinzu(stunde)}:${this.fuehreNullHinzu(minute)}`;
    }

    // Reine Zahl: "10" → 10:00
    if (/^\d{1,2}$/.test(norm)) {
      const stunde = Number(norm);
      if (stunde > 23) return null;
      return `${this.fuehreNullHinzu(stunde)}:00`;
    }

    // 4-stellig: "1030" → 10:30
    if (/^\d{3,4}$/.test(norm)) {
      const padded = norm.padStart(4, "0");
      const stunde = Number(padded.slice(0, 2));
      const minute = Number(padded.slice(2, 4));
      if (stunde > 23 || minute > 59) return null;
      return `${this.fuehreNullHinzu(stunde)}:${this.fuehreNullHinzu(minute)}`;
    }

    // "10 30" (auch aus "10:30" / "10.30" durch die Normalisierung)
    const teile = norm.split(" ");
    if (teile.length === 2 && /^\d{1,2}$/.test(teile[0]) && /^\d{1,2}$/.test(teile[1])) {
      const stunde = Number(teile[0]);
      const minute = Number(teile[1]);
      if (stunde > 23 || minute > 59) return null;
      return `${this.fuehreNullHinzu(stunde)}:${this.fuehreNullHinzu(minute)}`;
    }

    return null;
  }

  normalisiereFachbereich(text) {
    const normalisiert = this.normalisiereText(text);
    const schluessel = Object.keys(FACHBEREICHE).find(k => normalisiert.includes(k));
    if (schluessel) return FACHBEREICHE[schluessel];

    // Tippfehler: Levenshtein <= 2
    for (const wort of normalisiert.split(" ")) {
      if (wort.length < 5) continue;
      for (const key of Object.keys(FACHBEREICHE)) {
        if (this.levenshtein(wort, key) <= 2) return FACHBEREICHE[key];
      }
    }

    return null;
  }

  istVergangenesDatum(formatiertesDatum) {
    const [tag, monat, jahr] = formatiertesDatum.split(".").map(Number);
    const eingabe = new Date(jahr, monat - 1, tag);
    const heute = new Date();
    heute.setHours(0, 0, 0, 0);
    return eingabe < heute;
  }

  istWochenende(formatiertesDatum) {
    const [tag, monat, jahr] = formatiertesDatum.split(".").map(Number);
    const wochentag = new Date(jahr, monat - 1, tag).getDay();
    return wochentag === 0 || wochentag === 6;
  }

  istAusserOeffnungszeiten(formatierteUhrzeit) {
    const [stunde, minute] = formatierteUhrzeit.split(":").map(Number);
    const minuten = stunde * 60 + minute;
    const { start, ende } = scenario.oeffnungszeiten;
    return minuten < start * 60 || minuten >= ende * 60;
  }

  istGueltigeTelefonnummer(text) {
    const bereinigt = text.replace(/[\s\-()+]/g, "");
    return /^\d{6,15}$/.test(bereinigt);
  }

  istGueltigeEmail(text) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());
  }

  istWiederholteNachricht(socketId, nachricht) {
    const normalisierteNachricht = this.normalisiereText(nachricht);
    const letzteNachricht = this.normalisiereText(
      this.sessionMemory.holeLetzteNachricht(socketId) || ""
    );

    if (!normalisierteNachricht) return false;

    if (normalisierteNachricht === letzteNachricht) {
      this.sessionMemory.setzeLetzteNachricht(socketId, nachricht);
      const anzahl = this.sessionMemory.erhoeheWiederholungsZaehler(socketId);
      if (anzahl >= 1) return true;
    } else {
      this.sessionMemory.setzeLetzteNachricht(socketId, nachricht);
      this.sessionMemory.setzeWiederholungsZaehlerZurueck(socketId);
    }

    return false;
  }

  holeProzessHinweis(schritt) {
    return this.responses.prozessHinweise[schritt] || this.responses.prozessHinweise.allgemein;
  }

  // Persönliche Angaben bei der Buchung
  holeBuchungsKette() {
    const t = this.responses.termine;
    return [
      { feld: "name", schritt: "name", frage: t.frageName },
      { feld: "telefon", schritt: "telefon", frage: t.frageTelefon },
      { feld: "email", schritt: "email", frage: t.frageEmail }
    ];
  }

  holeBuchungsZiel() {
    return { schritt: "datum", frage: this.responses.termine.frageDatum };
  }

  // Persönliche Angaben bei Verschiebung/Absage
  holeVerschiebeKette() {
    const t = this.responses.termineVerschieben;
    return [
      { feld: "name", schritt: "name", frage: t.frageName },
      { feld: "telefon", schritt: "telefon", frage: t.frageTelefon }
    ];
  }

  holeAbsageKette() {
    const t = this.responses.termineAbsagen;
    return [
      { feld: "name", schritt: "name", frage: t.frageName },
      { feld: "telefon", schritt: "telefon", frage: t.frageTelefon }
    ];
  }

  // Nächsten Schritt setzen und die passende Frage stellen
  weiterMitBekanntenDaten(socketId, kette, ziel) {
    const naechster = kette.length > 0 ? kette[0] : ziel;
    this.sessionMemory.setzeSchritt(socketId, naechster.schritt);
    return naechster.frage;
  }

  // Persönliche Variante wenn Name bekannt
  persoenlichOder(name, standard, vorlageMitName) {
    return name ? this.fuelleVorlage(vorlageMitName, { name }) : standard;
  }

  // Buchung direkt mit bekanntem Fachbereich starten
  starteBuchungMitFachbereich(socketId, fachbereich) {
    this.sessionMemory.setzeProzess(socketId, "termin_buchen", "fachbereich");
    this.sessionMemory.speichereDatum(socketId, "fachbereich", fachbereich);
    this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);

    const bestaetigt = this.fuelleVorlage(this.responses.termine.fachbereichErkannt, { fachbereich });
    return `${bestaetigt}\n${this.weiterMitBekanntenDaten(socketId, this.holeBuchungsKette(), this.holeBuchungsZiel())}`;
  }

  // Gegenfrage: bei Beschwerde-Wörtern Richtung Buchung lenken
  holeGegenfrage(socketId, nachricht) {
    const norm = this.normalisiereText(nachricht);
    const passt = (wort) => new RegExp(`(^|[^a-zäöüß])${wort}`).test(norm);

    for (const regel of scenario.gegenfragen) {
      if (regel.woerter.some(passt)) {
        this.sessionMemory.setzeFachbereichVorschlag(socketId, regel.fachbereich);
        return this.fuelleVorlage(this.responses.gegenfrage, { fachbereich: regel.fachbereich });
      }
    }
    return null;
  }

  // Wort-Spotting mit Regeln aus scenario.json
  // (kurze Wörter <= 3 Zeichen nur als ganzes Wort)
  erkenneIntent(nachricht) {
    const text = nachricht.toLowerCase();

    const passt = (wort) => {
      if (wort.length <= 3) {
        return new RegExp(`(^|[^a-zäöüß])${wort}($|[^a-zäöüß])`).test(text);
      }
      return text.includes(wort);
    };

    for (const regel of scenario.intentRegeln) {
      const alle = regel.alle || [];
      const eine = regel.eine || [];
      if (alle.length === 0 && eine.length === 0) continue;

      const alleOk = alle.every(passt);
      const eineOk = eine.length === 0 || eine.some(passt);

      if (alleOk && eineOk) return regel.intent;
    }

    return "fallback";
  }

  istAllgemeineIntentNachricht(intent) {
    return ["oeffnungszeiten", "adresse", "kontakt", "termin_buchen", "termin_verschieben", "termin_absagen", "meine_termine"].includes(intent);
  }

  zeigeTermine(name) {
    const termine = findeTermineNachName(name);

    if (termine.length === 0) {
      return this.responses.meineTermine.keineGefunden;
    }

    const liste = termine
      .map(t => `• ${t.datum} um ${t.uhrzeit}${t.fachbereich ? ` (${t.fachbereich})` : ""}`)
      .join("\n");

    return `${this.responses.meineTermine.listeKopf}\n${liste}`;
  }

  // Termine anzeigen (nur Name nötig)
  verarbeiteTerminAnzeige(socketId, nachricht) {
    const name = nachricht.trim().replace(/\s+/g, " ").slice(0, 80);
    const hatBuchstaben = /[a-zA-ZäöüÄÖÜß]/.test(name);
    if (name.length < 2 || !hatBuchstaben) return this.responses.termine.ungueltigerName;
    this.sessionMemory.beendeProzess(socketId);
    return this.zeigeTermine(name);
  }

  // Buchung Schritt für Schritt
  async verarbeiteBuchungsprozess(socketId, nachricht) {
    const sitzung = this.sessionMemory.holeSitzung(socketId);
    const schritt = sitzung.aktuellerSchritt;
    const freieEingabeSchritte = ["name", "telefon", "email", "email_code"];
    const intent = this.erkenneIntent(nachricht);

    if (schritt !== "bestaetigung" && !freieEingabeSchritte.includes(schritt) && this.istAllgemeineIntentNachricht(intent)) {
      return this.holeProzessHinweis(schritt);
    }

    if (schritt === "fachbereich") {
      const fachbereich = this.normalisiereFachbereich(nachricht);
      if (!fachbereich) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigerFachbereich);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "fachbereich", fachbereich);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.weiterMitBekanntenDaten(socketId, this.holeBuchungsKette(), this.holeBuchungsZiel());
    }

    if (schritt === "name") {
      const name = nachricht.trim().replace(/\s+/g, " ").slice(0, 80);
      const hatBuchstaben = /[a-zA-ZäöüÄÖÜß]/.test(name);
      if (name.length < 2 || !hatBuchstaben) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigerName);
      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "name", name);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.weiterMitBekanntenDaten(socketId, this.holeBuchungsKette().slice(1), this.holeBuchungsZiel());
    }

    if (schritt === "telefon") {
      if (!this.istGueltigeTelefonnummer(nachricht)) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigeTelefon);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      const telefon = nachricht.trim();
      this.sessionMemory.speichereDatum(socketId, "telefon", telefon);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.weiterMitBekanntenDaten(socketId, this.holeBuchungsKette().slice(2), this.holeBuchungsZiel());
    }

    if (schritt === "email") {
      if (!this.istGueltigeEmail(nachricht)) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigeEmail);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      const email = nachricht.trim();
      this.sessionMemory.speichereDatum(socketId, "email", email);

      // Pro E-Mail nur eine Buchung innerhalb von 24 Stunden
      if (hatKuerzlichGebucht(email)) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termine.bereitsGebucht;
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      this.sessionMemory.speichereDatum(socketId, "emailCode", code);
      this.sessionMemory.speichereDatum(socketId, "emailCodeAblauf", Date.now() + 10 * 60 * 1000);
      this.sessionMemory.speichereDatum(socketId, "emailCodeVersuche", 0);

      try {
        await sendeVerifizierungsCode(email, code);
        this.sessionMemory.setzeSchritt(socketId, "email_code");
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.fuelleVorlage(this.responses.termine.emailVerifizierungGesendet, { email });
      } catch (err) {
        console.error("E-Mail-Versand fehlgeschlagen:", err.message, err.code || "");
        this.sessionMemory.setzeSchritt(socketId, "email");
        return this.responses.termine.emailCodeFehler;
      }
    }

    if (schritt === "email_code") {
      const norm = nachricht.trim().toLowerCase();
      const email = this.sessionMemory.holeDatum(socketId, "email");

      if (norm.includes("neu senden") || norm.includes("code neu") || norm.includes("neuen code") || norm.includes("nochmal")) {
        const neuerCode = Math.floor(100000 + Math.random() * 900000).toString();
        this.sessionMemory.speichereDatum(socketId, "emailCode", neuerCode);
        this.sessionMemory.speichereDatum(socketId, "emailCodeAblauf", Date.now() + 10 * 60 * 1000);
        this.sessionMemory.speichereDatum(socketId, "emailCodeVersuche", 0);
        try {
          await sendeVerifizierungsCode(email, neuerCode);
          return this.fuelleVorlage(this.responses.termine.emailCodeNeusenden, { email });
        } catch (err) {
          console.error("E-Mail-Versand fehlgeschlagen:", err.message);
          return this.responses.termine.emailCodeFehler;
        }
      }

      const gespeicherterCode = this.sessionMemory.holeDatum(socketId, "emailCode");
      const ablauf = this.sessionMemory.holeDatum(socketId, "emailCodeAblauf");
      let versuche = this.sessionMemory.holeDatum(socketId, "emailCodeVersuche") || 0;

      if (Date.now() > ablauf) {
        return this.responses.termine.emailCodeAbgelaufen;
      }

      if (versuche >= 3) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termine.emailCodeMaxVersuche;
      }

      if (nachricht.trim() !== gespeicherterCode) {
        this.sessionMemory.speichereDatum(socketId, "emailCodeVersuche", versuche + 1);
        return this.mitSchrittFehler(socketId, this.responses.termine.emailCodeFalsch);
      }

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      this.sessionMemory.setzeSchritt(socketId, "datum");
      return this.responses.termine.frageDatum;
    }

    if (schritt === "datum") {
      const formatiertesDatum = this.formatiereDatum(nachricht);
      if (!formatiertesDatum) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigesDatum);
      if (this.istVergangenesDatum(formatiertesDatum)) return this.responses.termine.vergangenesDatum;
      if (this.istWochenende(formatiertesDatum)) return this.responses.termine.wochenendeDatum;

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "datum", formatiertesDatum);
      this.sessionMemory.setzeSchritt(socketId, "uhrzeit");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.responses.termine.frageUhrzeit;
    }

    if (schritt === "uhrzeit") {
      const formatierteUhrzeit = this.formatiereUhrzeit(nachricht);
      if (!formatierteUhrzeit) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigeUhrzeit);
      if (this.istAusserOeffnungszeiten(formatierteUhrzeit)) return this.responses.termine.ausserOeffnungszeiten;

      const datum = this.sessionMemory.holeDatum(socketId, "datum");
      if (!pruefeVerfuegbarkeit(datum, formatierteUhrzeit)) {
        return this.holeSlotVorschlag(datum, formatierteUhrzeit, this.responses.termine.slotBesetzt);
      }

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "uhrzeit", formatierteUhrzeit);

      const daten = this.sessionMemory.holeAlleDaten(socketId);
      const zusammenfassung =
        this.fuelleVorlage(this.responses.zusammenfassung.buchung, daten) +
        `\n\n${this.responses.termine.bestaetigungFrage}`;

      this.sessionMemory.setzeSchritt(socketId, "bestaetigung");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return zusammenfassung;
    }

    if (schritt === "bestaetigung") {
      const text = nachricht.toLowerCase();

      if (this.istBestaetigung(text)) {
        const daten = this.sessionMemory.holeAlleDaten(socketId);
        // Nochmal prüfen (Parallelzugriff)
        if (!pruefeVerfuegbarkeit(daten.datum, daten.uhrzeit)) {
          this.sessionMemory.setzeSchritt(socketId, "uhrzeit");
          return this.holeSlotVorschlag(daten.datum, daten.uhrzeit, this.responses.termine.slotBesetzt);
        }
        if (hatKuerzlichGebucht(daten.email)) {
          this.sessionMemory.beendeProzess(socketId);
          return this.responses.termine.bereitsGebucht;
        }
        bucheTermin(daten);
        this.sessionMemory.protokolliereAktion(socketId, this.fuelleVorlage(this.responses.verlauf.buchung, daten));
        const name = daten.name;
        this.sessionMemory.beendeProzess(socketId);
        return this.persoenlichOder(name, this.responses.termine.bestaetigungJa, this.responses.termine.bestaetigungJaMitName);
      }

      if (this.istAblehnung(text)) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termine.bestaetigungNein;
      }

      return this.mitSchrittFehler(socketId, this.responses.termine.bestaetigungUnklar);
    }

    return this.zufaelligeAntwort(this.responses.fallback);
  }

  // Verschiebung Schritt für Schritt
  verarbeiteVerschiebungsprozess(socketId, nachricht) {
    const sitzung = this.sessionMemory.holeSitzung(socketId);
    const schritt = sitzung.aktuellerSchritt;
    const freieEingabeSchritte = ["name", "telefon"];
    const intent = this.erkenneIntent(nachricht);

    if (schritt !== "bestaetigung" && !freieEingabeSchritte.includes(schritt) && this.istAllgemeineIntentNachricht(intent)) {
      return this.holeProzessHinweis(schritt);
    }

    if (schritt === "name") {
      const name = nachricht.trim().replace(/\s+/g, " ").slice(0, 80);
      const hatBuchstaben = /[a-zA-ZäöüÄÖÜß]/.test(name);
      if (name.length < 2 || !hatBuchstaben) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigerName);
      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "name", name);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.weiterMitBekanntenDaten(socketId, this.holeVerschiebeKette().slice(1), {
        schritt: "altesDatum",
        frage: this.responses.termineVerschieben.frageAltesDatum
      });
    }

    if (schritt === "telefon") {
      if (!this.istGueltigeTelefonnummer(nachricht)) return this.mitSchrittFehler(socketId, this.responses.termineVerschieben.ungueltigeTelefon);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      const telefon = nachricht.trim();
      this.sessionMemory.speichereDatum(socketId, "telefon", telefon);
      this.sessionMemory.setzeSchritt(socketId, "altesDatum");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.responses.termineVerschieben.frageAltesDatum;
    }

    if (schritt === "altesDatum") {
      const datum = this.formatiereDatum(nachricht);
      if (!datum) return this.mitSchrittFehler(socketId, this.responses.termineVerschieben.ungueltigesDatum);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      const name = this.sessionMemory.holeDatum(socketId, "name");
      const termin = findeTermin(name, datum);

      if (!termin) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termineVerschieben.nichtGefunden;
      }

      this.sessionMemory.speichereDatum(socketId, "altesDatum", datum);
      this.sessionMemory.speichereDatum(socketId, "terminId", termin.id);
      this.sessionMemory.setzeSchritt(socketId, "neuesDatum");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.responses.termineVerschieben.frageNeuesDatum;
    }

    if (schritt === "neuesDatum") {
      const datum = this.formatiereDatum(nachricht);
      if (!datum) return this.mitSchrittFehler(socketId, this.responses.termineVerschieben.ungueltigesDatum);
      if (this.istVergangenesDatum(datum)) return this.responses.termine.vergangenesDatum;
      if (this.istWochenende(datum)) return this.responses.termine.wochenendeDatum;

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "neuesDatum", datum);
      this.sessionMemory.setzeSchritt(socketId, "neueUhrzeit");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.responses.termineVerschieben.frageNeueUhrzeit;
    }

    if (schritt === "neueUhrzeit") {
      const uhrzeit = this.formatiereUhrzeit(nachricht);
      if (!uhrzeit) return this.mitSchrittFehler(socketId, this.responses.termineVerschieben.ungueltigeUhrzeit);
      if (this.istAusserOeffnungszeiten(uhrzeit)) return this.responses.termine.ausserOeffnungszeiten;

      const neuesDatum = this.sessionMemory.holeDatum(socketId, "neuesDatum");
      if (!pruefeVerfuegbarkeit(neuesDatum, uhrzeit)) {
        return this.holeSlotVorschlag(neuesDatum, uhrzeit, this.responses.termineVerschieben.slotBesetzt);
      }

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "neueUhrzeit", uhrzeit);

      const daten = this.sessionMemory.holeAlleDaten(socketId);
      const zusammenfassung =
        this.fuelleVorlage(this.responses.zusammenfassung.verschiebung, daten) +
        `\n\n${this.responses.termineVerschieben.bestaetigungFrage}`;

      this.sessionMemory.setzeSchritt(socketId, "bestaetigung");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return zusammenfassung;
    }

    if (schritt === "bestaetigung") {
      const text = nachricht.toLowerCase();

      if (this.istBestaetigung(text)) {
        const daten = this.sessionMemory.holeAlleDaten(socketId);
        verschiebeTermin(daten.terminId, daten.neuesDatum, daten.neueUhrzeit);
        this.sessionMemory.protokolliereAktion(socketId, this.fuelleVorlage(this.responses.verlauf.verschiebung, daten));
        const name = daten.name;
        this.sessionMemory.beendeProzess(socketId);
        return this.persoenlichOder(name, this.responses.termineVerschieben.bestaetigungJa, this.responses.termineVerschieben.bestaetigungJaMitName);
      }

      if (this.istAblehnung(text)) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termineVerschieben.bestaetigungNein;
      }

      return this.mitSchrittFehler(socketId, this.responses.termineVerschieben.bestaetigungUnklar);
    }

    return this.zufaelligeAntwort(this.responses.fallback);
  }

  // Absage Schritt für Schritt
  verarbeiteAbsageprozess(socketId, nachricht) {
    const sitzung = this.sessionMemory.holeSitzung(socketId);
    const schritt = sitzung.aktuellerSchritt;
    const freieEingabeSchritte = ["name", "telefon"];
    const intent = this.erkenneIntent(nachricht);

    if (schritt !== "bestaetigung" && !freieEingabeSchritte.includes(schritt) && this.istAllgemeineIntentNachricht(intent)) {
      return this.holeProzessHinweis(schritt);
    }

    if (schritt === "name") {
      const name = nachricht.trim().replace(/\s+/g, " ").slice(0, 80);
      const hatBuchstaben = /[a-zA-ZäöüÄÖÜß]/.test(name);
      if (name.length < 2 || !hatBuchstaben) return this.mitSchrittFehler(socketId, this.responses.termine.ungueltigerName);
      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "name", name);
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.weiterMitBekanntenDaten(socketId, this.holeAbsageKette().slice(1), {
        schritt: "datum",
        frage: this.responses.termineAbsagen.frageDatum
      });
    }

    if (schritt === "telefon") {
      if (!this.istGueltigeTelefonnummer(nachricht)) return this.mitSchrittFehler(socketId, this.responses.termineAbsagen.ungueltigeTelefon);

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      const telefon = nachricht.trim();
      this.sessionMemory.speichereDatum(socketId, "telefon", telefon);
      this.sessionMemory.setzeSchritt(socketId, "datum");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return this.responses.termineAbsagen.frageDatum;
    }

    if (schritt === "datum") {
      const datum = this.formatiereDatum(nachricht);
      if (!datum) return this.mitSchrittFehler(socketId, this.responses.termineAbsagen.ungueltigesDatum);

      const name = this.sessionMemory.holeDatum(socketId, "name");
      const termin = findeTermin(name, datum);

      if (!termin) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termineAbsagen.nichtGefunden;
      }

      this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
      this.sessionMemory.speichereDatum(socketId, "datum", datum);
      this.sessionMemory.speichereDatum(socketId, "terminId", termin.id);
      this.sessionMemory.speichereDatum(socketId, "uhrzeit", termin.uhrzeit);

      const daten = this.sessionMemory.holeAlleDaten(socketId);
      const zusammenfassung =
        this.fuelleVorlage(this.responses.zusammenfassung.absage, daten) +
        `\n\n${this.responses.termineAbsagen.bestaetigungFrage}`;

      this.sessionMemory.setzeSchritt(socketId, "bestaetigung");
      this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
      return zusammenfassung;
    }

    if (schritt === "bestaetigung") {
      const text = nachricht.toLowerCase();

      if (this.istBestaetigung(text)) {
        const daten = this.sessionMemory.holeAlleDaten(socketId);
        storniereTermin(daten.terminId);
        this.sessionMemory.protokolliereAktion(socketId, this.fuelleVorlage(this.responses.verlauf.absage, daten));
        const name = daten.name;
        this.sessionMemory.beendeProzess(socketId);
        return this.persoenlichOder(name, this.responses.termineAbsagen.bestaetigungJa, this.responses.termineAbsagen.bestaetigungJaMitName);
      }

      if (this.istAblehnung(text)) {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.termineAbsagen.bestaetigungNein;
      }

      return this.mitSchrittFehler(socketId, this.responses.termineAbsagen.bestaetigungUnklar);
    }

    return this.zufaelligeAntwort(this.responses.fallback);
  }

  holeErweitertenFallback(socketId) {
    const fallbackZaehler = this.sessionMemory.erhoeheFallbackZaehler(socketId);

    if (fallbackZaehler >= 3) return this.responses.erweiterterFallback.stufe3;
    if (fallbackZaehler === 2) return this.responses.erweiterterFallback.stufe2;

    return this.zufaelligeAntwort(this.responses.fallback);
  }

  // Einstiegspunkt: Wiederholung erkennen, Anfrage trotzdem ausführen
  async verarbeiteNachricht(socketId, nachricht) {
    const istWiederholung = this.istWiederholteNachricht(socketId, nachricht);
    const antwort = await this.verarbeiteNachrichtKern(socketId, nachricht);

    if (istWiederholung) {
      const prefix = this.zufaelligeAntwort(this.responses.wiederholung);
      if (antwort && typeof antwort === "object" && antwort.text) {
        return { ...antwort, text: `${prefix}\n${antwort.text}` };
      }
      return `${prefix}\n${antwort}`;
    }
    return antwort;
  }

  // Nachricht auswerten und passenden Prozess starten
  async verarbeiteNachrichtKern(socketId, nachricht) {
    const sitzung = this.sessionMemory.holeSitzung(socketId);

    // Laufenden Prozess abbrechen
    if (sitzung.aktuellerProzess && this.istAbbruch(nachricht)) {
      this.sessionMemory.beendeProzess(socketId);
      return this.responses.prozessAbbruch;
    }

    // Abbruch-Angebot: nur "nein"/"weiter" macht weiter
    if (sitzung.abbruchAngebot) {
      const norm = this.normalisiereText(nachricht);
      const willWeiter = norm.includes("nein") || norm.includes("weiter") || norm.includes("fortfahren");
      if (willWeiter) {
        this.sessionMemory.setzeSchrittFehlerZurueck(socketId);
        const schritt = sitzung.aktuellerSchritt;
        const prozess = sitzung.aktuellerProzess;
        const antworten = prozess === "termin_buchen" ? this.responses.termine
                        : prozess === "termin_verschieben" ? this.responses.termineVerschieben
                        : this.responses.termineAbsagen;

        if (schritt === "bestaetigung") {
          const daten = this.sessionMemory.holeAlleDaten(socketId);
          const vorlageKey = prozess === "termin_buchen" ? "buchung"
                           : prozess === "termin_verschieben" ? "verschiebung" : "absage";
          const zusammenfassung = this.fuelleVorlage(this.responses.zusammenfassung[vorlageKey], daten);
          return `Gut, kein Problem.\n\n${zusammenfassung}\n\n${antworten.bestaetigungFrage}`;
        }

        const frageKey = {
          datum: "frageDatum", uhrzeit: "frageUhrzeit",
          telefon: "frageTelefon", email: "frageEmail", name: "frageName",
          altesDatum: "frageAltesDatum", neuesDatum: "frageNeuesDatum", neueUhrzeit: "frageNeueUhrzeit"
        }[schritt];
        const frage = (frageKey && antworten[frageKey]) || "Bitte versuchen Sie es erneut.";
        return `Gut, kein Problem. ${frage}`;
      } else {
        this.sessionMemory.beendeProzess(socketId);
        return this.responses.prozessAbbruch;
      }
    }

    if (sitzung.aktuellerProzess === "termin_buchen") {
      return await this.verarbeiteBuchungsprozess(socketId, nachricht);
    }
    if (sitzung.aktuellerProzess === "termin_verschieben") {
      return this.verarbeiteVerschiebungsprozess(socketId, nachricht);
    }
    if (sitzung.aktuellerProzess === "termin_absagen") {
      return this.verarbeiteAbsageprozess(socketId, nachricht);
    }
    if (sitzung.aktuellerProzess === "termine_anzeigen") {
      return this.verarbeiteTerminAnzeige(socketId, nachricht);
    }

    // Offene Gegenfrage: bei Zustimmung Buchung starten
    const vorschlag = this.sessionMemory.holeFachbereichVorschlag(socketId);
    if (vorschlag) {
      this.sessionMemory.setzeFachbereichVorschlag(socketId, null);
      if (this.istBestaetigung(nachricht.toLowerCase())) {
        return this.starteBuchungMitFachbereich(socketId, vorschlag);
      }
      if (this.istAblehnung(nachricht.toLowerCase())) {
        return this.responses.gegenfrageAbgelehnt;
      }
    }

    let intent;
    let entities = {};

    try {
      const cluErgebnis = await erkenneIntentMitCLU(nachricht);
      intent = cluErgebnis.intent;
      entities = cluErgebnis.entities;
    } catch (err) {
      console.error("CLU nicht erreichbar, Fallback zu Word-Spotting:", err.message);
      intent = this.erkenneIntent(nachricht);
    }

    // Intents, die CLU nicht kennt, per Word-Spotting
    const lokaleIntents = ["meine_termine", "Befinden", "BotIdentitaet", "Faehigkeiten", "Lob", "Unmut"];
    const wsVorabIntent = this.erkenneIntent(nachricht);
    if (lokaleIntents.includes(wsVorabIntent)) {
      intent = wsVorabIntent;
    }

    // Konversations-Intents nur mit Word-Spotting bestätigen
    const konversationsIntents = ["Begruessung", "Danke", "Verabschiedung"];
    if (konversationsIntents.includes(intent)) {
      const wsIntent = this.erkenneIntent(nachricht);
      if (!konversationsIntents.includes(wsIntent)) {
        intent = wsIntent;
      }
    }

    // CLU nichts erkannt -> Word-Spotting
    if (intent === "fallback" || intent === "None") {
      intent = this.erkenneIntent(nachricht);
    }

    switch (intent) {
      case "Termin_Buchen":
      case "termin_buchen": {
        // Fachbereich von CLU -> Schritt überspringen
        if (entities.Fachbereich) {
          const fachbereich = this.normalisiereFachbereich(entities.Fachbereich);
          if (fachbereich) {
            return this.starteBuchungMitFachbereich(socketId, fachbereich);
          }
        }

        this.sessionMemory.setzeProzess(socketId, "termin_buchen", "fachbereich");
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.responses.termine.buchenStart;
      }

      case "Termin_Verschieben":
      case "termin_verschieben": {
        this.sessionMemory.setzeProzess(socketId, "termin_verschieben", "name");
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        const weiter = this.weiterMitBekanntenDaten(socketId, this.holeVerschiebeKette(), {
          schritt: "altesDatum",
          frage: this.responses.termineVerschieben.frageAltesDatum
        });
        return `${this.responses.termineVerschieben.verschiebenStart}\n${weiter}`;
      }

      case "Termin_Absagen":
      case "termin_absagen": {
        this.sessionMemory.setzeProzess(socketId, "termin_absagen", "name");
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        const weiter = this.weiterMitBekanntenDaten(socketId, this.holeAbsageKette(), {
          schritt: "datum",
          frage: this.responses.termineAbsagen.frageDatum
        });
        return `${this.responses.termineAbsagen.absagenStart}\n${weiter}`;
      }

      case "Meine_Termine":
      case "meine_termine": {
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        this.sessionMemory.setzeProzess(socketId, "termine_anzeigen", "name");
        return this.responses.meineTermine.frageName;
      }

      case "Oeffnungszeiten":
      case "oeffnungszeiten":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        this.sessionMemory.protokolliereAktion(socketId, this.responses.verlauf.oeffnungszeiten);
        return this.zufaelligeAntwort(this.responses.oeffnungszeiten);

      case "Adresse":
      case "adresse":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        this.sessionMemory.protokolliereAktion(socketId, this.responses.verlauf.adresse);
        return this.zufaelligeAntwort(this.responses.adresse);

      case "Kontakt":
      case "kontakt":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        this.sessionMemory.protokolliereAktion(socketId, this.responses.verlauf.kontakt);
        return this.zufaelligeAntwort(this.responses.kontakt);

      case "Begruessung":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.begruessung_antwort);

      case "Danke":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.danke_antwort);

      case "Verabschiedung": {
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        const abschied = this.zufaelligeAntwort(this.responses.verabschiedung_antwort);

        // Gesprächszusammenfassung am Ende
        const verlauf = this.sessionMemory.holeVerlauf(socketId);
        if (verlauf.length === 0) return abschied;

        const kopf = this.responses.verlaufZusammenfassung.kopf;
        const liste = verlauf.map(eintrag => `• ${eintrag}`).join("\n");
        return `${abschied}\n\n${kopf}\n${liste}`;
      }

      case "Befinden":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.befinden_antwort);

      case "BotIdentitaet":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.identitaet_antwort);

      case "Faehigkeiten":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.faehigkeiten_antwort);

      case "Lob":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.lob_antwort);

      case "Unmut":
        this.sessionMemory.setzeFallbackZaehlerZurueck(socketId);
        return this.zufaelligeAntwort(this.responses.unmut_antwort);

      default:
        // Vor dem Fallback per Gegenfrage Richtung Buchung lenken
        return this.holeGegenfrage(socketId, nachricht) || this.holeErweitertenFallback(socketId);
    }
  }

  holeBegruessung() {
    return this.zufaelligeAntwort(this.responses.begruessung);
  }
}

module.exports = BotController;
