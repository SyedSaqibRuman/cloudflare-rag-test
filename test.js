export default function testingMethod({ signal, companyName } = {}) {
  const ts = () => new Date().toISOString();
  console.log(`[${ts()}] Testing job started for company: ${companyName || "(default)"}`);
}
