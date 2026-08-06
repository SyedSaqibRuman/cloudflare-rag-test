import testingMethod from "./cron/testing-job.js";
import { main as ingest } from "./ingest.js";

export default {
  testing: {
    id: "testing",
    name: "Testing Job",
    description: "Runs test workflow",
    handler: testingMethod,
  },

  ingest: {
    id: "ingest",
    name: "Ingest Job",
    description: "Runs ingest workflow",
    handler: ingest,
  },
};
