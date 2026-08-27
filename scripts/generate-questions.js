import fs from "fs";

const isoStandards = [
  "ISO 9001",
  "ISO 14001",
  "ISO 27001",
  "ISO 45001",
  "ISO 22000",
  "ISO 50001",
  "ISO 13485",
  "ISO 22301",
  "ISO 20000-1"
];

const industries = [
  "software company",
  "hospital",
  "school",
  "construction company",
  "manufacturer",
  "food factory",
  "restaurant",
  "logistics company",
  "HR agency",
  "BPO",
  "cybersecurity company",
  "cloud provider",
  "startup",
  "consulting company",
  "ecommerce company",
  "automotive company",
  "pharmaceutical company",
  "bank",
  "insurance company",
  "call center",
  "telecom company",
  "data center",
  "law firm",
  "accounting firm",
  "engineering company"
];

const countries = [
  "India",
  "USA",
  "Canada",
  "UK",
  "Germany",
  "France",
  "Australia",
  "Singapore",
  "UAE",
  "Saudi Arabia",
  "Qatar",
  "Oman",
  "Kuwait",
  "Bahrain",
  "South Africa"
];

const sizes = [
  "1 employee",
  "5 employees",
  "10 employees",
  "25 employees",
  "50 employees",
  "100 employees",
  "250 employees",
  "500 employees",
  "1000 employees"
];

const templates = [
  "What is {iso} for a {industry} in {country}?",
  "How much does {iso} cost for a {industry} in {country}?",
  "Can a {industry} with {size} get {iso} in {country}?",
  "How long does {iso} certification take for a {industry} in {country}?",
  "Do companies with {size} need {iso} in {country}?",
  "Is {iso} mandatory for a {industry} in {country}?",
  "What are the benefits of {iso} for a {industry}?",
  "Can you help a {industry} obtain {iso} in {country}?",
  "How much for a {industry} with {size} employees to get {iso}?",
  "Can startups with {size} get {iso} in {country}?",
  "What documents are needed for {iso} in a {industry}?",
  "Can I get {iso} this week in {country}?",
  "Can you provide a quote for {iso} for a {industry}?",
  "Will {iso} help a {industry} win tenders in {country}?",
  "Can {iso} increase sales for a {industry}?",
  "Can I get {iso} online in {country}?",
  "How often is {iso} renewed in {country}?",
  "What happens if a {industry} fails a {iso} audit?",
  "Is {iso} internationally recognized in {country}?",
  "Which ISO is best for a {industry} with {size} employees?",
  "Do customers require {iso} from a {industry}?",
  "How many days does {iso} implementation take for a {industry}?",
  "Can a {industry} export products without {iso}?",
  "Will government tenders in {country} require {iso}?",
  "Can a {industry} get certified remotely in {country}?"
];

const typoQuestions = [
  "ISO 90001",
  "ISO27001",
  "ISO 2700 certification",
  "ISO registation",
  "ISO aproval",
  "ISO certifcation",
  "Need ISO fast",
  "Need ISO urgent",
  "Need compliance",
  "Need certification ASAP",
  "Can buy ISO certificate?",
  "Need FDA ISO",
  "Need CE ISO",
  "Need ISO license",
  "Need ISO approval",
  "ISO 9001 and ISO 90001 same?",
  "Can u help with ISO?",
  "How much ISO cost?",
  "Need ISO now",
  "Want ISO certificate"
];

const vagueQuestions = [
  "Need certification",
  "Need compliance",
  "Need help",
  "Customer asking for ISO",
  "Need approval",
  "Need quote",
  "Need audit",
  "Need certificate urgently",
  "Need consultation",
  "Need certification this week"
];

const hindiQuestions = [
  "ISO certification kya hai?",
  "ISO 9001 ka cost kitna hai?",
  "ISO 27001 ka process kya hai?",
  "Meri company ke liye kaunsa ISO sahi hai?",
  "ISO certification kitne din me milta hai?",
  "ISO ka audit kaise hota hai?",
  "ISO certification mandatory hai kya?"
];

const arabicQuestions = [
  "ما هو ISO؟",
  "ما هي شهادة ISO 9001؟",
  "كم تكلفة شهادة ISO؟",
  "كيف أحصل على شهادة ISO؟",
  "هل ISO إلزامي؟",
  "كم يستغرق الحصول على شهادة ISO؟",
  "هل شهادة ISO معترف بها دولياً؟"
];

const questions = [];

for (const iso of isoStandards) {
  for (const industry of industries) {
    for (const country of countries) {
      for (const size of sizes) {
        for (const template of templates) {
          questions.push(
            template
              .replaceAll("{iso}", iso)
              .replaceAll("{industry}", industry)
              .replaceAll("{country}", country)
              .replaceAll("{size}", size)
          );
        }
      }
    }
  }
}

questions.push(...typoQuestions);
questions.push(...vagueQuestions);
questions.push(...hindiQuestions);
questions.push(...arabicQuestions);

const uniqueQuestions = [...new Set(questions)];

for (let i = uniqueQuestions.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [uniqueQuestions[i], uniqueQuestions[j]] = [
    uniqueQuestions[j],
    uniqueQuestions[i]
  ];
}

const finalQuestions = uniqueQuestions.slice(0, 10000);

fs.writeFileSync(
  "questions.json",
  JSON.stringify(finalQuestions, null, 2),
  "utf8"
);

console.log(`Generated ${finalQuestions.length} questions`);
console.log(`Total unique questions available: ${uniqueQuestions.length}`);
console.log("Saved to questions.json");
