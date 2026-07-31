// --------------------------
// CONFIGURATION
// --------------------------
export const MAX_CONCURRENT_JOBS = 6;

// --------------------------
// STANDALONE JOB STATE
// Map<jobCompanyKey, jobState> — allows multiple concurrent jobs
// --------------------------
export const standaloneJobs = new Map();

// --------------------------
// CRON SCHEDULER STATE
// Map<jobCompanyKey, cronState> — allows multiple concurrent schedules
// --------------------------
export const cronSchedulers = new Map();

// --------------------------
// KEY HELPERS
// --------------------------
export function jobKey(jobId, companyName) {
  return `${jobId}:${companyName || "_default"}`;
}

export function jobKeyDisplay(key) {
  const [jobId, company] = key.split(":");
  return company === "_default" ? jobId : `${jobId} [company: ${company}]`;
}
