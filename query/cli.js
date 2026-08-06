import "dotenv/config";
import readline from "readline";
import { getConfig, initConfig } from "../config/index.js";
import { askQuestion } from "./answer.js";
import { MAX_HISTORY } from "./llm.js";

// --------------------------
// CLI MODE (node query/cli.js)
// The REPL is a separate module from the ask pipeline: answer.js owns the
// pipeline (askQuestion/askQuestionStream), this file owns the terminal UX.
// Run directly, never imported — the guard keeps app.js imports clean.
// --------------------------
if (process.argv[1]?.endsWith("query/cli.js")) {
  await initConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const history = [];
  let cliCompany = null;

  rl.question("🏢 Company name: ", (co) => {
    cliCompany = co.trim();
    if (!cliCompany) {
      console.log("❌ Company name is required. Exiting.");
      rl.close();
      return;
    }
    const config = getConfig(cliCompany);
    console.log(`\n🤖 ${config.CONSULTANT_NAME || "Assistant"} RAG System Active | Type 'exit' to quit.\n`);

    const ask = () => {
      rl.question("❓ Ask: ", async (q) => {
        const input = q.trim();
        if (!input) return ask();
        if (["exit", "quit"].includes(input.toLowerCase())) return rl.close();

        history.push({ role: "user", content: input });
        const res = await askQuestion(input, history, cliCompany);
        const consultantName = getConfig(cliCompany).CONSULTANT_NAME || "Assistant";
        console.log(`\n💡 ${consultantName}:\n${res.answer}\n`);
        history.push({ role: "assistant", content: res.answer });

        while (history.length > MAX_HISTORY * 2) history.splice(0, 2);
        ask();
      });
    };

    ask();
  });
}
