import { getConfig, resolvePromptVariables } from "../config/index.js";

// --------------------------
// HELPERS
// --------------------------
export const generateUrl = (url, label = "") =>
  `[${label ? label : url}](${url})`;

// --------------------------
// SYSTEM MESSAGE
// --------------------------
export function getSystemMessage(companyName, systemPromptOverride = null, assistantName = null, variables = []) {
  const config = getConfig(companyName);
  // The selected assistant's system prompt replaces the company default; the
  // {{VARIABLES}} templating resolves with the assistant name overriding
  // CONSULTANT_NAME when one is selected.
  const template = systemPromptOverride || config.SYSTEM_PROMPT || "";
  const content = resolvePromptVariables(template, config, { assistantName, variables });
  return { role: "system", content };
}

// --------------------------
// STATIC RESPONSES
// --------------------------
export function buildResponses(companyName, assistantName = null) {
  const config = getConfig(companyName);
  const companyNameStr = config.COMPANY_NAME || "the company";
  const consultantName = assistantName || config.CONSULTANT_NAME || "Assistant";
  const contactUsUrl = config.CONTACT_US_URL || "#";
  const locationsUrl = config.LOCATIONS_URL || "#";
  const servicesUrl = config.SERVICES_URL || "#";

  return {
    greeting: `Hello! Welcome to ${companyNameStr}. How can I assist you with your certification needs today?`,
    identity: `I'm ${consultantName}, an AI assistant at ${companyNameStr}. How can I help you today?`,
    contact: `Looks like this needs a bit more personalized assistance.\n\nPlease fill out the contact form below and one of our experts will reach out to you shortly:\n\n${generateUrl(contactUsUrl, "Contact Us")}`,
    blocked: "I'm not able to find relevant information regarding your query.",
    noContext: `I'm not able to find relevant information regarding your query. Please contact our team directly for further assistance.\n\n${generateUrl(contactUsUrl, "Contact Us")}`,
    invalid: "Please enter a valid question.",
    error: "An error occurred. Please try again.",
    vague: "Could you clarify what you're looking for? For example, are you interested in the certification process, cost, eligibility, benefits, or something else?",
    discovery:
      "I'd love to help you get certified! To point you in the right direction:\n\n**Which standard are you looking to get certified for?**\n*(e.g. ISO 9001, ISO 14001, ISO 27001, CE Mark, Halal, etc.)*",
    office: `We are a global organization. You can explore our locations on our locations page: ${generateUrl(locationsUrl, "Our Locations")}`,
    help: `I'm here to assist you! You can tell me what you're looking for, or explore our range of services here: ${generateUrl(servicesUrl, "Our Services")}`,
  };
}
