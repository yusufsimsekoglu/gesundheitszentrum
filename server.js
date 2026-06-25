// Server: Express + Socket.IO

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const BotController = require("./classes/BotController");
const SessionMemory = require("./services/sessionMemory");
const pagesRouter = require("./routes/pages");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Antworten + Szenario aus JSON laden
const responsesPath = path.join(__dirname, "data", "responses.json");
const responses = JSON.parse(fs.readFileSync(responsesPath, "utf-8"));
const scenarioPath = path.join(__dirname, "data", "scenario.json");
const scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));

const sessionMemory = new SessionMemory();
const botController = new BotController(responses, sessionMemory);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use("/", pagesRouter);

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "pages", "404.html"));
});

// Quick-Reply-Vorschläge je nach Sitzungszustand
function holeVorschlaege(socketId) {
  const sitzung = sessionMemory.holeSitzung(socketId);

  if (!sitzung.aktuellerProzess) {
    return scenario.vorschlaege.standard;
  }
  return scenario.vorschlaege[sitzung.aktuellerSchritt] || scenario.vorschlaege.prozess;
}

io.on("connection", (socket) => {
  console.log("Ein Benutzer ist verbunden:", socket.id);

  socket.emit("bot-nachricht", {
    text: botController.holeBegruessung(),
    vorschlaege: holeVorschlaege(socket.id)
  });

  socket.on("benutzer-nachricht", async (nachricht) => {
    console.log("Benutzer:", nachricht);

    socket.emit("bot-yaziyor");
    const antwort = await botController.verarbeiteNachricht(socket.id, nachricht);

    if (antwort && typeof antwort === "object") {
      socket.emit("bot-nachricht", {
        text: antwort.text ?? "",
        vorschlaege: antwort.vorschlaege || holeVorschlaege(socket.id)
      });
    } else {
      socket.emit("bot-nachricht", {
        text: antwort,
        vorschlaege: holeVorschlaege(socket.id)
      });
    }
  });

  socket.on("disconnect", () => {
    sessionMemory.loescheSitzung(socket.id);
    console.log("Ein Benutzer ist getrennt:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
