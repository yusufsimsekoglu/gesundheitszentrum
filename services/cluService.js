// Azure CLU-API: Intent + Entities

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const scenario = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf-8"));

async function erkenneIntentMitCLU(text) {
  const endpoint = process.env.CLU_ENDPOINT;
  const apiKey = process.env.CLU_API_KEY;
  const projectName = process.env.CLU_PROJECT_NAME;
  const deploymentName = process.env.CLU_DEPLOYMENT_NAME;

  const url = `${endpoint}/language/:analyze-conversations?api-version=2023-04-01`;

  const body = {
    kind: "Conversation",
    analysisInput: {
      conversationItem: {
        id: "1",
        text: text,
        modality: "text",
        language: "de",
        participantId: "user"
      }
    },
    parameters: {
      projectName: projectName,
      deploymentName: deploymentName,
      verbose: false,
      stringIndexType: "TextElement_V8"
    }
  };

  const response = await axios.post(url, body, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/json"
    }
  });

  const prediction = response.data.result.prediction;
  const topIntent = prediction.topIntent;
  const confidence = prediction.intents.find(i => i.category === topIntent)?.confidenceScore ?? 0;

  // Zu niedrige Konfidenz -> Fallback
  if (confidence < scenario.cluKonfidenz || topIntent === "None") {
    return { intent: "fallback", entities: {} };
  }

  const entities = {};
  if (prediction.entities && prediction.entities.length > 0) {
    for (const entity of prediction.entities) {
      entities[entity.category] = entity.text;
    }
  }

  return { intent: topIntent, entities };
}

module.exports = { erkenneIntentMitCLU };
