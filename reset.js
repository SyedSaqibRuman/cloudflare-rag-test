import "dotenv/config";
import { deleteVectorIndex, createVectorIndex } from "./services/vectorize.js";// reset.js (add these lines)
import { clearBucket } from "./services/r2.js";

await deleteVectorIndex();
console.log("Deleted.");
await createVectorIndex();
console.log("Recreated with 768 dimensions.");
await clearBucket();
