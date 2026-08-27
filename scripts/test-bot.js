import fs from "fs";
import axios from "axios";
import { setTimeout as sleep } from "timers/promises";

const API_URL = "http://localhost:3000/ask";
const questions = JSON.parse(fs.readFileSync("./questions.json", "utf8"));

console.log(`Loaded ${questions.length} questions`);

function escapeCSV(value) {
  return `"${String(value ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

async function askQuestion(question) {
  const start = Date.now();
  try {
    const { data, status } = await axios.post(API_URL, { question, history: [] }, {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    });
    return { success: true, answer: data.answer || "", responseTimeMs: Date.now() - start, status, cached: data.cached ?? null, sourcesCount: data.sources?.length || 0 };
  } catch (error) {
    return { success: false, answer: "", responseTimeMs: Date.now() - start, status: error.response?.status || null, cached: null, sourcesCount: 0, error: error.response?.data?.message || error.message || "Unknown error" };
  }
}

async function run() {
  const jsonStream = fs.createWriteStream("results.json");
  const csvStream = fs.createWriteStream("results.csv");

  jsonStream.write("[\n");
  csvStream.write("Question;Answer;Success;Status;ResponseTimeMs;SourcesCount;Cached;Error\n");

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`[${i + 1}/${questions.length}] ${question}`);

    const result = await askQuestion(question);
    const row = { question, ...result };

    // Write JSON entry
    jsonStream.write((i > 0 ? ",\n" : "") + JSON.stringify(row, null, 2));

    // Write CSV row immediately
    csvStream.write([
      escapeCSV(row.question), escapeCSV(row.answer), row.success,
      row.status ?? "", row.responseTimeMs, row.sourcesCount,
      row.cached, escapeCSV(row.error || ""),
    ].join(";") + "\n");

    if (i < questions.length - 1) await sleep(3000);
  }

  jsonStream.end("\n]");
  csvStream.end();
  console.log("\nDone! Saved to results.json and results.csv");
}

run();
